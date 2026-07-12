import { describe, expect, it } from 'vitest';
import type { SchedulerBlock, ScanLogEntry } from '@shared/types';
import { detectScanGaps } from './gapDetector';
import { vancouverEpochOf } from '../scheduler/vancouverTime';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// 09:00–23:00 every day, cadence 5 min — the block whose gaps we probe.
const BLOCKS: SchedulerBlock[] = [
  { days: ALL_DAYS, startMin: 9 * 60, endMin: 23 * 60, intervalMins: 5 },
];

/** A fixed America/Vancouver wall clock (2026-07-13, PDT), round-tripped to
 *  ISO — deterministic regardless of the runner's own timezone, since block
 *  membership is evaluated in Vancouver local time via Intl. */
function van(hour: number, minute = 0): string {
  return new Date(vancouverEpochOf(2026, 7, 13, hour * 60 + minute)).toISOString();
}

function entry(scannedAt: string): ScanLogEntry {
  return {
    scannedAt,
    regionTab: 'ca',
    sportsScanned: ['basketball_nba'],
    creditsComputed: 1,
    requestsUsedTotal: null,
    distinctBooks: [],
    eventCount: 0,
  };
}

describe('detectScanGaps', () => {
  it('flags a hole bigger than 2× the block cadence inside a block', () => {
    const entries = [
      entry(van(19, 0)),
      entry(van(19, 5)),
      entry(van(19, 10)),
      // hole: next scan at 20:00 instead of ~19:15 — 50 min, way over 2×5=10
      entry(van(20, 0)),
      entry(van(20, 5)),
    ];
    const now = new Date(vancouverEpochOf(2026, 7, 13, 20 * 60 + 10));

    expect(detectScanGaps(entries, BLOCKS, now)).toEqual([
      { from: van(19, 10), to: van(20, 0), minutes: 50 },
    ]);
  });

  it('does not flag normal cadence, nor a hole that starts outside every block', () => {
    const entries = [
      entry(van(19, 0)),
      entry(van(19, 5)),
      entry(van(19, 10)),
      // a huge gap, but it starts at 02:00 — quiet hours, in no block
      entry(van(2, 0)),
    ];
    const now = new Date(vancouverEpochOf(2026, 7, 13, 19 * 60 + 15));

    expect(detectScanGaps(entries, BLOCKS, now)).toEqual([]);
  });

  it('uses the START block’s own cadence (dense vs moderate)', () => {
    const blocks: SchedulerBlock[] = [
      { days: ALL_DAYS, startMin: 8 * 60, endMin: 14 * 60, intervalMins: 30 }, // moderate
      { days: ALL_DAYS, startMin: 14 * 60, endMin: 19 * 60, intervalMins: 5 }, // dense
    ];
    // A 40-min hole from 13:00 (moderate, threshold 60) is fine…
    const moderate = [entry(van(13, 0)), entry(van(13, 40))];
    expect(detectScanGaps(moderate, blocks, new Date(vancouverEpochOf(2026, 7, 13, 13 * 60 + 45)))).toEqual([]);
    // …but the same 40-min hole from 15:00 (dense, threshold 10) is a gap.
    const dense = [entry(van(15, 0)), entry(van(15, 40))];
    expect(detectScanGaps(dense, blocks, new Date(vancouverEpochOf(2026, 7, 13, 15 * 60 + 45)))).toEqual([
      { from: van(15, 0), to: van(15, 40), minutes: 40 },
    ]);
  });

  it('also checks the span from the last scan to now', () => {
    const entries = [entry(van(19, 0))];
    const now = new Date(vancouverEpochOf(2026, 7, 13, 20 * 60)); // 60 min since the only scan

    expect(detectScanGaps(entries, BLOCKS, now)).toEqual([
      { from: van(19, 0), to: now.toISOString(), minutes: 60 },
    ]);
  });

  it('no entries and no elapsed time produces no gaps', () => {
    expect(detectScanGaps([], BLOCKS, new Date(vancouverEpochOf(2026, 7, 13, 19 * 60)))).toEqual([]);
  });
});
