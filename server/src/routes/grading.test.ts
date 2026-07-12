/**
 * Route smoke tests: request validation and the happy paths through a real
 * Express app with hand-rolled structural deps (no live provider, ever).
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { OpportunityRecord, ScanLogEntry } from '@shared/types';
import { DEFAULT_OPS_SETTINGS } from '../ops/opsStore';
import { apiErrorHandler } from './api';
import { createGradingRouter, type GradingRouterDeps } from './grading';

const NOW = new Date('2026-07-20T12:00:00Z');

function harness(overrides: Partial<GradingRouterDeps> = {}) {
  const gradingData = { daily: { date: '', credits: 0 }, events: {} };
  const deps: GradingRouterDeps = {
    service: {
      poll: async () => ({ graded: 1, polled: 2, capped: false }),
      manualGrade: async (id) =>
        id === 'nope'
          ? { ok: false, reason: 'not_found', message: 'Unknown opportunity: nope' }
          : { ok: true, record: { id } as OpportunityRecord },
    },
    records: async () => [],
    gradingStore: {
      read: async () => gradingData,
    },
    scanHistory: {
      entries: async function* (): AsyncGenerator<ScanLogEntry> {},
    },
    opsSettings: { read: async () => DEFAULT_OPS_SETTINGS },
    now: () => NOW,
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/grading', createGradingRouter(deps));
  app.use(apiErrorHandler);
  return { app };
}

describe('/api/grading', () => {
  it('POST /poll runs the service and reports today\'s spend + cap', async () => {
    const { app } = harness();
    const res = await request(app).post('/api/grading/poll');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ graded: 1, polled: 2, capped: false, cap: 500 });
  });

  it('GET /status reports buckets, spend, cap, and gaps', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/grading/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      buckets: { graded: 0, open: 0, needsRules: 0, stale: 0, preV13: 0 },
      scoresSpendToday: 0,
      cap: 500,
      capped: false,
      gaps: [],
    });
  });

  it('POST /manual-grade validates the body', async () => {
    const { app } = harness();
    const missingId = await request(app).post('/api/grading/manual-grade').send({ result: 'win' });
    expect(missingId.status).toBe(400);

    const badResult = await request(app).post('/api/grading/manual-grade').send({ id: 'x', result: 'whatever' });
    expect(badResult.status).toBe(400);

    const badNote = await request(app)
      .post('/api/grading/manual-grade')
      .send({ id: 'x', result: 'win', note: 42 });
    expect(badNote.status).toBe(400);
  });

  it('POST /manual-grade succeeds and maps not_found to 404', async () => {
    const { app } = harness();
    const ok = await request(app).post('/api/grading/manual-grade').send({ id: 'abc', result: 'win' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'abc' });

    const missing = await request(app).post('/api/grading/manual-grade').send({ id: 'nope', result: 'win' });
    expect(missing.status).toBe(404);
  });

  it('GET /export.csv streams graded records as Excel-safe CSV', async () => {
    const record: OpportunityRecord = {
      id: 'graded1',
      fingerprint: 'f'.repeat(64),
      strategy: 'arb',
      eventId: 'evt-1',
      sportKey: 'basketball_nba',
      sportTitle: 'NBA',
      eventName: 'Boston Celtics @ Los Angeles Lakers',
      commenceTime: '2026-07-11T19:00:00Z',
      marketKey: 'h2h',
      legs: [],
      profitPctAtDetection: 5,
      profitPct: 5,
      arbIndex: 1,
      status: 'completed',
      suspicious: false,
      sameBookmaker: false,
      regionTab: 'ca',
      detectedAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      statusChangedAt: NOW.toISOString(),
      alerted: false,
      alertedAt: null,
      grading: {
        result: 'win',
        legResults: ['win'],
        pnlPer100: 12.5,
        flags: [],
        gradedAt: '2026-07-11T20:00:00Z',
        source: 'auto',
        audit: [],
      },
    };
    const { app } = harness({ records: async () => [record] });
    const res = await request(app).get('/api/grading/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toBe(
      'id,strategy,sport,event,commence,result,pnl_per_100,source,flags,graded_at',
    );
    expect(res.text).toContain('"graded1","arb","NBA"');
  });
});
