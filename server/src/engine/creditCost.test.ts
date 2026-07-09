import { describe, expect, it } from 'vitest';
import { creditsForOddsCall, estimateDollarCost } from './creditCost';

describe('creditsForOddsCall', () => {
  it('charges markets × regions per The Odds API billing model', () => {
    expect(creditsForOddsCall(1, 2)).toBe(2); // h2h × (us, eu)
    expect(creditsForOddsCall(3, 5)).toBe(15); // h2h+spreads+totals × all regions
  });

  it('charges nothing for zero markets or regions', () => {
    expect(creditsForOddsCall(0, 2)).toBe(0);
    expect(creditsForOddsCall(1, 0)).toBe(0);
  });
});

describe('estimateDollarCost', () => {
  it('prices credits at plan price / plan credits', () => {
    // $30 / 20,000 credits = $0.0015 per credit → 28 credits ≈ $0.042
    expect(estimateDollarCost(28, 30, 20_000)).toBeCloseTo(0.042, 6);
  });

  it('returns 0 for zero credits', () => {
    expect(estimateDollarCost(0, 30, 20_000)).toBe(0);
  });

  it('returns 0 rather than dividing by zero on a free plan', () => {
    expect(estimateDollarCost(100, 0, 0)).toBe(0);
  });
});
