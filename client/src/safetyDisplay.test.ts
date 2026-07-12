import { describe, expect, it } from 'vitest';
import type { RecordSafety } from '../../shared/types';
import {
  hasUsableRoundedStakes,
  isSafetyFiltered,
  primaryStake,
  reasonLabel,
  scoreLabel,
} from './safetyDisplay';

function safety(overrides: Partial<RecordSafety> = {}): RecordSafety {
  return {
    score: 72,
    components: [],
    reasons: [],
    roundedStakes: [50, 50],
    scoredAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('scoreLabel', () => {
  it('renders REJECTED for a hard-rejected score of 0', () => {
    expect(scoreLabel(0)).toBe('REJECTED');
  });

  it('renders N/100 for any positive score', () => {
    expect(scoreLabel(72)).toBe('72/100');
  });

  it('renders 100/100 at the ceiling', () => {
    expect(scoreLabel(100)).toBe('100/100');
  });
});

describe('isSafetyFiltered', () => {
  it('is false when safety is absent — never scored is not filtered', () => {
    expect(isSafetyFiltered(undefined, { safeMode: true, safetyThreshold: 55 })).toBe(false);
  });

  it('is false when settings have not loaded yet', () => {
    expect(isSafetyFiltered(safety({ score: 10 }), null)).toBe(false);
  });

  it('is false when safeMode is off, regardless of score', () => {
    expect(isSafetyFiltered(safety({ score: 0 }), { safeMode: false, safetyThreshold: 55 })).toBe(
      false,
    );
  });

  it('is true when safeMode is on and the score sits below the threshold', () => {
    expect(isSafetyFiltered(safety({ score: 40 }), { safeMode: true, safetyThreshold: 55 })).toBe(
      true,
    );
  });

  it('is false when the score meets the threshold exactly', () => {
    expect(isSafetyFiltered(safety({ score: 55 }), { safeMode: true, safetyThreshold: 55 })).toBe(
      false,
    );
  });

  it('is true for a hard-rejected score of 0 under safeMode', () => {
    expect(isSafetyFiltered(safety({ score: 0 }), { safeMode: true, safetyThreshold: 55 })).toBe(
      true,
    );
  });
});

describe('reasonLabel', () => {
  it('maps every known hard-reject reason to a human label', () => {
    expect(reasonLabel('suspicious_edge')).toBe('edge above the safe cap');
    expect(reasonLabel('off_consensus')).toBe('a leg is too far off consensus');
    expect(reasonLabel('book_exposure')).toBe('a book is over its exposure budget');
    expect(reasonLabel('book_cooldown')).toBe('a book is resting after a hot streak');
    expect(reasonLabel('rounding_kills_edge')).toBe('$5 rounding would erase the edge');
    expect(reasonLabel('below_threshold')).toBe('score below the safety threshold');
  });

  it('passes an unknown reason code through verbatim', () => {
    expect(reasonLabel('future_reason')).toBe('future_reason');
  });
});

describe('primaryStake', () => {
  it('falls back to the exact stake when safety is absent', () => {
    expect(primaryStake(0, 48.5, undefined)).toBe(48.5);
  });

  it('uses the rounded stake at the leg index when present and aligned', () => {
    expect(primaryStake(1, 48.5, safety({ roundedStakes: [50, 45] }))).toBe(45);
  });

  it('falls back to the exact stake when roundedStakes is misaligned with the legs', () => {
    expect(primaryStake(1, 48.5, safety({ roundedStakes: [50] }))).toBe(48.5);
  });

  it('falls back to the exact stake when roundedStakes is absent', () => {
    expect(primaryStake(0, 48.5, safety({ roundedStakes: undefined }))).toBe(48.5);
  });
});

describe('hasUsableRoundedStakes', () => {
  it('is true when roundedStakes is present and matches the leg count', () => {
    expect(hasUsableRoundedStakes(2, safety({ roundedStakes: [50, 50] }))).toBe(true);
  });

  it('is false when safety is absent', () => {
    expect(hasUsableRoundedStakes(2, undefined)).toBe(false);
  });

  it('is false when roundedStakes length does not match the leg count', () => {
    expect(hasUsableRoundedStakes(2, safety({ roundedStakes: [50] }))).toBe(false);
  });

  it('is false when a rounded stake is non-finite', () => {
    expect(hasUsableRoundedStakes(1, safety({ roundedStakes: [Number.NaN] }))).toBe(false);
  });
});
