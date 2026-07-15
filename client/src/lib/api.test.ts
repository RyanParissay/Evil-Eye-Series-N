import { expect, test } from 'vitest';
import { AppState, deriveStatusLine, metricPct } from './api';

function stateWith(nextScanAt: number): AppState {
  return {
    mode: 'SIMULATED',
    now: 0,
    nextScanAt,
    quietHours: false,
    trades: { verified: [], pending: [] },
    counts: { verifiedToday: 0, killedToday: 0 },
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
