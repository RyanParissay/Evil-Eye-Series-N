import { describe, expect, it } from 'vitest';
import type { OpsSettings, ScanLogEntry } from '@shared/types';
import { detectScanGaps } from './gapDetector';
import { DEFAULT_SCHEDULER_SETTINGS } from './opsStore';

// Weekday and weekend windows deliberately identical (09:00–23:00 local) so
// the test doesn't depend on which day of the week it happens to run on.
const SETTINGS: OpsSettings = {
  weekday: { startMinutes: 9 * 60, endMinutes: 23 * 60 },
  weekend: { startMinutes: 9 * 60, endMinutes: 23 * 60 },
  inWindowMins: 5,
  outWindowMins: null,
  monthlyCreditBudget: 20_000,
  autoStopPct: 95,
  markets: { totals: false, spreads: false },
  confirmSecondSighting: false,
  scheduler: DEFAULT_SCHEDULER_SETTINGS,
};

/** Local wall-clock time on a fixed date, round-tripped through ISO — safe
 *  regardless of the test runner's timezone since both ends use the same
 *  process's local clock. */
function local(hour: number, minute: number): string {
  return new Date(2026, 6, 13, hour, minute).toISOString();
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
  it('flags a punched hole bigger than 2× cadence inside the window', () => {
    const entries = [
      entry(local(19, 0)),
      entry(local(19, 5)),
      entry(local(19, 10)),
      // hole: next scan at 20:00 instead of ~19:15 — 50min, way over 2×5=10
      entry(local(20, 0)),
      entry(local(20, 5)),
    ];
    const now = new Date(2026, 6, 13, 20, 10);

    const gaps = detectScanGaps(entries, SETTINGS, now);

    expect(gaps).toEqual([{ from: local(19, 10), to: local(20, 0), minutes: 50 }]);
  });

  it('does not flag normal cadence gaps or gaps outside the active window', () => {
    const entries = [
      entry(local(19, 0)),
      entry(local(19, 5)),
      entry(local(19, 10)),
      // a huge gap, but it starts at 02:00 — outside the 09:00–23:00 window
      entry(local(2, 0)),
    ];
    const now = new Date(2026, 6, 13, 19, 15);

    expect(detectScanGaps(entries, SETTINGS, now)).toEqual([]);
  });

  it('also checks the span from the last scan to now', () => {
    const entries = [entry(local(19, 0))];
    const now = new Date(2026, 6, 13, 20, 0); // 60min since the only scan

    const gaps = detectScanGaps(entries, SETTINGS, now);

    expect(gaps).toEqual([{ from: local(19, 0), to: now.toISOString(), minutes: 60 }]);
  });

  it('no entries and no elapsed time produces no gaps', () => {
    expect(detectScanGaps([], SETTINGS, new Date(2026, 6, 13, 19, 0))).toEqual([]);
  });
});
