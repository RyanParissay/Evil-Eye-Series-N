import { describe, expect, it } from 'vitest';
import { planStakes } from '../../shared/stakePlanning';
import { loadBankroll, saveBankroll } from './cockpit';

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

describe('shared stake planning (the client runs the same function the server does)', () => {
  it('scales and caps identically to the alert path', () => {
    const legs = [
      { odds: 2.1, bookmakerKey: 'bet365' },
      { odds: 2.05, bookmakerKey: 'pinnacle' },
    ];
    const uncapped = planStakes(legs, 500, new Map());
    expect(uncapped.totalStaked).toBeCloseTo(500, 1);
    expect(uncapped.guaranteedProfit).toBeGreaterThan(0);

    const capped = planStakes(legs, 500, new Map([['pinnacle', 100]]));
    expect(capped.capped).toBe(true);
    expect(capped.cappedBy).toBe('pinnacle');
    expect(capped.stakes[1]).toBeLessThanOrEqual(100);
  });
});
