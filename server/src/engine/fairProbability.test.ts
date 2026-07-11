import { describe, expect, it } from 'vitest';
import { devig, fairForLineGroup } from './fairProbability';

describe('devig (multiplicative)', () => {
  it('2-way even book: hand-computed fixture', () => {
    const result = devig([1.95, 1.95]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fair.overround).toBeCloseTo(2 / 1.95, 6);
    expect(result.fair.probabilities[0]).toBeCloseTo(0.5, 6);
    expect(result.fair.probabilities[1]).toBeCloseTo(0.5, 6);
    expect(result.fair.method).toBe('multiplicative');
  });

  it('2-way skewed book: p = (1/o)/M exactly', () => {
    const result = devig([1.87, 2.05]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const M = 1 / 1.87 + 1 / 2.05;
    expect(result.fair.overround).toBeCloseTo(M, 6);
    expect(result.fair.probabilities[0]).toBeCloseTo(1 / 1.87 / M, 6);
    expect(result.fair.probabilities[1]).toBeCloseTo(1 / 2.05 / M, 6);
    expect(result.fair.probabilities[0] + result.fair.probabilities[1]).toBeCloseTo(1, 9);
  });

  it('3-way with draw sums to one', () => {
    const result = devig([2.5, 3.3, 3.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const M = 1 / 2.5 + 1 / 3.3 + 1 / 3.1;
    expect(result.fair.probabilities[0]).toBeCloseTo(0.4 / M, 6);
    expect(result.fair.probabilities.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 9);
  });

  it('rejects invalid odds', () => {
    expect(devig([1.0, 2.0])).toEqual({ ok: false, reason: 'invalid_odds' });
    expect(devig([2.0, Number.NaN])).toEqual({ ok: false, reason: 'invalid_odds' });
    expect(devig([])).toEqual({ ok: false, reason: 'missing_outcome' });
  });
});

describe('fairForLineGroup — the line-group invariant extends to benchmarks', () => {
  const H2H_SIDES = [{ name: 'Lakers' }, { name: 'Celtics' }];

  it('matches benchmark outcomes to group sides by name and |point|', () => {
    const result = fairForLineGroup(
      [
        { name: 'Celtics', price: 2.05 },
        { name: 'Lakers', price: 1.87 },
      ],
      H2H_SIDES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Probabilities align with the GROUP side order, not benchmark order.
    const M = 1 / 1.87 + 1 / 2.05;
    expect(result.fair.probabilities[0]).toBeCloseTo(1 / 1.87 / M, 6); // Lakers
    expect(result.fair.probabilities[1]).toBeCloseTo(1 / 2.05 / M, 6); // Celtics
  });

  it('totals: same |point| accepted, different line rejected', () => {
    const sides = [
      { name: 'Over', point: 220.5 },
      { name: 'Under', point: 220.5 },
    ];
    const good = fairForLineGroup(
      [
        { name: 'Over', point: 220.5, price: 1.95 },
        { name: 'Under', point: 220.5, price: 1.95 },
      ],
      sides,
    );
    expect(good.ok).toBe(true);

    const mismatched = fairForLineGroup(
      [
        { name: 'Over', point: 221.5, price: 1.95 },
        { name: 'Under', point: 221.5, price: 1.95 },
      ],
      sides,
    );
    expect(mismatched).toEqual({ ok: false, reason: 'line_mismatch' });
  });

  it('spreads: mirrored signed points (−3.5/+3.5) belong to the same group', () => {
    const sides = [
      { name: 'Lakers', point: -3.5 },
      { name: 'Celtics', point: 3.5 },
    ];
    const result = fairForLineGroup(
      [
        { name: 'Lakers', point: -3.5, price: 1.91 },
        { name: 'Celtics', point: 3.5, price: 1.91 },
      ],
      sides,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects when the benchmark is missing a side', () => {
    const result = fairForLineGroup([{ name: 'Lakers', price: 1.87 }], H2H_SIDES);
    expect(result).toEqual({ ok: false, reason: 'missing_outcome' });
  });
});
