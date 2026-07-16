// Verify half of the core loop (Task 11): the double-verification recheck.
// Every due PENDING gets a fresh snapshot; the edge is recomputed for the SAME
// legs (same book + selection, live prices); the tolerance gate decides promote
// vs kill. Stakes exist only from promotion onward. Also runs the sweeps:
// stale VERIFIED trades and PENDING trades whose event started expire.

import type { Leg, Quote, Trade } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { PipeDeps } from './scan.js';
import { arbMargin, devigFairProbs, evEdge, middleMetrics } from '../engine/odds.js';
import { arbStakesCents, kellyStakeCents } from '../engine/stakes.js';
import { mixAllowance, mixPct } from '../engine/mix.js';
import { passesToleranceGate } from '../engine/tolerance.js';
import { eligibleQuotes } from './eligibility.js';
import { dayKey } from '../scheduler/vancouverTime.js';

const PINNACLE = 'pinnacle';

export function runVerifyDue(deps: PipeDeps, now: number): { promoted: number; killed: number; expired: number } {
  const s = deps.s();
  const { repos } = deps;
  let promoted = 0;
  let killed = 0;
  let expired = 0;

  // Sweep 1: PENDING trades whose event started can never be bet — expire.
  for (const t of repos.trades.byStatus('PENDING')) {
    if (t.eventStartsAt <= now) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      expired += 1;
    }
  }
  // Sweep 2: VERIFIED trades older than staleRemoveMin past freshUntil — expire.
  for (const t of repos.trades.byStatus('VERIFIED')) {
    if (t.freshUntil !== null && now > t.freshUntil + s.staleRemoveMin * 60_000) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      expired += 1;
    }
  }

  const due = repos.trades.byStatus('PENDING').filter((t) => t.verifyDueAt <= now);
  if (due.length === 0) return { promoted, killed, expired };

  // ONE refetch per run, shared by every due trade (and cached for the UI).
  const quotes = deps.provider.fetchQuotes(now);
  deps.lastQuotes = quotes;
  // Plan 5: legs must still be ELIGIBLE (book on, sport on) — a disabled leg reads
  // as no-quote and the trade dies QUOTE_STALE. The benchmark keeps the FULL snapshot.
  const lookup = buildLookup(eligibleQuotes(quotes, repos.books.all(), s));
  const day = dayKey(now);

  for (const t of due) {
    // The SAME legs at live prices; any leg no longer quoted → the trade is dead air.
    const fresh: Quote[] = [];
    for (const leg of t.legs) {
      const q = findQuote(lookup, t.event, leg);
      if (!q) break;
      fresh.push(q);
    }
    if (fresh.length !== t.legs.length) {
      killTrade(repos, t, 'QUOTE_STALE');
      killed += 1;
      continue;
    }

    const recheck = recomputeEdge(t, fresh, quotes, s);
    if (recheck === null) {
      // EV benchmark vanished — the edge cannot be recomputed, same as a missing quote.
      killTrade(repos, t, 'QUOTE_STALE');
      killed += 1;
      continue;
    }

    t.marginRecheck = recheck.edge;
    if (!passesToleranceGate(t.marginInitial, recheck.edge, s.tolerancePct)) {
      t.status = 'KILLED';
      t.killReason = 'FAILED_VERIFICATION';
      repos.trades.update(t);
      killed += 1;
      continue;
    }

    // Stakes at the RECHECK odds — the prices the card will actually show.
    const odds = fresh.map((q) => q.odds);
    const staked = stakeAtRecheck(t, odds, recheck, s);
    if (staked === null) {
      // ARB only: the scan-time rounding gate re-applied at the odds actually
      // being staked — $5 rounding ate the margin, so the "sure thing" isn't.
      killTrade(repos, t, 'ROUNDING_DESTROYS_MARGIN');
      killed += 1;
      continue;
    }
    if (staked.stakes.every((st) => st === 0)) {
      // Defensive — unreachable with the bases above (flat-pair floors at
      // minStake; promoted EV entered at ≥2% edge): never alert a $0 card.
      t.status = 'EXPIRED';
      repos.trades.update(t);
      repos.journal.add(now, `${t.category} ${t.event} passed verification but was held back — zero stake.`);
      expired += 1;
      continue;
    }

    // Daily pick cap — SENT semantics: promoting stamps verified_at, so the
    // count grows as this loop promotes and the cap can fill mid-run.
    if (repos.trades.verifiedSentToday(day) >= s.dailyPickCap) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      repos.journal.add(now, `${t.category} ${t.event} passed verification but was held back — daily pick cap of ${s.dailyPickCap} already reached.`);
      expired += 1;
      continue;
    }

    // STRATEGY MIX — LOCKED TO 100 (Plan 5): the category's share of the daily cap.
    // Same SENT semantics as the cap; the clause feeds the brain's rationale panel.
    if (repos.trades.sentTodayByCategory(day, t.category) >= mixAllowance(t.category, s)) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      repos.journal.add(now, `${t.category} ${t.event} passed verification but was held back — ${t.category} mix at its ${mixPct(t.category, s)}% cap.`);
      expired += 1;
      continue;
    }

    promote(t, odds, staked, s, now);
    repos.trades.update(t);
    deps.sender.sendVerified(t);
    promoted += 1;
  }

  return { promoted, killed, expired };
}

interface Recheck {
  edge: number;
  /** Per-leg fair win probs for Kelly staking (EV only); null for ARB and MIDDLE (flat-pair split). */
  fairProbs: number[] | null;
}

function recomputeEdge(t: Trade, fresh: Quote[], all: Quote[], s: Settings): Recheck | null {
  const odds = fresh.map((q) => q.odds);
  switch (t.category) {
    case 'ARB':
      return { edge: arbMargin(odds), fairProbs: null };
    case 'EV': {
      // REFERENCE PRICER FALLBACK (Plan 5) — the recheck MIRRORS detection: pinnacle
      // when the anchor is up, else the leave-one-out consensus (fallback 0). Anchor
      // down + fallback 1/2 → no benchmark → the EV cannot be re-priced (QUOTE_STALE).
      const anchorUp = all.some((q) => q.book === PINNACLE);
      const p = anchorUp
        ? pinnacleFairProb(all, fresh[0]!)
        : s.anchorFallback === 0 ? consensusFairProb(all, fresh[0]!) : null;
      if (p === null) return null;
      return { edge: evEdge(p, odds[0]!), fairProbs: [p] };
    }
    case 'MIDDLE': {
      // Same tolerance-comparison basis as detection (candidates.ts). No fair
      // probs: a middle stakes by the flat-pair split, never by Kelly.
      const m = middleMetrics(odds[0]!, odds[1]!);
      return { edge: m.bothWinPayoutFrac - Math.max(m.costFrac, 0), fairProbs: null };
    }
  }
}

interface Staked {
  stakes: number[];
  marginFinal: number;
}

/**
 * Stakes at recheck odds (amended 2026-07-14). ARB and MIDDLE both take the
 * arbStakesCents flat-pair equal-payout split — a middle is two balanced
 * opposite bets; Kelly with devig-complementary probs is structurally ≤ 0 for
 * every costed middle and is NOT a middle staking basis. EV keeps Kelly; its
 * ≥2% entry threshold keeps the stake positive. Returns null only for an ARB
 * whose ROUNDED stakes no longer lock in a positive margin.
 */
function stakeAtRecheck(t: Trade, odds: number[], recheck: Recheck, s: Settings): Staked | null {
  if (t.category === 'EV') {
    return { stakes: odds.map((o, i) => kellyStakeCents(recheck.fairProbs![i]!, o, s)), marginFinal: recheck.edge };
  }
  const r = arbStakesCents(odds, s);
  if (t.category === 'ARB') {
    // The final margin is the one the ROUNDED stakes lock in; ≤ 0 → no arb.
    return r.roundedMargin <= 0 ? null : { stakes: r.stakes, marginFinal: r.roundedMargin };
  }
  // MIDDLE: split stakes, but the margin basis stays the recheck edge — a
  // middle is not an arb, and its roundedMargin means nothing.
  return { stakes: r.stakes, marginFinal: recheck.edge };
}

function promote(t: Trade, odds: number[], staked: Staked, s: Settings, now: number): void {
  // Legs take the verified prices — the alert says exactly what to bet, at what odds.
  t.legs = t.legs.map((leg, i) => ({ ...leg, odds: odds[i]!, stakeCents: staked.stakes[i]! }));
  t.status = 'VERIFIED';
  t.verifiedAt = now;
  t.freshUntil = now + s.freshWindowSecs * 1000;
  t.marginFinal = staked.marginFinal;
}

function killTrade(repos: PipeDeps['repos'], t: Trade, reason: 'QUOTE_STALE' | 'ROUNDING_DESTROYS_MARGIN'): void {
  t.status = 'KILLED';
  t.killReason = reason;
  repos.trades.update(t);
}

// ---- fresh-quote matching -------------------------------------------------

function legKey(event: string, book: string, selection: string): string {
  return `${event}\u0000${book}\u0000${selection}`;
}

function buildLookup(quotes: Quote[]): Map<string, Quote[]> {
  const map = new Map<string, Quote[]>();
  for (const q of quotes) {
    const key = legKey(q.event, q.book, q.selection);
    const list = map.get(key);
    if (list) list.push(q);
    else map.set(key, [q]);
  }
  return map;
}

/** The leg's live quote: same event + book + selection; ties (multiple lines) go to the odds nearest the stored price. */
function findQuote(lookup: Map<string, Quote[]>, event: string, leg: Leg): Quote | null {
  const list = lookup.get(legKey(event, leg.book, leg.selection));
  if (!list || list.length === 0) return null;
  let best = list[0]!;
  for (const q of list) {
    if (Math.abs(q.odds - leg.odds) < Math.abs(best.odds - leg.odds)) best = q;
  }
  return best;
}

/** |line| grouping key — mirrors detection so the recheck reads the same benchmark group. */
function lineGroup(q: Quote): string {
  return q.line === null ? 'ML' : String(Math.abs(q.line));
}

/** Devigged pinnacle fair prob for the leg quote's selection within its own event+market+line group. */
function pinnacleFairProb(all: Quote[], legQuote: Quote): number | null {
  const group = lineGroup(legQuote);
  const bestBySelection = new Map<string, Quote>();
  for (const q of all) {
    if (q.book !== PINNACLE || q.event !== legQuote.event || q.market !== legQuote.market) continue;
    if (lineGroup(q) !== group) continue;
    const cur = bestBySelection.get(q.selection);
    if (!cur || q.odds > cur.odds) bestBySelection.set(q.selection, q);
  }
  if (bestBySelection.size < 2) return null; // one-sided benchmark → no fair prob
  const selections = [...bestBySelection.keys()];
  const probs = devigFairProbs(selections.map((sel) => bestBySelection.get(sel)!.odds));
  const i = selections.indexOf(legQuote.selection);
  return i === -1 ? null : probs[i]!;
}

/** Leave-one-out consensus fair prob — the recheck mirror of detectEvsConsensus.
 *  Devigs the BEST odds per selection among books ≠ the leg's own book, within the
 *  leg's event+market+|line| group; must be a COMPLETE line (≥2 selections, all
 *  present among the ≠B books) or null — no self-referential, no partial de-vig. */
function consensusFairProb(all: Quote[], legQuote: Quote): number | null {
  const group = all.filter((q) =>
    q.event === legQuote.event && q.market === legQuote.market && lineGroup(q) === lineGroup(legQuote));
  const groupSelections = [...new Set(group.map((q) => q.selection))];
  if (groupSelections.length < 2) return null;
  const benchmark = new Map<string, Quote>();
  for (const q of group) {
    if (q.book === legQuote.book) continue; // leave-one-out: never benchmark against self
    const best = benchmark.get(q.selection);
    if (!best || q.odds > best.odds) benchmark.set(q.selection, q);
  }
  if (!groupSelections.every((sel) => benchmark.has(sel))) return null; // incomplete line
  const fair = devigFairProbs(groupSelections.map((sel) => benchmark.get(sel)!.odds));
  const i = groupSelections.indexOf(legQuote.selection);
  return i === -1 ? null : fair[i]!;
}
