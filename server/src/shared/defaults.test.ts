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

test('brain defaults match the MODEL CONTROLS copy', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    heatWeightLimit: 23, heatWeightReject: 9, heatWeightCut: 14, heatWeightWithdrawal: -2,
    heatHalfLifeDays: 21, brainCadenceHours: 6, brainKillSwitch: 0, anchorIdx: 0,
    creditPlanMonthly: 100_000,
  });
});

test('settings-screen defaults (Plan 5)', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,
    anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
    whatsappNumber: '', disabledSports: '',
  });
  expect(DEFAULT_SETTINGS.mixArbPct + DEFAULT_SETTINGS.mixMiddlePct + DEFAULT_SETTINGS.mixEvPct).toBe(100);
});
