import { expect, test } from 'vitest';
import { Repos, openDb } from './db.js';
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

test('books.enabled defaults 1; setEnabled and setSport round-trip', () => {
  const r = Repos(openDb(':memory:'));
  expect(r.books.byName('bet365')!.enabled).toBe(1);
  r.books.setEnabled('bet365', 0);
  expect(r.books.byName('bet365')!.enabled).toBe(0);
  r.books.setSport('bet365', 'tennis');
  expect(r.books.byName('bet365')!.sport).toBe('tennis');
  r.books.setEnabled('bet365', 1);
  expect(r.books.byName('bet365')!.enabled).toBe(1);
});

test('string settings round-trip through the k/v store', () => {
  const r = Repos(openDb(':memory:'));
  r.settings.set({ whatsappNumber: '+1 604 555 8112', disabledSports: 'soccer,tennis' });
  const s = r.settings.all();
  expect(s.whatsappNumber).toBe('+1 604 555 8112');
  expect(s.disabledSports).toBe('soccer,tennis');
});

test('sentTodayByCategory counts sent picks per category per day', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'VERIFIED', verifiedAt: 1 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'b', status: 'CONFIRMED', verifiedAt: 2 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'c', category: 'EV', status: 'VERIFIED', verifiedAt: 3 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'd' }), '2026-07-14', null); // never sent
  r.trades.insert(mkTrade({ id: 'e', status: 'VERIFIED', verifiedAt: 4 }), '2026-07-13', null); // other day
  expect(r.trades.sentTodayByCategory('2026-07-14', 'ARB')).toBe(2);
  expect(r.trades.sentTodayByCategory('2026-07-14', 'EV')).toBe(1);
  expect(r.trades.sentTodayByCategory('2026-07-14', 'MIDDLE')).toBe(0);
});

test('exportRows/exportColumns: raw whole-table dump in stable order', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'b', createdAt: 2 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'a', createdAt: 1 }), '2026-07-14', null);
  const cols = r.trades.exportColumns();
  expect(cols[0]).toBe('id');
  expect(cols).toContain('day_key');
  const rows = r.trades.exportRows();
  expect(rows.map((x) => x.id)).toEqual(['a', 'b']);
  expect(typeof rows[0]!.legs).toBe('string'); // raw JSON column — an export, not a view
});
