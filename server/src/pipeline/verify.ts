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
import { passesToleranceGate } from '../engine/tolerance.js';
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
  const lookup = buildLookup(quotes);
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

    const recheck = recomputeEdge(t, fresh, quotes);
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

    // Daily pick cap — SENT semantics: promoting stamps verified_at, so the
    // count grows as this loop promotes and the cap can fill mid-run.
    if (repos.trades.verifiedSentToday(day) >= s.dailyPickCap) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      repos.journal.add(now, `${t.category} ${t.event} passed verification but was held back — daily pick cap of ${s.dailyPickCap} already reached.`);
      expired += 1;
      continue;
    }

    promote(t, fresh, recheck, s, now);
    repos.trades.update(t);
    deps.sender.sendVerified(t);
    promoted += 1;
  }

  return { promoted, killed, expired };
}

interface Recheck {
  edge: number;
  /** Per-leg fair win probs for Kelly staking; null for ARB (split staking). */
  fairProbs: number[] | null;
}

function recomputeEdge(t: Trade, fresh: Quote[], all: Quote[]): Recheck | null {
  const odds = fresh.map((q) => q.odds);
  switch (t.category) {
    case 'ARB':
      return { edge: arbMargin(odds), fairProbs: null };
    case 'EV': {
      const p = pinnacleFairProb(all, fresh[0]!);
      if (p === null) return null;
      return { edge: evEdge(p, odds[0]!), fairProbs: [p] };
    }
    case 'MIDDLE': {
      const m = middleMetrics(odds[0]!, odds[1]!);
      // Same tolerance-comparison basis as detection (candidates.ts).
      // Staking probs: the leg pair devigged as if complementary — the legs
      // overlap (both can win), so true win probs sum to 1 + P(both win) ≥ 1
      // and the devig is a conservative floor. Free middles Kelly positive;
      // a costed middle may Kelly to 0 (no stake is not a stake — no floor).
      return { edge: m.bothWinPayoutFrac - Math.max(m.costFrac, 0), fairProbs: devigFairProbs(odds) };
    }
  }
}

function promote(t: Trade, fresh: Quote[], recheck: Recheck, s: Settings, now: number): void {
  const odds = fresh.map((q) => q.odds);
  let stakes: number[];
  let marginFinal: number;
  if (t.category === 'ARB') {
    // Equal-payout split; the final margin is the one the ROUNDED stakes lock in.
    const r = arbStakesCents(odds, s);
    stakes = r.stakes;
    marginFinal = r.roundedMargin;
  } else {
    stakes = t.legs.map((_, i) => kellyStakeCents(recheck.fairProbs![i]!, odds[i]!, s));
    marginFinal = recheck.edge; // rounding does not move an EV/MIDDLE edge
  }
  // Legs take the verified prices — the alert says exactly what to bet, at what odds.
  t.legs = t.legs.map((leg, i) => ({ ...leg, odds: odds[i]!, stakeCents: stakes[i]! }));
  t.status = 'VERIFIED';
  t.verifiedAt = now;
  t.freshUntil = now + s.freshWindowSecs * 1000;
  t.marginFinal = marginFinal;
}

function killTrade(repos: PipeDeps['repos'], t: Trade, reason: 'QUOTE_STALE'): void {
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
