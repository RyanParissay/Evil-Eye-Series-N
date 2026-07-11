/**
 * Scan-gap detector (Phase 13, deliverable 6). Pure, detection only — NO
 * server-side scheduler (that would be the "scans are on-demand only"
 * invariant wearing another hat). A gap is a stretch between two
 * consecutive scans (or the last scan and now) that sits inside the active
 * window and runs more than 2× the in-window cadence — evidence that
 * auto-scan silently stopped firing (page closed, crash, etc).
 *
 * Window evaluation mirrors client/src/cadence.ts's inWindow/windowState
 * exactly (kept in sync deliberately — see CLAUDE.md: "TIMERS live in the
 * client, always"; this module only ever detects, never schedules). Like
 * the client, it reads local wall-clock time off the Date it's given — the
 * same single-user-app assumption the rest of ops/ makes (scan-history
 * timestamps are produced and consumed by the same machine/timezone).
 */
import type { OpsSettings, ScanLogEntry, ScanWindow } from '@shared/types';

export interface ScanGap {
  from: string;
  to: string;
  minutes: number;
}

export function detectScanGaps(entries: ScanLogEntry[], opsSettings: OpsSettings, now: Date): ScanGap[] {
  const sorted = [...entries].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  const boundaries = [...sorted.map((e) => e.scannedAt), now.toISOString()];
  const threshold = 2 * opsSettings.inWindowMins;
  const gaps: ScanGap[] = [];

  for (let i = 0; i + 1 < boundaries.length; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    if (!inActiveWindow(opsSettings, new Date(from))) continue; // only in-window gaps count
    const minutes = (Date.parse(to) - Date.parse(from)) / 60_000;
    if (minutes > threshold) gaps.push({ from, to, minutes: Math.round(minutes) });
  }
  return gaps;
}

/** Start inclusive, end exclusive; end < start spans midnight. Copy of
 *  client/src/cadence.ts's inWindow — see module comment. */
function inActiveWindow(settings: OpsSettings, at: Date): boolean {
  const day = at.getDay();
  const window: ScanWindow = day === 0 || day === 6 ? settings.weekend : settings.weekday;
  const mins = at.getHours() * 60 + at.getMinutes();
  if (window.startMinutes <= window.endMinutes) {
    return mins >= window.startMinutes && mins < window.endMinutes;
  }
  return mins >= window.startMinutes || mins < window.endMinutes;
}
