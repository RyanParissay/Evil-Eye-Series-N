/**
 * Cost of Safety (Phase 17) — fixture-verified against a HAND-COMPUTED week.
 * Population: records that reached 'confirmed', carry a safety score, and
 * fail the gate at the CURRENT settings (the one passesSafetyGate function).
 * Dollars at the fund default stake ($500 here):
 *   arb    → profitPct × stake/100
 *   ev     → edgePct × stake/100 (EXPECTED — a model, not money)
 *   middle → $0 unless freeMiddle (worst case of a costed middle is a loss);
 *            free middles forgo the locked floor −costPct × stake/100.
 */
import { describe, expect, it } from 'vitest';
import type { OpportunityRecord, RecordSafety } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import { computeSafetyCost } from './cost';

const NOW = new Date('2026-07-12T20:00:00Z');
const DAY_MS = 24 * 3_600_000;
const STAKE = 500;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function safety(score: number, reasons: string[], scoredDaysAgo: number): RecordSafety {
  return { score, components: [], reasons, roundedStakes: [250, 250], scoredAt: daysAgo(scoredDaysAgo) };
}

let seq = 0;
function makeRecord(overrides: Partial<OpportunityRecord>): OpportunityRecord {
  const id = `rec-${seq++}`;
  return {
    id,
    fingerprint: `fp-${id}`,
    strategy: 'arb',
    eventId: `evt-${id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: daysAgo(-1),
    marketKey: 'h2h',
    legs: [],
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: daysAgo(2),
    lastSeenAt: daysAgo(2),
    statusChangedAt: daysAgo(2),
    alerted: false,
    alertedAt: null,
    confirmation: { status: 'confirmed', scanAAt: daysAgo(2), scanBAt: daysAgo(2) },
    ...overrides,
  };
}

/** The hand-computed fixture history (see each line's arithmetic). */
function fixtureHistory(): OpportunityRecord[] {
  seq = 0;
  return [
    // Week + lifetime, below threshold: 3.0% × $500/100 = $15.00 forgone.
    makeRecord({ profitPct: 3.0, safety: safety(50, [], 2) }),
    // Week + lifetime, hard reject: 6.0% × $500/100 = $30.00.
    makeRecord({ profitPct: 6.0, safety: safety(0, ['suspicious_edge'], 1) }),
    // Week + lifetime, EV below threshold: 4.0% edge × $500/100 = $20.00 EXPECTED.
    makeRecord({
      strategy: 'ev',
      profitPct: 4.0,
      ev: {
        benchmarkKey: 'pinnacle',
        benchmarkOdds: 1.95,
        fairProbability: 0.5,
        edgePct: 4.0,
        benchmarkLastUpdate: daysAgo(3),
      },
      safety: safety(40, [], 3),
    }),
    // Week + lifetime, COSTED middle: counts, but $0 forgone (worst case is
    // a loss — payout-weighted dollars would be dishonest).
    makeRecord({
      strategy: 'middle',
      profitPct: -2.5,
      middle: {
        lowLine: 220.5, highLine: 224.5, windowSize: 4, costPct: 2.5, payoutPct: 95,
        breakevenPct: 2.56, freeMiddle: false, pushPossible: false, keyNumbers: [],
      },
      safety: safety(20, [], 4),
    }),
    // Week + lifetime, FREE middle: the locked floor is real forgone profit:
    // −(−3.0)% × $500/100 = $15.00.
    makeRecord({
      strategy: 'middle',
      profitPct: 3.0,
      middle: {
        lowLine: 220.5, highLine: 224.5, windowSize: 4, costPct: -3.0, payoutPct: 95,
        breakevenPct: -2.9, freeMiddle: true, pushPossible: false, keyNumbers: [],
      },
      safety: safety(30, [], 5),
    }),
    // Lifetime ONLY (scored 10 days ago): 2.0% × $500/100 = $10.00.
    makeRecord({ profitPct: 2.0, safety: safety(45, [], 10), detectedAt: daysAgo(10) }),
    // Passes the gate (80 ≥ 55) → never counted.
    makeRecord({ profitPct: 3.0, safety: safety(80, [], 1) }),
    // Confirmed but UNSCORED (scoring failure) → ungated, never counted.
    makeRecord({ profitPct: 3.0 }),
    // Still pending → not confirmed, never counted.
    makeRecord({
      profitPct: 3.0,
      safety: safety(10, [], 1),
      confirmation: { status: 'pending', scanAAt: daysAgo(1) },
    }),
  ];
}

describe('computeSafetyCost', () => {
  it('matches the hand-computed fixture week and lifetime exactly', () => {
    const report = computeSafetyCost({
      history: fixtureHistory(),
      settings: DEFAULT_SAFETY_SETTINGS,
      defaultStake: STAKE,
      now: NOW,
    });

    expect(report.simulated).toBe(true);

    // Week (trailing 7d): records 1–5 → $15 + $30 + $20 + $0 + $15 = $80.00;
    // edge 3.0 + 6.0 + 4.0 + 0 + 3.0 = 16.0 pp.
    expect(report.week).toEqual({
      filteredCount: 5,
      forgoneProfit: 80,
      forgoneEdgePp: 16,
      byReason: [
        { reason: 'below_threshold', count: 4, forgoneProfit: 50 },
        { reason: 'suspicious_edge', count: 1, forgoneProfit: 30 },
      ],
      byStrategy: [
        { strategy: 'arb', count: 2, forgoneProfit: 45 },
        { strategy: 'ev', count: 1, forgoneProfit: 20 },
        { strategy: 'middle', count: 2, forgoneProfit: 15 },
      ],
    });

    // Lifetime adds the 10-day-old $10 arb.
    expect(report.lifetime).toEqual({
      filteredCount: 6,
      forgoneProfit: 90,
      forgoneEdgePp: 18,
      byReason: [
        { reason: 'below_threshold', count: 5, forgoneProfit: 60 },
        { reason: 'suspicious_edge', count: 1, forgoneProfit: 30 },
      ],
      byStrategy: [
        { strategy: 'arb', count: 3, forgoneProfit: 55 },
        { strategy: 'ev', count: 1, forgoneProfit: 20 },
        { strategy: 'middle', count: 2, forgoneProfit: 15 },
      ],
    });
  });

  it('prices at the CURRENT settings — moving the threshold moves the population', () => {
    const report = computeSafetyCost({
      history: fixtureHistory(),
      settings: { ...DEFAULT_SAFETY_SETTINGS, safetyThreshold: 45 },
      defaultStake: STAKE,
      now: NOW,
    });
    // Scores 50 and 45 now pass; 40/30/20/0 still fail.
    expect(report.week.filteredCount).toBe(4);
    expect(report.week.forgoneProfit).toBe(65); // $30 + $20 + $0 + $15
    expect(report.lifetime.filteredCount).toBe(4);
  });

  it('safeMode OFF → the gate filters nothing, so the cost is honestly zero', () => {
    const report = computeSafetyCost({
      history: fixtureHistory(),
      settings: { ...DEFAULT_SAFETY_SETTINGS, safeMode: false },
      defaultStake: STAKE,
      now: NOW,
    });
    expect(report.week).toEqual({
      filteredCount: 0,
      forgoneProfit: 0,
      forgoneEdgePp: 0,
      byReason: [],
      byStrategy: [],
    });
    expect(report.lifetime.filteredCount).toBe(0);
  });

  it('no fund default stake → counts stand, dollars are $0 (never estimate money)', () => {
    const report = computeSafetyCost({
      history: fixtureHistory(),
      settings: DEFAULT_SAFETY_SETTINGS,
      defaultStake: 0,
      now: NOW,
    });
    expect(report.week.filteredCount).toBe(5);
    expect(report.week.forgoneProfit).toBe(0);
    expect(report.week.forgoneEdgePp).toBe(16); // edge is stake-independent
  });
});
