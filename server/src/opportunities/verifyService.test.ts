import { describe, expect, it, vi } from 'vitest';
import type { ArbOpportunity, OddsEvent } from '@shared/types';
import type { FetchOddsParams, OddsProvider, OddsResult, SportsResult } from '../providers/OddsProvider';
import { OpportunityService } from './opportunityService';
import type { OpportunityData, OpportunityDataStore } from './opportunityStore';
import { verifyOpportunity } from './verifyService';

const NOW = new Date('2026-07-09T12:00:00Z');
const FUTURE = '2026-07-09T23:00:00Z';
const SCOPE = { sportsScanned: ['basketball_nba'], regionTab: 'ca' };

class FakeStore implements OpportunityDataStore {
  constructor(public data: OpportunityData = { records: [] }) {}
  async read(): Promise<OpportunityData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: OpportunityData,
    ) => { data: OpportunityData; result: T } | Promise<{ data: OpportunityData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeArchive {
  async append(): Promise<void> {}
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

/** A feed where bet365 prices Lakers and pinnacle prices Celtics as given. */
function feedEvent(lakersOdds: number | null, celticsOdds: number | null): OddsEvent {
  const book = (key: string, title: string, name: string, price: number | null) => ({
    key,
    title,
    lastUpdate: NOW.toISOString(),
    markets: [
      {
        key: 'h2h',
        outcomes: price == null ? [] : [{ name, price }],
      },
    ],
  });
  return {
    id: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: FUTURE,
    homeTeam: 'Celtics',
    awayTeam: 'Lakers',
    bookmakers: [
      book('bet365', 'Bet365', 'Lakers', lakersOdds),
      book('pinnacle', 'Pinnacle', 'Celtics', celticsOdds),
    ],
  };
}

function stubProvider(events: OddsEvent[]) {
  const fetchOdds = vi.fn(
    async (_sport: string, _params: FetchOddsParams): Promise<OddsResult> => ({
      events,
      usage: { requestsUsedTotal: 140, requestsRemainingTotal: 19860, creditsCharged: 1 },
    }),
  );
  const provider: OddsProvider = {
    mode: 'mock' as const,
    async listSports(): Promise<SportsResult> {
      throw new Error('verify never lists sports');
    },
    fetchOdds,
    async fetchScores(): Promise<never> {
      throw new Error('verify never fetches scores');
    },
  };
  return { provider, fetchOdds };
}

async function seeded(arbOverrides: Partial<ArbOpportunity> = {}) {
  const service = new OpportunityService(new FakeStore(), new FakeArchive(), () => NOW);
  await service.recordScan([makeArb(arbOverrides)], SCOPE);
  const [record] = await service.list();
  return { service, record };
}

describe('verifyOpportunity', () => {
  it('re-prices the exact legs by bookmaker and returns the updated record', async () => {
    const { service, record } = await seeded();
    const { provider, fetchOdds } = stubProvider([feedEvent(2.12, 2.06)]);

    const outcome = await verifyOpportunity(
      { provider, opportunities: service, now: () => NOW },
      record.id,
    );
    expect(outcome).toMatchObject({
      ok: true,
      legOdds: [2.12, 2.06],
      creditsCharged: 1,
      record: { status: 'active' },
    });
    // One cheap call: the record's sport, its market, ONLY the legs' books.
    expect(fetchOdds).toHaveBeenCalledOnce();
    const [sport, params] = fetchOdds.mock.calls[0];
    expect(sport).toBe('basketball_nba');
    expect(params.markets).toEqual(['h2h']);
    expect([...params.bookmakers!].sort()).toEqual(['bet365', 'pinnacle']);
    expect((await service.get(record.id))?.legs.map((l) => l.odds)).toEqual([2.12, 2.06]);
  });

  it('kills the record when a leg vanished from the feed', async () => {
    const { service, record } = await seeded();
    const { provider } = stubProvider([feedEvent(2.12, null)]);
    const outcome = await verifyOpportunity(
      { provider, opportunities: service, now: () => NOW },
      record.id,
    );
    expect(outcome).toMatchObject({ ok: true, record: { status: 'dead' }, legOdds: [2.12, null] });
  });

  it('declares a commenced event dead without spending an API call', async () => {
    const { service, record } = await seeded({ commenceTime: '2026-07-09T11:00:00Z' });
    const { provider, fetchOdds } = stubProvider([]);
    const outcome = await verifyOpportunity(
      { provider, opportunities: service, now: () => NOW },
      record.id,
    );
    expect(outcome).toMatchObject({ ok: true, record: { status: 'dead' }, creditsCharged: 0 });
    expect(fetchOdds).not.toHaveBeenCalled();
  });

  it('maps unknown ids and completed records to not_found / conflict', async () => {
    const { service, record } = await seeded();
    await service.updateStatus(record.id, 'completed');
    const { provider, fetchOdds } = stubProvider([]);
    const deps = { provider, opportunities: service, now: () => NOW };

    expect(await verifyOpportunity(deps, 'nope')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await verifyOpportunity(deps, record.id)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(fetchOdds).not.toHaveBeenCalled();
  });
});
