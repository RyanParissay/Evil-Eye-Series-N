import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { OpsSettings, ScanLogEntry } from '@shared/types';
import { DENSE_WEEK_DAY_CAP } from '../config/constants';
import { DEFAULT_OPS_SETTINGS } from '../ops/opsStore';
import { vancouverEpochOf } from '../scheduler/vancouverTime';
import { apiErrorHandler } from './api';
import { createSchedulerRouter, type SchedulerRouterDeps } from './scheduler';

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

/** 15:00 PST, Thu Jan 15 2026 — outside quiet hours, deterministic. */
const NOW = new Date(vancouverEpochOf(2026, 1, 15, 15 * 60));

function line(atMs: number, credits: number): ScanLogEntry {
  return {
    scannedAt: new Date(atMs).toISOString(),
    regionTab: 'ca_us',
    sportsScanned: ['basketball_nba'],
    creditsComputed: credits,
    requestsUsedTotal: null,
    distinctBooks: [],
    eventCount: 1,
  };
}

function harness(scans: ScanLogEntry[] = [], opsOver: Partial<OpsSettings> = {}, now: Date = NOW) {
  const store = new MemOpsStore({ ...DEFAULT_OPS_SETTINGS, ...opsOver });
  let woke = 0;
  const deps: SchedulerRouterDeps = {
    settings: store,
    scanHistory: {
      entries: async function* () {
        for (const s of scans) yield s;
      },
    },
    onSchedulerChange: () => {
      woke += 1;
    },
    now: () => now,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/scheduler', createSchedulerRouter(deps));
  app.use(apiErrorHandler);
  return { app, store, woke: () => woke };
}

describe('/api/scheduler/dense-week', () => {
  it('GET returns inactive when no dense week is running', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/scheduler/dense-week');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(res.body.startedAt).toBeNull();
    expect(res.body.dayCap).toBe(DENSE_WEEK_DAY_CAP);
  });

  it('POST starts a dense week, stamps startedAt = now, and wakes the scheduler', async () => {
    const h = harness();
    const res = await request(h.app).post('/api/scheduler/dense-week');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.dayNumber).toBe(1);
    expect(res.body.startedAt).toBe(NOW.toISOString());
    expect(h.store.data.scheduler.denseWeek).toEqual({ startedAt: NOW.toISOString() });
    expect(h.woke()).toBe(1);
  });

  it('POST 409s when a dense week is already active', async () => {
    const h = harness([], {
      scheduler: { ...DEFAULT_OPS_SETTINGS.scheduler, denseWeek: { startedAt: NOW.toISOString() } },
    });
    const res = await request(h.app).post('/api/scheduler/dense-week');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('DELETE cancels an active dense week and wakes the scheduler', async () => {
    const h = harness([], {
      scheduler: { ...DEFAULT_OPS_SETTINGS.scheduler, denseWeek: { startedAt: NOW.toISOString() } },
    });
    const res = await request(h.app).delete('/api/scheduler/dense-week');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(h.store.data.scheduler.denseWeek).toBeNull();
    expect(h.woke()).toBe(1);
  });

  it('GET reports day/week spend from scan history and the cap banner', async () => {
    const startedAt = vancouverEpochOf(2026, 1, 15, 8 * 60); // 08:00 same day
    const scans = [
      line(vancouverEpochOf(2026, 1, 15, 9 * 60), DENSE_WEEK_DAY_CAP), // today, hits the day cap
    ];
    const h = harness(scans, {
      scheduler: {
        ...DEFAULT_OPS_SETTINGS.scheduler,
        denseWeek: { startedAt: new Date(startedAt).toISOString() },
      },
    });
    const res = await request(h.app).get('/api/scheduler/dense-week');
    expect(res.body.active).toBe(true);
    expect(res.body.dayCreditsUsed).toBe(DENSE_WEEK_DAY_CAP);
    expect(res.body.weekCreditsUsed).toBe(DENSE_WEEK_DAY_CAP);
    expect(res.body.stopped.scope).toBe('day');
  });

  it('GET lazily clears an expired dense week and reports inactive', async () => {
    const startedAt = NOW.getTime() - 8 * 86_400_000; // 8 days ago → expired
    const h = harness([], {
      scheduler: {
        ...DEFAULT_OPS_SETTINGS.scheduler,
        denseWeek: { startedAt: new Date(startedAt).toISOString() },
      },
    });
    const res = await request(h.app).get('/api/scheduler/dense-week');
    expect(res.body.active).toBe(false);
    expect(h.store.data.scheduler.denseWeek).toBeNull();
  });
});
