import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, PaperData } from '@shared/types';
import { PaperService } from './paperService';
import type { PaperDataStore } from './paperStore';

const NOW = new Date('2026-07-10T12:00:00Z');
const FUTURE = '2026-07-10T20:00:00Z';

class MemStore implements PaperDataStore {
  constructor(public data: PaperData) {}
  async read(): Promise<PaperData> {
    return this.data;
  }
  async update<T>(
    mutate: (data: PaperData) => { data: PaperData; result: T } | Promise<{ data: PaperData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function makeArb(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: FUTURE,
    marketKey: 'h2h',
    arbIndex: 0.977,
    profitPct: 2.34,
    legs: [
      { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'Celtics', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    sameBookmaker: false,
    suspicious: false,
    ...overrides,
  };
}

function fresh(enabled = true) {
  const store = new MemStore({
    settings: {
      enabled,
      startingBankroll: 5000,
      stakeRule: { kind: 'flat', value: 400 },
      haircutPercent: 20,
      thresholdPercent: 2,
    },
    entries: [],
  });
  return { store, service: new PaperService(store, () => NOW) };
}

describe('PaperService.considerEntries', () => {
  it('enters exactly the alert-worthy set and never double-enters a fingerprint', async () => {
    const { store, service } = fresh();
    const entered = await service.considerEntries([
      makeArb(),
      makeArb({ eventId: 'evt-sus', suspicious: true }),
      makeArb({ eventId: 'evt-same', sameBookmaker: true }),
      makeArb({ eventId: 'evt-low', profitPct: 1 }),
    ]);
    expect(entered).toBe(1);
    expect(store.data.entries).toHaveLength(1);
    expect(store.data.entries[0]).toMatchObject({
      eventId: 'evt-1',
      profitPct: 2.34,
      enteredAt: NOW.toISOString(),
    });

    // Same opportunity re-sighted (profit wobbled): no second entry.
    const again = await service.considerEntries([makeArb({ profitPct: 2.4 })]);
    expect(again).toBe(0);
    expect(store.data.entries).toHaveLength(1);
  });

  it('does nothing while paper mode is off', async () => {
    const { store, service } = fresh(false);
    expect(await service.considerEntries([makeArb()])).toBe(0);
    expect(store.data.entries).toHaveLength(0);
  });

  it('reset clears entries but keeps settings', async () => {
    const { store, service } = fresh();
    await service.considerEntries([makeArb()]);
    await service.reset();
    expect(store.data.entries).toHaveLength(0);
    expect(store.data.settings.startingBankroll).toBe(5000);
  });

  it('book() reports the settled view with the simulated flag', async () => {
    const { service } = fresh();
    await service.considerEntries([makeArb({ commenceTime: '2026-07-10T11:30:00Z' })]);
    const view = await service.book();
    expect(view.simulated).toBe(true);
    expect(view.book.entries[0]).toMatchObject({ settled: true, stake: 400 });
    expect(view.book.bankrollIdeal).toBeCloseTo(5000 + 400 * 0.0234, 2);
  });
});
