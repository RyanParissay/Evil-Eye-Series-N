/**
 * The scheduler's pure decision core — engine-grade (no fs/env/Express/
 * provider imports). Given the scheduler settings, the current instant, the
 * recent scan/score-poll history, and the credit budget, it returns the ONE
 * next action: run a scan, run a score poll, or sleep until an instant.
 *
 * Budget-, cap-, and quiet-hours-awareness is BY CONSTRUCTION here: the
 * global gates below are checked before any provider action can be emitted,
 * so the tick loop that executes these actions can never spend a credit in
 * quiet hours or past the 95% auto-stop. All local-time reasoning goes
 * through vancouverTime (IANA zone via Intl), never a fixed offset.
 */
import type { SchedulerBlock, SchedulerSettings } from '@shared/types';
import { isQuietHours, nextQuietEndMs, vancouverEpochOf, vancouverLocal } from './vancouverTime';

export type SchedulerAction =
  | { kind: 'scan'; params: { regionTab: string; topN: number } }
  | { kind: 'scorePoll' }
  | { kind: 'sleep'; untilMs: number };

export interface PlanInput {
  settings: SchedulerSettings;
  now: Date;
  /** Epoch ms of the most recent scan (manual or scheduled); null if none. */
  lastScanAtMs: number | null;
  /** Epoch ms of the scheduler's last score poll; null if it hasn't polled. */
  lastScorePollAtMs: number | null;
  /** Score-poll cadence in ms. */
  scorePollIntervalMs: number;
  budget: {
    monthlyCreditBudget: number;
    autoStopPct: number;
    /** The provider's own month-to-date counter; null when unknown. */
    usedTotal: number | null;
  };
}

/** When there's nothing to do soon, sleep this far and let the tick loop's
 *  own max-sleep cap re-evaluate (settings changes, budget release). */
const IDLE_SLEEP_MS = 24 * 3_600_000;

export function plan(input: PlanInput): SchedulerAction {
  const { settings, now } = input;
  const nowMs = now.getTime();

  // ————— Global gates (order matters; every one blocks provider calls) —————

  // Disabled: dormant. The tick loop clamps this to its max sleep and also
  // wakes on the enable toggle, so re-enabling is picked up promptly.
  if (!settings.enabled) return { kind: 'sleep', untilMs: nowMs + IDLE_SLEEP_MS };

  // Quiet hours: zero Odds API calls of any kind. Sleep to the next 08:00.
  if (isQuietHours(now)) return { kind: 'sleep', untilMs: nextQuietEndMs(now) };

  // Credit auto-stop: no scheduler-initiated provider call at/over the cap
  // (manual scans are never gated — that's enforced at the route, not here).
  if (budgetStopped(input.budget)) return { kind: 'sleep', untilMs: nowMs + IDLE_SLEEP_MS };

  const scorePollDue =
    input.lastScorePollAtMs == null ||
    nowMs - input.lastScorePollAtMs >= input.scorePollIntervalMs;
  const nextScorePollMs =
    input.lastScorePollAtMs == null ? nowMs : input.lastScorePollAtMs + input.scorePollIntervalMs;

  // ————— Inside an active scan block —————
  const active = activeBlock(settings.blocks, now);
  if (active) {
    const scanDueAtMs =
      input.lastScanAtMs == null ? nowMs : input.lastScanAtMs + active.intervalMins * 60_000;

    if (scanDueAtMs <= nowMs) return { kind: 'scan', params: settings.scanParams };
    if (scorePollDue) return { kind: 'scorePoll' };
    // Wake for whichever comes first: the next scan or the next score poll.
    return { kind: 'sleep', untilMs: Math.min(scanDueAtMs, nextScorePollMs) };
  }

  // ————— Between blocks (non-quiet gap) —————
  // Grading is time-sensitive (games finish outside scan blocks too), so a
  // due score poll still fires; otherwise sleep toward the next block start.
  if (scorePollDue) return { kind: 'scorePoll' };
  const nextStart = nextBlockStartMs(settings.blocks, now);
  const untilMs = Math.min(
    nextStart ?? nowMs + IDLE_SLEEP_MS,
    nextScorePollMs,
  );
  return { kind: 'sleep', untilMs };
}

function budgetStopped(budget: PlanInput['budget']): boolean {
  return (
    budget.usedTotal != null &&
    budget.usedTotal >= (budget.autoStopPct / 100) * budget.monthlyCreditBudget
  );
}

/** The first block whose day + [startMin, endMin) window contains `now`
 *  (Vancouver local); null if none. */
export function activeBlock(blocks: SchedulerBlock[], now: Date): SchedulerBlock | null {
  const loc = vancouverLocal(now);
  for (const b of blocks) {
    if (!b.days.includes(loc.weekday)) continue;
    if (loc.minutesOfDay >= b.startMin && loc.minutesOfDay < b.endMin) return b;
  }
  return null;
}

/** Epoch ms of the earliest block start strictly after `now`, scanning the
 *  next 8 local days; null if the schedule has no blocks at all. */
export function nextBlockStartMs(blocks: SchedulerBlock[], now: Date): number | null {
  if (blocks.length === 0) return null;
  const loc = vancouverLocal(now);
  const nowMs = now.getTime();
  let best = Infinity;
  for (let d = 0; d < 8; d++) {
    const date = new Date(Date.UTC(loc.year, loc.month - 1, loc.day + d));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = date.getUTCDay();
    for (const b of blocks) {
      if (!b.days.includes(weekday)) continue;
      const startMs = vancouverEpochOf(y, m, day, b.startMin);
      if (startMs > nowMs && startMs < best) best = startMs;
    }
  }
  return Number.isFinite(best) ? best : null;
}
