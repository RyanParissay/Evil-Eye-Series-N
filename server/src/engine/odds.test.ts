import { expect, test } from 'vitest';
import { arbMargin, devigFairProbs, evEdge, middleMetrics } from './odds.js'; // ADAPTED from brief: NodeNext needs the .js extension
test('devig: multiplicative normalization of implied probs', () => {
  const [p1, p2] = devigFairProbs([1.9, 1.9]);
  expect(p1).toBeCloseTo(0.5, 10); expect(p2).toBeCloseTo(0.5, 10);
  const probs = devigFairProbs([2.5, 3.4, 2.9]);
  expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
});
test('arbMargin = 1 - sum(1/odds); positive means guaranteed profit', () => {
  expect(arbMargin([2.1, 2.1])).toBeCloseTo(1 - (1/2.1 + 1/2.1), 12); // ≈ +4.76%
  expect(arbMargin([1.9, 1.9])).toBeLessThan(0);
  expect(arbMargin([3.2, 3.6, 3.1])).toBeCloseTo(1 - (1/3.2 + 1/3.6 + 1/3.1), 12); // 3-leg soccer
});
test('evEdge = fairProb*odds - 1', () => {
  expect(evEdge(0.5, 2.2)).toBeCloseTo(0.10, 12);
  expect(evEdge(0.4, 2.4)).toBeCloseTo(-0.04, 12);
});
test('middleMetrics: cost, both-win payout, ratio, free flag', () => {
  const m = middleMetrics(2.0, 2.1); // S = 0.97619 → free middle
  expect(m.free).toBe(true);
  const c = middleMetrics(1.9, 1.95); // S = 1.0391
  expect(c.free).toBe(false);
  expect(c.costFrac).toBeCloseTo(c.sumInv - 1, 12);
  expect(c.bothWinPayoutFrac).toBeCloseTo(2 / c.sumInv - 1, 12);
  expect(c.ratio).toBeCloseTo(c.bothWinPayoutFrac / c.costFrac, 12);
});
