import { describe, expect, it } from 'vitest';
import {
  QUIET_END_MIN,
  QUIET_START_MIN,
  VANCOUVER_TZ,
  isQuietHours,
  nextQuietEndMs,
  vancouverEpochOf,
  vancouverLocal,
} from './vancouverTime';

/** Format an epoch back through the same IANA zone — the ground truth we
 *  assert against, so the test never bakes in a fixed UTC offset. */
function vanClock(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VANCOUVER_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

describe('vancouverLocal', () => {
  it('reads wall-clock fields in America/Vancouver, not the host zone', () => {
    // 2026-01-15 12:00 UTC → 04:00 PST (UTC-8) that morning.
    const winter = vancouverLocal(new Date('2026-01-15T12:00:00Z'));
    expect(winter.year).toBe(2026);
    expect(winter.month).toBe(1);
    expect(winter.day).toBe(15);
    expect(winter.minutesOfDay).toBe(4 * 60);
    expect(winter.weekday).toBe(4); // Thursday

    // 2026-07-15 12:00 UTC → 05:00 PDT (UTC-7).
    const summer = vancouverLocal(new Date('2026-07-15T12:00:00Z'));
    expect(summer.minutesOfDay).toBe(5 * 60);
    expect(summer.weekday).toBe(3); // Wednesday
  });

  it('normalizes local midnight to minutesOfDay 0', () => {
    // 08:00 UTC on 2026-01-15 → 00:00 PST.
    const midnight = vancouverLocal(new Date('2026-01-15T08:00:00Z'));
    expect(midnight.minutesOfDay).toBe(0);
    expect(midnight.day).toBe(15);
  });
});

describe('vancouverEpochOf — DST-safe local→UTC', () => {
  it('round-trips a winter (PST) wall clock', () => {
    const ms = vancouverEpochOf(2026, 1, 15, 8 * 60); // 08:00 PST
    expect(vanClock(ms)).toBe('2026-01-15, 08:00');
    // PST is UTC-8, so 08:00 local = 16:00 UTC.
    expect(new Date(ms).toISOString()).toBe('2026-01-15T16:00:00.000Z');
  });

  it('round-trips a summer (PDT) wall clock', () => {
    const ms = vancouverEpochOf(2026, 7, 15, 8 * 60); // 08:00 PDT
    expect(vanClock(ms)).toBe('2026-07-15, 08:00');
    // PDT is UTC-7, so 08:00 local = 15:00 UTC.
    expect(new Date(ms).toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('lands 08:00 correctly on the spring-forward day (2026-03-08)', () => {
    // The gap is 02:00→03:00; 08:00 is well clear of it and is PDT (UTC-7).
    const ms = vancouverEpochOf(2026, 3, 8, 8 * 60);
    expect(vanClock(ms)).toBe('2026-03-08, 08:00');
    expect(new Date(ms).toISOString()).toBe('2026-03-08T15:00:00.000Z');
  });
});

describe('isQuietHours', () => {
  it('quiet 01:00–08:00, live otherwise (PST)', () => {
    const at = (min: number) => new Date(vancouverEpochOf(2026, 1, 15, min));
    expect(isQuietHours(at(QUIET_START_MIN - 1))).toBe(false); // 00:59
    expect(isQuietHours(at(QUIET_START_MIN))).toBe(true); // 01:00
    expect(isQuietHours(at(5 * 60))).toBe(true); // 05:00
    expect(isQuietHours(at(QUIET_END_MIN - 1))).toBe(true); // 07:59
    expect(isQuietHours(at(QUIET_END_MIN))).toBe(false); // 08:00 — end exclusive
    expect(isQuietHours(at(20 * 60))).toBe(false); // 20:00
  });

  it('quiet window tracks PDT too (offset differs, wall clock does not)', () => {
    const at = (min: number) => new Date(vancouverEpochOf(2026, 7, 15, min));
    expect(isQuietHours(at(QUIET_START_MIN))).toBe(true);
    expect(isQuietHours(at(QUIET_END_MIN))).toBe(false);
  });
});

describe('nextQuietEndMs', () => {
  it('during quiet hours, points at the same day 08:00', () => {
    const at = new Date(vancouverEpochOf(2026, 1, 15, 3 * 60)); // 03:00 PST
    expect(vanClock(nextQuietEndMs(at))).toBe('2026-01-15, 08:00');
  });

  it('before quiet hours (00:30), still points at that day 08:00', () => {
    const at = new Date(vancouverEpochOf(2026, 1, 15, 30)); // 00:30
    expect(vanClock(nextQuietEndMs(at))).toBe('2026-01-15, 08:00');
  });

  it('after 08:00, rolls to the next day 08:00', () => {
    const at = new Date(vancouverEpochOf(2026, 1, 15, 20 * 60)); // 20:00
    expect(vanClock(nextQuietEndMs(at))).toBe('2026-01-16, 08:00');
  });
});
