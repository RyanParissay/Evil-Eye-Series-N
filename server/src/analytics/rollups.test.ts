import { expect, test } from 'vitest';
import type { AnalyticsTradeRow } from '../db/repos.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import {
  funnelCounts, gateCost, leaderboards, monthlyRows, openBets, opportunities,
  retention, roundingCost,
} from './rollups.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const MIN = 60_000;
const label = (b: string): string => (b === 'bet365' ? 'bet365' : b === 'pinnacle' ? 'Pinnacle' : b);

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
    eventStartsAt: NOW + 3_600_000, dayKey: '2026-07-14', market: 'moneyline',
    ...over,
  };
}

test('monthlyRows: definitions per Design §8, newest month first', () => {
  const rows = [
    mkRow({ id: 'a', dayKey: '2026-06-30' }),                                                        // JUN cand
    mkRow({ id: 'b', dayKey: '2026-07-01', verifiedAt: 1 }),                                          // sent
    mkRow({ id: 'c', dayKey: '2026-07-02', status: 'EXPIRED', marginRecheck: 0.019 }),                // held back (passed, never sent)
    mkRow({ id: 'd', dayKey: '2026-07-03', status: 'KILLED', killReason: 'HEAT_GATE' }),
    mkRow({ id: 'e', dayKey: '2026-07-04', status: 'EXPIRED', verifiedAt: 1 }),                       // sent, died at confirm
    mkRow({
      id: 'f', dayKey: '2026-07-05', verifiedAt: 1, confirmedAt: 2, status: 'SETTLED',
      resultCents: 4_200, settledAt: Date.UTC(2026, 6, 6, 19, 0),
    }),
  ];
  const m = monthlyRows(rows);
  expect(m.map((r) => r.month)).toEqual(['2026-07', '2026-06']);
  expect(m[0]).toEqual({
    month: '2026-07', cand: 5, verif: 4, sent: 3, conf: 1, unconf: 0, exp: 2, killed: 1,
    followThruPct: 33, plCents: 4_200,
  });
  expect(m[1]).toEqual({
    month: '2026-06', cand: 1, verif: 0, sent: 0, conf: 0, unconf: 0, exp: 0, killed: 0,
    followThruPct: null, plCents: 0,
  });
});

test('monthlyRows: P/L lands in the SETTLE month, confirmed money only', () => {
  const rows = [
    mkRow({
      id: 'jun', dayKey: '2026-06-28', verifiedAt: 1, confirmedAt: 2, status: 'SETTLED',
      resultCents: 1_000, settledAt: Date.UTC(2026, 6, 2, 19, 0),                 // settles in July
    }),
    mkRow({
      id: 'shadow', dayKey: '2026-06-28', verifiedAt: 1, status: 'SETTLED',
      resultCents: 9_999, settledAt: Date.UTC(2026, 6, 2, 19, 0), confirmedAt: null, // never followed
    }),
  ];
  const m = monthlyRows(rows);
  expect(m.find((r) => r.month === '2026-07')!.plCents).toBe(1_000);
  expect(m.find((r) => r.month === '2026-06')!.plCents).toBe(0);
});

test('funnelCounts: buckets on confirm latency; dead = sent and gone; live cards excluded', () => {
  const v = NOW;
  const rows = [
    mkRow({ id: 'a', verifiedAt: v, confirmedAt: v + 1 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'b', verifiedAt: v, confirmedAt: v + 3 * MIN, status: 'SETTLED', settledAt: v, resultCents: 1 }),
    mkRow({ id: 'c', verifiedAt: v, confirmedAt: v + 7 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'd', verifiedAt: v, confirmedAt: v + 12 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'e', verifiedAt: v, status: 'EXPIRED' }),
    mkRow({ id: 'f', verifiedAt: v, status: 'VERIFIED' }),          // still live — no outcome yet
    mkRow({ id: 'g', status: 'KILLED', killReason: 'QUOTE_STALE' }), // never sent
  ];
  expect(funnelCounts(rows)).toEqual({ under2: 1, from2to5: 1, from5to10: 1, over10: 1, dead: 1, total: 5 });
  expect(funnelCounts([])).toEqual({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
});

test('openBets: confirmed unsettled money, live flag flips at start', () => {
  const rows = [
    mkRow({ id: 'a', status: 'CONFIRMED', confirmedAt: 1, verifiedAt: 1, eventStartsAt: NOW + 3_600_000 }),
    mkRow({ id: 'b', status: 'CONFIRMED', confirmedAt: 1, verifiedAt: 1, eventStartsAt: NOW - 60_000 }),
    mkRow({ id: 'c', status: 'SETTLED', confirmedAt: 1, settledAt: 1, resultCents: 1 }),
    mkRow({ id: 'd', status: 'VERIFIED', verifiedAt: 1 }),
  ];
  const bets = openBets(rows, NOW, label);
  expect(bets).toHaveLength(2);
  expect(bets[0]).toEqual({
    category: 'ARB', event: 'A vs B',
    legsText: 'bet365 home @ 2.10 / Pinnacle away @ 2.20',
    stakeCents: 10_000, startsAt: NOW + 3_600_000, live: false,
  });
  expect(bets[1]!.live).toBe(true);
});

test('leaderboards: confirmed legs credit their books; four boards, top 3, share of category', () => {
  const rows = [
    mkRow({ id: 'a', confirmedAt: 1, status: 'CONFIRMED' }),
    mkRow({ id: 'b', confirmedAt: 1, status: 'CONFIRMED' }),
    mkRow({
      id: 'c', category: 'EV', confirmedAt: 1, status: 'CONFIRMED',
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: 2_000 }],
    }),
    mkRow({ id: 'd', category: 'EV' }), // not confirmed — invisible here
  ];
  const boards = leaderboards(rows, label);
  expect(boards.map((b) => b.title)).toEqual(['ARB', 'EV', 'MIDDLES', 'ALL CATEGORIES']);
  expect(boards[0]!.rows).toEqual([
    { book: 'bet365', count: 2, pct: 100 },   // 2 legs over 2 confirmed ARB trades
    { book: 'Pinnacle', count: 2, pct: 100 },
  ]);
  expect(boards[1]!.rows).toEqual([{ book: 'fanduel', count: 1, pct: 100 }]);
  expect(boards[2]!.rows).toEqual([]);
  expect(boards[3]!.rows[0]!.count).toBe(2);
});

test('roundingCost: ideal equal-payout profit minus the rounded worst case, confirmed ARB pairs only', () => {
  const rows = [
    mkRow({ id: 'a', status: 'SETTLED', confirmedAt: 1, settledAt: 1, resultCents: 500 }),
    mkRow({ id: 'b' }), // not confirmed — excluded
  ];
  // margin(2.1, 2.2) = 1 − (1/2.1 + 1/2.2) = 0.0692641…; ideal = round(10000 × m) = 693
  // payouts 10500 / 11000 → worst-case profit 500; cost = 693 − 500 = 193
  expect(roundingCost(rows)).toEqual({ costCents: 193, pairs: 1 });
  expect(roundingCost([mkRow({ id: 'b' })])).toBeNull();
});

test('retention: median recheck/initial and the recheck death rate', () => {
  const rows = [
    mkRow({ id: 'a', marginRecheck: 0.018, status: 'VERIFIED', verifiedAt: 1 }),
    mkRow({ id: 'b', marginRecheck: 0.001, status: 'KILLED', killReason: 'FAILED_VERIFICATION' }),
    mkRow({ id: 'c', marginRecheck: 0.02, status: 'CONFIRMED', verifiedAt: 1, confirmedAt: 2 }),
    mkRow({ id: 'd', marginRecheck: null }), // never rechecked — excluded
  ];
  expect(retention(rows)).toEqual({ medianPct: 90, dieAtRecheckPct: 33 });
  expect(retention([mkRow({ marginRecheck: null })])).toBeNull();
});

test('gateCost: flat-pair EV proxy per battery reason, cap notes verbatim, top-book note elsewhere', () => {
  const rows = [
    mkRow({ id: 'a', status: 'KILLED', killReason: 'ONE_SPORT_RULE', marginInitial: 0.03 }),
    mkRow({
      id: 'b', status: 'KILLED', killReason: 'ONE_SPORT_RULE', marginInitial: 0.01,
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: null }],
    }),
    mkRow({ id: 'c', status: 'KILLED', killReason: 'SHARP_VELOCITY_CAP', marginInitial: 0.02 }),
    mkRow({ id: 'd', status: 'KILLED', killReason: 'FAILED_VERIFICATION' }), // recheck death — not a battery rule
  ];
  const g = gateCost(rows, DEFAULT_SETTINGS, label);
  expect(g).toEqual([
    { reason: 'ONE_SPORT_RULE', costCents: 400, note: '75% OF LINE ITEM IS BET365' },  // 300 + 100; top book bet365
    { reason: 'SHARP_VELOCITY_CAP', costCents: 200, note: '3/DAY PER BOOK' },
  ]);
  expect(gateCost([], DEFAULT_SETTINGS, label)).toEqual([]);
});

test('opportunities: every candidate counts, legs credit books, since = first trade day', () => {
  const rows = [
    mkRow({ id: 'a', dayKey: '2026-07-11' }),
    mkRow({ id: 'b', dayKey: '2026-07-12', status: 'KILLED', killReason: 'HEAT_GATE', marginInitial: 0.04 }),
    mkRow({
      id: 'c', category: 'EV', dayKey: '2026-07-13', marginInitial: 0.03,
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: null }],
    }),
  ];
  const o = opportunities(rows, label);
  expect(o.since).toBe('2026-07-11');
  expect(o.arb).toEqual([
    { book: 'bet365', count: 2, avgPct: 3 },   // (2% + 4%) / 2
    { book: 'Pinnacle', count: 2, avgPct: 3 },
  ]);
  expect(o.ev).toEqual([{ book: 'fanduel', count: 1, avgPct: 3 }]);
  expect(o.middles).toEqual([]);
  expect(opportunities([], label).since).toBe('');
});
