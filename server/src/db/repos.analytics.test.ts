import { expect, test } from 'vitest';
import { Repos, openDb } from './db.js';
import { createApp } from '../api/routes.js';
import { confirmTrade, unconfirmTrade } from '../pipeline/actions.js';
import type { Trade } from '../shared/types.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT — awake hours

function mkTrade(over: Partial<Trade>): Trade {
  return {
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1_000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: 9_999_999,
    confirmedAt: null,
    ...over,
  };
}

test('confirmed_at round-trips through insert and update', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED', confirmedAt: 123 }), '2026-07-14', 'moneyline');
  expect(r.trades.byId('a')!.confirmedAt).toBe(123);
  const t = r.trades.byId('a')!;
  t.confirmedAt = null;
  r.trades.update(t);
  expect(r.trades.byId('a')!.confirmedAt).toBeNull();
});

test('confirmTrade stamps confirmedAt; unconfirm clears; re-confirm re-stamps; double-tap keeps the first', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'VERIFIED', verifiedAt: 100 }), '2026-07-14', 'moneyline');
  confirmTrade(r, 'a', 500);
  expect(r.trades.byId('a')!.confirmedAt).toBe(500);
  confirmTrade(r, 'a', 900); // no-op double-tap — first stamp stands
  expect(r.trades.byId('a')!.confirmedAt).toBe(500);
  unconfirmTrade(r, 'a', 1_000);
  expect(r.trades.byId('a')!.confirmedAt).toBeNull();
  confirmTrade(r, 'a', 2_000);
  expect(r.trades.byId('a')!.confirmedAt).toBe(2_000);
});

test('analyticsRows: one query feeds every rollup — mapped columns, insert order', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', createdAt: 1 }), '2026-07-13', 'moneyline');
  r.trades.insert(mkTrade({ id: 'b', createdAt: 2, status: 'SETTLED', resultCents: 220, settledAt: 9, confirmedAt: 5, verifiedAt: 4, marginFinal: 0.02 }), '2026-07-14', 'total');
  const rows = r.trades.analyticsRows(1);
  expect(rows.map((x) => x.id)).toEqual(['a', 'b']);
  expect(rows[1]).toMatchObject({
    id: 'b', category: 'ARB', status: 'SETTLED', resultCents: 220, settledAt: 9,
    confirmedAt: 5, verifiedAt: 4, marginFinal: 0.02, dayKey: '2026-07-14', market: 'total',
  });
  expect(rows[0]!.legs[0]!.book).toBe('bet365'); // legs come back parsed
  expect(r.trades.analyticsRows(2)).toEqual([]); // other profiles see nothing
});

test('settledConfirmedCents sums confirmed settled money only', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'SETTLED', resultCents: 200, settledAt: 9, confirmedAt: 5 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'b', status: 'SETTLED', resultCents: -500, settledAt: 9, confirmedAt: null }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'c', status: 'CONFIRMED', confirmedAt: 5 }), '2026-07-14', null);
  expect(r.trades.settledConfirmedCents(1)).toBe(200);
  expect(r.trades.settledConfirmedCents(99)).toBe(0);
});

test('the scan tick snapshots EVERY profile with confirmed money only', () => {
  let now = NOW;
  const h = createApp({
    dbPath: ':memory:',
    clock: () => now,
    timer: { setTimeout: () => 0 },
    rng: () => 0.5,
    provider: { fetchQuotes: () => [] }, // empty market — the snapshot is the whole story
    sender: { sendVerified: () => {} },
  });
  h.repos.profiles.create('LEA', 500_000, '2026-07-14');
  h.repos.trades.insert(mkTrade({ id: 'won', status: 'SETTLED', resultCents: 4_200, settledAt: NOW - 1, confirmedAt: NOW - 2 }), '2026-07-13', null);
  h.repos.trades.insert(mkTrade({ id: 'unfollowed', status: 'SETTLED', resultCents: 9_999, settledAt: NOW - 1, confirmedAt: null }), '2026-07-13', null);
  h.scheduler.scanNow(now);
  const p1 = h.repos.snapshots.byProfile(1);
  expect(p1[p1.length - 1]).toEqual({ profileId: 1, dayKey: '2026-07-14', bankrollCents: 1_004_200 });
  expect(h.repos.snapshots.byProfile(2)).toEqual([{ profileId: 2, dayKey: '2026-07-14', bankrollCents: 500_000 }]);
});
