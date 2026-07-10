import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OddsEvent } from '@shared/types';
import { BookmakerService } from './bookmakerService';
import type { BookmakerData, BookmakerDataStore } from './bookmakerStore';

const NOW = new Date('2026-07-09T12:00:00Z');

class FakeStore implements BookmakerDataStore {
  constructor(public data: BookmakerData = { bookmakers: [] }) {}
  async read(): Promise<BookmakerData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: BookmakerData,
    ) => { data: BookmakerData; result: T } | Promise<{ data: BookmakerData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function makeEvent(books: Array<[string, string]>): OddsEvent {
  return {
    id: 'ev-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: '2026-07-09T23:00:00Z',
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: books.map(([key, title]) => ({
      key,
      title,
      lastUpdate: NOW.toISOString(),
      markets: [],
    })),
  };
}

function makeArb(bookKeys: string[]): ArbOpportunity {
  return {
    eventId: 'ev-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'B @ A',
    commenceTime: '2026-07-09T23:00:00Z',
    marketKey: 'h2h',
    arbIndex: 0.95,
    profitPct: 5,
    legs: bookKeys.map((key, i) => ({
      outcome: `Outcome ${i}`,
      bookmakerKey: key,
      bookmakerTitle: key,
      odds: 2.1,
      stake: 50,
      link: null,
    })),
    sameBookmaker: false,
    suspicious: false,
  };
}

describe('BookmakerService', () => {
  it('recordSeen registers every distinct book across events once', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([
      makeEvent([
        ['bet365', 'Bet365'],
        ['pinnacle', 'Pinnacle'],
      ]),
      makeEvent([['bet365', 'Bet365']]),
    ]);
    expect(store.data.bookmakers.map((b) => b.key).sort()).toEqual(['bet365', 'pinnacle']);
  });

  it('patch updates a known book and returns null for an unknown key', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([makeEvent([['bet365', 'Bet365']])]);

    const updated = await service.patch('bet365', { status: 'limited', balance: 100 });
    expect(updated).toMatchObject({ status: 'limited', balance: 100 });
    expect(store.data.bookmakers[0].status).toBe('limited');

    expect(await service.patch('nope', { enabled: false })).toBeNull();
  });

  it('patching the balance stamps balanceUpdatedAt; other edits do not', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([makeEvent([['bet365', 'Bet365']])]);

    await service.patch('bet365', { notes: 'no stamp' });
    expect(store.data.bookmakers[0].balanceUpdatedAt).toBeUndefined();

    await service.patch('bet365', { balance: 500 });
    expect(store.data.bookmakers[0].balanceUpdatedAt).toBe(NOW.toISOString());
  });

  it('adjustBalances applies exact deltas atomically, treating null as zero', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([makeEvent([['bet365', 'Bet365'], ['pinnacle', 'Pinnacle']])]);
    await service.patch('bet365', { balance: 100 });

    await service.adjustBalances([
      { key: 'bet365', delta: -40 },
      { key: 'pinnacle', delta: 250 },
    ]);
    const byKey = Object.fromEntries(store.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(byKey.bet365).toBeCloseTo(60, 2);
    expect(byKey.pinnacle).toBeCloseTo(250, 2);
  });

  it('filterAlertable drops arbs with any leg at a non-alertable book', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([
      makeEvent([
        ['bet365', 'Bet365'],
        ['pinnacle', 'Pinnacle'],
        ['coolbet', 'Coolbet'],
      ]),
    ]);
    await service.patch('pinnacle', { status: 'limited' });

    const kept = await service.filterAlertable([
      makeArb(['bet365', 'coolbet']),
      makeArb(['bet365', 'pinnacle']),
      makeArb(['bet365', 'never-seen']),
    ]);
    expect(kept.map((a) => a.legs[1].bookmakerKey)).toEqual(['coolbet', 'never-seen']);
  });

  it('list returns configs sorted by title', async () => {
    const store = new FakeStore();
    const service = new BookmakerService(store, () => NOW);
    await service.recordSeen([
      makeEvent([
        ['pinnacle', 'Pinnacle'],
        ['bet365', 'Bet365'],
      ]),
    ]);
    expect((await service.list()).map((b) => b.title)).toEqual(['Bet365', 'Pinnacle']);
  });
});
