import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { PaperData } from '@shared/types';
import { PaperService } from '../paper/paperService';
import type { PaperDataStore } from '../paper/paperStore';
import { apiErrorHandler } from './api';
import { createPaperRouter } from './paper';

const NOW = new Date('2026-07-10T12:00:00Z');

class MemStore implements PaperDataStore {
  constructor(public data: PaperData) {}
  async read(): Promise<PaperData> {
    return this.data;
  }
  async update<T>(
    mutate: (data: PaperData) => { data: PaperData; result: T } | Promise<{ data: PaperData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function app() {
  const store = new MemStore({
    settings: {
      enabled: false,
      startingBankroll: 5000,
      stakeRule: { kind: 'flat', value: 400 },
      haircutPercent: 20,
      haircutSource: 'manual',
      thresholdPercent: 2,
    },
    entries: [],
  });
  const service = new PaperService(store, () => NOW);
  const a = express();
  a.use(express.json());
  a.use('/api/paper', createPaperRouter(service));
  a.use(apiErrorHandler);
  return { a, store };
}

describe('/api/paper', () => {
  it('GET carries the simulated label and the settled book', async () => {
    const { a } = app();
    const res = await request(a).get('/api/paper');
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.settings.enabled).toBe(false);
    expect(res.body.book.entries).toEqual([]);
  });

  it('PATCH /settings validates and applies partial updates', async () => {
    const { a } = app();
    const good = await request(a)
      .patch('/api/paper/settings')
      .send({ enabled: true, stakeRule: { kind: 'percent', value: 8 }, haircutPercent: 25 });
    expect(good.status).toBe(200);
    expect(good.body.settings).toMatchObject({
      enabled: true,
      stakeRule: { kind: 'percent', value: 8 },
      haircutPercent: 25,
    });

    for (const body of [
      { startingBankroll: -5 },
      { stakeRule: { kind: 'flat', value: 0 } },
      { stakeRule: { kind: 'percent', value: 150 } },
      { haircutPercent: 101 },
      { thresholdPercent: -1 },
      { enabled: 'yes' },
    ]) {
      const bad = await request(a).patch('/api/paper/settings').send(body);
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('bad_request');
    }
  });

  it('POST /reset zeroes the entries', async () => {
    const { a, store } = app();
    store.data.entries.push({
      id: 'x',
      fingerprint: 'f'.repeat(64),
      eventId: 'evt',
      eventName: 'A @ B',
      sportKey: 's',
      sportTitle: 'S',
      marketKey: 'h2h',
      profitPct: 2,
      arbIndex: 0.98,
      legs: [],
      enteredAt: NOW.toISOString(),
      commenceTime: NOW.toISOString(),
    });
    const res = await request(a).post('/api/paper/reset');
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(store.data.entries).toEqual([]);
  });
});
