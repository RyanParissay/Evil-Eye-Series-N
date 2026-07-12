import { describe, expect, it } from 'vitest';
import { creditSpendSeverity, describePairCost, scoresSharePct } from './creditWidget';

describe('creditSpendSeverity', () => {
  it('is ok well below 80% of budget', () => {
    expect(creditSpendSeverity(7000, 10_000)).toBe('ok');
  });

  it('is amber at exactly 80% of budget', () => {
    expect(creditSpendSeverity(8000, 10_000)).toBe('amber');
  });

  it('is amber between 80% and 100%', () => {
    expect(creditSpendSeverity(9500, 10_000)).toBe('amber');
  });

  it('is red at exactly 100% of budget', () => {
    expect(creditSpendSeverity(10_000, 10_000)).toBe('red');
  });

  it('is red above 100%', () => {
    expect(creditSpendSeverity(15_000, 10_000)).toBe('red');
  });

  it('is ok when there is no projection yet (provider usage unknown)', () => {
    expect(creditSpendSeverity(null, 10_000)).toBe('ok');
  });

  it('is ok when budget is non-positive (nothing to divide by)', () => {
    expect(creditSpendSeverity(100, 0)).toBe('ok');
  });
});

describe('describePairCost (Phase 16 Part A — conditional pair)', () => {
  it('labels an assumed hit rate ASSUMED, showing the per-window number', () => {
    expect(
      describePairCost({
        intervalSecs: 60,
        hitRate: 0.3,
        hitRateSource: 'assumed',
        samples: 12,
        creditsPerPairWindow: 13,
      }),
    ).toBe('≈13 credits/window · 30% hit rate (ASSUMED)');
  });

  it('labels a measured hit rate MEASURED', () => {
    expect(
      describePairCost({
        intervalSecs: 60,
        hitRate: 0.25,
        hitRateSource: 'measured',
        samples: 60,
        creditsPerPairWindow: 12.5,
      }),
    ).toBe('≈12.5 credits/window · 25% hit rate (MEASURED)');
  });
});

describe('scoresSharePct', () => {
  it('computes a rounded percentage of the daily scores cap', () => {
    expect(scoresSharePct(250, 500)).toBe(50);
  });

  it('rounds to the nearest integer', () => {
    expect(scoresSharePct(333, 500)).toBe(67);
  });

  it('is 0 when nothing spent yet', () => {
    expect(scoresSharePct(0, 500)).toBe(0);
  });

  it('returns null when the cap is zero', () => {
    expect(scoresSharePct(10, 0)).toBeNull();
  });
});
