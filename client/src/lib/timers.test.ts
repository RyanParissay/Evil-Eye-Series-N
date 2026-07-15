import { expect, test } from 'vitest';
import { liveTimer, pendingCountdown } from './timers';

test('FRESH counts down from freshUntil − now (ceil — never 0:00 while fresh)', () => {
  expect(liveTimer(86_000, 0)).toEqual({ phase: 'FRESH', seconds: 86 });
  expect(liveTimer(1_000_500, 1_000_000)).toEqual({ phase: 'FRESH', seconds: 1 });
});

test('at 0 it auto-flips to STALE and counts UP (MASTER PROMPT rule 8 — no clamp)', () => {
  expect(liveTimer(1000, 1000)).toEqual({ phase: 'STALE', seconds: 0 });
  expect(liveTimer(0, 161_000)).toEqual({ phase: 'STALE', seconds: 161 });
  expect(liveTimer(0, 1500)).toEqual({ phase: 'STALE', seconds: 1 });
});

test('pending countdown derives from verifyDueAt − now, clamped at 0 (server reschedules)', () => {
  expect(pendingCountdown(42_000, 0)).toBe(42);
  expect(pendingCountdown(500, 0)).toBe(1);
  expect(pendingCountdown(1000, 5000)).toBe(0);
});
