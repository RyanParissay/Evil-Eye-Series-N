/**
 * Scan history browser (Phase 15 #2): pairs each recent scan-history line
 * with the opportunities detected or re-sighted during its slot — the
 * window between it and the previous scan — plus the Phase-13 gap
 * indicator immediately before it (reused from gapDetector, never
 * reimplemented). Zero credits: derives entirely from scanHistoryStore +
 * persisted opportunity records already on disk. No new live calls.
 */
import type { OpportunityRecord, OpsSettings, ScanBrowserEntry, ScanLogEntry } from '@shared/types';
import { detectScanGaps } from './gapDetector';

/**
 * A record is attributed to a scan when it falls in that scan's SLOT —
 * (previous scan's timestamp, this scan's timestamp] — scoped to the same
 * region tab and a sport the scan actually covered (mirroring the
 * "provenGone" scoping in opportunityLifecycle.ts). Both detection and
 * re-sighting timestamps count, since a record detected earlier can be
 * re-sighted by a later scan. Only gaps that land BETWEEN two rendered
 * rows are surfaced — the trailing gap between the last scan and "now"
 * has no following row to sit before, so it's intentionally dropped here.
 */
export function buildScanBrowser(
  allScans: ScanLogEntry[],
  lastN: number,
  records: OpportunityRecord[],
  opsSettings: OpsSettings,
  now: Date,
): ScanBrowserEntry[] {
  const sorted = [...allScans].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  const gapByEnd = new Map(
    detectScanGaps(sorted, opsSettings.scheduler.blocks, now).map((g) => [g.to, g]),
  );
  const window = sorted.slice(-Math.max(lastN, 0));
  const firstWindowIndex = sorted.length - window.length;

  const rows: ScanBrowserEntry[] = window.map((scan, i) => {
    const prev = sorted[firstWindowIndex + i - 1] ?? null;
    const slotStart = prev ? Date.parse(prev.scannedAt) : -Infinity;
    const slotEnd = Date.parse(scan.scannedAt);
    const scannedSports = new Set(scan.sportsScanned);
    const inSlot = (iso: string) => {
      const t = Date.parse(iso);
      return t > slotStart && t <= slotEnd;
    };

    const opportunities = records
      .filter(
        (r) =>
          r.regionTab === scan.regionTab &&
          scannedSports.has(r.sportKey) &&
          (inSlot(r.detectedAt) || inSlot(r.lastSeenAt)),
      )
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

    return {
      ...scan,
      gapBefore: gapByEnd.get(scan.scannedAt) ?? null,
      opportunities,
      counts: {
        arb: opportunities.filter((r) => r.strategy === 'arb').length,
        ev: opportunities.filter((r) => r.strategy === 'ev').length,
        middle: opportunities.filter((r) => r.strategy === 'middle').length,
        total: opportunities.length,
      },
    };
  });

  return rows.reverse(); // newest first
}
