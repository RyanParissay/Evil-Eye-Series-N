/**
 * The scheduler's pure decision core — engine-grade (no fs/env/Express/
 * provider imports). Given the scheduler settings, the current instant, the
 * recent scan/score-poll history, the credit budget, and the pending
 * confirmation pair (Phase 16 Part A), it returns the ONE next action: run
 * a scan, run the confirmation scan B, resolve a lapsed pair, run a score
 * poll, or sleep until an instant.
 *
 * Budget-, cap-, and quiet-hours-awareness is BY CONSTRUCTION here: the
 * global gates below are checked before any provider action can be emitted,
 * so the tick loop that executes these actions can never spend a credit in
 * quiet hours or past the 95% auto-stop. The ONE deliberate exception: a
 * due confirmation scan B rides its scan A's authorization — it fires while
 * the scheduler is disabled (a MANUAL scan's pair must complete with the
 * browser closed) and past the budget stop (manual scans are never
 * budget-gated; a scheduler pair's A already passed the gate an interval
 * ago). Quiet hours still block it absolutely, and a B that cannot fire
 * within CONFIRMATION_GRACE_INTERVALS× the interval of its due time
 * resolves its candidates to single_sighting instead — bookkeeping, zero
 * credits, allowed anywhere. All local-time reasoning goes through
 * vancouverTime (IANA zone via Intl), never a fixed offset.
 */
import type { SchedulerBlock, SchedulerSettings } from '@shared/types';
import {
  CONFIRMATION_GRACE_INTERVALS,
  DEFAULT_CONFIRMATION_INTERVAL_SECS,
  DENSE_WEEK_DAY_CAP,
  DENSE_WEEK_WEEK_CAP,
} from '../config/constants';
import {
  isQuietHours,
  nextQuietEndMs,
  nextVancouverMidnightMs,
  vancouverEpochOf,
  vancouverLocal,
} from './vancouverTime';

export type SchedulerAction =
  | { kind: 'scan'; params: { regionTab: string; topN: number } }
  | { kind: 'confirmScan'; params: { regionTab: string; topN: number } }
  | { kind: 'resolveConfirmations' }
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
  /**
   * Phase 16 Part A: the pending confirmation pair, derived from the
   * opportunity store (records with confirmation.status 'pending' that are
   * still eligible candidates) — store-derived, so it survives restarts.
   */
  confirmation: {
    pendingCount: number;
    /** Latest lastSeenAt among the pending candidates — the expiry anchor
     *  (only successful scans move it, so failed retries stay bounded). */
    latestSeenAtMs: number | null;
    /** The last completed scan's fetch scope — scan B uses the same. */
    lastScanParams: { regionTab: string; topN: number } | null;
  };
  /**
   * Phase 16 Part C.3: the dense data-gathering week, already resolved from
   * scan history (spend) + measured cost (interval) by the caller — plan
   * stays pure. Null/absent (or expired) ⇒ normal block cadence. When active
   * it OVERRIDES the enabled gate (it is user-authorized, like scan B), but
   * the 95% monthly auto-stop and quiet hours still bind, plus its own hard
   * daily/weekly credit caps.
   */
  denseWeek?: {
    active: boolean;
    /** Epoch ms the dense week ends — the week-cap sleep target. */
    endsAtMs: number;
    /** Derived elevated interval, whole minutes. */
    intervalMins: number;
    /** Credits spent this Vancouver-local day (scan history). */
    dayCreditsUsed: number;
    /** Credits spent across the whole dense week so far (scan history). */
    weekCreditsUsed: number;
  } | null;
}

/** When there's nothing to do soon, sleep this far and let the tick loop's
 *  own max-sleep cap re-evaluate (settings changes, budget release). */
const IDLE_SLEEP_MS = 24 * 3_600_000;

export function plan(input: PlanInput): SchedulerAction {
  const { settings, now } = input;
  const nowMs = now.getTime();

  // ————— Confirmation pair (Part A) — see the module doc for why this
  // outranks the enabled/budget gates but never quiet hours —————
  const pair = confirmationTimes(input);
  if (pair && nowMs >= pair.expiresAtMs) return { kind: 'resolveConfirmations' };

  // Quiet hours: zero Odds API calls of any kind. Sleep to the next 08:00 —
  // or to a pending pair's expiry, whichever is first (resolving is free).
  if (isQuietHours(now)) {
    return {
      kind: 'sleep',
      untilMs: Math.min(nextQuietEndMs(now), pair?.expiresAtMs ?? Infinity),
    };
  }

  if (pair && nowMs >= pair.dueAtMs) {
    return {
      kind: 'confirmScan',
      params: input.confirmation.lastScanParams ?? settings.scanParams,
    };
  }
  // Nothing below may sleep past a pending pair's due time.
  const wakeCapMs = pair ? pair.dueAtMs : Infinity;

  const scorePollDue =
    input.lastScorePollAtMs == null ||
    nowMs - input.lastScorePollAtMs >= input.scorePollIntervalMs;
  const nextScorePollMs =
    input.lastScorePollAtMs == null ? nowMs : input.lastScorePollAtMs + input.scorePollIntervalMs;

  // ————— Dense data-gathering week (Part C.3) —————
  // Overrides the enabled gate (user-authorized), but the monthly auto-stop
  // and its own hard credit caps still bind; quiet hours already returned above.
  // A SELF-disable (disabledReason set — dead/spent key) is never overridden:
  // user authorization doesn't extend past an unrecoverable provider state.
  const dense = input.denseWeek;
  if (dense && dense.active && settings.disabledReason == null) {
    // The 95% monthly auto-stop still applies on top of the dense caps.
    if (budgetStopped(input.budget)) {
      return { kind: 'sleep', untilMs: Math.min(nowMs + IDLE_SLEEP_MS, wakeCapMs) };
    }
    // Weekly hard cap: stop scheduled scanning for the rest of the dense week.
    if (dense.weekCreditsUsed >= DENSE_WEEK_WEEK_CAP) {
      return { kind: 'sleep', untilMs: Math.min(dense.endsAtMs, wakeCapMs) };
    }
    // Daily hard cap: stop until the next Vancouver-local day resets the count.
    if (dense.dayCreditsUsed >= DENSE_WEEK_DAY_CAP) {
      return {
        kind: 'sleep',
        untilMs: Math.min(nextVancouverMidnightMs(now), dense.endsAtMs, wakeCapMs),
      };
    }
    const scanDueAtMs =
      input.lastScanAtMs == null ? nowMs : input.lastScanAtMs + dense.intervalMins * 60_000;
    if (scanDueAtMs <= nowMs) return { kind: 'scan', params: settings.scanParams };
    if (scorePollDue) return { kind: 'scorePoll' };
    return {
      kind: 'sleep',
      untilMs: Math.min(scanDueAtMs, nextScorePollMs, dense.endsAtMs, wakeCapMs),
    };
  }

  // ————— Global gates (order matters; every one blocks provider calls) —————

  // Disabled: dormant (except the scan-B wake above). The tick loop clamps
  // this to its max sleep and also wakes on the enable toggle.
  if (!settings.enabled) {
    return { kind: 'sleep', untilMs: Math.min(nowMs + IDLE_SLEEP_MS, wakeCapMs) };
  }

  // Credit auto-stop: no scheduler-initiated provider call at/over the cap
  // (manual scans are never gated — that's enforced at the route, not here).
  if (budgetStopped(input.budget)) {
    return { kind: 'sleep', untilMs: Math.min(nowMs + IDLE_SLEEP_MS, wakeCapMs) };
  }

  // ————— Inside an active scan block —————
  const active = activeBlock(settings.blocks, now);
  if (active) {
    const scanDueAtMs =
      input.lastScanAtMs == null ? nowMs : input.lastScanAtMs + active.intervalMins * 60_000;

    if (scanDueAtMs <= nowMs) return { kind: 'scan', params: settings.scanParams };
    if (scorePollDue) return { kind: 'scorePoll' };
    // Wake for whichever comes first: next scan, next score poll, scan B.
    return { kind: 'sleep', untilMs: Math.min(scanDueAtMs, nextScorePollMs, wakeCapMs) };
  }

  // ————— Between blocks (non-quiet gap) —————
  // Grading is time-sensitive (games finish outside scan blocks too), so a
  // due score poll still fires; otherwise sleep toward the next block start.
  if (scorePollDue) return { kind: 'scorePoll' };
  const nextStart = nextBlockStartMs(settings.blocks, now);
  const untilMs = Math.min(
    nextStart ?? nowMs + IDLE_SLEEP_MS,
    nextScorePollMs,
    wakeCapMs,
  );
  return { kind: 'sleep', untilMs };
}

/**
 * When the pending pair's scan B is due and when it lapses. Due anchors to
 * the last scan ATTEMPT (a failed B retries on the pair cadence, never a
 * tight loop); expiry anchors to the last real SIGHTING, so retries stay
 * bounded at ~CONFIRMATION_GRACE_INTERVALS attempts. A pending pair with no
 * sighting anchor is unknowable state — treated as already lapsed so it
 * resolves honestly instead of hanging or guessing.
 */
function confirmationTimes(
  input: PlanInput,
): { dueAtMs: number; expiresAtMs: number } | null {
  const { pendingCount, latestSeenAtMs } = input.confirmation;
  if (pendingCount <= 0) return null;
  if (latestSeenAtMs == null) return { dueAtMs: -Infinity, expiresAtMs: -Infinity };
  const intervalMs =
    (input.settings.confirmationIntervalSecs ?? DEFAULT_CONFIRMATION_INTERVAL_SECS) * 1000;
  return {
    dueAtMs: Math.max(input.lastScanAtMs ?? latestSeenAtMs, latestSeenAtMs) + intervalMs,
    expiresAtMs: latestSeenAtMs + intervalMs * (1 + CONFIRMATION_GRACE_INTERVALS),
  };
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
