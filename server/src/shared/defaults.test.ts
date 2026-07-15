import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults.js';
test('locked defaults match MASTER PROMPT', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    tolerancePct: 5, verifyGapSecs: 75, staleRemoveMin: 10, freshWindowSecs: 120,
    minArbMarginPct: 0.75, minEvEdgePct: 2.0, middleRatio: 1.5,
    kellyFraction: 0.25, kellyCapPct: 5, bankrollCents: 1_000_000,
    flatPairCents: 10_000, roundToCents: 500, minStakeCents: 1_000, dailyPickCap: 12,
    quietStartHour: 0, quietEndHour: 8, scanBaseMin: 20, scanHotMinMin: 5,
    scanHotMaxMin: 8, hotWindowHours: 2, sharpVelocityPerDayPerBook: 3,
    marketBreadthPerWeekPerBook: 2, goGentleHeat: 30, stopHeat: 60,
  });
});
