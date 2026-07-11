import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { EvSettings, OpportunityRecord } from '@shared/types';
import { apiErrorHandler } from './api';
import { createEvRouter } from './ev';

class MemStore {
  constructor(public data: EvSettings) {}
  async read(): Promise<EvSettings> {
    return this.data;
  }
  async update<T>(
    mutate: (data: EvSettings) => { data: EvSettings; result: T } | Promise<{ data: EvSettings; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function evRecord(id: string, edgePct: number, status = 'active'): OpportunityRecord {
  return {
    id,
    fingerprint: 'f'.repeat(64),
    strategy: 'ev',
    eventId: `evt-${id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: '2026-07-21T00:00:00Z',
    marketKey: 'h2h',
    legs: [{ outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 100, link: null }],
    profitPctAtDetection: edgePct,
    profitPct: edgePct,
    arbIndex: 1,
    status: status as OpportunityRecord['status'],
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-20T10:00:00Z',
    lastSeenAt: '2026-07-20T10:00:00Z',
    statusChangedAt: '2026-07-20T10:00:00Z',
    alerted: false,
    alertedAt: null,
    ev: {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 1.95,
      fairProbability: 0.5,
      edgePct,
      benchmarkLastUpdate: '2026-07-20T09:58:00Z',
    },
  };
}

function harness(records: OpportunityRecord[] = []) {
  const store = new MemStore({
    showMinEdgePct: 1,
    alertMinEdgePct: 3,
    maxOdds: 4,
    maxBenchmarkAgeMins: 15,
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/ev',
    createEvRouter({
      settings: store,
      opportunities: { list: async () => records },
      fund: { settings: async () => ({ totalBankroll: 3000, defaultStake: 400, unallocatedCash: 0 }) },
    }),
  );
  app.use(apiErrorHandler);
  return { app, store };
}

describe('/api/ev', () => {
  it('board: active EV records sorted by edge, arb records never leak in', async () => {
    const records = [
      evRecord('low', 2.1),
      evRecord('high', 8.4),
      evRecord('dead', 9.9, 'dead'),
      { ...evRecord('arb', 99), strategy: 'arb' as const, ev: undefined },
    ];
    const res = await request(harness(records).app).get('/api/ev/board');
    expect(res.status).toBe(200);
    expect(res.body.bets.map((b: { id: string }) => b.id)).toEqual(['high', 'low']);
    expect(res.body.defaultStake).toBe(400);
    expect(res.body.settings.showMinEdgePct).toBe(1);
  });

  it('settings validate: edges 0–50, odds 1.1–100, freshness 1–240', async () => {
    const { app, store } = harness();
    const good = await request(app)
      .patch('/api/ev/settings')
      .send({ alertMinEdgePct: 4, maxOdds: 3.5 });
    expect(good.status).toBe(200);
    expect(store.data.alertMinEdgePct).toBe(4);
    expect(store.data.maxOdds).toBe(3.5);

    for (const body of [
      { showMinEdgePct: -1 },
      { alertMinEdgePct: 60 },
      { maxOdds: 1 },
      { maxBenchmarkAgeMins: 0 },
      {},
    ]) {
      const bad = await request(app).patch('/api/ev/settings').send(body);
      expect(bad.status).toBe(400);
    }
  });
});
