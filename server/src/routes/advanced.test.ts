import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, BookmakerConfig, OddsEvent } from '@shared/types';
import type { OddsSnapshot } from '../scan/snapshotStore';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import { PresetService } from '../presets/presetService';
import type { PresetData, PresetDataStore } from '../presets/presetStore';
import { apiErrorHandler } from './api';
import { createAdvancedRouter } from './advanced';

const NOW = new Date('2026-07-10T12:00:00Z');
const FUTURE = '2026-07-10T18:00:00Z';

/* ————— In-memory stores ————— */

class MemStore<T> {
  constructor(public data: T) {}
  async read(): Promise<T> {
    return this.data;
  }
  async update<R>(
    mutate: (data: T) => { data: T; result: R } | Promise<{ data: T; result: R }>,
  ): Promise<R> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeArchive {
  async append(): Promise<void> {}
}

/* ————— Snapshot fixture: one legal cross-book arb + one cross-line trap ————— */

function h2hEvent(): OddsEvent {
  const mk = (key: string, lakers: number, celtics: number) => ({
    key,
    title: key.toUpperCase(),
    lastUpdate: NOW.toISOString(),
    markets: [
      {
        key: 'h2h',
        outcomes: [
          { name: 'Los Angeles Lakers', price: lakers },
          { name: 'Boston Celtics', price: celtics },
        ],
      },
    ],
  });
  return {
    id: 'ev1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: FUTURE,
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    bookmakers: [mk('bet365', 2.1, 1.8), mk('pinnacle', 1.85, 2.12)],
  };
}

/** Over 220.5 and Under 221.5 at juicy prices — different |point| groups, never an arb. */
function crossLineTrapEvent(): OddsEvent {
  const mk = (key: string, name: string, price: number, point: number) => ({
    key,
    title: key.toUpperCase(),
    lastUpdate: NOW.toISOString(),
    markets: [{ key: 'totals', outcomes: [{ name, price, point }] }],
  });
  return {
    id: 'ev-trap',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: FUTURE,
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: [mk('bet365', 'Over', 2.4, 220.5), mk('pinnacle', 'Under', 2.4, 221.5)],
  };
}

const SNAPSHOT: OddsSnapshot = {
  fetchedAt: '2026-07-10T11:45:00Z',
  regionTab: 'ca',
  markets: ['h2h', 'totals'],
  sportsScanned: ['basketball_nba'],
  events: [h2hEvent(), crossLineTrapEvent()],
};

function harness(snapshot: OddsSnapshot | null) {
  const presets = new PresetService(
    new MemStore<PresetData>({ presets: [] }) as unknown as PresetDataStore,
    () => NOW,
  );
  const opportunities = new OpportunityService(
    new MemStore<OpportunityData>({ records: [] }) as unknown as OpportunityDataStore,
    new FakeArchive(),
    () => NOW,
  );
  const books = {
    async list(): Promise<BookmakerConfig[]> {
      return ['bet365', 'pinnacle'].map((key) => ({
        key,
        title: key,
        enabled: true,
        balance: null,
        status: 'active' as const,
        notes: '',
        firstSeenAt: NOW.toISOString(),
        lastSeenAt: NOW.toISOString(),
      }));
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAdvancedRouter({
      presets,
      snapshots: { read: async () => snapshot },
      opportunities,
      books,
      now: () => NOW,
    }),
  );
  app.use(apiErrorHandler);
  return { app, presets, opportunities };
}

describe('POST /api/advanced/recompute', () => {
  it('finds the cross-book arb from the snapshot and reports data age', async () => {
    const { app } = harness(SNAPSHOT);
    const res = await request(app)
      .post('/api/advanced/recompute')
      .send({ bookmakerKeys: ['bet365', 'pinnacle'] });
    expect(res.status).toBe(200);
    expect(res.body.snapshot.fetchedAt).toBe('2026-07-10T11:45:00Z');
    expect(res.body.opportunities).toHaveLength(1);
    expect(res.body.opportunities[0].eventId).toBe('ev1');
    // The cross-line totals trap must never appear (line groups are sacred).
    expect(res.body.opportunities.some((o: ArbOpportunity) => o.marketKey === 'totals')).toBe(false);
    // No usage/credits fields: recompute has no provider to charge.
    expect(res.body.usage).toBeUndefined();
  });

  it('drops the arb when the subset lacks one leg book', async () => {
    const { app } = harness(SNAPSHOT);
    const res = await request(app)
      .post('/api/advanced/recompute')
      .send({ bookmakerKeys: ['bet365'] });
    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(0);
  });

  it('resolves a dynamic preset and touches its lastUsedAt', async () => {
    const { app, presets } = harness(SNAPSHOT);
    const [allEnabled] = await presets.list();
    const res = await request(app)
      .post('/api/advanced/recompute')
      .send({ presetId: allEnabled.id });
    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(1);
    // The resolved key set comes back so the UI can render the selection.
    expect(res.body.bookmakerKeys.sort()).toEqual(['bet365', 'pinnacle']);
    expect((await presets.list())[0].lastUsedAt).toBe(NOW.toISOString());
  });

  it('marks which opportunities have persisted records — and never writes any', async () => {
    const { app, opportunities } = harness(SNAPSHOT);
    const first = await request(app)
      .post('/api/advanced/recompute')
      .send({ bookmakerKeys: ['bet365', 'pinnacle'] });
    const arb: ArbOpportunity = first.body.opportunities[0];
    expect(first.body.knownRecordIds).toEqual([]);
    expect(await opportunities.list()).toHaveLength(0); // recompute persisted nothing

    // A scan records the same opportunity → now the id is known.
    await opportunities.recordScan([arb], { sportsScanned: ['basketball_nba'], regionTab: 'ca' });
    const second = await request(app)
      .post('/api/advanced/recompute')
      .send({ bookmakerKeys: ['bet365', 'pinnacle'] });
    expect(second.body.knownRecordIds).toEqual([arb.id]);
  });

  it('no snapshot → empty payload, never an error; bad bodies → 400; unknown preset → 404', async () => {
    const empty = harness(null);
    const res = await request(empty.app)
      .post('/api/advanced/recompute')
      .send({ bookmakerKeys: ['bet365'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      snapshot: null,
      opportunities: [],
      knownRecordIds: [],
      bookmakerKeys: ['bet365'],
    });

    const { app } = harness(SNAPSHOT);
    for (const body of [{}, { presetId: 'x', bookmakerKeys: ['y'] }, { bookmakerKeys: 'bet365' }]) {
      const bad = await request(app).post('/api/advanced/recompute').send(body);
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('bad_request');
    }
    const missing = await request(app).post('/api/advanced/recompute').send({ presetId: 'ghost' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
  });
});

describe('/api/presets CRUD over HTTP', () => {
  it('lists seeds, creates, renames, deletes, and 404s cleanly', async () => {
    const { app } = harness(SNAPSHOT);
    const seeded = await request(app).get('/api/presets');
    expect(seeded.body.presets).toHaveLength(2);

    const created = await request(app)
      .post('/api/presets')
      .send({ name: 'Mine', bookmakerKeys: ['bet365'] });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ kind: 'static', name: 'Mine' });

    const renamed = await request(app)
      .patch(`/api/presets/${created.body.id}`)
      .send({ name: 'Ours' });
    expect(renamed.body.name).toBe('Ours');

    expect((await request(app).delete(`/api/presets/${created.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/presets/${created.body.id}`)).status).toBe(404);

    const invalid = await request(app).post('/api/presets').send({ name: '', bookmakerKeys: [] });
    expect(invalid.status).toBe(400);
  });
});
