import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Quote, Trade } from '../shared/types.js';
import { CLOSE_KIND, captureCloses, closingEdge } from './closes.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);
const HOUR = 3_600_000;

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

function quote(book: string, selection: string, odds: number, event = 'E1'): Quote {
  return {
    book, sport: 'basketball', event, market: 'moneyline', selection, odds,
    line: null, fetchedAt: NOW, eventStartsAt: NOW + HOUR,
  };
}

function sentTrade(over: Partial<Trade>): Trade {
  return {
    id: 't1', profileId: 1, category: 'ARB', event: 'E1', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: NOW - HOUR, verifyDueAt: NOW - HOUR,
    verifiedAt: NOW - HOUR, freshUntil: NOW, settledAt: null, eventStartsAt: NOW + HOUR,
    ...over,
  };
}

test('captures a sent trade inside the hot window with all legs quoted', () => {
  const deps = mkDeps();
  deps.repos.trades.insert(sentTrade({}), '2026-07-14', 'moneyline');
  deps.lastQuotes = [quote('bet365', 'home', 2.05), quote('pinnacle', 'home', 2.0)];
  expect(captureCloses(deps, NOW)).toBe(1);
  const rows = deps.repos.eventsLog.byKind(CLOSE_KIND);
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toEqual({
    tradeId: 't1', eventStartsAt: NOW + HOUR,
    legs: [{ book: 'bet365', selection: 'home', oddsAtBet: 2.1, closeOdds: 2.05 }],
  });
});

test('skips: started events, events beyond the window, missing legs, never-sent trades', () => {
  const deps = mkDeps();
  deps.repos.trades.insert(sentTrade({ id: 'started', eventStartsAt: NOW - 1 }), '2026-07-14', 'moneyline');
  deps.repos.trades.insert(sentTrade({ id: 'far', eventStartsAt: NOW + 3 * HOUR }), '2026-07-14', 'moneyline');
  deps.repos.trades.insert(sentTrade({ id: 'unquoted', event: 'E2' }), '2026-07-14', 'moneyline');
  deps.repos.trades.insert(sentTrade({ id: 'pending', status: 'PENDING', verifiedAt: null }), '2026-07-14', 'moneyline');
  deps.lastQuotes = [quote('bet365', 'home', 2.05)];
  expect(captureCloses(deps, NOW)).toBe(0);
  expect(deps.repos.eventsLog.byKind(CLOSE_KIND)).toHaveLength(0);
});

test('expired-but-sent trades still capture (a stale pick still had a price)', () => {
  const deps = mkDeps();
  deps.repos.trades.insert(sentTrade({ id: 'exp', status: 'EXPIRED' }), '2026-07-14', 'moneyline');
  deps.lastQuotes = [quote('bet365', 'home', 2.02)];
  expect(captureCloses(deps, NOW)).toBe(1);
});

test('closingEdge aggregates the LATEST capture per trade, started events only', () => {
  const deps = mkDeps();
  const payload = (closeOdds: number) => JSON.stringify({
    tradeId: 't1', eventStartsAt: 3_000,
    legs: [{ book: 'bet365', selection: 'home', oddsAtBet: 2.1, closeOdds }],
  });
  deps.repos.eventsLog.add(1_000, CLOSE_KIND, payload(2.0));
  deps.repos.eventsLog.add(2_000, CLOSE_KIND, payload(1.9)); // the later capture wins
  expect(closingEdge(deps.repos, 2_500)).toBeNull(); // event not started yet — no final close
  const edge = closingEdge(deps.repos, 5_000)!;
  expect(edge.avgPct).toBe(10.5); // 2.1/1.9 − 1 = 10.526% → 1dp
  expect(edge.beatClosePct).toBe(100);
  expect(edge.legs).toBe(1);
});

test('no captures at all → null (the tile renders an honest em-dash)', () => {
  const deps = mkDeps();
  expect(closingEdge(deps.repos, NOW)).toBeNull();
});
