import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { vancouverEpochOf } from '../scheduler/vancouverTime';
import { quietHoursGuard } from './quietHoursGuard';

/** Mounts the guard the way index.ts does: in front of a provider-spending
 *  POST that otherwise 200s. */
function app(nowMs: number) {
  const a = express();
  a.use(express.json());
  a.post('/api/scan', quietHoursGuard(() => new Date(nowMs)), (_req, res) => {
    res.json({ ran: true });
  });
  return a;
}

describe('quietHoursGuard', () => {
  it('blocks with 503 quiet_hours at 03:00 America/Vancouver', async () => {
    const res = await request(app(vancouverEpochOf(2026, 1, 15, 3 * 60))).post('/api/scan');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('quiet_hours');
    expect(res.body.error.message).toMatch(/08:00/);
  });

  it('blocks at 01:00 (inclusive) but not 08:00 (exclusive)', async () => {
    const at0100 = await request(app(vancouverEpochOf(2026, 1, 15, 1 * 60))).post('/api/scan');
    expect(at0100.status).toBe(503);
    const at0800 = await request(app(vancouverEpochOf(2026, 1, 15, 8 * 60))).post('/api/scan');
    expect(at0800.status).toBe(200);
    expect(at0800.body).toEqual({ ran: true });
  });

  it('passes through in daytime (14:00), PST and PDT alike', async () => {
    const pst = await request(app(vancouverEpochOf(2026, 1, 15, 14 * 60))).post('/api/scan');
    expect(pst.status).toBe(200);
    const pdt = await request(app(vancouverEpochOf(2026, 7, 15, 14 * 60))).post('/api/scan');
    expect(pdt.status).toBe(200);
  });
});
