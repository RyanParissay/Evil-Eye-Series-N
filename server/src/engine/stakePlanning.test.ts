import { describe, expect, it } from 'vitest';
import { planStakes } from '@shared/stakePlanning';

// 2.1 / 2.05: S ≈ 0.96400, shares ≈ 49.4% / 50.6%.
const LEGS = [
  { odds: 2.1, bookmakerKey: 'bet365' },
  { odds: 2.05, bookmakerKey: 'pinnacle' },
];

describe('planStakes', () => {
  it('uncapped: splits the target by ideal shares with guaranteed profit', () => {
    const plan = planStakes(LEGS, 500, new Map());
    expect(plan.totalStaked).toBeCloseTo(500, 1);
    expect(plan.stakes[0] + plan.stakes[1]).toBeCloseTo(plan.totalStaked, 2);
    // Hand fixture: share₀ = (1/2.1)/S = 0.49397… → stake ≈ 246.99.
    expect(plan.stakes[0]).toBeCloseTo(246.99, 1);
    expect(plan.stakes[1]).toBeCloseTo(253.01, 1);
    expect(plan.guaranteedProfit).toBeGreaterThan(0);
    // Worst payout minus staked — same definition the engine books.
    const worst = Math.min(plan.stakes[0] * 2.1, plan.stakes[1] * 2.05);
    expect(plan.guaranteedProfit).toBeCloseTo(worst - plan.totalStaked, 2);
    expect(plan.capped).toBe(false);
    expect(plan.cappedBy).toBeNull();
  });

  it('caps: a thin book rescales the WHOLE position so profit stays guaranteed', () => {
    // pinnacle holds only $100; its ideal share at $500 would be ~$253.
    const plan = planStakes(LEGS, 500, new Map([['pinnacle', 100]]));
    expect(plan.capped).toBe(true);
    expect(plan.cappedBy).toBe('pinnacle');
    expect(plan.stakes[1]).toBeLessThanOrEqual(100);
    // Proportions preserved → both legs shrink together, profit still ≥ 0.
    expect(plan.stakes[0] / plan.stakes[1]).toBeCloseTo(246.99 / 253.01, 2);
    expect(plan.guaranteedProfit).toBeGreaterThan(0);
    const worst = Math.min(plan.stakes[0] * 2.1, plan.stakes[1] * 2.05);
    expect(plan.guaranteedProfit).toBeCloseTo(worst - plan.totalStaked, 2);
  });

  it('null or missing balances never constrain', () => {
    const plan = planStakes(LEGS, 500, new Map([['bet365', null]]));
    expect(plan.capped).toBe(false);
    expect(plan.totalStaked).toBeCloseTo(500, 1);
  });

  it('a zero-balance book collapses the position to zero, flagged', () => {
    const plan = planStakes(LEGS, 500, new Map([['bet365', 0]]));
    expect(plan.capped).toBe(true);
    expect(plan.totalStaked).toBe(0);
    expect(plan.stakes).toEqual([0, 0]);
  });

  it('a NEGATIVE recorded balance never produces negative stakes', () => {
    const plan = planStakes(LEGS, 500, new Map([['pinnacle', -118.97]]));
    expect(plan.capped).toBe(true);
    expect(plan.cappedBy).toBe('pinnacle');
    expect(plan.totalStaked).toBe(0);
    expect(plan.stakes).toEqual([0, 0]);
    expect(plan.guaranteedProfit).toBe(0);
  });
});
