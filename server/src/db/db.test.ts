import { expect, test } from 'vitest';
import { openDb, Repos } from './db.js'; // ADAPTED from brief: NodeNext needs the .js extension
import type { Trade } from '../shared/types.js'; // ADAPTED: brief's test uses Trade without importing it
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

// ---- brief's tests (verbatim except noted adaptations) ----

test('opens in-memory db, seeds defaults, round-trips a trade', () => {
  const r = Repos(openDb(':memory:'));
  expect(r.settings.all().tolerancePct).toBe(5);
  expect(r.books.all().length).toBe(16);
  expect(r.books.byName('pinnacle')?.sharpExempt).toBe(1);
  expect(r.profiles.all()[0]?.name).toBe('RYAN');
  const t: Trade = { id: 't1', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'A ML', odds: 2.1, stakeCents: null }],
    marginInitial: 0.012, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null,
    confirmedAt: null, // Plan 4: rowToTrade always emits the column
    eventStartsAt: 9_999_999 };
  r.trades.insert(t, '2026-07-14'); // ADAPTED: insert takes the Vancouver dayKey as 2nd arg (stamped as day_key)
  expect(r.trades.byId('t1')).toEqual(t);
  expect(r.trades.byStatus('PENDING')).toHaveLength(1);
});

test('opening twice is idempotent', () => {
  const db = openDb(':memory:'); Repos(db); Repos(db); // no throw
});

// ---- additional contract coverage (methods the brief names but its tests don't reach) ----

function mkTrade(over: Partial<Trade>): Trade {
  return { id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'A ML', odds: 2.1, stakeCents: null }],
    marginInitial: 0.012, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, confirmedAt: null, eventStartsAt: 9_999_999, ...over };
}

test('day counters: "sent" = verified_at stamped; day_key/book/market filters apply', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'VERIFIED', verifiedAt: 5000 }), '2026-07-14', 'h2h');
  r.trades.insert(mkTrade({ id: 'b' }), '2026-07-14', 'h2h'); // PENDING — never sent
  r.trades.insert(mkTrade({ id: 'c', status: 'CONFIRMED', verifiedAt: 900 }), '2026-07-13', 'h2h'); // yesterday
  r.trades.insert(mkTrade({ id: 'd', status: 'VERIFIED', verifiedAt: 6000,
    legs: [{ book: 'fanduel', selection: 'B ML', odds: 1.9, stakeCents: null }] }), '2026-07-14', 'spreads');
  expect(r.trades.verifiedSentToday('2026-07-14')).toBe(2); // a + d
  expect(r.trades.countByBookToday('bet365', '2026-07-14')).toBe(1); // a (b pending, c yesterday)
  expect(r.trades.countByBookToday('caesars', '2026-07-14')).toBe(0);
  expect(r.trades.countByBookMarketSince('bet365', 'h2h', 0)).toBe(2); // a + c
  expect(r.trades.countByBookMarketSince('bet365', 'h2h', 1000)).toBe(1); // a only (c sent at 900)
  expect(r.trades.countByBookMarketSince('fanduel', 'h2h', 0)).toBe(0); // d is spreads
  expect(r.trades.byId('nope')).toBeNull();
  expect(r.books.byName('nope')).toBeNull();
});

test('settings.set persists a patch; all() hands out copies, never the module object', () => {
  const db = openDb(':memory:');
  const r = Repos(db);
  expect(r.settings.set({ tolerancePct: 7 }).tolerancePct).toBe(7);
  expect(Repos(db).settings.all().tolerancePct).toBe(7); // persisted across Repos instances
  expect(DEFAULT_SETTINGS.tolerancePct).toBe(5); // module object untouched
  const s = r.settings.all();
  s.bankrollCents = 0; // mutating a returned object…
  expect(r.settings.all().bankrollCents).toBe(1_000_000); // …never leaks back
  expect(r.settings.all()).not.toBe(DEFAULT_SETTINGS);
});

test('journal, events, credits, snapshots (upsert), limits, profiles, trades.update', () => {
  const r = Repos(openDb(':memory:'));
  r.journal.add(1000, 'first entry');
  expect(r.journal.all().map((j) => j.text)).toEqual(['first entry']);
  r.eventsLog.add(2000, 'scan', '{"created":1}');
  expect(r.eventsLog.all()[0]).toMatchObject({ ts: 2000, kind: 'scan', payload: '{"created":1}' });
  r.credits.add(3000, 2);
  r.credits.add(4000, 3);
  expect(r.credits.all().map((c) => c.n)).toEqual([2, 3]);
  r.snapshots.writeDaily(1, '2026-07-14', 1_000_000);
  r.snapshots.writeDaily(1, '2026-07-14', 1_005_000); // same day → upsert, not a second row
  expect(r.snapshots.byProfile(1)).toEqual([{ profileId: 1, dayKey: '2026-07-14', bankrollCents: 1_005_000 }]);
  const p = r.profiles.create('ALT', 500_000, '2026-07-14');
  expect(p).toMatchObject({ id: 2, name: 'ALT', startingCashCents: 500_000, createdDate: '2026-07-14' });
  expect(r.profiles.all()).toHaveLength(2);
  const t = mkTrade({ id: 'u1' });
  r.trades.insert(t, '2026-07-14');
  const updated: Trade = { ...t, status: 'KILLED', killReason: 'QUOTE_STALE' };
  r.trades.update(updated);
  expect(r.trades.byId('u1')).toEqual(updated);
  expect(r.trades.byStatus('PENDING')).toHaveLength(0);
  r.limitsReports.add('u1', 'bet365', 50_000, 5000);
  expect(r.limitsReports.all()[0]).toMatchObject({ tradeId: 'u1', book: 'bet365', maxAllowedCents: 50_000, sentAt: 5000 });
});
