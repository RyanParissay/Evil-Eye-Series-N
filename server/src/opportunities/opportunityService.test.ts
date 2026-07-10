import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { OPPORTUNITY_ARCHIVE_AFTER_MS } from '../config/constants';
import { opportunityFingerprint } from './opportunityId';
import { OpportunityService } from './opportunityService';
import type { OpportunityData, OpportunityDataStore } from './opportunityStore';

const NOW = new Date('2026-07-09T12:00:00Z');
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
  appended: OpportunityRecord[][] = [];
  failNext = false;
  async append(records: OpportunityRecord[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('disk full');
    }
    this.appended.push(records);
  }
}

function makeArb(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-09T23:00:00Z',
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

describe('OpportunityService', () => {
  it('recordScan persists new records; get and list find them', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);

    const listed = await service.list('active');
    expect(listed).toHaveLength(1);
    expect(await service.get(listed[0].id)).toMatchObject({ eventName: 'Lakers @ Celtics' });
    expect(await service.get('nope')).toBeNull();
  });

  it('markAlerted flags matching fingerprints once', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    const arb = makeArb();
    await service.recordScan([arb], SCOPE);

    await service.markAlerted([opportunityFingerprint(arb)]);
    const [record] = await service.list();
    expect(record.alerted).toBe(true);
    expect(record.alertedAt).toBe(NOW.toISOString());

    // A second call must not move alertedAt.
    const later = new OpportunityService(store, new FakeArchive(), () => new Date(NOW.getTime() + 60_000));
    await later.markAlerted([opportunityFingerprint(arb)]);
    expect((await service.list())[0].alertedAt).toBe(NOW.toISOString());
  });

  it('ages settled records into the archive and drops them from the active file', async () => {
    const store = new FakeStore();
    const archive = new FakeArchive();
    const service = new OpportunityService(store, archive, () => NOW);
    await service.recordScan([makeArb()], SCOPE);

    // Kill it, then age it past the window and rescan to trigger archiving.
    await service.recordScan([], SCOPE);
    store.data.records[0].statusChangedAt = new Date(
      NOW.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS - 1,
    ).toISOString();
    await service.recordScan([], SCOPE);

    expect(archive.appended.flat()).toHaveLength(1);
    expect(store.data.records).toHaveLength(0);
  });

  it('keeps records in the active file when the archive append fails', async () => {
    const store = new FakeStore();
    const archive = new FakeArchive();
    const service = new OpportunityService(store, archive, () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    await service.recordScan([], SCOPE);
    store.data.records[0].statusChangedAt = new Date(
      NOW.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS - 1,
    ).toISOString();

    archive.failNext = true;
    await service.recordScan([], SCOPE);
    expect(store.data.records).toHaveLength(1); // nothing lost
  });
});
