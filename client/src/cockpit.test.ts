import { describe, expect, it } from 'vitest';
import { loadBankroll, saveBankroll, scaleLegStakes } from './cockpit';

const LEGS = [
  { odds: 2.1, stake: 48.78 },
  { odds: 2.05, stake: 51.22 },
];

describe('scaleLegStakes', () => {
  it('scales the per-$100 stakes to the bankroll and reports the guaranteed outcome', () => {
    const scaled = scaleLegStakes(LEGS, 500);
    expect(scaled.stakes).toEqual([243.9, 256.1]);
    expect(scaled.totalStaked).toBeCloseTo(500, 2);
    // Each leg's payout, minus everything staked; guaranteed = the worst one.
    const payouts = [243.9 * 2.1, 256.1 * 2.05];
    expect(scaled.guaranteedProfit).toBeCloseTo(Math.min(...payouts) - 500, 2);
    expect(scaled.guaranteedProfit).toBeGreaterThan(0);
  });

  it('handles a non-arb honestly: negative guaranteed profit', () => {
    const scaled = scaleLegStakes(
      [
        { odds: 1.9, stake: 50 },
        { odds: 1.9, stake: 50 },
      ],
      100,
    );
    expect(scaled.guaranteedProfit).toBeLessThan(0);
  });

  it('rejects nonsense bankrolls by falling back to $100', () => {
    expect(scaleLegStakes(LEGS, 0).totalStaked).toBeCloseTo(100, 2);
    expect(scaleLegStakes(LEGS, -5).totalStaked).toBeCloseTo(100, 2);
    expect(scaleLegStakes(LEGS, Number.NaN).totalStaked).toBeCloseTo(100, 2);
  });
});

describe('bankroll persistence', () => {
  function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
  }

  it('round-trips and defaults to $100 on garbage', () => {
    const storage = fakeStorage();
    expect(loadBankroll(storage)).toBe(100);
    saveBankroll(storage, 750);
    expect(loadBankroll(storage)).toBe(750);
    storage.setItem('evil-eye:bankroll', 'lots');
    expect(loadBankroll(storage)).toBe(100);
  });
});
