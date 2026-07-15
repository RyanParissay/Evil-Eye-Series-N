import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import { mixAllowance, mixPct } from './mix.js';

test('mixPct maps categories to their keys', () => {
  expect(mixPct('ARB', DEFAULT_SETTINGS)).toBe(47);
  expect(mixPct('MIDDLE', DEFAULT_SETTINGS)).toBe(24);
  expect(mixPct('EV', DEFAULT_SETTINGS)).toBe(29);
});

test('allowances share the daily cap: 6/3/3 at defaults, floor 1, zero means zero', () => {
  expect(mixAllowance('ARB', DEFAULT_SETTINGS)).toBe(6);   // round(12 × 0.47)
  expect(mixAllowance('MIDDLE', DEFAULT_SETTINGS)).toBe(3);
  expect(mixAllowance('EV', DEFAULT_SETTINGS)).toBe(3);
  const tiny = { ...DEFAULT_SETTINGS, dailyPickCap: 1 };
  expect(mixAllowance('MIDDLE', tiny)).toBe(1);            // round(0.24) = 0 → floor 1
  const none = { ...DEFAULT_SETTINGS, mixEvPct: 0, mixArbPct: 71 };
  expect(mixAllowance('EV', none)).toBe(0);                // 0% means none, ever
});
