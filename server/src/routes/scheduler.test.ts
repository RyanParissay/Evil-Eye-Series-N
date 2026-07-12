import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { OpportunityRecord, OpsSettings, ScanLogEntry } from '@shared/types';
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

function harness(
  scans: ScanLogEntry[] = [],
  opsOver: Partial<OpsSettings> = {},
  now: Date = NOW,
  records: OpportunityRecord[] = [],
) {
  const store = new MemOpsStore({ ...DEFAULT_OPS_SETTINGS, ...opsOver });
  let woke = 0;
  const deps: SchedulerRouterDeps = {
    settings: store,
    scanHistory: {
      entries: async function* () {
        for (const s of scans) yield s;
      },
    },
    records: async () => records,
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

/** A confirmed arb record detected at a Vancouver-local (date, hour). */
function confirmedRec(date: [number, number, number], hour: number): OpportunityRecord {
  const at = new Date(vancouverEpochOf(date[0], date[1], date[2], hour * 60)).toISOString();
  return {
    id: `${date.join('')}-${hour}`,
    fingerprint: `${date.join('')}-${hour}`,
    strategy: 'arb',
    eventId: 'e',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: at,
    marketKey: 'h2h',
    legs: [],
    profitPctAtDetection: 3,
    profitPct: 3,
    arbIndex: 0.97,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca_us',
    detectedAt: at,
    lastSeenAt: at,
    statusChangedAt: at,
    alerted: false,
    alertedAt: null,
    confirmation: { status: 'confirmed', scanAAt: at, scanBAt: at, edgeDeltaPp: 0 },
  };
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

/** 8 days of scan history (Jan 8 → Jan 15). */
const WEEK_HISTORY: ScanLogEntry[] = Array.from({ length: 8 }, (_, i) =>
  line(vancouverEpochOf(2026, 1, 8 + i, 12 * 60), 10),
);

describe('/api/scheduler/proposal', () => {
  it('409s with a clear message when there are fewer than 7 days of history', async () => {
    const short = Array.from({ length: 3 }, (_, i) => line(vancouverEpochOf(2026, 1, 13 + i, 12 * 60), 10));
    const h = harness(short);
    const res = await request(h.app).get('/api/scheduler/proposal');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.message).toMatch(/7 days/);
  });

  it('GET returns a MODEL proposal with density, blocks, and projected ≤ ceiling', async () => {
    const records = [confirmedRec([2026, 1, 15], 15), confirmedRec([2026, 1, 15], 15)];
    const h = harness(WEEK_HISTORY, {}, NOW, records);
    const res = await request(h.app).get('/api/scheduler/proposal');
    expect(res.status).toBe(200);
    expect(res.body.model).toBe(true);
    expect(res.body.density).toEqual([{ day: 4, hour: 15, arb: 2, ev: 0, middle: 0 }]);
    expect(res.body.blocks.length).toBeGreaterThan(0);
    expect(res.body.projectedMonthlyCredits).toBeLessThanOrEqual(res.body.spendCeiling);
    expect(res.body.spendCeiling).toBe(18_000);
  });

  it('POST /proposal/apply writes blocks + stamps proposalAppliedAt + wakes; GET alone never writes', async () => {
    const h = harness(WEEK_HISTORY);
    // A read never mutates blocks.
    const before = [...h.store.data.scheduler.blocks];
    await request(h.app).get('/api/scheduler/proposal');
    expect(h.store.data.scheduler.blocks).toEqual(before);
    expect(h.store.data.scheduler.proposalAppliedAt).toBeNull();
    expect(h.woke()).toBe(0);

    const blocks = [{ days: [1, 3, 5], startMin: 8 * 60, endMin: 14 * 60, intervalMins: 20 }];
    const res = await request(h.app).post('/api/scheduler/proposal/apply').send({ blocks });
    expect(res.status).toBe(200);
    expect(res.body.scheduler.blocks).toEqual(blocks);
    expect(h.store.data.scheduler.blocks).toEqual(blocks);
    expect(h.store.data.scheduler.proposalAppliedAt).toBe(NOW.toISOString());
    expect(h.woke()).toBe(1);
  });

  it('POST /proposal/apply rejects malformed blocks (400)', async () => {
    const h = harness(WEEK_HISTORY);
    for (const blocks of [
      undefined,
      [],
      [{ days: [], startMin: 0, endMin: 60, intervalMins: 10 }],
      [{ days: [7], startMin: 0, endMin: 60, intervalMins: 10 }],
      [{ days: [1], startMin: 60, endMin: 60, intervalMins: 10 }],
      [{ days: [1], startMin: 0, endMin: 60, intervalMins: 0 }],
    ]) {
      const res = await request(h.app).post('/api/scheduler/proposal/apply').send({ blocks });
      expect(res.status).toBe(400);
    }
    // Nothing was written.
    expect(h.store.data.scheduler.proposalAppliedAt).toBeNull();
  });
});
