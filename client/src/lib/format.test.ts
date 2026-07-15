import { expect, test } from 'vitest';
import {
  formatCents, formatClock, formatMetric, formatOdds,
  formatScanTime, formatSignedCents, formatWhen, parseDollarsToCents,
} from './format';

test('formatCents: whole dollars drop decimals, thousands separated', () => {
  expect(formatCents(3500)).toBe('$35');
  expect(formatCents(1_000_000)).toBe('$10,000');
  expect(formatCents(5000)).toBe('$50');
});

test('formatCents: fractional cents render 2dp', () => {
  expect(formatCents(220)).toBe('$2.20');
  expect(formatCents(5)).toBe('$0.05');
  expect(formatCents(123_456)).toBe('$1,234.56');
});

test('formatSignedCents: always 2dp, + or U+2212 minus', () => {
  expect(formatSignedCents(220)).toBe('+$2.20');
  expect(formatSignedCents(-2000)).toBe('−$20.00');
  expect(formatSignedCents(0)).toBe('+$0.00');
  expect(formatSignedCents(4750)).toBe('+$47.50');
  expect(formatSignedCents(-1500)).toBe('−$15.00');
});

test('formatClock: m:ss, floor, pad2, clamps below 0', () => {
  expect(formatClock(86)).toBe('1:26');
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(161)).toBe('2:41');
  expect(formatClock(42)).toBe('0:42');
  expect(formatClock(-5)).toBe('0:00');
});

test('formatOdds: always 2dp', () => {
  expect(formatOdds(3.1)).toBe('3.10');
  expect(formatOdds(2.06)).toBe('2.06');
  expect(formatOdds(2)).toBe('2.00');
});

test('formatMetric: card style (colon) vs list style (no colon), 1dp', () => {
  expect(formatMetric('ARB', 2.5, { colon: true })).toBe('MARGIN: 2.5%');
  expect(formatMetric('EV', 2.8, { colon: true })).toBe('EDGE: +2.8%');
  expect(formatMetric('MIDDLE', 4.6, { colon: true })).toBe('EDGE: +4.6%');
  expect(formatMetric('ARB', 2.5, { colon: false })).toBe('MARGIN 2.5%');
  expect(formatMetric('EV', 3.1, { colon: false })).toBe('EDGE +3.1%');
  expect(formatMetric('ARB', 2.44, { colon: false })).toBe('MARGIN 2.4%');
});

test('parseDollarsToCents: dollars + optional 2dp fraction; junk → null', () => {
  expect(parseDollarsToCents('$25')).toBe(2500);
  expect(parseDollarsToCents('25')).toBe(2500);
  expect(parseDollarsToCents('$1,000')).toBe(100_000);
  expect(parseDollarsToCents(' $50 ')).toBe(5000);
  expect(parseDollarsToCents('$25.50')).toBe(2550);
  expect(parseDollarsToCents('25.5')).toBe(2550);
  expect(parseDollarsToCents('0.05')).toBe(5);
  expect(parseDollarsToCents('')).toBeNull();
  expect(parseDollarsToCents('$')).toBeNull();
  expect(parseDollarsToCents('abc')).toBeNull();
  expect(parseDollarsToCents('25.999')).toBeNull();
  expect(parseDollarsToCents('.50')).toBeNull();
});

test('formatScanTime: America/Vancouver, MMM DD · h:mm AM/PM, uppercase', () => {
  // 2026-07-13 22:47 PDT (UTC-7) == 2026-07-14 05:47 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 14, 5, 47))).toBe('JUL 13 · 10:47 PM');
  // 2026-07-14 14:12 PDT == 2026-07-14 21:12 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 14, 21, 12))).toBe('JUL 14 · 2:12 PM');
  // day pads to 2 digits: 2026-07-08 19:29 PDT == 2026-07-09 02:29 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 9, 2, 29))).toBe('JUL 08 · 7:29 PM');
  // DST-safe: winter is PST (UTC-8): 2026-01-15 10:05 PST == 18:05 UTC
  expect(formatScanTime(Date.UTC(2026, 0, 15, 18, 5))).toBe('JAN 15 · 10:05 AM');
});

test('formatWhen: identical format to formatScanTime (history third column)', () => {
  expect(formatWhen(Date.UTC(2026, 6, 14, 21, 12))).toBe('JUL 14 · 2:12 PM');
});
