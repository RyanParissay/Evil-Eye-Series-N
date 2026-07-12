import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubLeaderboards } from '@shared/types';
import { HubService } from '../hub/hubService';
import { HubProfileStore } from '../hub/profileStore';
import { apiErrorHandler } from './api';
import { createHubRouter } from './hub';

const EMPTY_BOARDS: HubLeaderboards = { sinceAt: '2026-07-20T00:00:00Z', arb: [], ev: [], middle: [] };

describe('hub routes', () => {
  let dir: string;

  function app(boards: HubLeaderboards = EMPTY_BOARDS) {
    const hub = new HubService({ store: new HubProfileStore(join(dir, 'hub.json')), records: async () => [] });
    const a = express();
    a.use(express.json());
    a.use('/api/hub', createHubRouter({ hub, leaderboards: async () => boards }));
    a.use(apiErrorHandler);
    return a;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-routes-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('GET /api/hub returns all profile reports, each simulated', async () => {
    const res = await request(app()).get('/api/hub');
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(3);
    expect(res.body.reports.every((r: { simulated: boolean }) => r.simulated === true)).toBe(true);
  });

  it('POST /api/hub/profiles creates a custom profile (201)', async () => {
    const res = await request(app())
      .post('/api/hub/profiles')
      .send({ name: 'Mine', startingBankroll: 500, stake: { type: 'flat', value: 25 }, strategies: ['arb'], minEdgePct: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Mine', premade: false, startingBankroll: 500 });
    expect(res.body.id).toMatch(/^custom-/);
  });

  it('POST with a bad body is 400 bad_request', async () => {
    const res = await request(app())
      .post('/api/hub/profiles')
      .send({ name: '', startingBankroll: -1, stake: { type: 'flat', value: 25 }, strategies: [], minEdgePct: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('PATCH edits a premade profile (stake/filters editable)', async () => {
    const a = app();
    const list = await request(a).get('/api/hub');
    const arbId = list.body.reports.find((r: { profile: { name: string } }) => r.profile.name === 'Arb').profile.id;
    const res = await request(a).patch(`/api/hub/profiles/${arbId}`).send({ minEdgePct: 2, stake: { type: 'pctOfStart', value: 3 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: arbId, premade: true, minEdgePct: 2, stake: { type: 'pctOfStart', value: 3 } });
  });

  it('PATCH of an unknown profile is 404 not_found', async () => {
    const res = await request(app()).patch('/api/hub/profiles/nope').send({ minEdgePct: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('DELETE of a premade is 409 conflict', async () => {
    const a = app();
    const list = await request(a).get('/api/hub');
    const arbId = list.body.reports.find((r: { profile: { name: string } }) => r.profile.name === 'Arb').profile.id;
    const res = await request(a).delete(`/api/hub/profiles/${arbId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('DELETE of a custom profile is 204; unknown is 404', async () => {
    const a = app();
    const created = await request(a)
      .post('/api/hub/profiles')
      .send({ name: 'Temp', startingBankroll: 500, stake: { type: 'flat', value: 25 }, strategies: ['arb'], minEdgePct: 0 });
    const del = await request(a).delete(`/api/hub/profiles/${created.body.id}`);
    expect(del.status).toBe(204);
    expect((await request(a).delete('/api/hub/profiles/nope')).status).toBe(404);
  });

  it('GET /api/hub/leaderboards returns the three boards', async () => {
    const boards: HubLeaderboards = {
      sinceAt: '2026-07-20T00:00:00Z',
      arb: [{ bookmakerKey: 'bet365', title: 'Bet365', count: 3, occurrencePct: 75 }],
      ev: [],
      middle: [],
    };
    const res = await request(app(boards)).get('/api/hub/leaderboards');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(boards);
  });
});
