/**
 * GET /api/clv/summary — the HTTP boundary. It streams the ClvSummary the pure
 * aggregator produces (asserted exhaustively in clv/clvSummary.test.ts); here
 * we only pin the wiring: records + live safety settings in, JSON out, errors
 * mapped by the shared handler.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { OpportunityRecord, SafetySettings } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import { apiErrorHandler } from './api';
import { createClvRouter } from './clv';

function app(records: () => Promise<OpportunityRecord[]>, safety?: () => Promise<SafetySettings>) {
  const server = express();
  server.use(express.json());
  server.use(
    '/api/clv',
    createClvRouter({
      records,
      safetySettings: safety ?? (async () => structuredClone(DEFAULT_SAFETY_SETTINGS)),
      now: () => new Date('2026-07-13T12:00:00Z'),
    }),
  );
  server.use(apiErrorHandler);
  return server;
}

function alertedRecord(): OpportunityRecord {
  return {
    id: 'R1',
    fingerprint: 'fp-R1',
    strategy: 'arb',
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-13T11:00:00Z',
    marketKey: 'h2h',
    legs: [
      { outcome: 'Celtics', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 50, link: null },
      { outcome: 'Lakers', bookmakerKey: 'coolbet', bookmakerTitle: 'Coolbet', odds: 2.1, stake: 50, link: null },
    ],
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.95,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-13T09:00:00Z',
    lastSeenAt: '2026-07-13T10:00:00Z',
    statusChangedAt: '2026-07-13T09:00:00Z',
    alerted: true,
    alertedAt: '2026-07-13T10:00:00Z',
    confirmation: { status: 'confirmed', scanAAt: '2026-07-13T09:00:00Z', confirmedLegOdds: [2.1, 2.1] },
    closing: { legOdds: [2.0, 2.0], capturedAt: '2026-07-13T10:30:00Z', minutesToCommence: 30 },
  };
}

describe('GET /api/clv/summary', () => {
  it('returns the ClvSummary with coverage + an alerted signal cell', async () => {
    const res = await request(app(async () => [alertedRecord()])).get('/api/clv/summary');
    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({ recordsWithClosing: 1, recordsTotal: 1, medianCaptureMins: 30 });
    expect(res.body.signal).toEqual([
      {
        strategy: 'arb',
        gateOutcome: 'alerted',
        cell: { records: 1, meanClvPct: 5, medianClvPct: 5, beatClosePct: 1 },
      },
    ]);
    expect(res.body.execution).toEqual([]);
    expect(res.body.byBook).toHaveLength(2);
  });

  it('an empty record set is a valid empty summary, not an error', async () => {
    const res = await request(app(async () => [])).get('/api/clv/summary');
    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({ recordsWithClosing: 0, recordsTotal: 0, medianCaptureMins: null });
  });

  it('a records-source failure maps through the shared error handler (500)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(
      app(async () => {
        throw new Error('archive read failed');
      }),
    ).get('/api/clv/summary');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
  });
});
