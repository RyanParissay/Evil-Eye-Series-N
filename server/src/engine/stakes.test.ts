import { expect, test } from 'vitest';
import { arbStakesCents, kellyStakeCents, roundStake } from './stakes.js'; // ADAPTED from brief: NodeNext needs the .js extension
import { DEFAULT_SETTINGS as S } from '../shared/defaults.js'; // ADAPTED from brief: NodeNext needs the .js extension
test('rounding: nearest $5, min $10', () => {
  expect(roundStake(3720, S)).toBe(3500);
  expect(roundStake(3760, S)).toBe(4000);
  expect(roundStake(300, S)).toBe(1000);
});
test('kelly: f* = (p·o − 1)/(o − 1), quarter, capped 5% of total, rounded', () => {
  // p=0.55 o=2.0 → f*=0.10 → quarter=0.025 → $250 → rounded $250
  expect(kellyStakeCents(0.55, 2.0, S)).toBe(25_000);
  // huge edge hits the 5% cap → $500
  expect(kellyStakeCents(0.9, 3.0, S)).toBe(50_000);
  expect(kellyStakeCents(0.4, 2.0, S)).toBe(0); // negative edge → no stake, not $10
});
test('arb split: equal payout, margin survives rounding on a fat arb', () => {
  const { stakes, roundedMargin } = arbStakesCents([2.1, 2.1], S);
  expect(stakes[0]).toBe(stakes[1]);
  expect(stakes[0]! % 500).toBe(0);
  expect(roundedMargin).toBeGreaterThan(0);
});
test('arb split: 3-leg soccer', () => {
  const { stakes } = arbStakesCents([3.2, 3.6, 3.1], S);
  expect(stakes).toHaveLength(3);
  const payouts = stakes.map((st, i) => st! * [3.2, 3.6, 3.1][i]!);
  const spread = Math.max(...payouts) - Math.min(...payouts);
  expect(spread / Math.min(...payouts)).toBeLessThan(0.15); // rounding-limited equality
});
