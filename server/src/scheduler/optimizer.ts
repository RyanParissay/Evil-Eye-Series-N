/**
 * The weekly deterministic schedule optimizer (Phase 16 Part C.4) — PURE,
 * engine-grade (no fs/env/Express/provider imports). MODEL-labeled and
 * propose-only: it NEVER writes settings. POST /api/scheduler/proposal/apply
 * is the sole path that copies proposal.blocks into scheduler.blocks, and only
 * on explicit user confirmation.
 *
 * Given the confirmed-opportunity density by hour-of-day × day-of-week per
 * strategy (America/Vancouver local), it proposes scan blocks that allocate
 * scan frequency proportional to density, subject to three hard constraints:
 *   • quiet hours (01:00–08:00 Vancouver) are excluded — never a block;
 *   • ≥1 scan window per allowed 2-hour block (the floor);
 *   • projectedMonthlyCredits (scan pairs at the measured hit rate + the
 *     score-poll reserve) ≤ spendCeiling = monthlyBudget × 0.9.
 *
 * Deterministic BY CONSTRUCTION: no randomness, no wall clock beyond the
 * injected `now`, fixed iteration order — the SAME inputs always produce a
 * byte-identical proposal (the acceptance test JSON.stringify-compares two
 * runs over one fixture history).
 */
import type {
  DensityCell,
  OpportunityRecord,
  ScanLogEntry,
  SchedulerBlock,
  SchedulerProposal,
} from '@shared/types';
import {
  PROPOSAL_MIN_INTERVAL_MINS,
  PROPOSAL_SPEND_CEILING_FRACTION,
} from '../config/constants';
import { QUIET_END_MIN, QUIET_START_MIN, vancouverLocal } from './vancouverTime';

const DAY_MS = 24 * 3_600_000;
/** Gregorian average — a fixed constant, so determinism is unaffected. */
const AVG_WEEKS_PER_MONTH = 365.25 / 12 / 7;

export interface OptimizerInput {
  now: Date;
  /**
   * Confirmed opportunity records — the caller filters to confirmation
   * 'confirmed' (pre-Phase-16 records have no confirmation field and are not
   * counted). Density keys off detectedAt (scan A's sighting) in Vancouver
   * local time.
   */
  confirmedRecords: Pick<OpportunityRecord, 'detectedAt' | 'strategy'>[];
  /** Full scan history — the density window's span (historyDays). */
  scanHistory: Pick<ScanLogEntry, 'scannedAt'>[];
  monthlyBudget: number;
  /** Measured confirmation hit rate — scan B fires this fraction of scans. */
  hitRate: number;
  /** Actual per-scan credit cost (markets × region-equivalents × topN). */
  creditsPerScan: number;
  /**
   * Estimated monthly score-poll credit spend, reserved off the top of the
   * ceiling. The route derives it from the score-poll cadence bounded by the
   * daily scores cap; the scan-pair term the optimizer controls dominates.
   */
  scorePollCreditsPerMonth: number;
}

/** Whole days spanned by the scan history (max − min scannedAt). */
export function historyDaysSpan(scanHistory: Pick<ScanLogEntry, 'scannedAt'>[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const s of scanHistory) {
    const ms = Date.parse(s.scannedAt);
    if (!Number.isFinite(ms)) continue;
    if (ms < min) min = ms;
    if (ms > max) max = ms;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return (max - min) / DAY_MS;
}

/** One allowed 2-hour slot (clipped to avoid quiet hours) and its hours. */
interface Slot {
  startMin: number;
  endMin: number;
  hours: number[];
}

/**
 * The allowed 2-hour slots of a local day: the [0,120), [120,240) … grid with
 * the quiet window subtracted. Derived from the quiet constants, so it stays
 * correct if quiet hours ever move. With quiet = [01:00, 08:00) the result is
 * eight full 2h slots (08:00–24:00) plus the 00:00–01:00 pre-quiet hour.
 */
export function allowedSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let start = 0; start < 24 * 60; start += 120) {
    const end = start + 120;
    for (const [s, e] of subtractQuiet(start, end)) {
      slots.push({ startMin: s, endMin: e, hours: hoursIn(s, e) });
    }
  }
  return slots;
}

/** [start,end) minus the quiet interval, as up to two non-empty pieces. */
function subtractQuiet(start: number, end: number): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  const left: [number, number] = [start, Math.min(end, QUIET_START_MIN)];
  if (left[0] < left[1]) pieces.push(left);
  const right: [number, number] = [Math.max(start, QUIET_END_MIN), end];
  if (right[0] < right[1]) pieces.push(right);
  return pieces;
}

function hoursIn(startMin: number, endMin: number): number[] {
  const hours: number[] = [];
  for (let h = Math.floor(startMin / 60); h < Math.ceil(endMin / 60); h++) hours.push(h);
  return hours;
}

/**
 * Compute the proposal. `model: true` always; the density table and blocks are
 * both included so the UI can render the hour × day counts alongside the
 * proposed schedule and the projected-vs-ceiling spend.
 */
export function computeProposal(input: OptimizerInput): SchedulerProposal {
  const spendCeiling = Math.round(input.monthlyBudget * PROPOSAL_SPEND_CEILING_FRACTION);
  const perPairCost = input.creditsPerScan * (1 + input.hitRate);

  // ————— Density: [day][hour] per strategy —————
  const grid = emptyGrid();
  for (const record of input.confirmedRecords) {
    const ms = Date.parse(record.detectedAt);
    if (!Number.isFinite(ms)) continue;
    const loc = vancouverLocal(new Date(ms));
    const hour = Math.floor(loc.minutesOfDay / 60);
    const cell = grid[loc.weekday][hour];
    if (record.strategy === 'ev') cell.ev += 1;
    else if (record.strategy === 'middle') cell.middle += 1;
    else cell.arb += 1;
  }

  const slots = allowedSlots();

  // Per-(day, slot) total confirmed density.
  const slotDensity: number[][] = []; // [day][slotIndex]
  let totalDensity = 0;
  for (let day = 0; day < 7; day++) {
    slotDensity[day] = slots.map((slot) => {
      const d = slot.hours.reduce(
        (sum, h) => sum + grid[day][h].arb + grid[day][h].ev + grid[day][h].middle,
        0,
      );
      totalDensity += d;
      return d;
    });
  }

  // ————— Budget-aware interval allocation —————
  // Each allowed cell occurs ~AVG_WEEKS_PER_MONTH times/month and gets ≥1
  // window (the floor). Any budget beyond the floors is distributed across
  // cells in proportion to density; a denser cell earns a shorter interval.
  // Because integer intervals pack whole windows into a block, the honest
  // discrete spend slightly exceeds the smooth allocation — so `scale` dials
  // the extra allocation down (deterministic binary search) until the ACTUAL
  // projected spend fits the ceiling. The ∝-density SHAPE is preserved.
  const cellCount = 7 * slots.length;
  const floorScansPerMonth = cellCount * AVG_WEEKS_PER_MONTH; // one window per occurrence
  const scanBudget = Math.max(0, spendCeiling - input.scorePollCreditsPerMonth);
  const extraCreditBudget =
    perPairCost > 0 ? Math.max(0, scanBudget - floorScansPerMonth * perPairCost) : 0;
  const extraScansTotal = perPairCost > 0 ? extraCreditBudget / perPairCost : 0;

  const intervalsFor = (scale: number): number[][] => {
    const out: number[][] = [];
    for (let day = 0; day < 7; day++) {
      out[day] = slots.map((slot, si) => {
        const d = slotDensity[day][si];
        const extraScans = totalDensity > 0 ? extraScansTotal * scale * (d / totalDensity) : 0;
        const scansPerOccurrence = 1 + extraScans / AVG_WEEKS_PER_MONTH;
        const duration = slot.endMin - slot.startMin;
        const raw = Math.ceil(duration / scansPerOccurrence);
        return clamp(raw, PROPOSAL_MIN_INTERVAL_MINS, duration);
      });
    }
    return out;
  };

  const projectedFor = (intervals: number[][]): number => {
    let scanPairsPerMonth = 0;
    for (let day = 0; day < 7; day++) {
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si];
        const windows = windowsInBlock(slot.endMin - slot.startMin, intervals[day][si]);
        scanPairsPerMonth += windows * AVG_WEEKS_PER_MONTH;
      }
    }
    return scanPairsPerMonth * perPairCost + input.scorePollCreditsPerMonth;
  };

  // Full extra allocation if it already fits; otherwise the largest scale that
  // keeps the discrete projection under the ceiling.
  let scale = 1;
  if (projectedFor(intervalsFor(1)) > spendCeiling) {
    let lo = 0;
    let hi = 1;
    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      if (projectedFor(intervalsFor(mid)) <= spendCeiling) lo = mid;
      else hi = mid;
    }
    scale = lo;
  }
  const intervalByDaySlot = intervalsFor(scale);
  const projectedMonthlyCredits = Math.round(projectedFor(intervalByDaySlot));

  return {
    model: true,
    computedAt: input.now.toISOString(),
    historyDays: Math.round(historyDaysSpan(input.scanHistory) * 100) / 100,
    density: densityCells(grid),
    blocks: buildBlocks(slots, intervalByDaySlot),
    projectedMonthlyCredits,
    monthlyBudget: input.monthlyBudget,
    spendCeiling,
  };
}

/** Windows a block of `duration` minutes holds at `interval` (≥1): a scan at
 *  entry, then every interval while still inside the block. */
function windowsInBlock(duration: number, interval: number): number {
  return Math.floor((duration - 1) / interval) + 1;
}

/**
 * Blocks from the per-(day, slot) intervals: merge contiguous same-interval
 * slots within a day, then merge day-blocks with identical (start, end,
 * interval) across days into one multi-day block (collapsing a uniform
 * schedule the way the seed expresses it). Deterministic sort: startMin, then
 * intervalMins.
 */
function buildBlocks(slots: Slot[], intervalByDaySlot: number[][]): SchedulerBlock[] {
  // Step 1: per-day merged runs of contiguous same-interval slots.
  type Run = { startMin: number; endMin: number; intervalMins: number };
  const perDay: Run[][] = [];
  for (let day = 0; day < 7; day++) {
    const runs: Run[] = [];
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const interval = intervalByDaySlot[day][si];
      const last = runs[runs.length - 1];
      if (last && last.endMin === slot.startMin && last.intervalMins === interval) {
        last.endMin = slot.endMin;
      } else {
        runs.push({ startMin: slot.startMin, endMin: slot.endMin, intervalMins: interval });
      }
    }
    perDay[day] = runs;
  }
  // Step 2: merge identical runs across days into one block.
  const byKey = new Map<string, { days: number[]; run: Run }>();
  for (let day = 0; day < 7; day++) {
    for (const run of perDay[day]) {
      const key = `${run.startMin}-${run.endMin}-${run.intervalMins}`;
      const existing = byKey.get(key);
      if (existing) existing.days.push(day);
      else byKey.set(key, { days: [day], run });
    }
  }
  return [...byKey.values()]
    .map(({ days, run }) => ({
      days: [...days].sort((a, b) => a - b),
      startMin: run.startMin,
      endMin: run.endMin,
      intervalMins: run.intervalMins,
    }))
    .sort((a, b) => a.startMin - b.startMin || a.intervalMins - b.intervalMins);
}

interface Counts {
  arb: number;
  ev: number;
  middle: number;
}

function emptyGrid(): Counts[][] {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ arb: 0, ev: 0, middle: 0 })),
  );
}

/** Non-zero density cells, sorted by (day, hour) for a stable proposal. */
function densityCells(grid: Counts[][]): DensityCell[] {
  const cells: DensityCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = grid[day][hour];
      if (c.arb || c.ev || c.middle) {
        cells.push({ day, hour, arb: c.arb, ev: c.ev, middle: c.middle });
      }
    }
  }
  return cells;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
