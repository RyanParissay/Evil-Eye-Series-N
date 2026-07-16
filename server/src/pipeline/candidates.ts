// Candidate detection — turns one quote snapshot into ARB / EV / MIDDLE
// candidates (Task 7's Candidate shape) for the kill battery. Pure function of
// (quotes, settings): no clock, no io, no randomness.
//
// Grouping discipline: quotes group by event + market + |line| (null line is
// its own group; |line| lets complementary signed spreads −3.5/+3.5 share a
// group while totals share their line naturally). Line groups are sacred —
// ARB legs and EV fair probs never mix lines; middles REQUIRE different lines
// by construction. Thresholds in Settings are PERCENT; engine edges are
// FRACTIONS — divide by 100 at every comparison.

import type { Quote } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Candidate } from '../engine/gates.js';
import { arbMargin, devigFairProbs, evEdge, middleMetrics } from '../engine/odds.js';

const PINNACLE = 'pinnacle';
const OVER = 'over';
const UNDER = 'under';
// Soccer h2h — the ONLY market sanctioned for 3-leg arbs (home/draw/away).
// Matches the sim provider's 1X2 identifiers (providers/simOdds.ts).
const SOCCER = 'soccer';
const SOCCER_H2H_MARKET = '1X2';

function toLeg(q: Quote): Candidate['legs'][number] {
  return { book: q.book, selection: q.selection, odds: q.odds, fetchedAt: q.fetchedAt };
}

/** Identity fields every leg of a group shares. */
function base(q: Quote): Pick<Candidate, 'sport' | 'event' | 'market' | 'eventStartsAt'> {
  return { sport: q.sport, event: q.event, market: q.market, eventStartsAt: q.eventStartsAt };
}

export function detectCandidates(quotes: Quote[], s: Settings): Candidate[] {
  // Engine odds math assumes odds > 1 — callers own hygiene, so drop garbage here.
  const clean = quotes.filter((q) => q.odds > 1);

  // REFERENCE PRICER FALLBACK (Plan 5, Design §4): binds ONLY when the snapshot
  // carries NO anchor at all. In sim the provider always quotes pinnacle, so this
  // is dormant until a live outage — proven by stub providers, never by faking one.
  //   0 (default) → FALL BACK TO CONSENSUS: EV devigs a leave-one-out benchmark.
  //   1           → PAUSE EV + MIDDLES; arbs continue.
  //   2           → PAUSE EVERYTHING.
  const anchorUp = clean.some((q) => q.book === PINNACLE);
  if (!anchorUp && s.anchorFallback === 2) return []; // PAUSE EVERYTHING

  const groups = new Map<string, Quote[]>();
  for (const q of clean) {
    const key = `${q.event}\u0000${q.market}\u0000${q.line === null ? 'ML' : Math.abs(q.line)}`;
    const group = groups.get(key);
    if (group) group.push(q);
    else groups.set(key, [q]);
  }

  const out: Candidate[] = [];
  for (const group of groups.values()) detectArbs(group, s, out); // arbs never need an anchor
  if (anchorUp) {
    for (const group of groups.values()) detectEvs(group, s, out);
    detectMiddles(clean, s, out);
  } else if (s.anchorFallback === 0) {
    for (const group of groups.values()) detectEvsConsensus(group, s, out);
    detectMiddles(clean, s, out); // middles need no anchor — they continue under consensus
  }
  // anchorFallback === 1 (anchor down): EV + MIDDLES paused; only the arbs above stand.
  return out;
}

/**
 * ARB: best odds per outcome across books within ONE line group; qualifies at
 * arbMargin ≥ minArbMarginPct/100. Two outcomes only, except soccer h2h (1X2)
 * groups, which require ALL THREE outcomes present — a 2-leg subset of a 1X2
 * market is a false arb (the unquoted draw beats both legs), so an incomplete
 * snapshot yields nothing.
 */
function detectArbs(group: Quote[], s: Settings, out: Candidate[]): void {
  const bestBySelection = new Map<string, Quote>();
  for (const q of group) {
    const best = bestBySelection.get(q.selection);
    if (!best || q.odds > best.odds) bestBySelection.set(q.selection, q);
  }
  const first = group[0]!;
  const soccerH2h = first.sport === SOCCER && first.market === SOCCER_H2H_MARKET;
  if (bestBySelection.size !== (soccerH2h ? 3 : 2)) return;
  const legs = [...bestBySelection.values()];
  const margin = arbMargin(legs.map((l) => l.odds));
  if (margin < s.minArbMarginPct / 100) return;
  out.push({ category: 'ARB', ...base(group[0]!), legs: legs.map(toLeg), edge: margin, fairProbs: null });
}

/**
 * EV: soft-book odds vs pinnacle devig fair prob, qualifying at
 * evEdge ≥ minEvEdgePct/100. Pinnacle must quote BOTH sides of the same line
 * group — one-sided benchmarks yield no fair prob, hence no candidate.
 */
function detectEvs(group: Quote[], s: Settings, out: Candidate[]): void {
  const pinnacleBySelection = new Map<string, Quote>();
  for (const q of group) {
    if (q.book !== PINNACLE) continue;
    const best = pinnacleBySelection.get(q.selection);
    if (!best || q.odds > best.odds) pinnacleBySelection.set(q.selection, q);
  }
  if (pinnacleBySelection.size < 2) return;
  const selections = [...pinnacleBySelection.keys()];
  const fair = devigFairProbs(selections.map((sel) => pinnacleBySelection.get(sel)!.odds));
  const fairBySelection = new Map(selections.map((sel, i) => [sel, fair[i]!]));
  for (const q of group) {
    if (q.book === PINNACLE) continue; // the benchmark is never the bet
    const fairProb = fairBySelection.get(q.selection);
    if (fairProb === undefined) continue; // selection pinnacle never priced → no fair prob
    const edge = evEdge(fairProb, q.odds);
    if (edge < s.minEvEdgePct / 100) continue;
    out.push({ category: 'EV', ...base(q), legs: [toLeg(q)], edge, fairProbs: [fairProb] });
  }
}

/**
 * Consensus EV (anchor down, fallback 0): a LEAVE-ONE-OUT benchmark. For each book
 * B, the fair line devigs the BEST odds per selection among books ≠ B, so a book is
 * NEVER measured against its own price — no self-referential edge (mirrors detectEvs's
 * pinnacle exclusion). Two guards keep it honest: the group must carry ≥ 2 distinct
 * selections (a lone outcome de-vigs to a phantom 1.0), and the ≠B benchmark must be a
 * COMPLETE line — every selection in the group represented among the ≠B books — or a
 * partial de-vig (e.g. 2-of-3 soccer 1X2) manufactures phantom edges; incomplete →
 * emit nothing for B. Only a price that beats the OTHERS' best-price consensus qualifies.
 */
function detectEvsConsensus(group: Quote[], s: Settings, out: Candidate[]): void {
  const groupSelections = [...new Set(group.map((q) => q.selection))];
  if (groupSelections.length < 2) return; // a single outcome is not a de-vig-able market
  const books = new Set(group.map((q) => q.book));
  for (const book of books) {
    const benchmark = new Map<string, Quote>();
    for (const q of group) {
      if (q.book === book) continue; // leave-one-out: B is excluded from its own benchmark
      const best = benchmark.get(q.selection);
      if (!best || q.odds > best.odds) benchmark.set(q.selection, q);
    }
    if (!groupSelections.every((sel) => benchmark.has(sel))) continue; // incomplete line → skip B
    const fair = devigFairProbs(groupSelections.map((sel) => benchmark.get(sel)!.odds));
    const fairBySelection = new Map(groupSelections.map((sel, i) => [sel, fair[i]!]));
    for (const q of group) {
      if (q.book !== book) continue;
      const fairProb = fairBySelection.get(q.selection)!;
      const edge = evEdge(fairProb, q.odds);
      if (edge < s.minEvEdgePct / 100) continue;
      out.push({ category: 'EV', ...base(q), legs: [toLeg(q)], edge, fairProbs: [fairProb] });
    }
  }
}

/**
 * MIDDLE: best-priced over vs under on DIFFERENT lines of the same
 * event+market, with overLine < underLine (anything else can't both win).
 * Qualification is the locked seam in engine/odds.ts: free OR
 * ratio ≥ middleRatio. edge = bothWinPayoutFrac − max(costFrac, 0) — a
 * tolerance-comparison basis only, not an expected value.
 */
function detectMiddles(quotes: Quote[], s: Settings, out: Candidate[]): void {
  // event+market → best quote per selection+line
  const markets = new Map<string, Map<string, Quote>>();
  for (const q of quotes) {
    if (q.line === null || (q.selection !== OVER && q.selection !== UNDER)) continue;
    const marketKey = `${q.event}\u0000${q.market}`;
    let bySide = markets.get(marketKey);
    if (!bySide) {
      bySide = new Map();
      markets.set(marketKey, bySide);
    }
    const sideKey = `${q.selection}\u0000${q.line}`;
    const best = bySide.get(sideKey);
    if (!best || q.odds > best.odds) bySide.set(sideKey, q);
  }
  for (const bySide of markets.values()) {
    const sides = [...bySide.values()];
    const overs = sides.filter((q) => q.selection === OVER);
    const unders = sides.filter((q) => q.selection === UNDER);
    for (const over of overs) {
      for (const under of unders) {
        // Same line is an arb shape, not a middle; over above under both lose.
        if (over.line! >= under.line!) continue;
        const m = middleMetrics(over.odds, under.odds);
        if (!m.free && m.ratio < s.middleRatio) continue;
        const edge = m.bothWinPayoutFrac - Math.max(m.costFrac, 0);
        out.push({ category: 'MIDDLE', ...base(over), legs: [toLeg(over), toLeg(under)], edge, fairProbs: null });
      }
    }
  }
}
