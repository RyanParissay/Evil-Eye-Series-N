import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { OpsSettings, ScanLogEntry } from '@shared/types';
import { apiErrorHandler } from './api';
import { createOpsRouter, type OpsRouterDeps } from './ops';

const NOW = new Date('2026-07-20T12:00:00Z');

class MemOpsStore {
  constructor(public data: OpsSettings) {}
  async read(): Promise<OpsSettings> {
    return this.data;
  }
  async update<T>(
    mutate: (data: OpsSettings) => { data: OpsSettings; result: T } | Promise<{ data: OpsSettings; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

const DEFAULTS: OpsSettings = {
  weekday: { startMinutes: 18.5 * 60, endMinutes: 22.5 * 60 },
  weekend: { startMinutes: 12 * 60, endMinutes: 22.5 * 60 },
  inWindowMins: 5,
  outWindowMins: null,
  monthlyCreditBudget: 20_000,
  autoStopPct: 95,
};

function harness(scans: ScanLogEntry[] = []) {
  const store = new MemOpsStore({ ...DEFAULTS });
  const deps: OpsRouterDeps = {
    settings: store,
    scanHistory: {
      async lastN(n: number) {
        return scans.slice(-n);
      },
      entries: async function* () {
        for (const s of scans) yield s;
      },
    },
    books: { list: async () => [] },
    records: async () => [],
    ledger: async () => ({
      realized: { totalLockedProfit: 0, completions: 0, unpricedCompletions: 0 },
      captureRate: { alerted: 0, completed: 0, rate: null },
    }),
    paper: async () => null,
    lastUsage: async () => ({ requestsUsedTotal: 12_000 }),
    now: () => NOW,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/ops', createOpsRouter(deps));
  app.use(apiErrorHandler);
  return { app, store };
}

describe('/api/ops', () => {
  it('GET/PATCH settings with validation', async () => {
    const { app } = harness();
    const got = await request(app).get('/api/ops/settings');
    expect(got.status).toBe(200);
    expect(got.body.inWindowMins).toBe(5);

    const patched = await request(app)
      .patch('/api/ops/settings')
      .send({ inWindowMins: 7, outWindowMins: 30, weekday: { startMinutes: 1080, endMinutes: 1350 } });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ inWindowMins: 7, outWindowMins: 30 });

    for (const body of [
      { inWindowMins: 0 },
      { autoStopPct: 150 },
      { weekday: { startMinutes: -5, endMinutes: 100 } },
      { monthlyCreditBudget: -1 },
      {},
    ]) {
      const bad = await request(app).patch('/api/ops/settings').send(body);
      expect(bad.status).toBe(400);
    }
  });

  it('GET coverage / telemetry / scoreboard respond from persisted data only', async () => {
    const { app } = harness([
      {
        scannedAt: '2026-07-19T10:00:00Z',
        regionTab: 'ca',
        sportsScanned: ['basketball_nba'],
        creditsComputed: 10,
        requestsUsedTotal: 12_000,
        distinctBooks: ['bet365'],
        eventCount: 3,
      },
    ]);
    const coverage = await request(app).get('/api/ops/coverage');
    expect(coverage.status).toBe(200);
    expect(coverage.body.scansConsidered).toBe(1);

    const telemetry = await request(app).get('/api/ops/telemetry');
    expect(telemetry.status).toBe(200);
    expect(telemetry.body.alertToVerify).toEqual({ samples: 0, medianMs: null });

    const scoreboard = await request(app).get('/api/ops/scoreboard');
    expect(scoreboard.status).toBe(200);
    // July 20 noon ≈ 62.9% of the month elapsed → projection ≈ 19,032.
    expect(scoreboard.body.credits.usedTotal).toBe(12_000);
    expect(scoreboard.body.credits.projectedMonthEnd).toBeGreaterThan(18_000);
    expect(scoreboard.body.credits.projectedMonthEnd).toBeLessThan(20_000);
    expect(scoreboard.body.credits.autoStopEngaged).toBe(false);
    expect(scoreboard.body.paper).toBeNull();
  });
});
