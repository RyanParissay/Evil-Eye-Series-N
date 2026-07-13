/**
 * Golden CLV math (Phase 18), hand-computed to the decimal. Covers raw CLV,
 * de-vigged true CLV (the fair probs derived through the real devig), the
 * signal vs execution basis + weight split, EXCLUDED-null-leg renormalization,
 * and the null-when-nothing-usable rule. Pure arithmetic — no stores, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { ArbLeg, OpportunityRecord, RecordClosing } from '@shared/types';
import { devig } from './fairProbability';
import { legRawClvPct, legTrueClvPct, recordClv, recordLegClvs } from './clv';

function leg(outcome: string, bookmakerKey: string, odds: number, stake: number): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds, stake, link: null };
}

function makeRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: 'rec-1',
    fingerprint: 'fp-1',
    strategy: 'arb',
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-13T00:00:00Z',
    marketKey: 'h2h',
    legs: [leg('Celtics', 'bet365', 2.06, 50), leg('Lakers', 'pinnacle', 2.06, 50)],
    profitPctAtDetection: 3,
    profitPct: 3,
    arbIndex: 0.97,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-12T20:00:00Z',
    lastSeenAt: '2026-07-12T20:01:00Z',
    statusChangedAt: '2026-07-12T20:00:00Z',
    alerted: false,
    alertedAt: null,
    ...overrides,
  };
}

function closing(over: Partial<RecordClosing> = {}): RecordClosing {
  return {
    legOdds: [2.0, 2.0],
    capturedAt: '2026-07-12T23:00:00Z',
    minutesToCommence: 60,
    ...over,
  };
}

describe('per-leg CLV', () => {
  it('raw CLV% = (basisOdds ÷ closingOdds − 1) × 100', () => {
    expect(legRawClvPct(2.1, 2.0)).toBeCloseTo(5, 10); // 1.05 − 1 = 0.05 → 5%
    expect(legRawClvPct(2.0, 2.0)).toBe(0); // bet exactly the close
    expect(legRawClvPct(3.0, 2.5)).toBeCloseTo(20, 10); // 1.2 − 1 = 0.2 → 20%
    expect(legRawClvPct(1.9, 2.0)).toBeCloseTo(-5, 10); // closed shorter → negative
  });

  it('true CLV% = (basisOdds × benchmarkFairProb − 1) × 100', () => {
    // fair 0.525 from de-vigging 1.90/2.10 (see below): 2.10 × 0.525 = 1.1025.
    expect(legTrueClvPct(2.1, 0.525)).toBeCloseTo(10.25, 10);
    expect(legTrueClvPct(2.0, 0.5)).toBe(0); // priced exactly at fair
  });
});

describe('recordClv — raw, stake-weighted', () => {
  it('weights legs by the stored stake split (signal basis = confirmedLegOdds)', () => {
    // leg0 (stake 60): 2.10/2.00 → +5.0; leg1 (stake 40): 3.00/2.50 → +20.0
    // weighted = (60·5 + 40·20) / 100 = 1100 / 100 = 11.0
    const record = makeRecord({
      legs: [leg('Celtics', 'bet365', 2.06, 60), leg('Lakers', 'pinnacle', 2.06, 40)],
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 3.0] },
      closing: closing({ legOdds: [2.0, 2.5] }),
    });
    const clv = recordClv(record, 'signal');
    expect(clv).not.toBeNull();
    expect(clv!.rawClvPct).toBeCloseTo(11, 10);
    expect(clv!.usableLegs).toBe(2);
    expect(clv!.trueClvPct).toBeNull(); // no benchmark on this closing
  });

  it('EXCLUDES a leg the closing no longer priced — renormalizes, never zeroes it', () => {
    // leg1 delisted (null); only leg0 counts: (60·5)/60 = 5.0 — NOT (60·5+40·0)/100 = 3.0
    const record = makeRecord({
      legs: [leg('Celtics', 'bet365', 2.06, 60), leg('Lakers', 'pinnacle', 2.06, 40)],
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 3.0] },
      closing: closing({ legOdds: [2.0, null] }),
    });
    const clv = recordClv(record, 'signal');
    expect(clv!.rawClvPct).toBeCloseTo(5, 10);
    expect(clv!.usableLegs).toBe(1);
  });

  it('zero usable legs → null CLV (never zeroed)', () => {
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 3.0] },
      closing: closing({ legOdds: [null, null] }),
    });
    expect(recordClv(record, 'signal')).toBeNull();
  });

  it('falls back to equal weight when every stake is 0 (degenerate, never 0-divides)', () => {
    // legs stake 0/0; leg0 +5.0, leg1 +10.0 → equal-weight mean 7.5
    const record = makeRecord({
      legs: [leg('Celtics', 'bet365', 2.06, 0), leg('Lakers', 'pinnacle', 2.06, 0)],
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 2.2] },
      closing: closing({ legOdds: [2.0, 2.0] }),
    });
    expect(recordClv(record, 'signal')!.rawClvPct).toBeCloseTo(7.5, 10);
  });
});

describe('recordClv — true CLV vs the de-vigged benchmark close', () => {
  it('uses the benchmark fair probabilities (derived through the real devig)', () => {
    // De-vig Pinnacle 1.90 / 2.10 → fair 0.525 / 0.475 (exact: 2.10/4.00, 1.90/4.00).
    const fair = devig([1.9, 2.1]);
    expect(fair.ok).toBe(true);
    if (!fair.ok) throw new Error('devig failed');
    expect(fair.fair.probabilities[0]).toBeCloseTo(0.525, 12);
    expect(fair.fair.probabilities[1]).toBeCloseTo(0.475, 12);

    // signal odds [2.10, 2.30]; true leg0 = (2.10·0.525 − 1)·100 = 10.25,
    // leg1 = (2.30·0.475 − 1)·100 = 9.25; equal stakes → (10.25 + 9.25)/2 = 9.75.
    // raw: closing [2.00, 2.30] → leg0 +5.0, leg1 0.0 → (5 + 0)/2 = 2.5.
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 2.3] },
      closing: closing({
        legOdds: [2.0, 2.3],
        benchmarkLegOdds: [1.9, 2.1],
        benchmarkFairProb: fair.fair.probabilities,
      }),
    });
    const clv = recordClv(record, 'signal');
    expect(clv!.rawClvPct).toBeCloseTo(2.5, 10);
    expect(clv!.trueClvPct).toBeCloseTo(9.75, 10);
    expect(clv!.trueLegs).toBe(2);
  });

  it('true CLV counts only legs the benchmark quoted; the rest still count for raw', () => {
    // benchmarkFairProb only for leg0 → trueLegs 1; raw still spans both legs.
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 2.1] },
      closing: closing({
        legOdds: [2.0, 2.0],
        benchmarkFairProb: [0.5, null],
      }),
    });
    const clv = recordClv(record, 'signal');
    expect(clv!.usableLegs).toBe(2);
    expect(clv!.trueLegs).toBe(1);
    // leg0 true = (2.10·0.5 − 1)·100 = 5.0, single leg → 5.0
    expect(clv!.trueClvPct).toBeCloseTo(5, 10);
  });
});

describe('recordClv — execution basis (filledLegs odds + actual staked weights)', () => {
  it('uses filledLegs, weighted by the dollars actually staked', () => {
    // filled [2.20 @ $150, 1.90 @ $50] vs closing [2.00, 2.00]:
    // leg0 +10.0, leg1 −5.0 → (150·10 + 50·−5)/200 = 1250/200 = 6.25
    const record = makeRecord({
      status: 'completed',
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [9, 9] }, // ignored by execution
      execution: {
        filledLegs: [
          { odds: 2.2, stake: 150 },
          { odds: 1.9, stake: 50 },
        ],
        totalStaked: 200,
        lockedProfit: 0,
        recordedAt: '2026-07-12T21:00:00Z',
      },
      closing: closing({ legOdds: [2.0, 2.0] }),
    });
    const exec = recordClv(record, 'execution');
    expect(exec!.rawClvPct).toBeCloseTo(6.25, 10);
    // Signal on the SAME record reads confirmedLegOdds (9,9) → wildly different.
    const signal = recordClv(record, 'signal');
    expect(signal!.rawClvPct).not.toBeCloseTo(6.25, 2);
  });
});

describe('recordClv — basis unavailable → null', () => {
  it('no closing at all', () => {
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 2.1] },
    });
    expect(recordClv(record, 'signal')).toBeNull();
  });
  it('signal with no confirmedLegOdds', () => {
    const record = makeRecord({ closing: closing() });
    expect(recordClv(record, 'signal')).toBeNull();
  });
  it('signal with misaligned confirmedLegOdds length', () => {
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1] },
      closing: closing(),
    });
    expect(recordClv(record, 'signal')).toBeNull();
  });
  it('execution with no filledLegs', () => {
    const record = makeRecord({ closing: closing() });
    expect(recordClv(record, 'execution')).toBeNull();
  });
});

describe('recordLegClvs — the byBook per-leg input', () => {
  it('returns each leg CLV aligned with record.legs, nulls where unmeasurable', () => {
    const record = makeRecord({
      confirmation: { status: 'confirmed', scanAAt: '', confirmedLegOdds: [2.1, 2.1] },
      closing: closing({ legOdds: [2.0, null], benchmarkFairProb: [0.5, 0.5] }),
    });
    const legs = recordLegClvs(record, 'signal')!;
    expect(legs).toHaveLength(2);
    expect(legs[0].rawClvPct).toBeCloseTo(5, 10);
    expect(legs[1].rawClvPct).toBeNull(); // delisted → excluded
    expect(legs[0].trueClvPct).toBeCloseTo(5, 10);
    expect(legs[1].trueClvPct).toBeCloseTo(5, 10); // benchmark still quoted it
  });
});
