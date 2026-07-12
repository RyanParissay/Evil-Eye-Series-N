import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { GradeResult, OpportunityRecord, OpsSettings, RecordGrading } from '@shared/types';
import { apiErrorHandler } from './api';
import { createPortfolioRouter, type PortfolioRouterDeps } from './portfolios';

const OPS_SETTINGS: OpsSettings = {
  weekday: { startMinutes: 0, endMinutes: 1440 },
  weekend: { startMinutes: 0, endMinutes: 1440 },
  inWindowMins: 5,
  outWindowMins: null,
  monthlyCreditBudget: 20_000,
  autoStopPct: 95,
  markets: { totals: false, spreads: false },
  confirmSecondSighting: false,
};

function grading(result: GradeResult, pnlPer100: number): RecordGrading {
  return {
    result,
    legResults: [result],
    pnlPer100,
    flags: [],
    gradedAt: '2026-01-02T00:00:00Z',
    source: 'auto',
    audit: [{ at: '2026-01-02T00:00:00Z', old: null, next: result }],
  };
}

function baseRecord(overrides: Partial<OpportunityRecord> & { id: string }): OpportunityRecord {
  return {
    fingerprint: overrides.id.padEnd(64, '0'),
    strategy: 'arb',
    eventId: `evt-${overrides.id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Away @ Home',
    commenceTime: '2026-01-01T00:00:00Z',
    marketKey: 'h2h',
    legs: [{ outcome: 'Home', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2, stake: 100, link: null }],
    profitPctAtDetection: 0,
    profitPct: 0,
    arbIndex: 1,
    status: 'completed',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    statusChangedAt: '2026-01-01T00:00:00Z',
    alerted: false,
    alertedAt: null,
    schemaVersion: 2,
    ...overrides,
  };
}

/** 30 graded records for one series, 2/day across 15 days (span = 14 days
 *  exactly) — just enough to clear both optimizer gates. */
function seedSeries(strategy: 'arb' | 'ev' | 'middle', idPrefix: string): OpportunityRecord[] {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const records: OpportunityRecord[] = [];
  for (let i = 0; i < 30; i++) {
    const dayOffset = Math.floor(i / 2);
    const detectedAt = new Date(start + dayOffset * 86_400_000 + (i % 2) * 3_600_000).toISOString();
    const result: GradeResult = i % 2 === 0 ? 'win' : 'loss';
    const pnlPer100 = result === 'win' ? 5 : -3;
    records.push(
      baseRecord({
        id: `${idPrefix}${i.toString().padStart(14, '0')}`,
        strategy,
        detectedAt,
        profitPctAtDetection: strategy === 'arb' ? 2 : 0,
        ...(strategy === 'ev' && {
          ev: {
            benchmarkKey: 'pinnacle',
            benchmarkOdds: 2,
            fairProbability: 0.5,
            edgePct: 5,
            benchmarkLastUpdate: detectedAt,
          },
        }),
        ...(strategy === 'middle' && {
          middle: {
            lowLine: 219.5,
            highLine: 220.5,
            windowSize: 1,
            costPct: -1,
            payoutPct: 1,
            breakevenPct: -1,
            freeMiddle: true,
            pushPossible: false,
            keyNumbers: [],
          },
        }),
        grading: grading(result, pnlPer100),
      }),
    );
  }
  return records;
}

const GATE_CLEARING_RECORDS = [...seedSeries('arb', 'a'), ...seedSeries('ev', 'e'), ...seedSeries('middle', 'm')];

function harness(records: OpportunityRecord[] = [], overrides: Partial<PortfolioRouterDeps> = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/portfolios',
    createPortfolioRouter({
      records: async () => records,
      scanHistory: { entries: async function* () {} },
      opsSettings: { read: async () => OPS_SETTINGS },
      now: () => new Date('2026-02-01T00:00:00Z'),
      ...overrides,
    }),
  );
  app.use(apiErrorHandler);
  return app;
}

describe('GET /api/portfolios', () => {
  it('returns 13 series, the gap list, and optimizer gates', async () => {
    const res = await request(harness([])).get('/api/portfolios');
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(13);
    expect(res.body.gaps).toEqual([]);
    expect(res.body.optimizerGates).toMatchObject({
      arb: { records: { have: 0, need: 30 }, days: { have: 0, need: 14 }, met: false },
      ev: { records: { have: 0, need: 30 }, days: { have: 0, need: 14 }, met: false },
      middle: { records: { have: 0, need: 30 }, days: { have: 0, need: 14 }, met: false },
      met: false,
    });
  });

  it('reports gates met once every representative series clears 30 records / 14 days', async () => {
    const res = await request(harness(GATE_CLEARING_RECORDS)).get('/api/portfolios');
    expect(res.status).toBe(200);
    expect(res.body.optimizerGates.arb.records.have).toBe(30);
    expect(res.body.optimizerGates.arb.days.have).toBeGreaterThanOrEqual(14);
    expect(res.body.optimizerGates.met).toBe(true);
  });
});

describe('POST /api/portfolios/optimize', () => {
  it('400s when the gates are not met', async () => {
    const res = await request(harness([])).post('/api/portfolios/optimize').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('runs the grid-search optimizer once gates are met, labeled model: true', async () => {
    const res = await request(harness(GATE_CLEARING_RECORDS)).post('/api/portfolios/optimize').send({});
    expect(res.status).toBe(200);
    expect(res.body.model).toBe(true);
    expect(res.body.weights).toHaveLength(3);
    const sum = res.body.weights.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const w of res.body.weights) {
      expect(w).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });

  it('evaluates caller-supplied weights instead of optimizing when weights are given', async () => {
    const res = await request(harness(GATE_CLEARING_RECORDS))
      .post('/api/portfolios/optimize')
      .send({ weights: [50, 30, 20] });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe(true);
    expect(res.body.weights).toEqual([0.5, 0.3, 0.2]);
  });

  it('validates the weights body: wrong length, negative, or not summing to 100', async () => {
    for (const weights of [[50, 50], [60, 60, -20], [10, 10, 10]]) {
      const res = await request(harness(GATE_CLEARING_RECORDS))
        .post('/api/portfolios/optimize')
        .send({ weights });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });
});
