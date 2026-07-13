/**
 * CLV display helpers (Phase 18) — pure, hand-computed. The record-level
 * cockpit math MIRRORS server engine/clv.ts semantics exactly (excluded
 * null legs, renormalized weights, degenerate equal-weighting); the engine
 * is the authority, these tests pin the mirror.
 */
import { describe, expect, it } from 'vitest';
import type { ClvSummary, OpportunityRecord } from '../../shared/types';
import {
  barGeometry,
  cockpitClv,
  formatBeatShare,
  formatCaptureLead,
  formatClvPct,
  formatPpDelta,
  gateGroups,
  gateScaleMax,
  isSmallN,
  topBooks,
} from './clv';

/* ————— formatting ————— */

describe('formatClvPct — percentage points at 2dp, U+2212 minus', () => {
  it('formats sign, 2dp, %', () => {
    expect(formatClvPct(5)).toBe('+5.00%');
    expect(formatClvPct(-2.5)).toBe('−2.50%');
    expect(formatClvPct(0)).toBe('+0.00%');
  });
  it('null → em dash', () => {
    expect(formatClvPct(null)).toBe('—');
  });
});

describe('formatPpDelta — deltas between two CLV values are pp', () => {
  it('formats sign, 2dp, pp', () => {
    expect(formatPpDelta(1.8)).toBe('+1.80pp');
    expect(formatPpDelta(-0.4)).toBe('−0.40pp');
  });
});

describe('formatBeatShare — server sends FRACTIONS 0..1, display ×100', () => {
  it('multiplies by 100 and rounds', () => {
    expect(formatBeatShare(0.6667)).toBe('67%');
    expect(formatBeatShare(0)).toBe('0%');
    expect(formatBeatShare(1)).toBe('100%');
  });
  it('null → em dash', () => {
    expect(formatBeatShare(null)).toBe('—');
  });
});

describe('formatCaptureLead — median minutes before start', () => {
  it('minutes under 90, hours at 1dp above', () => {
    expect(formatCaptureLead(38)).toBe('38 min');
    expect(formatCaptureLead(89.6)).toBe('90 min');
    expect(formatCaptureLead(200)).toBe('3.3 h');
  });
  it('null → em dash', () => {
    expect(formatCaptureLead(null)).toBe('—');
  });
});

describe('isSmallN — cells under 10 records never masquerade as findings', () => {
  it('9 is small, 10 is not', () => {
    expect(isSmallN(9)).toBe(true);
    expect(isSmallN(10)).toBe(false);
  });
});

/* ————— gate comparison ————— */

function cell(records: number, mean: number | null, beat: number | null) {
  return { records, meanClvPct: mean, medianClvPct: mean, beatClosePct: beat };
}

const SIGNAL: ClvSummary['signal'] = [
  { strategy: 'arb', gateOutcome: 'alerted', cell: cell(12, 2.1, 0.62) },
  { strategy: 'arb', gateOutcome: 'filtered', cell: cell(11, 0.3, 0.55) },
  { strategy: 'arb', gateOutcome: 'single_sighting', cell: cell(13, -0.5, 0.46) },
  { strategy: 'ev', gateOutcome: 'alerted', cell: cell(2, 0.8, 0.5) },
];

describe('gateGroups — one group per strategy, margins vs alerted', () => {
  it('groups rows in gate order and computes alerted margins in pp', () => {
    const groups = gateGroups(SIGNAL);
    expect(groups).toHaveLength(2);
    expect(groups[0].strategy).toBe('arb');
    expect(groups[0].rows.map((r) => r.gateOutcome)).toEqual([
      'alerted',
      'filtered',
      'single_sighting',
    ]);
    expect(groups[0].margins).toEqual([
      { vs: 'filtered', pp: 1.8 },
      { vs: 'single_sighting', pp: 2.6 },
    ]);
    expect(groups[1].strategy).toBe('ev');
    expect(groups[1].rows).toHaveLength(1);
    expect(groups[1].margins).toEqual([]); // nothing to compare against
  });

  it('no row beats alerted in the healthy story', () => {
    const groups = gateGroups(SIGNAL);
    expect(groups[0].rows.every((r) => !r.beatsAlerted)).toBe(true);
  });

  it('a filtered cell ≥ alerted at n≥10 is flagged — the gate may be discarding value', () => {
    const groups = gateGroups([
      { strategy: 'arb', gateOutcome: 'alerted', cell: cell(12, 2.1, 0.62) },
      { strategy: 'arb', gateOutcome: 'filtered', cell: cell(12, 3.0, 0.7) },
    ]);
    expect(groups[0].rows[1].beatsAlerted).toBe(true);
    expect(groups[0].margins).toEqual([{ vs: 'filtered', pp: -0.9 }]);
  });

  it('a small-N challenger (n<10) is NEVER flagged, even when its mean is higher', () => {
    const groups = gateGroups([
      { strategy: 'arb', gateOutcome: 'alerted', cell: cell(12, 2.1, 0.62) },
      { strategy: 'arb', gateOutcome: 'filtered', cell: cell(4, 9.9, 1) },
    ]);
    expect(groups[0].rows[1].beatsAlerted).toBe(false);
  });

  it('no alerted row → no margins, no flags', () => {
    const groups = gateGroups([
      { strategy: 'arb', gateOutcome: 'filtered', cell: cell(12, 3.0, 0.7) },
    ]);
    expect(groups[0].margins).toEqual([]);
    expect(groups[0].rows[0].beatsAlerted).toBe(false);
  });
});

describe('gateScaleMax — one shared scale across every row of every group', () => {
  it('is the largest |mean| across all rows', () => {
    expect(gateScaleMax(gateGroups(SIGNAL))).toBe(2.1);
  });
  it('falls back to 1 when there is nothing to scale', () => {
    expect(gateScaleMax(gateGroups([]))).toBe(1);
    expect(
      gateScaleMax(gateGroups([{ strategy: 'arb', gateOutcome: 'alerted', cell: cell(12, 0, 0.5) }])),
    ).toBe(1);
  });
});

describe('barGeometry — diverging bar on the shared scale, zero centered', () => {
  it('positive extends right, full scale = half the track', () => {
    expect(barGeometry(2.1, 2.1)).toEqual({ side: 'pos', pct: 50 });
  });
  it('negative extends left, proportional', () => {
    expect(barGeometry(-1.05, 2.1)).toEqual({ side: 'neg', pct: 25 });
  });
  it('zero → zero-width positive; null → no bar', () => {
    expect(barGeometry(0, 2.1)).toEqual({ side: 'pos', pct: 0 });
    expect(barGeometry(null, 2.1)).toBeNull();
  });
  it('clamps at the track edge', () => {
    expect(barGeometry(5, 2.1)).toEqual({ side: 'pos', pct: 50 });
  });
});

describe('topBooks — top rows by LEG count (byBook records are legs)', () => {
  const byBook: ClvSummary['byBook'] = [
    { bookmakerKey: 'a', title: 'A', cell: cell(3, 1, 1) },
    { bookmakerKey: 'b', title: 'B', cell: cell(9, 1, 1) },
    { bookmakerKey: 'c', title: 'C', cell: cell(9, 1, 1) },
    { bookmakerKey: 'd', title: 'D', cell: cell(5, 1, 1) },
  ];
  it('sorts by leg count desc, ties keep server (alphabetical) order', () => {
    expect(topBooks(byBook, 3).map((b) => b.bookmakerKey)).toEqual(['b', 'c', 'd']);
  });
  it('defaults to 8 rows', () => {
    expect(topBooks(byBook).map((b) => b.bookmakerKey)).toEqual(['b', 'c', 'd', 'a']);
  });
});

/* ————— cockpit per-record CLV (mirrors engine/clv.ts) ————— */

const COMMENCED = '2026-07-13T11:00:00Z';
const UPCOMING = '2026-07-13T15:00:00Z';
const NOW_MS = Date.parse('2026-07-13T12:00:00Z');

interface Spec {
  commenceTime?: string;
  stakes?: number[];
  confirmedLegOdds?: number[];
  filledLegs?: Array<{ odds: number; stake: number }>;
  closing?: {
    legOdds: Array<number | null>;
    benchmarkFairProb?: Array<number | null>;
  };
}

function rec(spec: Spec): OpportunityRecord {
  const stakes = spec.stakes ?? [50, 50];
  const record: OpportunityRecord = {
    id: 'r1',
    fingerprint: 'fp-r1',
    strategy: 'arb',
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: spec.commenceTime ?? COMMENCED,
    marketKey: 'h2h',
    legs: stakes.map((stake, i) => ({
      outcome: i === 0 ? 'Celtics' : 'Lakers',
      bookmakerKey: i === 0 ? 'bet365' : 'coolbet',
      bookmakerTitle: i === 0 ? 'bet365' : 'Coolbet',
      odds: 2,
      stake,
      link: null,
    })),
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'dead',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-13T09:00:00Z',
    lastSeenAt: '2026-07-13T10:00:00Z',
    statusChangedAt: '2026-07-13T09:00:00Z',
    alerted: true,
    alertedAt: '2026-07-13T10:00:00Z',
  };
  if (spec.confirmedLegOdds) {
    record.confirmation = {
      status: 'confirmed',
      scanAAt: '2026-07-13T09:00:00Z',
      confirmedLegOdds: spec.confirmedLegOdds,
    };
  }
  if (spec.filledLegs) {
    record.execution = {
      filledLegs: spec.filledLegs,
      totalStaked: spec.filledLegs.reduce((s, l) => s + l.stake, 0),
      lockedProfit: 0,
      recordedAt: '2026-07-13T10:45:00Z',
    };
  }
  if (spec.closing) {
    record.closing = {
      ...spec.closing,
      capturedAt: '2026-07-13T10:30:00Z',
      minutesToCommence: 30,
    };
  }
  return record;
}

describe('cockpitClv — renders nothing before the close freezes', () => {
  it('null without a closing', () => {
    expect(cockpitClv(rec({ confirmedLegOdds: [2.1, 2.1] }), NOW_MS)).toBeNull();
  });
  it('null before commence (the close has not frozen)', () => {
    const r = rec({
      commenceTime: UPCOMING,
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [2.0, 2.0] },
    });
    expect(cockpitClv(r, NOW_MS)).toBeNull();
  });
  it('null with no bet basis (no fills, no confirmedLegOdds)', () => {
    expect(cockpitClv(rec({ closing: { legOdds: [2.0, 2.0] } }), NOW_MS)).toBeNull();
  });
  it('null when the closing legs are misaligned with the record legs', () => {
    const r = rec({ confirmedLegOdds: [2.1, 2.1], closing: { legOdds: [2.0] } });
    expect(cockpitClv(r, NOW_MS)).toBeNull();
  });
});

describe('cockpitClv — signal basis (confirmedLegOdds), hand-computed', () => {
  it('per-leg raw + true, stake-weighted record figures', () => {
    const r = rec({
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [2.0, 2.0], benchmarkFairProb: [0.5, null] },
    });
    const clv = cockpitClv(r, NOW_MS);
    expect(clv).not.toBeNull();
    expect(clv!.basis).toBe('signal');
    expect(clv!.legs).toEqual([
      { basisOdds: 2.1, closingOdds: 2.0, rawClvPct: 5.000000000000004, trueClvPct: 5.000000000000004 },
      { basisOdds: 2.1, closingOdds: 2.0, rawClvPct: 5.000000000000004, trueClvPct: null },
    ]);
    expect(clv!.rawClvPct).toBeCloseTo(5, 10);
    expect(clv!.trueClvPct).toBeCloseTo(5, 10); // leg0 only, weight renormalized
    expect(clv!.usableLegs).toBe(2);
    expect(clv!.trueLegs).toBe(1);
  });

  it('a null closing leg is EXCLUDED and the weights renormalize (never zeroed)', () => {
    const r = rec({
      stakes: [60, 40],
      confirmedLegOdds: [2.2, 2.0],
      closing: { legOdds: [2.0, null] },
    });
    const clv = cockpitClv(r, NOW_MS)!;
    expect(clv.legs[1].rawClvPct).toBeNull();
    expect(clv.rawClvPct).toBeCloseTo(10, 10); // leg0 alone carries full weight
    expect(clv.usableLegs).toBe(1);
  });

  it('zero usable legs → record CLV null but the legs still explain why', () => {
    const r = rec({
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [null, null] },
    });
    const clv = cockpitClv(r, NOW_MS)!;
    expect(clv.rawClvPct).toBeNull();
    expect(clv.usableLegs).toBe(0);
    expect(clv.legs.every((l) => l.rawClvPct === null)).toBe(true);
  });

  it('degenerate all-zero weights fall back to the equal-weight mean (engine parity)', () => {
    const r = rec({
      stakes: [0, 0],
      confirmedLegOdds: [2.1, 1.9],
      closing: { legOdds: [2.0, 2.0] },
    });
    const clv = cockpitClv(r, NOW_MS)!;
    expect(clv.rawClvPct).toBeCloseTo(0, 10); // (+5 − 5) / 2
  });
});

describe('cockpitClv — execution basis wins when fills exist', () => {
  it('uses filledLegs odds and stakes', () => {
    const r = rec({
      confirmedLegOdds: [2.1, 2.1],
      filledLegs: [
        { odds: 2.3, stake: 100 },
        { odds: 1.9, stake: 100 },
      ],
      closing: { legOdds: [2.0, 2.0] },
    });
    const clv = cockpitClv(r, NOW_MS)!;
    expect(clv.basis).toBe('execution');
    expect(clv.legs[0].rawClvPct).toBeCloseTo(15, 10);
    expect(clv.legs[1].rawClvPct).toBeCloseTo(-5, 10);
    expect(clv.rawClvPct).toBeCloseTo(5, 10);
  });

  it('misaligned fills fall back to the signal basis', () => {
    const r = rec({
      confirmedLegOdds: [2.1, 2.1],
      filledLegs: [{ odds: 2.3, stake: 100 }],
      closing: { legOdds: [2.0, 2.0] },
    });
    const clv = cockpitClv(r, NOW_MS)!;
    expect(clv.basis).toBe('signal');
    expect(clv.rawClvPct).toBeCloseTo(5, 10);
  });
});
