/**
 * CLV summary (Phase 18) — a hand-built record population where EVERY cell is
 * asserted exactly, plus coverage honesty (frozen-only median, closing-less
 * records counted but never zeroed into cells) and the gate-outcome
 * classification (alerted / filtered via the live safety gate / single_sighting).
 */
import { describe, expect, it } from 'vitest';
import type {
  ArbLeg,
  OpportunityRecord,
  OpportunityStatus,
  OpportunityStrategy,
  RecordClosing,
} from '@shared/types';
import { computeClvSummary } from './clvSummary';

const NOW = new Date('2026-07-13T12:00:00Z');
const PAST = '2026-07-13T11:00:00Z'; // commenced → frozen
const FUTURE = '2026-07-13T15:00:00Z'; // not yet → rolling
const SETTINGS = { safeMode: true, safetyThreshold: 55 };

interface RecSpec {
  id: string;
  strategy?: OpportunityStrategy;
  commenceTime: string;
  alerted?: boolean;
  safetyScore?: number;
  confStatus?: 'confirmed' | 'single_sighting';
  confirmedLegOdds?: number[];
  legs: Array<{ outcome: string; book: string; stake: number }>;
  status?: OpportunityStatus;
  filledLegs?: Array<{ odds: number; stake: number }>;
  closing?: Pick<RecordClosing, 'legOdds' | 'benchmarkFairProb' | 'minutesToCommence'>;
}

function rec(spec: RecSpec): OpportunityRecord {
  const legs: ArbLeg[] = spec.legs.map((l, i) => ({
    outcome: l.outcome,
    bookmakerKey: l.book,
    bookmakerTitle: l.book,
    odds: spec.confirmedLegOdds?.[i] ?? 2,
    stake: l.stake,
    link: null,
  }));
  const record: OpportunityRecord = {
    id: spec.id,
    fingerprint: `fp-${spec.id}`,
    strategy: spec.strategy ?? 'arb',
    eventId: `evt-${spec.id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: spec.commenceTime,
    marketKey: 'h2h',
    legs,
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: spec.status ?? 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-13T09:00:00Z',
    lastSeenAt: '2026-07-13T10:00:00Z',
    statusChangedAt: '2026-07-13T09:00:00Z',
    alerted: spec.alerted ?? false,
    alertedAt: spec.alerted ? '2026-07-13T10:00:00Z' : null,
  };
  if (spec.confStatus || spec.confirmedLegOdds) {
    record.confirmation = {
      status: spec.confStatus ?? 'confirmed',
      scanAAt: '2026-07-13T09:00:00Z',
      ...(spec.confirmedLegOdds && { confirmedLegOdds: spec.confirmedLegOdds }),
    };
  }
  if (spec.safetyScore != null) {
    record.safety = { score: spec.safetyScore, components: [], reasons: [], scoredAt: '2026-07-13T09:30:00Z' };
  }
  if (spec.closing) {
    record.closing = { ...spec.closing, capturedAt: '2026-07-13T10:30:00Z' };
  }
  if (spec.filledLegs) {
    record.execution = {
      filledLegs: spec.filledLegs,
      totalStaked: spec.filledLegs.reduce((s, l) => s + l.stake, 0),
      lockedProfit: 0,
      recordedAt: '2026-07-13T10:45:00Z',
    };
  }
  return record;
}

/** The population (see the per-record hand-computations inline in the test). */
function population(): OpportunityRecord[] {
  return [
    // R1 arb, alerted; both legs +5.0 raw, both benchmarked → true +5.0.
    rec({
      id: 'R1',
      alerted: true,
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [2.0, 2.0], benchmarkFairProb: [0.5, 0.5], minutesToCommence: 10 },
    }),
    // R2 arb, alerted; legs −5.0 / 0.0 → record −2.5; no benchmark.
    rec({
      id: 'R2',
      alerted: true,
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'pinnacle', stake: 50 }],
      confirmedLegOdds: [1.9, 2.0],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 30 },
    }),
    // R3 arb, filtered (safety 40 < 55); legs +10.0/+10.0 → record +10.0.
    rec({
      id: 'R3',
      safetyScore: 40,
      confStatus: 'confirmed',
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.2, 2.2],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 20 },
    }),
    // R4 arb, single_sighting (re-sighted, drifted); legs 0.0/−10.0 → −5.0.
    rec({
      id: 'R4',
      confStatus: 'single_sighting',
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'pinnacle', stake: 50 }],
      confirmedLegOdds: [2.0, 1.8],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 40 },
    }),
    // R5 ev, alerted; single leg +5.0 raw, benchmarked → true +5.0.
    rec({
      id: 'R5',
      strategy: 'ev',
      alerted: true,
      commenceTime: PAST,
      legs: [{ outcome: 'Team X', book: 'bet365', stake: 100 }],
      confirmedLegOdds: [2.1],
      closing: { legOdds: [2.0], benchmarkFairProb: [0.5], minutesToCommence: 15 },
    }),
    // R6 arb, completed (execution +5.0), confirmed+gate-passed+unalerted →
    // NOT a signal cell, but its signal legs (2.10/2.10) feed byBook.
    rec({
      id: 'R6',
      confStatus: 'confirmed',
      status: 'completed',
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.1, 2.1],
      filledLegs: [{ odds: 2.3, stake: 100 }, { odds: 1.9, stake: 100 }],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 25 },
    }),
    // R7 arb, alerted, NO closing → coverage total only, excluded everywhere.
    rec({
      id: 'R7',
      alerted: true,
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.1, 2.1],
    }),
    // R8 arb, closing present but NO confirmedLegOdds and NOT commenced →
    // coverage recordsWithClosing (rolling, excluded from the frozen median).
    rec({
      id: 'R8',
      commenceTime: FUTURE,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 200 },
    }),
  ];
}

describe('computeClvSummary — every cell asserted exactly', () => {
  const summary = computeClvSummary({ records: population(), safetySettings: SETTINGS, now: NOW });

  it('coverage: 7/8 have closing; frozen-only median minutes = 22.5 (R8 rolling excluded)', () => {
    expect(summary.coverage).toEqual({
      recordsWithClosing: 7,
      recordsTotal: 8,
      medianCaptureMins: 22.5, // median of [10,15,20,25,30,40]
    });
  });

  it('signal cells: arb×{alerted,filtered,single_sighting} + ev×alerted, in order', () => {
    expect(summary.signal).toEqual([
      {
        strategy: 'arb',
        gateOutcome: 'alerted',
        cell: {
          records: 2, // R1 +5.0, R2 −2.5
          meanClvPct: 1.25,
          medianClvPct: 1.25,
          beatClosePct: 0.5,
          trueClv: { records: 1, meanPct: 5, beatPct: 1 }, // R1 only
        },
      },
      {
        strategy: 'arb',
        gateOutcome: 'filtered',
        cell: { records: 1, meanClvPct: 10, medianClvPct: 10, beatClosePct: 1 }, // R3
      },
      {
        strategy: 'arb',
        gateOutcome: 'single_sighting',
        cell: { records: 1, meanClvPct: -5, medianClvPct: -5, beatClosePct: 0 }, // R4
      },
      {
        strategy: 'ev',
        gateOutcome: 'alerted',
        cell: {
          records: 1,
          meanClvPct: 5,
          medianClvPct: 5,
          beatClosePct: 1,
          trueClv: { records: 1, meanPct: 5, beatPct: 1 },
        },
      },
    ]);
  });

  it('execution cells: only completed+filled R6, arb, +5.0', () => {
    expect(summary.execution).toEqual([
      { strategy: 'arb', cell: { records: 1, meanClvPct: 5, medianClvPct: 5, beatClosePct: 1 } },
    ]);
  });

  it('byBook: each leg attributes its own signal CLV to its own book', () => {
    expect(summary.byBook).toEqual([
      {
        bookmakerKey: 'bet365',
        title: 'bet365',
        cell: {
          records: 6, // R1,R2,R3,R4,R5,R6 leg0: [5,−5,10,0,5,5]
          meanClvPct: 3.33, // 20/6
          medianClvPct: 5,
          beatClosePct: 0.6667, // 4/6
          trueClv: { records: 2, meanPct: 5, beatPct: 1 }, // R1+R5 leg0
        },
      },
      {
        bookmakerKey: 'coolbet',
        title: 'coolbet',
        cell: {
          records: 3, // R1,R3,R6 leg1: [5,10,5]
          meanClvPct: 6.67, // 20/3
          medianClvPct: 5,
          beatClosePct: 1,
          trueClv: { records: 1, meanPct: 5, beatPct: 1 }, // R1 leg1
        },
      },
      {
        bookmakerKey: 'pinnacle',
        title: 'pinnacle',
        cell: {
          records: 2, // R2,R4 leg1: [0,−10]
          meanClvPct: -5,
          medianClvPct: -5,
          beatClosePct: 0,
        },
      },
    ]);
  });
});

describe('computeClvSummary — edges', () => {
  it('an empty population → zeroed coverage, empty arrays (never a throw)', () => {
    expect(computeClvSummary({ records: [], safetySettings: SETTINGS, now: NOW })).toEqual({
      coverage: { recordsWithClosing: 0, recordsTotal: 0, medianCaptureMins: null },
      signal: [],
      execution: [],
      byBook: [],
    });
  });

  it('a confirmed+gate-passed+unalerted record is NOT a measured gate outcome (excluded from signal)', () => {
    const passed = rec({
      id: 'P',
      confStatus: 'confirmed',
      safetyScore: 80, // passes the gate
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 10 },
    });
    const summary = computeClvSummary({ records: [passed], safetySettings: SETTINGS, now: NOW });
    expect(summary.signal).toEqual([]); // not alerted, not filtered, not single_sighting
    expect(summary.byBook).toHaveLength(2); // still contributes its leg CLVs by book
  });

  it('safeMode OFF → no record is "filtered" (the gate passes everything)', () => {
    const filtered = rec({
      id: 'F',
      safetyScore: 10,
      confStatus: 'confirmed',
      commenceTime: PAST,
      legs: [{ outcome: 'Celtics', book: 'bet365', stake: 50 }, { outcome: 'Lakers', book: 'coolbet', stake: 50 }],
      confirmedLegOdds: [2.1, 2.1],
      closing: { legOdds: [2.0, 2.0], minutesToCommence: 10 },
    });
    const off = computeClvSummary({
      records: [filtered],
      safetySettings: { safeMode: false, safetyThreshold: 55 },
      now: NOW,
    });
    // Gate passes → not filtered; unalerted+confirmed → not a measured outcome.
    expect(off.signal).toEqual([]);
  });
});
