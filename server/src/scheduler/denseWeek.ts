/**
 * The dense data-gathering week (Phase 16 Part C.3) — pure, engine-grade (no
 * fs/env/Express/provider imports). A user-started mode that, for 7 days from
 * `denseWeek.startedAt`, replaces normal block cadence with elevated-frequency
 * scan pairs across ALL allowed (non-quiet) hours.
 *
 * The scheduler DERIVES the interval from measured per-pair cost so the caps
 * bind: spread the daily credit cap across the allowed minutes of a local day,
 * floored at DENSE_WEEK_MIN_INTERVAL_MINS. Two HARD caps then hard-stop
 * scheduled scanning (manual scans stay allowed; quiet hours stay absolute;
 * the 95% monthly auto-stop still applies on top): 4,500 credits/Vancouver-day
 * and 30,000/week, both measured from scan-history lines (creditsComputed)
 * scoped to the dense week. Day/week spend is derived from persisted history,
 * so the cap-hit banner survives restarts and the day cap resumes at the next
 * local midnight — no separate flag to persist.
 *
 * Everything here is a pure function of (startedAt, now, scan history, cost),
 * so the acceptance fixtures simulate a whole day or week hitting a cap by
 * constructing history lines and advancing `now` — no test ever sleeps.
 */
import type { DenseWeekStatus, ScanLogEntry } from '@shared/types';
import {
  DENSE_WEEK_DAY_CAP,
  DENSE_WEEK_DAYS,
  DENSE_WEEK_MIN_INTERVAL_MINS,
  DENSE_WEEK_WEEK_CAP,
} from '../config/constants';
import { QUIET_END_MIN, QUIET_START_MIN, sameVancouverDay } from './vancouverTime';

const DAY_MS = 24 * 3_600_000;

/** Minutes in a local day the scheduler may scan (quiet hours excluded). */
export const ALLOWED_MINUTES_PER_DAY = 24 * 60 - (QUIET_END_MIN - QUIET_START_MIN);

/** Epoch ms the dense week ends (startedAt + 7 days). */
export function denseWeekEndMs(startedAtMs: number): number {
  return startedAtMs + DENSE_WEEK_DAYS * DAY_MS;
}

/** Active ⇔ present AND `now` sits inside [startedAt, startedAt + 7 days). */
export function isDenseWeekActive(startedAtMs: number | null, nowMs: number): boolean {
  if (startedAtMs == null) return false;
  return nowMs >= startedAtMs && nowMs < denseWeekEndMs(startedAtMs);
}

/**
 * The elevated scan interval, in whole minutes: spread the daily cap across
 * the allowed minutes of a local day so the cap binds, floored at the
 * elevated-frequency floor. `perPairCost` = per-scan credits × (1 + measured
 * hit rate). Unknown/zero cost falls to the floor — the hard caps still stop
 * scanning, so a too-aggressive interval can never overspend.
 *
 *   intervalMins = max(FLOOR, ceil(ALLOWED_MINUTES_PER_DAY × perPairCost / DAY_CAP))
 */
export function denseWeekIntervalMins(perPairCost: number): number {
  if (!(perPairCost > 0)) return DENSE_WEEK_MIN_INTERVAL_MINS;
  const spread = Math.ceil((ALLOWED_MINUTES_PER_DAY * perPairCost) / DENSE_WEEK_DAY_CAP);
  return Math.max(DENSE_WEEK_MIN_INTERVAL_MINS, spread);
}

/**
 * Credits spent (from scan-history creditsComputed) within the dense week:
 * `week` = everything at/after startedAt; `day` = the subset on `now`'s
 * Vancouver-local calendar day. Both include manual scans — they consume the
 * budget too, they're just never blocked by it.
 */
export function denseWeekSpend(
  startedAtMs: number,
  now: Date,
  scanHistory: Pick<ScanLogEntry, 'scannedAt' | 'creditsComputed'>[],
): { dayCreditsUsed: number; weekCreditsUsed: number } {
  let day = 0;
  let week = 0;
  for (const line of scanHistory) {
    const atMs = Date.parse(line.scannedAt);
    if (!Number.isFinite(atMs) || atMs < startedAtMs) continue;
    const credits = Number.isFinite(line.creditsComputed) ? line.creditsComputed : 0;
    week += credits;
    if (sameVancouverDay(new Date(atMs), now)) day += credits;
  }
  return { dayCreditsUsed: day, weekCreditsUsed: week };
}

/** 1-based day index (1..7) of `now` within the dense week. */
export function denseWeekDayNumber(startedAtMs: number, nowMs: number): number {
  const elapsedDays = Math.floor((nowMs - startedAtMs) / DAY_MS);
  return Math.min(DENSE_WEEK_DAYS, Math.max(1, elapsedDays + 1));
}

/** The cap-hit banner: week cap outranks day cap; null while running. */
export function denseWeekStop(
  dayCreditsUsed: number,
  weekCreditsUsed: number,
): DenseWeekStatus['stopped'] {
  if (weekCreditsUsed >= DENSE_WEEK_WEEK_CAP) {
    return {
      scope: 'week',
      message: `Dense week paused — the ${DENSE_WEEK_WEEK_CAP.toLocaleString()} credits/week cap is reached. Scheduled scanning stays off for the rest of the week; manual scans still work.`,
    };
  }
  if (dayCreditsUsed >= DENSE_WEEK_DAY_CAP) {
    return {
      scope: 'day',
      message: `Dense week paused for today — the ${DENSE_WEEK_DAY_CAP.toLocaleString()} credits/day cap is reached. Scheduled scanning resumes after local midnight; manual scans still work.`,
    };
  }
  return null;
}

/**
 * Assemble the UI/route status. `startedAtMs` null (or expired) ⇒ inactive.
 * `perPairCost` derives the interval shown; the caller measures it from
 * recent scan history (per-scan credits × (1 + hit rate)).
 */
export function denseWeekStatus(
  startedAtMs: number | null,
  now: Date,
  scanHistory: Pick<ScanLogEntry, 'scannedAt' | 'creditsComputed'>[],
  perPairCost: number,
): DenseWeekStatus {
  const nowMs = now.getTime();
  const active = isDenseWeekActive(startedAtMs, nowMs);
  if (!active || startedAtMs == null) {
    return {
      active: false,
      startedAt: startedAtMs == null ? null : new Date(startedAtMs).toISOString(),
      endsAt: startedAtMs == null ? null : new Date(denseWeekEndMs(startedAtMs)).toISOString(),
      dayNumber: 0,
      dayCreditsUsed: 0,
      weekCreditsUsed: 0,
      dayCap: DENSE_WEEK_DAY_CAP,
      weekCap: DENSE_WEEK_WEEK_CAP,
      intervalMins: denseWeekIntervalMins(perPairCost),
      stopped: null,
    };
  }
  const { dayCreditsUsed, weekCreditsUsed } = denseWeekSpend(startedAtMs, now, scanHistory);
  return {
    active: true,
    startedAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(denseWeekEndMs(startedAtMs)).toISOString(),
    dayNumber: denseWeekDayNumber(startedAtMs, nowMs),
    dayCreditsUsed,
    weekCreditsUsed,
    dayCap: DENSE_WEEK_DAY_CAP,
    weekCap: DENSE_WEEK_WEEK_CAP,
    intervalMins: denseWeekIntervalMins(perPairCost),
    stopped: denseWeekStop(dayCreditsUsed, weekCreditsUsed),
  };
}
