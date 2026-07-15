import { expect, test } from 'vitest';
import { isQuietHours, nextQuietEnd, dayKey } from './vancouverTime.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

const HOUR = 3_600_000;
const MIN = 60_000;

// --- Test-side Intl helper (independent of the implementation) ---------------
// Converts a Vancouver wall-clock time to an epoch by brute-force scanning UTC
// offsets in 15-minute steps and checking each candidate's formatted parts.
// Deliberately a different algorithm than production code; no hardcoded offsets.
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function vanEpoch(y: number, m: number, d: number, h = 0, min = 0): number {
  const wallAsUtc = Date.UTC(y, m - 1, d, h, min);
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const candidate = wallAsUtc + off * MIN;
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(candidate))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    if (p.year === y && p.month === m && p.day === d && p.hour === h && p.minute === min) {
      return candidate;
    }
  }
  throw new Error(`no epoch maps to Vancouver ${y}-${m}-${d} ${h}:${min} (skipped by DST?)`);
}

// --- isQuietHours -------------------------------------------------------------
test('quiet hours are [00:00, 08:00) Vancouver-local on an ordinary day', () => {
  const s = DEFAULT_SETTINGS;
  expect(isQuietHours(vanEpoch(2026, 7, 13, 0, 0), s)).toBe(true);   // midnight: quiet
  expect(isQuietHours(vanEpoch(2026, 7, 13, 3, 0), s)).toBe(true);   // 03:00: quiet
  expect(isQuietHours(vanEpoch(2026, 7, 13, 8, 0) - 1, s)).toBe(true);  // 07:59:59.999: quiet
  expect(isQuietHours(vanEpoch(2026, 7, 13, 8, 0), s)).toBe(false);  // 08:00 exactly: not quiet
  expect(isQuietHours(vanEpoch(2026, 7, 13, 12, 0), s)).toBe(false); // noon: not quiet
  expect(isQuietHours(vanEpoch(2026, 7, 13, 23, 59), s)).toBe(false);
});

// --- nextQuietEnd, ordinary days ----------------------------------------------
test('nextQuietEnd from 03:00 Vancouver is the same day 08:00 Vancouver, exactly', () => {
  expect(nextQuietEnd(vanEpoch(2026, 7, 13, 3, 0))).toBe(vanEpoch(2026, 7, 13, 8, 0));
});

test('nextQuietEnd from 09:00 (past quiet end) rolls to the NEXT day 08:00', () => {
  expect(nextQuietEnd(vanEpoch(2026, 7, 13, 9, 0))).toBe(vanEpoch(2026, 7, 14, 8, 0));
});

test('nextQuietEnd at exactly 08:00 rolls to the next day (08:00 is already outside quiet)', () => {
  expect(nextQuietEnd(vanEpoch(2026, 7, 13, 8, 0))).toBe(vanEpoch(2026, 7, 14, 8, 0));
});

// --- nextQuietEnd across DST transitions ---------------------------------------
// 2026-03-08: clocks spring forward, 02:00 PST -> 03:00 PDT (02:xx does not exist).
test('spring forward 2026-03-08: 01:30 sleeps to 08:00 PDT — 5.5 real hours, not 6.5', () => {
  const start = vanEpoch(2026, 3, 8, 1, 30); // PST, before the jump
  const end = nextQuietEnd(start);
  expect(end).toBe(vanEpoch(2026, 3, 8, 8, 0)); // 08:00 PDT, Intl-computed
  // Wall-clock gap is 6.5h but one hour is skipped: a fixed-offset
  // implementation would be off by exactly one hour here.
  expect(end - start).toBe(5.5 * HOUR);
});

// 2026-11-01: clocks fall back, 02:00 PDT -> 01:00 PST (01:xx happens twice).
test('fall back 2026-11-01: 00:30 sleeps to 08:00 PST — 8.5 real hours, not 7.5', () => {
  const start = vanEpoch(2026, 11, 1, 0, 30); // PDT, before the repeat (00:30 is unambiguous)
  const end = nextQuietEnd(start);
  expect(end).toBe(vanEpoch(2026, 11, 1, 8, 0)); // 08:00 PST, Intl-computed
  expect(end - start).toBe(8.5 * HOUR);
});

// --- dayKey --------------------------------------------------------------------
test('dayKey rolls at Vancouver midnight, not UTC midnight', () => {
  // 2026-07-14T02:00Z is still 2026-07-13 19:00 in Vancouver (PDT):
  // one day in UTC, the PRIOR day Vancouver-local.
  const utcDay14 = Date.UTC(2026, 6, 14, 2, 0);
  expect(dayKey(utcDay14)).toBe('2026-07-13');
  // And the boundary is exactly Vancouver midnight:
  const vanMidnight = vanEpoch(2026, 7, 14, 0, 0);
  expect(dayKey(vanMidnight - 1)).toBe('2026-07-13');
  expect(dayKey(vanMidnight)).toBe('2026-07-14');
});

test('dayKey zero-pads month and day', () => {
  expect(dayKey(vanEpoch(2026, 3, 8, 12, 0))).toBe('2026-03-08');
});
