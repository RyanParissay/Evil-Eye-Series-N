import { describe, expect, it } from 'vitest';
import type { ScanLogEntry } from '@shared/types';
import {
  DENSE_WEEK_DAY_CAP,
  DENSE_WEEK_MIN_INTERVAL_MINS,
  DENSE_WEEK_WEEK_CAP,
} from '../config/constants';
import {
  ALLOWED_MINUTES_PER_DAY,
  denseWeekEndMs,
  denseWeekIntervalMins,
  denseWeekSpend,
  denseWeekStatus,
  denseWeekStop,
  isDenseWeekActive,
} from './denseWeek';
import { vancouverEpochOf } from './vancouverTime';

/** A scan-history line at a Vancouver-local instant with given credits. */
function line(
  date: [number, number, number],
  min: number,
  credits: number,
): Pick<ScanLogEntry, 'scannedAt' | 'creditsComputed'> {
  return {
    scannedAt: new Date(vancouverEpochOf(date[0], date[1], date[2], min)).toISOString(),
    creditsComputed: credits,
  };
}

const START = vancouverEpochOf(2026, 1, 15, 8 * 60); // 08:00 PST, Thu Jan 15

describe('denseWeek — interval derivation', () => {
  it('allowed minutes exclude the 7-hour quiet window', () => {
    expect(ALLOWED_MINUTES_PER_DAY).toBe(1020); // 1440 − 420
  });

  it('spreads the daily cap across allowed minutes: ceil(1020 × perPair / 4500)', () => {
    // perPairCost 39 → ceil(1020×39/4500) = ceil(8.84) = 9
    expect(denseWeekIntervalMins(39)).toBe(9);
    // perPairCost 225 makes the cap bind EXACTLY: 1020×225/4500 = 51 → 20 pairs/day × 225 = 4500
    expect(denseWeekIntervalMins(225)).toBe(51);
  });

  it('never drops below the 5-minute floor, even for a cheap or unknown pair', () => {
    expect(denseWeekIntervalMins(13)).toBe(DENSE_WEEK_MIN_INTERVAL_MINS); // ceil(2.95)=3 → floored
    expect(denseWeekIntervalMins(0)).toBe(DENSE_WEEK_MIN_INTERVAL_MINS);
    expect(denseWeekIntervalMins(-5)).toBe(DENSE_WEEK_MIN_INTERVAL_MINS);
  });
});

describe('denseWeek — active window', () => {
  it('active only inside [startedAt, startedAt + 7 days)', () => {
    expect(isDenseWeekActive(START, START)).toBe(true);
    expect(isDenseWeekActive(START, START + 6.9 * 86_400_000)).toBe(true);
    expect(isDenseWeekActive(START, denseWeekEndMs(START))).toBe(false); // day 7 exactly → over
    expect(isDenseWeekActive(START, START - 1)).toBe(false);
    expect(isDenseWeekActive(null, START)).toBe(false);
  });
});

describe('denseWeek — spend scoped to the week and the local day', () => {
  it('day = same Vancouver day; week = everything at/after startedAt; pre-start excluded', () => {
    const now = new Date(vancouverEpochOf(2026, 1, 15, 20 * 60)); // 20:00 Jan 15
    const history = [
      line([2026, 1, 15], 7 * 60, 1000), // 07:00 — BEFORE start (08:00): excluded
      line([2026, 1, 15], 10 * 60, 1500), // 10:00 Jan 15 — day + week
      line([2026, 1, 15], 20 * 60, 500), // 20:00 Jan 15 — day + week
      line([2026, 1, 16], 9 * 60, 2000), // 09:00 Jan 16 — week only (different day)
    ];
    const spend = denseWeekSpend(START, now, history);
    expect(spend.dayCreditsUsed).toBe(2000); // 1500 + 500
    expect(spend.weekCreditsUsed).toBe(4000); // 1500 + 500 + 2000
  });
});

describe('denseWeek — cap banner', () => {
  it('week cap outranks day cap; null while under both', () => {
    expect(denseWeekStop(0, 0)).toBeNull();
    expect(denseWeekStop(DENSE_WEEK_DAY_CAP, 5000)?.scope).toBe('day');
    expect(denseWeekStop(DENSE_WEEK_DAY_CAP, DENSE_WEEK_WEEK_CAP)?.scope).toBe('week');
    expect(denseWeekStop(100, DENSE_WEEK_WEEK_CAP)?.scope).toBe('week');
  });
});

describe('denseWeek — status assembly', () => {
  it('inactive when absent', () => {
    const s = denseWeekStatus(null, new Date(START), [], 39);
    expect(s.active).toBe(false);
    expect(s.startedAt).toBeNull();
    expect(s.intervalMins).toBe(9);
    expect(s.stopped).toBeNull();
  });

  it('active: reports day number, spend, and the derived interval', () => {
    const now = new Date(START + 2 * 86_400_000 + 12 * 3_600_000); // ~day 3
    const history = [line([2026, 1, 15], 10 * 60, 1000)];
    const s = denseWeekStatus(START, now, history, 39);
    expect(s.active).toBe(true);
    expect(s.dayNumber).toBe(3);
    expect(s.weekCreditsUsed).toBe(1000);
    expect(s.intervalMins).toBe(9);
    expect(s.endsAt).toBe(new Date(denseWeekEndMs(START)).toISOString());
  });

  it('sets the day-cap banner when the day cap is reached', () => {
    const now = new Date(vancouverEpochOf(2026, 1, 15, 22 * 60));
    const history = [line([2026, 1, 15], 10 * 60, DENSE_WEEK_DAY_CAP)];
    const s = denseWeekStatus(START, now, history, 39);
    expect(s.stopped?.scope).toBe('day');
  });
});
