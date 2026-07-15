import { expect, test } from 'vitest';
import { openDb, Repos } from './db.js';
import type { Trade } from '../shared/types.js';

function mkTrade(over: Partial<Trade>): Trade {
  return {
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: null }],
    marginInitial: 0.02, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1_000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: 9_999_999,
    ...over,
  };
}

test('books.update writes heat, health and belief', () => {
  const r = Repos(openDb(':memory:'));
  r.books.update('bet365', 41, 'yellow', 12_000);
  const b = r.books.byName('bet365')!;
  expect(b.heat).toBe(41);
  expect(b.health).toBe('yellow');
  expect(b.maxBeliefCents).toBe(12_000);
  r.books.update('bet365', 5, 'green', null);
  expect(r.books.byName('bet365')!.maxBeliefCents).toBeNull();
});

test('countToday / heldBackToday / killedTodayByReason slice by day_key and columns', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a' }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'b', status: 'EXPIRED', marginRecheck: 0.019 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'c', status: 'KILLED', killReason: 'HEAT_GATE' }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'd', status: 'KILLED', killReason: 'FAILED_VERIFICATION', marginRecheck: 0.001 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'e' }), '2026-07-13', 'moneyline');
  expect(r.trades.countToday('2026-07-14')).toBe(4);
  expect(r.trades.heldBackToday('2026-07-14')).toBe(1); // EXPIRED + recheck set + never verified
  expect(r.trades.killedTodayByReason('2026-07-14')).toEqual({ HEAT_GATE: 1, FAILED_VERIFICATION: 1 });
});

test('recheckRows returns initial/recheck/status for rechecked trades only', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a' }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'b', status: 'VERIFIED', marginRecheck: 0.018, verifiedAt: 2_000 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'c', status: 'KILLED', killReason: 'FAILED_VERIFICATION', marginRecheck: 0.001 }), '2026-07-14', 'moneyline');
  expect(r.trades.recheckRows()).toEqual([
    { marginInitial: 0.02, marginRecheck: 0.018, status: 'VERIFIED' },
    { marginInitial: 0.02, marginRecheck: 0.001, status: 'KILLED' },
  ]);
});

test('sentVolumeByBook: confirmed/settled sent trades with a leg at the book', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED', verifiedAt: 111 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'b', status: 'SETTLED', verifiedAt: 222, settledAt: 999, resultCents: 100 }), '2026-07-14', 'total');
  r.trades.insert(mkTrade({ id: 'c', status: 'VERIFIED', verifiedAt: 333 }), '2026-07-14', 'moneyline'); // sent, not confirmed
  r.trades.insert(mkTrade({
    id: 'd', status: 'CONFIRMED', verifiedAt: 444,
    legs: [{ book: 'fanduel', selection: 'away', odds: 2.0, stakeCents: 1000 }],
  }), '2026-07-14', 'moneyline'); // other book
  expect(r.trades.sentVolumeByBook('bet365')).toEqual([
    { verifiedAt: 111, market: 'moneyline' },
    { verifiedAt: 222, market: 'total' },
  ]);
});

test('eventsLog.byKind filters by kind in ts order', () => {
  const r = Repos(openDb(':memory:'));
  r.eventsLog.add(2, 'stake_cut', '{"book":"bet365"}');
  r.eventsLog.add(1, 'bet_rejected', '{"book":"bet365"}');
  r.eventsLog.add(3, 'scan', '{}');
  expect(r.eventsLog.byKind('bet_rejected').map((e) => e.ts)).toEqual([1]);
  expect(r.eventsLog.byKind('stake_cut')).toHaveLength(1);
});
