/**
 * Scan-gap detector (Phase 13, rewired for Phase 16). Pure, detection only —
 * NOT a scheduler. A gap is a stretch between two consecutive scans (or the
 * last scan and now) whose START sits inside an active scheduler block and
 * runs more than 2× THAT block's cadence — evidence that the scheduler
 * silently stopped firing (disabled, crashed, quota, etc).
 *
 * The expected cadence now derives from `scheduler.blocks` (Phase-16 flip),
 * not the legacy inWindowMins/weekday-weekend windows: block membership and
 * per-block interval come straight from the same plan.ts the scheduler runs
 * on, evaluated in America/Vancouver local time (DST-safe via Intl). A
 * stretch that starts outside every block — quiet hours or a schedule gap —
 * expects no scan and is never flagged.
 */
import type { SchedulerBlock, ScanLogEntry } from '@shared/types';
import { activeBlock } from '../scheduler/plan';

export interface ScanGap {
  from: string;
  to: string;
  minutes: number;
}

export function detectScanGaps(
  entries: ScanLogEntry[],
  blocks: SchedulerBlock[],
  now: Date,
): ScanGap[] {
  const sorted = [...entries].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  const boundaries = [...sorted.map((e) => e.scannedAt), now.toISOString()];
  const gaps: ScanGap[] = [];

  for (let i = 0; i + 1 < boundaries.length; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    const block = activeBlock(blocks, new Date(from));
    if (!block) continue; // start outside every block → no scan expected here
    const minutes = (Date.parse(to) - Date.parse(from)) / 60_000;
    if (minutes > 2 * block.intervalMins) gaps.push({ from, to, minutes: Math.round(minutes) });
  }
  return gaps;
}
