import { describe, expect, it } from 'vitest';
import type { GradeResult, OpportunityRecord, RecordGrading } from '@shared/types';
import type { ScanGap } from '../ops/gapDetector';
import {
  exportPortfoliosCsv,
  perSignalReturns,
  runScenarios,
  SERIES_STARTING_BANKROLL,
  type PortfolioSeries,
} from './scenarioEngine';

function grading(result: GradeResult, pnlPer100: number, flags: string[] = []): RecordGrading {
  return {
    result,
    legResults: [result],
    pnlPer100,
    flags,
    gradedAt: '2026-01-02T00:00:00Z',
    source: 'auto',
    audit: [{ at: '2026-01-02T00:00:00Z', old: null, next: result }],
  };
}

function rec(overrides: Partial<OpportunityRecord> & { id: string }): OpportunityRecord {
  return {
    fingerprint: overrides.id.padEnd(64, '0'),
    strategy: 'arb',
    eventId: `evt-${overrides.id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Away @ Home',
    commenceTime: '2026-01-01T00:00:00Z',
    marketKey: 'h2h',
    legs: [{ outcome: 'Home', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2, stake: 100, link: null }],
    profitPctAtDetection: 0,
    profitPct: 0,
    arbIndex: 1,
    status: 'completed',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    statusChangedAt: '2026-01-01T00:00:00Z',
    alerted: false,
    alertedAt: null,
    schemaVersion: 2,
    ...overrides,
  };
}

function arb(id: string, detectedAt: string, edge: number, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({ id, detectedAt, strategy: 'arb', profitPctAtDetection: edge, grading: g, ...extra });
}

function ev(id: string, detectedAt: string, edgePct: number, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({
    id,
    detectedAt,
    strategy: 'ev',
    profitPctAtDetection: 0,
    grading: g,
    ev: {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 2,
      fairProbability: 0.5,
      edgePct,
      benchmarkLastUpdate: detectedAt,
    },
    ...extra,
  });
}

function middle(id: string, detectedAt: string, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({
    id,
    detectedAt,
    strategy: 'middle',
    grading: g,
    middle: {
      lowLine: 219.5,
      highLine: 220.5,
      windowSize: 1,
      costPct: -1,
      payoutPct: 1,
      breakevenPct: -1,
      freeMiddle: true,
      pushPossible: false,
      keyNumbers: [],
    },
    ...extra,
  });
}

describe('runScenarios — series shape', () => {
  it('builds exactly 13 series with the documented keys and groups', () => {
    const report = runScenarios([], []);
    expect(report.series).toHaveLength(13);
    expect(report.series.map((s) => s.key)).toEqual([
      'arb_1',
      'arb_2',
      'arb_3',
      'ev_e3_high',
      'ev_e3_med',
      'ev_e3_low',
      'ev_e5_high',
      'ev_e5_med',
      'ev_e5_low',
      'ev_e7_high',
      'ev_e7_med',
      'ev_e7_low',
      'middle',
    ]);
    expect(report.series.filter((s) => s.group === 'arb')).toHaveLength(3);
    expect(report.series.filter((s) => s.group === 'ev')).toHaveLength(9);
    expect(report.series.filter((s) => s.group === 'middle')).toHaveLength(1);
  });

  it('every series starts at the $10,000 paper bankroll with zeroed stats on an empty stream', () => {
    const report = runScenarios([], []);
    for (const series of report.series) {
      expect(series.startingBankroll).toBe(SERIES_STARTING_BANKROLL);
      expect(series.bankroll).toBe(SERIES_STARTING_BANKROLL);
      expect(series.pnl).toBe(0);
      expect(series.roiPct).toBe(0);
      expect(series.records).toBe(0);
      expect(series.wins).toBe(0);
      expect(series.losses).toBe(0);
      expect(series.pushes).toBe(0);
      expect(series.voids).toBe(0);
      expect(series.skipped).toEqual({ count: 0, events: [] });
      expect(series.maxDrawdown).toBe(0);
      expect(series.equity).toEqual([]);
      expect(series.buckets).toEqual({ preV13: 0, needsRules: 0, stale: 0, open: 0, excluded: 0 });
    }
  });

  it('attaches the caller-supplied scan gaps unchanged, shared across every series', () => {
    const gaps: ScanGap[] = [{ from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z', minutes: 60 }];
    const report = runScenarios([], gaps);
    expect(report.gaps).toEqual(gaps);
  });
});

describe('runScenarios — determinism', () => {
  it('the same input replayed twice deep-equals itself', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-03T00:00:00Z', 5, grading('win', 50)),
      arb('2'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('loss', -100)),
      ev('3'.repeat(16), '2026-01-02T00:00:00Z', 6, grading('push', 0)),
    ];
    const first = runScenarios(records, []);
    const second = runScenarios(records, []);
    expect(second).toEqual(first);
  });

  it('does not mutate the input record array', () => {
    const records = [
      arb('2'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('loss', -100)),
      arb('1'.repeat(16), '2026-01-03T00:00:00Z', 5, grading('win', 50)),
    ];
    const snapshot = [...records];
    runScenarios(records, []);
    expect(records).toEqual(snapshot);
  });

  it('replay is order-independent: shuffled input matches sorted input', () => {
    const a = arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 50));
    const b = arb('2'.repeat(16), '2026-01-02T00:00:00Z', 5, grading('loss', -100));
    const c = arb('3'.repeat(16), '2026-01-03T00:00:00Z', 5, grading('push', 0));

    const sorted = runScenarios([a, b, c], []);
    const shuffled = runScenarios([c, a, b], []);
    expect(shuffled).toEqual(sorted);
  });

  it('breaks same-detectedAt ties by id so replay stays deterministic', () => {
    const a = arb('2'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 10));
    const b = arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 20));
    const first = runScenarios([a, b], []);
    const second = runScenarios([b, a], []);
    expect(second).toEqual(first);
    // id '1...' sorts before '2...' — its signal lands first in the equity curve.
    const arb1 = first.series.find((s) => s.key === 'arb_1')!;
    expect(arb1.equity[0].bankroll).toBe(SERIES_STARTING_BANKROLL + 200 * 0.2); // b (pnl 20) first
  });
});

describe('runScenarios — hand fixtures reconcile to the cent', () => {
  it('a win/loss/push sequence lands the arb series bankroll exactly', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 50)), // +$100 on $200 stake
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 5, grading('loss', -100)), // -$200
      arb('3'.repeat(16), '2026-01-03T00:00:00Z', 5, grading('push', 0)), // $0
    ];
    const report = runScenarios(records, []);
    for (const key of ['arb_1', 'arb_2', 'arb_3']) {
      const series = report.series.find((s) => s.key === key)!;
      expect(series.bankroll).toBe(9900); // 10000 + 100 - 200 + 0
      expect(series.pnl).toBe(-100);
      expect(series.roiPct).toBe(-1);
      expect(series.records).toBe(3);
      expect(series.wins).toBe(1);
      expect(series.losses).toBe(1);
      expect(series.pushes).toBe(1);
      expect(series.voids).toBe(0);
      expect(series.equity).toEqual([
        { at: '2026-01-01T00:00:00Z', bankroll: 10100 },
        { at: '2026-01-02T00:00:00Z', bankroll: 9900 },
        { at: '2026-01-03T00:00:00Z', bankroll: 9900 },
      ]);
    }
  });

  it('a void reconciles to $0 P&L and counts in the voids bucket', () => {
    const records = [arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('void', 0))];
    const report = runScenarios(records, []);
    const series = report.series.find((s) => s.key === 'arb_1')!;
    expect(series.bankroll).toBe(10000);
    expect(series.voids).toBe(1);
    expect(series.records).toBe(1);
  });

  it('EV risk tiers stake the same signal differently — high/med/low reconcile independently', () => {
    const records = [ev('1'.repeat(16), '2026-01-01T00:00:00Z', 6, grading('win', 50))];
    const report = runScenarios(records, []);
    const high = report.series.find((s) => s.key === 'ev_e5_high')!; // stake $300
    const med = report.series.find((s) => s.key === 'ev_e5_med')!; // stake $200
    const low = report.series.find((s) => s.key === 'ev_e5_low')!; // stake $100
    expect(high.bankroll).toBe(10000 + 300 * 0.5);
    expect(med.bankroll).toBe(10000 + 200 * 0.5);
    expect(low.bankroll).toBe(10000 + 100 * 0.5);
  });

  it('skips a signal the series cannot afford and records the skip event; bankroll unaffected', () => {
    const bigLoss = arb('1'.repeat(16), '2026-01-01T00:00:00Z', 3, grading('loss', -4901)); // -$9802 on $200
    const nextSignal = arb('2'.repeat(16), '2026-01-02T00:00:00Z', 3, grading('win', 50));
    const report = runScenarios([bigLoss, nextSignal], []);
    const arb3 = report.series.find((s) => s.key === 'arb_3')!;
    expect(arb3.bankroll).toBeCloseTo(198, 8);
    expect(arb3.records).toBe(1); // only the big loss was placed
    expect(arb3.skipped).toEqual({
      count: 1,
      events: [{ at: '2026-01-02T00:00:00Z', recordId: '2'.repeat(16) }],
    });
    // the skipped signal never touches the equity curve or bankroll
    expect(arb3.equity).toHaveLength(1);
  });

  it('peak-to-trough max drawdown tracks the running bankroll', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 100)), // 10000 -> 10200
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 5, grading('loss', -100)), // 10200 -> 10000
      arb('3'.repeat(16), '2026-01-03T00:00:00Z', 5, grading('loss', -100)), // 10000 -> 9800
      arb('4'.repeat(16), '2026-01-04T00:00:00Z', 5, grading('win', 100)), // 9800 -> 10000
    ];
    const report = runScenarios(records, []);
    const series = report.series.find((s) => s.key === 'arb_1')!;
    // peak 10200, trough 9800 -> drawdown 400
    expect(series.maxDrawdown).toBe(400);
  });
});

describe('runScenarios — entry filters keep series strategy-pure', () => {
  it('an EV record never enters an arb series, and vice versa', () => {
    const records = [
      ev('1'.repeat(16), '2026-01-01T00:00:00Z', 10, grading('win', 50)),
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 10, grading('win', 50)),
    ];
    const report = runScenarios(records, []);
    const arb1 = report.series.find((s) => s.key === 'arb_1')!;
    const evSeries = report.series.find((s) => s.key === 'ev_e3_high')!;
    expect(arb1.records).toBe(1);
    expect(evSeries.records).toBe(1);
  });

  it('arb series gate on profitPctAtDetection thresholds independently', () => {
    const records = [arb('1'.repeat(16), '2026-01-01T00:00:00Z', 1.5, grading('win', 10))];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'arb_1')!.records).toBe(1);
    expect(report.series.find((s) => s.key === 'arb_2')!.records).toBe(0);
    expect(report.series.find((s) => s.key === 'arb_3')!.records).toBe(0);
  });

  it('EV series gate on edgePct thresholds independently of risk tier', () => {
    const records = [ev('1'.repeat(16), '2026-01-01T00:00:00Z', 4, grading('win', 10))];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'ev_e3_high')!.records).toBe(1);
    expect(report.series.find((s) => s.key === 'ev_e5_high')!.records).toBe(0);
    expect(report.series.find((s) => s.key === 'ev_e7_high')!.records).toBe(0);
  });

  it('only strategy "middle" records enter the middle series', () => {
    const records = [
      middle('1'.repeat(16), '2026-01-01T00:00:00Z', grading('win', 10)),
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 10, grading('win', 10)),
    ];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'middle')!.records).toBe(1);
  });
});

describe('runScenarios — ungradeable buckets, visible and never dropped', () => {
  it('pre-v13 (no schemaVersion, no grading) counts in the preV13 bucket', () => {
    const records = [arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, undefined, { schemaVersion: undefined })];
    const report = runScenarios(records, []);
    const series = report.series.find((s) => s.key === 'arb_1')!;
    expect(series.buckets.preV13).toBe(1);
    expect(series.records).toBe(0);
  });

  it('needs_rules flag counts in the needsRules bucket', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, undefined, { gradingFlags: ['needs_rules'] }),
    ];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'arb_1')!.buckets.needsRules).toBe(1);
  });

  it('ungraded_stale flag counts in the stale bucket', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, undefined, { gradingFlags: ['ungraded_stale'] }),
    ];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'arb_1')!.buckets.stale).toBe(1);
  });

  it('an ungraded record with no flag counts in the open bucket', () => {
    const records = [arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, undefined)];
    const report = runScenarios(records, []);
    expect(report.series.find((s) => s.key === 'arb_1')!.buckets.open).toBe(1);
  });

  it('same-book or suspicious records land in the excluded bucket and never enter P&L, even if graded', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 50), { sameBookmaker: true }),
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 5, grading('win', 50), { suspicious: true }),
    ];
    const report = runScenarios(records, []);
    const series = report.series.find((s) => s.key === 'arb_1')!;
    expect(series.buckets.excluded).toBe(2);
    expect(series.records).toBe(0);
    expect(series.bankroll).toBe(SERIES_STARTING_BANKROLL);
  });
});

describe('perSignalReturns', () => {
  it('derives per-signal fractional returns from the equity curve, chronologically', () => {
    const records = [
      arb('1'.repeat(16), '2026-01-01T00:00:00Z', 5, grading('win', 50)), // +100
      arb('2'.repeat(16), '2026-01-02T00:00:00Z', 5, grading('loss', -100)), // -200
    ];
    const report = runScenarios(records, []);
    const series = report.series.find((s) => s.key === 'arb_1')!;
    expect(perSignalReturns(series)).toEqual([100 / SERIES_STARTING_BANKROLL, -200 / SERIES_STARTING_BANKROLL]);
  });

  it('an empty series has no returns', () => {
    const report = runScenarios([], []);
    expect(perSignalReturns(report.series[0])).toEqual([]);
  });
});

describe('exportPortfoliosCsv', () => {
  function series(overrides: Partial<PortfolioSeries> = {}): PortfolioSeries {
    return {
      key: 'arb_2',
      label: 'Arb ≥2%',
      group: 'arb',
      startingBankroll: SERIES_STARTING_BANKROLL,
      bankroll: 10_200,
      pnl: 200,
      roiPct: 2,
      records: 3,
      wins: 2,
      losses: 1,
      pushes: 0,
      voids: 0,
      skipped: { count: 1, events: [{ at: '2026-01-05T00:00:00Z', recordId: 'skipped1' }] },
      buckets: { preV13: 0, needsRules: 0, stale: 0, open: 0, excluded: 0 },
      maxDrawdown: 50,
      equity: [],
      ...overrides,
    };
  }

  function collect(rows: PortfolioSeries[]): string[] {
    const chunks: string[] = [];
    exportPortfoliosCsv(rows, (chunk) => chunks.push(chunk));
    return chunks.join('').split('\n').filter((l) => l.length > 0);
  }

  it('emits a header plus one row per series: id, entries, settled count, realized P&L, ending bankroll, skipped count', () => {
    const lines = collect([series()]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'series_id,entries,settled_count,realized_pnl,ending_bankroll,skipped_insufficient_count',
    );
    // entries=records=3, settled=records+skipped=4, pnl=200, bankroll=10200, skipped=1
    expect(lines[1]).toBe('"arb_2",3,4,200,10200,1');
  });

  it('a series with no skips settles exactly its placed records', () => {
    const lines = collect([series({ key: 'middle', records: 5, skipped: { count: 0, events: [] } })]);
    expect(lines[1]).toBe('"middle",5,5,200,10200,0');
  });

  it('empty input is just the header', () => {
    expect(collect([])).toEqual([
      'series_id,entries,settled_count,realized_pnl,ending_bankroll,skipped_insufficient_count',
    ]);
  });
});
