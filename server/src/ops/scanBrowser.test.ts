import { describe, expect, it } from 'vitest';
import type { OpportunityRecord, OpsSettings, ScanLogEntry } from '@shared/types';
import { buildScanBrowser } from './scanBrowser';
import { DEFAULT_SCHEDULER_SETTINGS } from './opsStore';

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

/** Local wall-clock time on a fixed date, matching gapDetector.test.ts. */
function local(hour: number, minute: number): string {
  return new Date(2026, 6, 13, hour, minute).toISOString();
}

function scan(overrides: Partial<ScanLogEntry>): ScanLogEntry {
  return {
    scannedAt: local(19, 0),
    regionTab: 'ca',
    sportsScanned: ['basketball_nba'],
    creditsComputed: 2,
    requestsUsedTotal: 100,
    distinctBooks: ['bet365', 'pinnacle'],
    eventCount: 1,
    ...overrides,
  };
}

function record(overrides: Partial<OpportunityRecord>): OpportunityRecord {
  return {
    id: Math.random().toString(16).slice(2, 18),
    fingerprint: 'f'.repeat(64),
    strategy: 'arb',
    eventId: 'evt',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: local(23, 0),
    marketKey: 'h2h',
    legs: [
      { outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'B', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    profitPctAtDetection: 2.34,
    profitPct: 2.34,
    arbIndex: 0.977,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: local(19, 0),
    lastSeenAt: local(19, 0),
    statusChangedAt: local(19, 0),
    alerted: false,
    alertedAt: null,
    ...overrides,
  };
}

describe('buildScanBrowser', () => {
  it('attributes each record to the scan whose slot it falls in, newest scan first', () => {
    // Three scans so slot 2 (18:55, 19:00] isn't the ambiguous -inf first
    // slot: r1 and r2 are both detected inside slot 2; r2 is additionally
    // RE-SIGHTED inside slot 3, so it appears on both rows. Slot 1
    // (-inf, 18:55] gets nothing — the empty-row case.
    const scans = [
      scan({ scannedAt: local(18, 55) }),
      scan({ scannedAt: local(19, 0) }),
      scan({ scannedAt: local(19, 5) }),
    ];
    const records = [
      record({ id: 'r1', detectedAt: local(18, 58), lastSeenAt: local(18, 58) }),
      record({ id: 'r2', detectedAt: local(18, 56), lastSeenAt: local(19, 4) }),
    ];

    const rows = buildScanBrowser(scans, 10, records, SETTINGS, new Date(2026, 6, 13, 19, 10));

    expect(rows.map((r) => r.scannedAt)).toEqual([local(19, 5), local(19, 0), local(18, 55)]); // newest first
    expect(rows[0].opportunities.map((r) => r.id)).toEqual(['r2']); // re-sighted in slot 3
    expect(rows[0].counts).toEqual({ arb: 1, ev: 0, middle: 0, total: 1 });
    expect(rows[1].opportunities.map((r) => r.id)).toEqual(['r1', 'r2']); // both detected in slot 2
    expect(rows[2].opportunities).toEqual([]); // slot 1: nothing before the window starts
  });

  it('never attributes a record to a scan on a different region tab or an unscanned sport', () => {
    const scans = [scan({ scannedAt: local(19, 0) })];
    const records = [
      record({ id: 'wrong-tab', regionTab: 'ca_us', detectedAt: local(18, 59) }),
      record({ id: 'wrong-sport', sportKey: 'icehockey_nhl', detectedAt: local(18, 59) }),
      record({ id: 'right', detectedAt: local(18, 59) }),
    ];

    const rows = buildScanBrowser(scans, 10, records, SETTINGS, new Date(2026, 6, 13, 19, 1));

    expect(rows[0].opportunities.map((r) => r.id)).toEqual(['right']);
  });

  it('counts by strategy: arb/ev/middle', () => {
    const scans = [scan({ scannedAt: local(19, 0) })];
    const records = [
      record({ id: 'a', strategy: 'arb', detectedAt: local(18, 59) }),
      record({ id: 'e', strategy: 'ev', detectedAt: local(18, 59) }),
      record({ id: 'm', strategy: 'middle', detectedAt: local(18, 59) }),
    ];

    const rows = buildScanBrowser(scans, 10, records, SETTINGS, new Date(2026, 6, 13, 19, 1));

    expect(rows[0].counts).toEqual({ arb: 1, ev: 1, middle: 1, total: 3 });
  });

  it('attaches the Phase-13 gap indicator to the row right after the hole', () => {
    const scans = [
      scan({ scannedAt: local(19, 0) }),
      scan({ scannedAt: local(19, 5) }),
      scan({ scannedAt: local(20, 0) }), // hole: 55min, way over 2×5
    ];

    const rows = buildScanBrowser(scans, 10, [], SETTINGS, new Date(2026, 6, 13, 20, 5));

    const gapRow = rows.find((r) => r.scannedAt === local(20, 0))!;
    expect(gapRow.gapBefore).toEqual({ from: local(19, 5), to: local(20, 0), minutes: 55 });
    expect(rows.find((r) => r.scannedAt === local(19, 5))!.gapBefore).toBeNull();
    expect(rows.find((r) => r.scannedAt === local(19, 0))!.gapBefore).toBeNull();
  });

  it('drops the trailing gap-to-now (no following row to sit before)', () => {
    const scans = [scan({ scannedAt: local(19, 0) })];
    // "now" is hours later — a real gap by gapDetector's own math, but it
    // has no next scan row to attach to, so it must not appear anywhere.
    const rows = buildScanBrowser(scans, 10, [], SETTINGS, new Date(2026, 6, 13, 22, 0));
    expect(rows.every((r) => r.gapBefore === null)).toBe(true);
  });

  it('lastN limits the window to the most recent scans, still newest first', () => {
    const scans = [
      scan({ scannedAt: local(19, 0) }),
      scan({ scannedAt: local(19, 5) }),
      scan({ scannedAt: local(19, 10) }),
    ];
    const rows = buildScanBrowser(scans, 2, [], SETTINGS, new Date(2026, 6, 13, 19, 15));
    expect(rows.map((r) => r.scannedAt)).toEqual([local(19, 10), local(19, 5)]);
  });

  it('returns nothing for empty history', () => {
    expect(buildScanBrowser([], 10, [], SETTINGS, new Date())).toEqual([]);
  });
});
