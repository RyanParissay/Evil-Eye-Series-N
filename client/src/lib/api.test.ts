import { expect, test } from 'vitest';
import { AppState, deriveFeedHealth, deriveStatusLine, metricPct } from './api';

function stateWith(nextScanAt: number, overrides: Partial<AppState> = {}): AppState {
  return {
    mode: 'SIMULATED',
    now: 0,
    nextScanAt,
    quietHours: false,
    trades: { verified: [], pending: [] },
    counts: { verifiedToday: 0, killedToday: 0 },
    feedHealth: null,
    ...overrides,
  };
}

test('deriveStatusLine: null state → em-dash time, SIMULATED badge (no error banner)', () => {
  expect(deriveStatusLine(null)).toEqual({ nextScanText: '—', modeLabel: 'SIMULATED' });
});

test('deriveStatusLine: live state → vancouver timestamp + server mode', () => {
  // 2026-07-13 22:47 PDT == 2026-07-14 05:47 UTC
  const s = stateWith(Date.UTC(2026, 6, 14, 5, 47));
  expect(deriveStatusLine(s)).toEqual({ nextScanText: 'JUL 13 · 10:47 PM', modeLabel: 'SIMULATED' });
});

test('metricPct: ARB reads marginPct, EV/MIDDLE read edgePct, null → 0', () => {
  expect(metricPct({ category: 'ARB', marginPct: 2.5, edgePct: null })).toBe(2.5);
  expect(metricPct({ category: 'EV', marginPct: null, edgePct: 2.8 })).toBe(2.8);
  expect(metricPct({ category: 'MIDDLE', marginPct: null, edgePct: 4.6 })).toBe(4.6);
  expect(metricPct({ category: 'EV', marginPct: null, edgePct: null })).toBe(0);
});

// ---- §2.2 live-fetch hardening: feed-health indicator ------------------------

test('deriveFeedHealth: null state (server down) → neutral SIM, same default as deriveStatusLine', () => {
  expect(deriveFeedHealth(null, 0)).toEqual({ tone: 'sim', text: 'FEED · SIM', detail: '' });
});

test('deriveFeedHealth: SIMULATED mode → neutral SIM label regardless of any feedHealth value', () => {
  const s = stateWith(0, { mode: 'SIMULATED', feedHealth: null });
  expect(deriveFeedHealth(s, 0)).toEqual({ tone: 'sim', text: 'FEED · SIM', detail: '' });
});

test('deriveFeedHealth: LIVE + no fetch attempted yet → neutral, NOT an error state', () => {
  const s = stateWith(0, {
    mode: 'LIVE',
    feedHealth: { lastFetchAt: null, lastFetchOk: null, lastFetchError: null, lastSuccessfulFetchAt: null },
  });
  expect(deriveFeedHealth(s, 1_000)).toEqual({ tone: 'muted', text: 'FEED · AWAITING FIRST FETCH', detail: '' });
});

test('deriveFeedHealth: LIVE + last fetch ok → green OK + time since last successful fetch', () => {
  const s = stateWith(0, {
    mode: 'LIVE',
    feedHealth: { lastFetchAt: 10_000, lastFetchOk: true, lastFetchError: null, lastSuccessfulFetchAt: 10_000 },
  });
  expect(deriveFeedHealth(s, 22_000)).toEqual({ tone: 'green', text: 'FEED OK', detail: '12S AGO' });
});

test('deriveFeedHealth: LIVE + failed fetch after a prior success → red ERROR, last-good time stays honest', () => {
  const s = stateWith(0, {
    mode: 'LIVE',
    feedHealth: { lastFetchAt: 90_000, lastFetchOk: false, lastFetchError: 'odds api 429 for basketball_nba', lastSuccessfulFetchAt: 10_000 },
  });
  expect(deriveFeedHealth(s, 100_000)).toEqual({ tone: 'red', text: 'FEED ERROR', detail: 'LAST OK 90S AGO' });
});

test('deriveFeedHealth: LIVE + failed fetch that has NEVER succeeded → red ERROR, no fabricated last-good time', () => {
  const s = stateWith(0, {
    mode: 'LIVE',
    feedHealth: { lastFetchAt: 5_000, lastFetchOk: false, lastFetchError: 'odds api 401 for basketball_nba', lastSuccessfulFetchAt: null },
  });
  expect(deriveFeedHealth(s, 6_000)).toEqual({ tone: 'red', text: 'FEED ERROR', detail: 'NO SUCCESSFUL FETCH YET' });
});
