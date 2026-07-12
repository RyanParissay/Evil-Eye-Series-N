import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { OpsSettings, ScanLogEntry } from '@shared/types';
import { apiErrorHandler } from './api';
import { createOpsRouter, type OpsRouterDeps } from './ops';
import { DEFAULT_SCHEDULER_SETTINGS } from '../ops/opsStore';

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
  markets: { totals: false, spreads: false },
  scheduler: DEFAULT_SCHEDULER_SETTINGS,
};

function harness(scans: ScanLogEntry[] = [], extra: Partial<OpsRouterDeps> = {}) {
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
    fetchPlan: async () => ({ bookmakersParam: undefined }),
    snapshots: { read: async () => null },
    records: async () => [],
    ledger: async () => ({
      realized: { totalLockedProfit: 0, completions: 0, unpricedCompletions: 0 },
      captureRate: { alerted: 0, completed: 0, rate: null },
    }),
    paper: async () => null,
    lastUsage: async () => ({ requestsUsedTotal: 12_000 }),
    leaderboard: { read: async () => ({ createdAt: '2026-07-01T00:00:00Z', totalScans: 0, books: [] }) },
    now: () => NOW,
    ...extra,
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
      { confirmSecondSighting: true }, // superseded by the confirmation pair (Phase 16 Part A)
      {},
    ]) {
      const bad = await request(app).patch('/api/ops/settings').send(body);
      expect(bad.status).toBe(400);
    }
  });

  it('PATCH scheduler.confirmationIntervalSecs (Phase 16 Part A) within 10-600s', async () => {
    const { app } = harness();
    const set = await request(app)
      .patch('/api/ops/settings')
      .send({ scheduler: { confirmationIntervalSecs: 120 } });
    expect(set.status).toBe(200);
    expect(set.body.scheduler.confirmationIntervalSecs).toBe(120);

    for (const secs of [5, 601, 60.5, 'soon']) {
      const bad = await request(app)
        .patch('/api/ops/settings')
        .send({ scheduler: { confirmationIntervalSecs: secs } });
      expect(bad.status).toBe(400);
    }
  });

  it('enabling the scheduler clears the self-disable reason, seeds scope from last scan, and wakes it', async () => {
    let woke = 0;
    const { app, store } = harness([], {
      onSchedulerChange: () => {
        woke += 1;
      },
      latestScanMeta: async () => ({ regionTab: 'ca', topN: 8 }),
    });
    // Simulate a prior quota self-disable.
    store.data.scheduler = { ...store.data.scheduler, enabled: false, disabledReason: 'was spent' };

    const res = await request(app).patch('/api/ops/settings').send({ scheduler: { enabled: true } });
    expect(res.status).toBe(200);
    expect(res.body.scheduler.enabled).toBe(true);
    expect(res.body.scheduler.disabledReason).toBeNull();
    expect(res.body.scheduler.scanParams).toEqual({ regionTab: 'ca', topN: 8 });
    expect(woke).toBe(1);
  });

  it('accepts explicit scanParams and a disable toggle; rejects invalid scheduler patches', async () => {
    const { app } = harness();
    const withParams = await request(app)
      .patch('/api/ops/settings')
      .send({ scheduler: { enabled: true, scanParams: { regionTab: 'ca_us', topN: 3 } } });
    expect(withParams.status).toBe(200);
    expect(withParams.body.scheduler.scanParams).toEqual({ regionTab: 'ca_us', topN: 3 });

    const off = await request(app).patch('/api/ops/settings').send({ scheduler: { enabled: false } });
    expect(off.body.scheduler.enabled).toBe(false);

    for (const body of [
      { scheduler: { enabled: 'yes' } },
      { scheduler: { scanParams: { regionTab: 'nope', topN: 3 } } },
      { scheduler: { scanParams: { regionTab: 'ca', topN: 99 } } },
      { scheduler: {} },
      { scheduler: [] },
    ]) {
      const bad = await request(app).patch('/api/ops/settings').send(body);
      expect(bad.status).toBe(400);
    }
  });

  it('cost estimate reflects market toggles: OFF = today, each toggle multiplies', async () => {
    const { app, store } = harness();
    const off = await request(app).get('/api/ops/cost-estimate?regionTab=ca&topN=5');
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ marketCount: 1, regionEquivalents: 2, creditsPerScan: 10 });

    store.data.markets = { totals: true, spreads: true };
    const on = await request(app).get('/api/ops/cost-estimate?regionTab=ca&topN=5');
    expect(on.body).toMatchObject({ marketCount: 3, creditsPerScan: 30 });
  });

  it('cost estimate models the conditional pair: ASSUMED 30% before 50 samples, the plain number kept', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/ops/cost-estimate?regionTab=ca&topN=5');
    expect(res.status).toBe(200);
    expect(res.body.creditsPerScan).toBe(10); // the plain per-scan number stays visible
    expect(res.body.confirmation).toEqual({
      intervalSecs: 60,
      hitRate: 0.3,
      hitRateSource: 'assumed',
      samples: 0,
      creditsPerPairWindow: 13, // 10 × (1 + 0.30)
    });
  });

  it('cost estimate MEASURES the hit rate from the last 14 days once ≥50 logged scans carry candidates', async () => {
    const line = (daysAgo: number, candidates?: number): ScanLogEntry => ({
      scannedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
      regionTab: 'ca',
      sportsScanned: ['basketball_nba'],
      creditsComputed: 10,
      requestsUsedTotal: null,
      distinctBooks: [],
      eventCount: 1,
      ...(candidates != null && { confirmationCandidates: candidates }),
    });
    const scans: ScanLogEntry[] = [
      ...Array.from({ length: 15 }, (_, i) => line(i % 10, 1)), // 15 hits
      ...Array.from({ length: 45 }, (_, i) => line(i % 10, 0)), // 45 misses
      ...Array.from({ length: 30 }, () => line(2)), // pre-Phase-16 lines: excluded
      ...Array.from({ length: 30 }, () => line(20, 1)), // outside 14 days: excluded
    ];
    const { app } = harness(scans);
    const res = await request(app).get('/api/ops/cost-estimate?regionTab=ca&topN=5');
    expect(res.body.confirmation).toEqual({
      intervalSecs: 60,
      hitRate: 0.25, // 15 / 60
      hitRateSource: 'measured',
      samples: 60,
      creditsPerPairWindow: 12.5, // 10 × 1.25
    });
  });

  it('cost estimate hit rate stays ASSUMED at 49 in-window samples (the ≥50 boundary)', async () => {
    const line = (candidates: number): ScanLogEntry => ({
      scannedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      regionTab: 'ca',
      sportsScanned: ['basketball_nba'],
      creditsComputed: 10,
      requestsUsedTotal: null,
      distinctBooks: [],
      eventCount: 1,
      confirmationCandidates: candidates,
    });
    const { app } = harness(Array.from({ length: 49 }, (_, i) => line(i % 2)));
    const res = await request(app).get('/api/ops/cost-estimate?regionTab=ca&topN=5');
    expect(res.body.confirmation).toMatchObject({
      hitRate: 0.3,
      hitRateSource: 'assumed',
      samples: 49,
    });
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

  it('GET /scans returns scans newest-first with drill-down opportunities and gap indicators', async () => {
    const { app } = harness([
      {
        scannedAt: '2026-07-19T10:00:00Z',
        regionTab: 'ca',
        sportsScanned: ['basketball_nba'],
        creditsComputed: 10,
        requestsUsedTotal: 11_000,
        distinctBooks: ['bet365'],
        eventCount: 3,
      },
      {
        scannedAt: '2026-07-19T10:05:00Z',
        regionTab: 'ca',
        sportsScanned: ['basketball_nba'],
        creditsComputed: 10,
        requestsUsedTotal: 11_010,
        distinctBooks: ['bet365'],
        eventCount: 3,
      },
    ]);
    const res = await request(app).get('/api/ops/scans?lastN=1');
    expect(res.status).toBe(200);
    expect(res.body.scans).toHaveLength(1);
    expect(res.body.scans[0].scannedAt).toBe('2026-07-19T10:05:00Z');
    expect(res.body.scans[0]).toHaveProperty('opportunities');
    expect(res.body.scans[0]).toHaveProperty('counts');
    expect(res.body.scans[0]).toHaveProperty('gapBefore');

    const full = await request(app).get('/api/ops/scans');
    expect(full.body.scans).toHaveLength(2);
    expect(full.body.scans.map((s: { scannedAt: string }) => s.scannedAt)).toEqual([
      '2026-07-19T10:05:00Z',
      '2026-07-19T10:00:00Z',
    ]);
  });

  it('GET /leaderboard passes the store report straight through', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/ops/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ createdAt: '2026-07-01T00:00:00Z', totalScans: 0, books: [] });
  });
});
