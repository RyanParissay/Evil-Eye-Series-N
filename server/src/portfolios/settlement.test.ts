import { describe, expect, it } from 'vitest';
import type { RecordGrading } from '@shared/types';
import { maxDrawdownOf, pnlForStake } from './settlement';

function grading(pnlPer100: number): RecordGrading {
  return {
    result: pnlPer100 > 0 ? 'win' : pnlPer100 < 0 ? 'loss' : 'push',
    legResults: [],
    pnlPer100,
    flags: [],
    gradedAt: '2026-01-02T00:00:00Z',
    source: 'auto',
    audit: [],
  };
}

describe('pnlForStake', () => {
  it('is stake × pnlPer100 / 100, rounded to cents (THE single P&L derivation)', () => {
    expect(pnlForStake(50, grading(4))).toBe(2);
    expect(pnlForStake(200, grading(2.5))).toBe(5);
    expect(pnlForStake(50, grading(-100))).toBe(-50); // a total loss
    expect(pnlForStake(50, grading(0))).toBe(0); // push
  });

  it('rounds to two decimals', () => {
    expect(pnlForStake(33.33, grading(3.333))).toBe(1.11);
  });
});

describe('maxDrawdownOf', () => {
  it('is peak-to-trough on the running-bankroll sequence, never negative', () => {
    expect(maxDrawdownOf([1000, 1100, 900, 1050])).toBe(200); // peak 1100 → trough 900
  });

  it('is zero for a monotonically rising curve', () => {
    expect(maxDrawdownOf([1000, 1010, 1020])).toBe(0);
  });

  it('is zero for an empty or single-point curve', () => {
    expect(maxDrawdownOf([])).toBe(0);
    expect(maxDrawdownOf([1000])).toBe(0);
  });

  it('tracks the deepest trough across multiple dips', () => {
    expect(maxDrawdownOf([1000, 800, 1200, 600])).toBe(600); // peak 1200 → trough 600
  });
});
