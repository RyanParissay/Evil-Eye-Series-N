import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ArbLeg, OpportunityRecord, SafetySettings } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import { apiErrorHandler } from './api';
import { createSafetyRouter } from './safety';

class MemStore {
  constructor(public data: SafetySettings) {}
  async read(): Promise<SafetySettings> {
    return this.data;
  }
  async update<T>(
    mutate: (data: SafetySettings) => { data: SafetySettings; result: T } | Promise<{ data: SafetySettings; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function leg(bookmakerKey: string, outcome: string): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds: 2.05, stake: 50, link: null };
}

let seq = 0;
function arbRecord(homeSideBook: string): OpportunityRecord {
  const id = `r${seq++}`;
  return {
    id,
    fingerprint: `fp-${id}`,
    strategy: 'arb',
    eventId: `evt-${id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Celtics @ Lakers',
    commenceTime: '2026-07-20T00:00:00Z',
    marketKey: 'h2h',
    legs: [leg(homeSideBook, 'Lakers'), leg('draftkings', 'Celtics')],
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-12T18:00:00Z',
    lastSeenAt: '2026-07-12T18:00:00Z',
    statusChangedAt: '2026-07-12T18:00:00Z',
    alerted: true,
    alertedAt: '2026-07-12T18:00:00Z',
    homeTeam: 'Lakers',
    awayTeam: 'Celtics',
  };
}

function harness(records: OpportunityRecord[] = []) {
  seq = 0;
  const store = new MemStore(structuredClone(DEFAULT_SAFETY_SETTINGS));
  const app = express();
  app.use(express.json());
  app.use(
    '/api/safety',
    createSafetyRouter({
      settings: store,
      records: async () => records,
      hubPurchasedRecordIds: async () => new Set(),
      defaultStake: async () => 500,
      now: () => new Date('2026-07-12T20:00:00Z'),
    }),
  );
  app.use(apiErrorHandler);
  return { app, store };
}

describe('/api/safety/settings', () => {
  it('GET returns the settings object', async () => {
    const res = await request(harness().app).get('/api/safety/settings');
    expect(res.status).toBe(200);
    expect(res.body.safeMode).toBe(true);
    expect(res.body.safetyThreshold).toBe(55);
  });

  it('PATCH applies valid scalar + nested changes', async () => {
    const { app, store } = harness();
    const res = await request(app)
      .patch('/api/safety/settings')
      .send({ safeMode: false, safetyThreshold: 70, budgets: { maxArbsPerDay: 5 } });
    expect(res.status).toBe(200);
    expect(store.data.safeMode).toBe(false);
    expect(store.data.safetyThreshold).toBe(70);
    expect(store.data.budgets.maxArbsPerDay).toBe(5);
    // Untouched nested fields survive.
    expect(store.data.budgets.maxArbsPerWeek).toBe(12);
  });

  it('PATCH rejects bad shapes with bad_request (400)', async () => {
    const { app } = harness();
    for (const body of [
      { safeMode: 'yes' },
      { safetyThreshold: 150 },
      { maxSafeEdge: 0 },
      { roundTo: -1 },
      { neverLimitBooks: [1, 2] },
      { budgets: { maxArbsPerDay: 0 } },
      { consensus: { minorPenalty: 15 } }, // penalty must be ≤ 0
      { marketTiers: { tier1: [{ marketKey: 'h2h' }] } }, // missing sportPrefix
      {},
    ]) {
      const res = await request(app).patch('/api/safety/settings').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });
});

describe('/api/safety/cost', () => {
  it('GET returns the SIMULATED Cost of Safety at current settings + fund stake', async () => {
    // One confirmed-but-filtered arb (hard reject), scored an hour ago:
    // 6% × $500/100 = $30 forgone, bucketed under its reject reason.
    const filtered = {
      ...arbRecord('bet365'),
      profitPct: 6,
      confirmation: { status: 'confirmed' as const, scanAAt: '2026-07-12T18:59:00Z' },
      safety: {
        score: 0,
        components: [],
        reasons: ['suspicious_edge'],
        roundedStakes: [250, 250],
        scoredAt: '2026-07-12T19:00:00Z',
      },
    };
    const res = await request(harness([filtered]).app).get('/api/safety/cost');
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.week).toMatchObject({
      filteredCount: 1,
      forgoneProfit: 30,
      forgoneEdgePp: 6,
      byReason: [{ reason: 'suspicious_edge', count: 1, forgoneProfit: 30 }],
    });
    expect(res.body.lifetime.filteredCount).toBe(1);
  });
});

describe('/api/safety/rotation', () => {
  it('GET returns an advisory rotation report', async () => {
    const records = Array.from({ length: 6 }, () => arbRecord('bet365'));
    const res = await request(harness(records).app).get('/api/safety/rotation');
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(30);
    const bet365 = res.body.books.find((b: { bookmakerKey: string }) => b.bookmakerKey === 'bet365');
    expect(bet365.imbalanced).toBe(true);
    expect(bet365.hint).toContain('consider rotating');
  });
});
