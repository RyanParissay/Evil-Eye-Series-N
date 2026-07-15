// Candidate detection (Task 10) — hand-built quote fixtures, per brief.
import { expect, test } from 'vitest';
import type { Quote } from '../shared/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';
import { arbMargin, middleMetrics } from '../engine/odds.js';
import { detectCandidates } from './candidates.js';

const NOW = 1_752_000_000_000;
const STARTS = NOW + 3_600_000;
const S: Settings = { ...DEFAULT_SETTINGS }; // copy, never alias

function mkQ(book: string, selection: string, odds: number, o: Partial<Quote> = {}): Quote {
  return {
    book, selection, odds,
    sport: 'basketball', event: 'EVT', market: 'moneyline', line: null,
    fetchedAt: NOW, eventStartsAt: STARTS, ...o,
  };
}

test('ARB: clean 2-leg arb detected with best-price legs', () => {
  const cands = detectCandidates([
    mkQ('bet365', 'home', 2.1),
    mkQ('fanduel', 'home', 2.05), // worse home price — must not be picked
    mkQ('bet365', 'away', 1.9), //   worse away price — must not be picked
    mkQ('fanduel', 'away', 2.1),
  ], S);
  expect(cands).toHaveLength(1);
  const c = cands[0]!;
  expect(c.category).toBe('ARB');
  expect(c.sport).toBe('basketball');
  expect(c.event).toBe('EVT');
  expect(c.market).toBe('moneyline');
  expect(c.eventStartsAt).toBe(STARTS);
  expect(c.fairProbs).toBeNull();
  expect(c.legs).toEqual([
    { book: 'bet365', selection: 'home', odds: 2.1, fetchedAt: NOW },
    { book: 'fanduel', selection: 'away', odds: 2.1, fetchedAt: NOW },
  ]);
  expect(c.edge).toBeCloseTo(arbMargin([2.1, 2.1]), 12); // ≈ +4.76%
});

test('ARB: 3-leg soccer h2h arb across three books', () => {
  const o = { sport: 'soccer', event: 'SOC', market: '1X2' };
  const cands = detectCandidates([
    mkQ('sportsinteraction', 'home', 3.2, o),
    mkQ('betway', 'home', 3.0, o),
    mkQ('betway', 'draw', 3.6, o),
    mkQ('bwin', 'draw', 3.4, o),
    mkQ('bwin', 'away', 3.1, o),
    mkQ('sportsinteraction', 'away', 2.9, o),
  ], S);
  expect(cands).toHaveLength(1);
  const c = cands[0]!;
  expect(c.category).toBe('ARB');
  expect(c.legs).toEqual([
    { book: 'sportsinteraction', selection: 'home', odds: 3.2, fetchedAt: NOW },
    { book: 'betway', selection: 'draw', odds: 3.6, fetchedAt: NOW },
    { book: 'bwin', selection: 'away', odds: 3.1, fetchedAt: NOW },
  ]);
  expect(c.edge).toBeCloseTo(arbMargin([3.2, 3.6, 3.1]), 12);
});

test('ARB: 3-outcome groups outside soccer never combine', () => {
  const o = { sport: 'basketball', event: 'B3', market: 'threeway' };
  expect(detectCandidates([
    mkQ('bet365', 'home', 3.2, o),
    mkQ('fanduel', 'draw', 3.6, o),
    mkQ('pointsbet', 'away', 3.1, o),
  ], S)).toEqual([]);
});

test('ARB: line groups are sacred — over 220.5 never pairs with under 219.5', () => {
  const t = { event: 'TOT', market: 'total' };
  // Cross-line pair would show a fat +4.76% "margin" — must never be combined.
  expect(detectCandidates([
    mkQ('bet365', 'over', 2.1, { ...t, line: 220.5 }),
    mkQ('fanduel', 'under', 2.1, { ...t, line: 219.5 }),
  ], S)).toEqual([]);
  // Control: the identical prices on the SAME line are a legitimate arb.
  const same = detectCandidates([
    mkQ('bet365', 'over', 2.1, { ...t, line: 220.5 }),
    mkQ('fanduel', 'under', 2.1, { ...t, line: 220.5 }),
  ], S);
  expect(same).toHaveLength(1);
  expect(same[0]!.category).toBe('ARB');
});

test('EV: soft-book price vs pinnacle devig fair when pinnacle quotes both sides', () => {
  const cands = detectCandidates([
    mkQ('pinnacle', 'home', 1.85),
    mkQ('pinnacle', 'away', 1.85), // devig → fair 0.5 / 0.5
    mkQ('draftkings', 'away', 2.15), // evEdge = 0.5·2.15 − 1 = +7.5%
    mkQ('draftkings', 'home', 1.8), //  below fair — no candidate
  ], S);
  expect(cands).toHaveLength(1);
  const c = cands[0]!;
  expect(c.category).toBe('EV');
  expect(c.legs).toEqual([{ book: 'draftkings', selection: 'away', odds: 2.15, fetchedAt: NOW }]);
  expect(c.fairProbs).toHaveLength(1);
  expect(c.fairProbs![0]).toBeCloseTo(0.5, 12);
  expect(c.edge).toBeCloseTo(0.075, 12);
});

test('EV: pinnacle quoting only one side → no fair prob, no candidate', () => {
  expect(detectCandidates([
    mkQ('pinnacle', 'away', 1.85),
    mkQ('draftkings', 'away', 2.15),
    mkQ('draftkings', 'home', 1.8),
  ], S)).toEqual([]);
});

test('EV: fair probs live per |line| — signed ±3.5 group together, off-line quotes get nothing', () => {
  const sp = { event: 'SP', market: 'spread' };
  const cands = detectCandidates([
    mkQ('pinnacle', 'home', 1.85, { ...sp, line: -3.5 }),
    mkQ('pinnacle', 'away', 1.85, { ...sp, line: 3.5 }), // both sides of the SAME |3.5| line
    mkQ('draftkings', 'away', 2.15, { ...sp, line: 3.5 }), // +7.5% vs that fair
    mkQ('draftkings', 'home', 2.4, { ...sp, line: -2.5 }), // juicy, but pinnacle never priced −2.5
  ], S);
  expect(cands).toHaveLength(1);
  const c = cands[0]!;
  expect(c.category).toBe('EV');
  expect(c.legs).toEqual([{ book: 'draftkings', selection: 'away', odds: 2.15, fetchedAt: NOW }]);
  expect(c.edge).toBeCloseTo(0.075, 12);
});

test('MIDDLE: opposite selections on different lines, best price per side', () => {
  const t = { event: 'MID', market: 'total' };
  const cands = detectCandidates([
    mkQ('pointsbet', 'over', 2.0, { ...t, line: 217.5 }),
    mkQ('bodog', 'over', 1.9, { ...t, line: 217.5 }), // worse over price — must not be picked
    mkQ('bet365', 'under', 2.0, { ...t, line: 223.5 }),
  ], S);
  expect(cands).toHaveLength(1);
  const c = cands[0]!;
  expect(c.category).toBe('MIDDLE');
  expect(c.fairProbs).toBeNull();
  expect(c.legs).toEqual([
    { book: 'pointsbet', selection: 'over', odds: 2.0, fetchedAt: NOW },
    { book: 'bet365', selection: 'under', odds: 2.0, fetchedAt: NOW },
  ]);
  // Free middle (S = 1.0): edge = bothWinPayoutFrac − max(costFrac, 0) = 1.0
  expect(c.edge).toBeCloseTo(1.0, 12);
});

test('MIDDLE: costed middle edge basis; reversed lines can never both win', () => {
  const t = { event: 'MID2', market: 'total' };
  const cands = detectCandidates([
    mkQ('pointsbet', 'over', 1.95, { ...t, line: 217.5 }),
    mkQ('bet365', 'under', 1.98, { ...t, line: 223.5 }),
  ], S);
  expect(cands).toHaveLength(1);
  const m = middleMetrics(1.95, 1.98);
  expect(m.free).toBe(false); // sanity: this fixture is a COSTED middle
  expect(cands[0]!.edge).toBeCloseTo(m.bothWinPayoutFrac - Math.max(m.costFrac, 0), 12);
  // over 223.5 / under 217.5 leaves no landing zone — not a middle, whatever the prices.
  expect(detectCandidates([
    mkQ('pointsbet', 'over', 2.6, { ...t, line: 223.5 }),
    mkQ('bet365', 'under', 2.6, { ...t, line: 217.5 }),
  ], S)).toEqual([]);
});

test('sub-threshold everything → []', () => {
  expect(detectCandidates([
    // arb margin ≈ +0.25% < 0.75%
    mkQ('bet365', 'home', 2.005, { event: 'A' }),
    mkQ('fanduel', 'away', 2.005, { event: 'A' }),
    mkQ('bodog', 'home', 1.0, { event: 'A' }), // garbage odds ≤ 1 must be ignored, not crash
    // EV edge = 0.5·2.03 − 1 = +1.5% < 2%
    mkQ('pinnacle', 'home', 1.9, { event: 'B' }),
    mkQ('pinnacle', 'away', 1.9, { event: 'B' }),
    mkQ('draftkings', 'away', 2.03, { event: 'B' }),
    // costed middle at ratio ≈ 0.77 < middleRatio 1.5
    mkQ('pointsbet', 'over', 1.36, { event: 'C', market: 'total', line: 217.5 }),
    mkQ('bet365', 'under', 1.36, { event: 'C', market: 'total', line: 223.5 }),
  ], S)).toEqual([]);
});
