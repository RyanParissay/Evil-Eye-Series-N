import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import { ProviderError } from '../providers/OddsProvider';
import { apiErrorHandler } from './api';
import { createOpportunitiesRouter, type VerifyRunner } from './opportunities';

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
  async append(_records: OpportunityRecord[]): Promise<void> {}
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

async function appWithOneRecord(verify: VerifyRunner = unusedVerify) {
  const service = new OpportunityService(new FakeStore(), new FakeArchive(), () => NOW);
  await service.recordScan([makeArb()], SCOPE);
  const [record] = await service.list();
  const app = express();
  app.use(express.json());
  app.use('/api/opportunities', createOpportunitiesRouter(service, verify));
  app.use(apiErrorHandler);
  return { app, service, record };
}

const unusedVerify: VerifyRunner = async () => {
  throw new Error('verify not expected in this test');
};

describe('opportunities routes', () => {
  it('GET /:id returns the record', async () => {
    const { app, record } = await appWithOneRecord();
    const res = await request(app).get(`/api/opportunities/${record.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: record.id, eventName: 'Lakers @ Celtics' });
  });

  it('GET /:id distinguishes a stale link with code not_found', async () => {
    const { app } = await appWithOneRecord();
    const res = await request(app).get('/api/opportunities/deadbeefdeadbeef');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('PATCH /:id completes a record', async () => {
    const { app, record } = await appWithOneRecord();
    const res = await request(app)
      .patch(`/api/opportunities/${record.id}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: record.id, status: 'completed' });
  });

  it('PATCH /:id rejects statuses the cockpit does not own', async () => {
    const { app, record } = await appWithOneRecord();
    for (const status of ['active', 'dead', 'wat', undefined]) {
      const res = await request(app).patch(`/api/opportunities/${record.id}`).send({ status });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });

  it('PATCH /:id maps unknown ids to 404 not_found', async () => {
    const { app } = await appWithOneRecord();
    const res = await request(app)
      .patch('/api/opportunities/deadbeefdeadbeef')
      .send({ status: 'completed' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('POST /:id/verify returns the runner outcome', async () => {
    const { app, record } = await appWithOneRecord(async (id) => ({
      ok: true,
      record: { ...record, id, status: 'degraded' },
      legOdds: [2.05, 2.02],
      creditsCharged: 1,
    }));
    const res = await request(app).post(`/api/opportunities/${record.id}/verify`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      record: { id: record.id, status: 'degraded' },
      legOdds: [2.05, 2.02],
      creditsCharged: 1,
    });
  });

  it('POST /:id/verify maps not_found and conflict', async () => {
    const notFound = await appWithOneRecord(async (id) => ({
      ok: false,
      reason: 'not_found',
      message: `Unknown opportunity: ${id}`,
    }));
    const res404 = await request(notFound.app).post('/api/opportunities/nope/verify');
    expect(res404.status).toBe(404);
    expect(res404.body.error.code).toBe('not_found');

    const conflict = await appWithOneRecord(async () => ({
      ok: false,
      reason: 'conflict',
      message: 'Cannot verify a completed opportunity',
    }));
    const res409 = await request(conflict.app).post('/api/opportunities/x/verify');
    expect(res409.status).toBe(409);
    expect(res409.body.error.code).toBe('conflict');
  });

  it('POST /:id/verify maps provider failures like a scan does', async () => {
    const { app, record } = await appWithOneRecord(async () => {
      throw new ProviderError('quota', 'quota_exhausted', 401);
    });
    const res = await request(app).post(`/api/opportunities/${record.id}/verify`);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('quota_exhausted');
  });

  it('PATCH /:id completes with filled legs and returns the booked execution', async () => {
    const { app, record } = await appWithOneRecord();
    const res = await request(app)
      .patch(`/api/opportunities/${record.id}`)
      .send({
        status: 'completed',
        filledLegs: [
          { odds: 2.1, stake: 243.9 },
          { odds: 2.05, stake: 256.1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.execution).toMatchObject({ totalStaked: 500 });
    expect(res.body.execution.lockedProfit).toBeCloseTo(243.9 * 2.1 - 500, 2);
  });

  it('PATCH /:id rejects malformed filled legs with 400', async () => {
    const { app, record } = await appWithOneRecord();
    for (const filledLegs of [
      [{ odds: 0.9, stake: 100 }, { odds: 2, stake: 100 }], // odds must exceed 1
      [{ odds: 2, stake: -5 }, { odds: 2, stake: 100 }], // no negative stakes
      [{ odds: 2, stake: 100 }], // must align with record legs
      'nope',
    ]) {
      const res = await request(app)
        .patch(`/api/opportunities/${record.id}`)
        .send({ status: 'completed', filledLegs });
      expect(res.status).toBe(400);
    }
  });

  it('PATCH /:id maps an invalid transition to 409 conflict', async () => {
    const { app, service, record } = await appWithOneRecord();
    await service.recordScan([], SCOPE); // sport rescanned, fingerprint gone → dead
    const res = await request(app)
      .patch(`/api/opportunities/${record.id}`)
      .send({ status: 'degraded' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });
});
