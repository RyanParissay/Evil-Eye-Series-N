import { describe, expect, it } from 'vitest';
import type { OpportunityRecord, ScanLogEntry } from '@shared/types';
import { PROPOSAL_MIN_INTERVAL_MINS } from '../config/constants';
import { allowedSlots, computeProposal, historyDaysSpan, type OptimizerInput } from './optimizer';
import { QUIET_END_MIN, QUIET_START_MIN, vancouverEpochOf } from './vancouverTime';

/** A confirmed record detected at a Vancouver-local (date, hour). */
function rec(
  date: [number, number, number],
  hour: number,
  strategy: OpportunityRecord['strategy'] = 'arb',
): Pick<OpportunityRecord, 'detectedAt' | 'strategy'> {
  return {
    detectedAt: new Date(vancouverEpochOf(date[0], date[1], date[2], hour * 60)).toISOString(),
    strategy,
  };
}

/** A scan-history line at a Vancouver-local (date). */
function scan(date: [number, number, number], hour = 12): Pick<ScanLogEntry, 'scannedAt'> {
  return {
    scannedAt: new Date(vancouverEpochOf(date[0], date[1], date[2], hour * 60)).toISOString(),
  };
}

/** 8 days of history (Jan 8 → Jan 15, 2026). */
const HISTORY: Pick<ScanLogEntry, 'scannedAt'>[] = Array.from({ length: 8 }, (_, i) =>
  scan([2026, 1, 8 + i]),
);

function input(over: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    now: new Date(vancouverEpochOf(2026, 1, 15, 9 * 60)),
    confirmedRecords: [],
    scanHistory: HISTORY,
    monthlyBudget: 20_000,
    hitRate: 0.3,
    creditsPerScan: 10,
    scorePollCreditsPerMonth: 1_000,
    ...over,
  };
}

describe('optimizer — allowed slots', () => {
  it('excludes quiet hours: 00:00–01:00 plus the eight 08:00–24:00 2h slots', () => {
    const slots = allowedSlots();
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual({ startMin: 0, endMin: 60, hours: [0] });
    // No slot intersects the quiet window (01:00–08:00).
    for (const s of slots) {
      expect(s.endMin <= QUIET_START_MIN || s.startMin >= QUIET_END_MIN).toBe(true);
    }
  });
});

describe('optimizer — density table', () => {
  it('counts confirmed records by Vancouver hour-of-day × day-of-week per strategy', () => {
    const p = computeProposal(
      input({
        confirmedRecords: [
          rec([2026, 1, 15], 15, 'arb'), // Thu (day 4) 15:00
          rec([2026, 1, 15], 15, 'arb'),
          rec([2026, 1, 15], 15, 'ev'),
          rec([2026, 1, 12], 10, 'middle'), // Mon (day 1) 10:00
        ],
      }),
    );
    const thu15 = p.density.find((c) => c.day === 4 && c.hour === 15);
    expect(thu15).toEqual({ day: 4, hour: 15, arb: 2, ev: 1, middle: 0 });
    const mon10 = p.density.find((c) => c.day === 1 && c.hour === 10);
    expect(mon10).toEqual({ day: 1, hour: 10, arb: 0, ev: 0, middle: 1 });
    // Sparse: only the two non-zero cells are present.
    expect(p.density).toHaveLength(2);
  });
});

describe('optimizer — proposed blocks', () => {
  it('never proposes a block inside quiet hours, and always ≥1 window per 2h block', () => {
    const p = computeProposal(input({ confirmedRecords: [rec([2026, 1, 15], 15)] }));
    for (const b of p.blocks) {
      expect(b.startMin).toBeLessThan(b.endMin);
      expect(b.endMin <= QUIET_START_MIN || b.startMin >= QUIET_END_MIN).toBe(true);
      // ≥1 window per allowed 2h block ⇒ interval ≤ min(120, block duration).
      expect(b.intervalMins).toBeLessThanOrEqual(Math.min(120, b.endMin - b.startMin));
      expect(b.intervalMins).toBeGreaterThanOrEqual(PROPOSAL_MIN_INTERVAL_MINS);
    }
  });

  it('allocates a shorter interval to a denser slot (frequency ∝ density)', () => {
    // Cheap pairs → lots of extra budget to differentiate. All density in the
    // Thursday 14:00–16:00 slot; the Thursday 20:00–22:00 slot stays empty.
    const dense = Array.from({ length: 40 }, () => rec([2026, 1, 15], 15));
    const p = computeProposal(input({ confirmedRecords: dense, creditsPerScan: 2, hitRate: 0 }));
    // Find the Thursday-only (or Thursday-containing) blocks covering 14:00 and 20:00.
    const at = (min: number) =>
      p.blocks.find((b) => b.days.includes(4) && b.startMin <= min && min < b.endMin);
    const denseBlock = at(14 * 60);
    const emptyBlock = at(20 * 60);
    expect(denseBlock).toBeDefined();
    expect(emptyBlock).toBeDefined();
    expect(denseBlock!.intervalMins).toBeLessThan(emptyBlock!.intervalMins);
  });

  it('a flat (uniform) history collapses to multi-day blocks, like the seed', () => {
    // No density anywhere → every cell gets the floor interval (slot duration),
    // so all 7 days share identical blocks and merge into all-days blocks.
    const p = computeProposal(input({ confirmedRecords: [] }));
    for (const b of p.blocks) {
      expect(b.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });
});

describe('optimizer — budget ceiling (spendCeiling = budget × 0.9)', () => {
  it('projected monthly credits never exceed the spend ceiling', () => {
    const dense = Array.from({ length: 200 }, (_, i) => rec([2026, 1, 12 + (i % 4)], 8 + (i % 14)));
    const p = computeProposal(input({ confirmedRecords: dense }));
    expect(p.spendCeiling).toBe(18_000); // 20,000 × 0.9
    expect(p.projectedMonthlyCredits).toBeLessThanOrEqual(p.spendCeiling);
    expect(p.projectedMonthlyCredits).toBeGreaterThan(0);
  });

  it('holds the ceiling even with a huge density and cheap pairs', () => {
    const dense = Array.from({ length: 5_000 }, (_, i) => rec([2026, 1, 12 + (i % 5)], 8 + (i % 14)));
    const p = computeProposal(
      input({ confirmedRecords: dense, creditsPerScan: 1, hitRate: 0, monthlyBudget: 5_000 }),
    );
    expect(p.spendCeiling).toBe(4_500);
    expect(p.projectedMonthlyCredits).toBeLessThanOrEqual(p.spendCeiling);
  });
});

describe('optimizer — determinism & labeling', () => {
  it('same inputs → byte-identical proposal', () => {
    const records = Array.from({ length: 30 }, (_, i) => rec([2026, 1, 12 + (i % 4)], 9 + (i % 10)));
    const a = computeProposal(input({ confirmedRecords: records }));
    const b = computeProposal(input({ confirmedRecords: records }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('always MODEL-labeled and stamps computedAt / historyDays', () => {
    const p = computeProposal(input());
    expect(p.model).toBe(true);
    expect(p.computedAt).toBe(new Date(vancouverEpochOf(2026, 1, 15, 9 * 60)).toISOString());
    expect(p.historyDays).toBe(7); // Jan 8 → Jan 15 = 7.0 days
  });
});

describe('optimizer — historyDaysSpan', () => {
  it('is the span between the earliest and latest scan', () => {
    expect(historyDaysSpan(HISTORY)).toBe(7);
    expect(historyDaysSpan([])).toBe(0);
    expect(historyDaysSpan([scan([2026, 1, 15])])).toBe(0);
  });
});
