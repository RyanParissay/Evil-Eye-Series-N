import { expect, test } from 'vitest';
import type { AnalyticsTradeRow, BankrollSnapshot } from '../db/repos.js';
import {
  allBaseline, allSeries, baselineFor, chartStats, confirmedSeries, dayAxis,
  fnv1a32, mulberry32, shadowResults,
} from './series.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const HOUR = 3_600_000;

function mkRow(over: Partial<AnalyticsTradeRow>): AnalyticsTradeRow {
  return {
    id: 'x', category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [
      { book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 },
      { book: 'pinnacle', selection: 'away', odds: 2.2, stakeCents: 5_000 },
    ],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02,
    status: 'PENDING', killReason: null, resultCents: null,
    createdAt: NOW, verifiedAt: null, confirmedAt: null, settledAt: null,
    eventStartsAt: NOW, dayKey: '2026-07-14', market: 'moneyline',
    ...over,
  };
}

test('dayAxis: trailing Vancouver windows, clipped to the fund start', () => {
  expect(dayAxis(NOW, '1D', '2026-05-01')).toEqual(['2026-07-14']);
  expect(dayAxis(NOW, '5D', '2026-05-01')).toEqual([
    '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14',
  ]);
  expect(dayAxis(NOW, '5D', '2026-07-13')).toEqual(['2026-07-13', '2026-07-14']); // clipped
  expect(dayAxis(NOW, 'MAX', '2026-07-12')).toEqual(['2026-07-12', '2026-07-13', '2026-07-14']);
  expect(dayAxis(NOW, '30D', '2026-05-01')).toHaveLength(30);
  expect(dayAxis(NOW, 'MAX', '2026-07-14')).toEqual(['2026-07-14']); // created today
  expect(dayAxis(NOW, 'MAX', '2026-08-01')).toEqual(['2026-07-14']); // future-dated profile degrades to today
});

test('fnv1a32/mulberry32: stable, distinct, reproducible', () => {
  expect(fnv1a32('')).toBe(2_166_136_261); // FNV-1a offset basis
  expect(fnv1a32('trade-1')).toBe(fnv1a32('trade-1'));
  expect(fnv1a32('trade-1')).not.toBe(fnv1a32('trade-2'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test('shadowResults: unfollowed sent picks settle in imagination only, deterministically', () => {
  const expiredSent = mkRow({
    id: 'shadow-1', status: 'EXPIRED', verifiedAt: NOW - 10 * HOUR,
    eventStartsAt: NOW - 5 * HOUR, // +3h cutoff passed
  });
  const first = shadowResults([expiredSent], NOW);
  expect(first).toEqual([{ day: '2026-07-14', resultCents: 200 }]); // ARB: round(10000 × 0.02)
  expect(shadowResults([expiredSent], NOW)).toEqual(first); // same forever
  // never-verified EXPIRED (pending swept) and not-yet-finished events produce nothing
  expect(shadowResults([mkRow({ status: 'EXPIRED', verifiedAt: null, eventStartsAt: NOW - 5 * HOUR })], NOW)).toEqual([]);
  expect(shadowResults([mkRow({ status: 'EXPIRED', verifiedAt: NOW, eventStartsAt: NOW - 2 * HOUR })], NOW)).toEqual([]);
  expect(shadowResults([mkRow({ status: 'SETTLED', verifiedAt: NOW, settledAt: NOW, eventStartsAt: NOW - 5 * HOUR })], NOW)).toEqual([]);
});

test('confirmedSeries: carry-forward over gap days; baseline is the value walking in', () => {
  const snaps: BankrollSnapshot[] = [
    { profileId: 1, dayKey: '2026-07-11', bankrollCents: 1_000_500 },
    { profileId: 1, dayKey: '2026-07-13', bankrollCents: 1_004_200 },
  ];
  const axis = ['2026-07-12', '2026-07-13', '2026-07-14'];
  expect(confirmedSeries(snaps, axis, 1_000_000)).toEqual([
    { day: '2026-07-12', profitCents: 500 },   // carried from the 11th
    { day: '2026-07-13', profitCents: 4_200 },
    { day: '2026-07-14', profitCents: 4_200 }, // no snapshot yet today — carry
  ]);
  expect(baselineFor(snaps, axis, 1_000_000)).toBe(500); // the 11th walked in
  expect(baselineFor(snaps, ['2026-07-11'], 1_000_000)).toBe(0); // nothing before the first day
  expect(confirmedSeries([], axis, 1_000_000).map((p) => p.profitCents)).toEqual([0, 0, 0]);
});

test('allSeries: real settled + shadow, cumulative along the axis', () => {
  const rows = [
    mkRow({ id: 'real', status: 'SETTLED', resultCents: 4_200, settledAt: Date.UTC(2026, 6, 13, 19, 0), verifiedAt: 1, confirmedAt: 2 }),
    mkRow({ id: 'shadow-1', status: 'EXPIRED', verifiedAt: 1, eventStartsAt: NOW - 5 * HOUR }), // +200 today
  ];
  const axis = ['2026-07-12', '2026-07-13', '2026-07-14'];
  expect(allSeries(rows, axis, NOW)).toEqual([
    { day: '2026-07-12', profitCents: 0 },
    { day: '2026-07-13', profitCents: 4_200 },
    { day: '2026-07-14', profitCents: 4_400 },
  ]);
  expect(allBaseline(rows, axis, NOW)).toBe(0);
  expect(allBaseline(rows, ['2026-07-14'], NOW)).toBe(4_200); // the 13th's real result walked in
});

test('chartStats: profit vs baseline, return vs the ONE bankroll, annualized ×365/days', () => {
  const points = [
    { day: '2026-07-13', profitCents: 1_000 },
    { day: '2026-07-14', profitCents: 4_000 },
  ];
  const s = chartStats(points, 1_000, 1_000_000);
  expect(s.profitCents).toBe(3_000);
  expect(s.returnPct).toBeCloseTo(0.3, 10);
  expect(s.annualizedPct).toBeCloseTo(0.3 * (365 / 2), 10);
  expect(chartStats([], 0, 1_000_000)).toEqual({ profitCents: 0, returnPct: 0, annualizedPct: 0 });
});
