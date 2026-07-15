// Demo Data seed (feat-demo-seed): additive, simulation-only backfill covering
// every trade status + book heat + bankroll history, so the beta preview never
// opens to an empty board. Fully deterministic (fixed rng seed, time derived
// only from `now`), gated off in live mode, and idempotent on re-run.
import { expect, test } from 'vitest';
import request from 'supertest';
import { openDb, Repos } from '../db/db.js';
import type { Repos as ReposT } from '../db/db.js';
import { createApp } from '../api/routes.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { gradeAll } from '../brain/grades.js';
import type { AlertSender, OddsProvider, Trade, TradeStatus } from '../shared/types.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { seedDemo } from './seed.js';

const NOW = 1_784_000_000_000; // same fixed instant used across the house test suite

/** mulberry32 — deterministic PRNG; same helper as the pipeline/api tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_STATUSES: TradeStatus[] = ['PENDING', 'VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED', 'KILLED', 'SETTLED'];

function harness() {
  const db = openDb(':memory:');
  const repos = Repos(db);
  const provider: OddsProvider = { fetchQuotes: () => [] };
  const sender: AlertSender = { sendVerified: () => {} };
  const rng = mulberry32(1); // PipeDeps requires one; seedDemo never touches it — it seeds its own fixed rng
  const deps: PipeDeps = { repos, provider, sender, s: () => repos.settings.all(), rng };
  return { repos, deps };
}

function allDemoTrades(repos: ReposT): Trade[] {
  return ALL_STATUSES.flatMap((s) => repos.trades.byStatus(s));
}

// ---- 1. fresh seed writes additive rows --------------------------------------

test('fresh seed writes additive rows with sane shapes', () => {
  const { repos, deps } = harness();
  const result = seedDemo(deps, NOW);
  expect(result.gated).toBe(false);
  expect(result.alreadySeeded).toBe(false);
  expect(result.inserted.trades).toBeGreaterThan(0);

  const trades = allDemoTrades(repos);
  for (const t of trades) expect(t.id.startsWith('demo-')).toBe(true); // fresh db: only demo rows exist

  const settled = trades.filter((t) => t.status === 'SETTLED');
  expect(settled.length).toBeGreaterThanOrEqual(100);
  for (const cat of ['ARB', 'EV', 'MIDDLE'] as const) {
    expect(settled.filter((t) => t.category === cat).length).toBeGreaterThanOrEqual(30);
  }
  expect(trades.filter((t) => t.status === 'CONFIRMED').length).toBeGreaterThanOrEqual(1);
  expect(trades.filter((t) => t.status === 'UNCONFIRMED').length).toBeGreaterThanOrEqual(1);
  expect(trades.filter((t) => t.status === 'EXPIRED').length).toBeGreaterThanOrEqual(1);
  expect(trades.filter((t) => t.status === 'KILLED').length).toBeGreaterThanOrEqual(1);

  for (const t of trades) {
    for (const leg of t.legs) {
      if (leg.stakeCents !== null) {
        expect(Number.isInteger(leg.stakeCents)).toBe(true);
        expect(leg.stakeCents % 500).toBe(0);
        expect(leg.stakeCents).toBeGreaterThanOrEqual(1000);
      }
    }
    if (t.status === 'SETTLED') expect(Number.isInteger(t.resultCents)).toBe(true);
  }

  const profileId = repos.profiles.all()[0]!.id;
  const snaps = repos.snapshots.byProfile(profileId);
  expect(snaps.length).toBeGreaterThan(0);
  for (const s of snaps) expect(Number.isInteger(s.bankrollCents)).toBe(true);

  expect(repos.journal.all().length).toBeGreaterThan(0);
});

// ---- 2. grades derive to the design feel -------------------------------------

test('grades derive honestly: ARB green top, EV yellow, MIDDLE green mid, strict ordering', () => {
  const { repos, deps } = harness();
  seedDemo(deps, NOW);

  const grades = gradeAll(repos.trades.byStatus('SETTLED'));
  const byStrat = Object.fromEntries(grades.map((g) => [g.strategy, g]));
  const tone = (g: number): 'green' | 'yellow' | 'red' => (g >= 70 ? 'green' : g >= 30 ? 'yellow' : 'red');

  for (const g of grades) expect(g.provisional).toBe(false);

  expect(tone(byStrat.ARB!.grade)).toBe('green');
  expect(byStrat.ARB!.grade).toBeGreaterThanOrEqual(85);

  expect(tone(byStrat.EV!.grade)).toBe('yellow');
  expect(byStrat.EV!.grade).toBeGreaterThanOrEqual(30);
  expect(byStrat.EV!.grade).toBeLessThanOrEqual(69);

  expect(tone(byStrat.MIDDLE!.grade)).toBe('green');
  expect(byStrat.MIDDLE!.grade).toBeGreaterThanOrEqual(70);
  expect(byStrat.MIDDLE!.grade).toBeLessThanOrEqual(92);

  expect(byStrat.ARB!.grade).toBeGreaterThan(byStrat.MIDDLE!.grade);
  expect(byStrat.MIDDLE!.grade).toBeGreaterThan(byStrat.EV!.grade);
});

// ---- 3. determinism -----------------------------------------------------------

test('determinism: two fresh dbs seeded with the same now are byte-identical', () => {
  const h1 = harness();
  const h2 = harness();
  seedDemo(h1.deps, NOW);
  seedDemo(h2.deps, NOW);

  const dump = (repos: ReposT) => ({
    trades: Object.fromEntries(ALL_STATUSES.map((s) => [s, repos.trades.byStatus(s)])),
    snapshots: repos.snapshots.byProfile(repos.profiles.all()[0]!.id),
    journal: repos.journal.all().map((j) => j.text),
    books: repos.books.all(),
  });

  expect(JSON.stringify(dump(h1.repos))).toEqual(JSON.stringify(dump(h2.repos)));
});

// ---- 4. idempotency -------------------------------------------------------------

test('idempotency: seeding an already-seeded db is a no-op the second time', () => {
  const { repos, deps } = harness();
  const r1 = seedDemo(deps, NOW);
  expect(r1.alreadySeeded).toBe(false);

  const profileId = repos.profiles.all()[0]!.id;
  const tradesBefore = allDemoTrades(repos).length;
  const snapsBefore = repos.snapshots.byProfile(profileId).length;
  const journalBefore = repos.journal.all().length;
  const limitsBefore = repos.limitsReports.all().length;

  const r2 = seedDemo(deps, NOW);
  expect(r2.gated).toBe(false);
  expect(r2.alreadySeeded).toBe(true);
  expect(r2.inserted).toEqual({ trades: 0, snapshots: 0, journal: 0, limitsReports: 0 });

  expect(allDemoTrades(repos).length).toBe(tradesBefore);
  expect(repos.snapshots.byProfile(profileId).length).toBe(snapsBefore);
  expect(repos.journal.all().length).toBe(journalBefore);
  expect(repos.limitsReports.all().length).toBe(limitsBefore);
});

// ---- 5. additive-only -----------------------------------------------------------

test('additive-only: a pre-existing non-demo trade survives untouched; nothing is ever deleted', () => {
  const { repos, deps } = harness();
  const other: Trade = {
    id: 'not-demo-1', profileId: 1, category: 'EV', event: 'Foo @ Bar', sport: 'baseball',
    legs: [{ book: 'draftkings', selection: 'away', odds: 2.1, stakeCents: 1_500 }],
    marginInitial: 0.03, marginRecheck: 0.03, marginFinal: 0.03, status: 'VERIFIED', killReason: null,
    resultCents: null, createdAt: NOW - 1_000, verifyDueAt: NOW - 900, verifiedAt: NOW - 500,
    freshUntil: NOW + 1_000, settledAt: null, eventStartsAt: NOW + 3_600_000,
  };
  repos.trades.insert(other, dayKey(NOW - 1_000), 'moneyline');

  seedDemo(deps, NOW);

  expect(repos.trades.byId('not-demo-1')).toEqual(other);
});

// ---- 6. sim-gate ------------------------------------------------------------------

test('sim-gate: liveMode=1 blocks the seed entirely; liveMode=0 allows it', () => {
  const { repos, deps } = harness();
  repos.settings.set({ liveMode: 1 } as never);

  const r1 = seedDemo(deps, NOW);
  expect(r1.gated).toBe(true);
  expect(r1.alreadySeeded).toBe(false);
  expect(r1.inserted).toEqual({ trades: 0, snapshots: 0, journal: 0, limitsReports: 0 });
  expect(repos.trades.byId('demo-0000')).toBeNull();
  expect(allDemoTrades(repos)).toHaveLength(0);

  repos.settings.set({ liveMode: 0 } as never);
  const r2 = seedDemo(deps, NOW);
  expect(r2.gated).toBe(false);
  expect(r2.alreadySeeded).toBe(false);
  expect(repos.trades.byId('demo-0000')).not.toBeNull();
});

// ---- 7. route via supertest ---------------------------------------------------

test('POST /api/demo/seed: 200 with counts, then alreadySeeded, then 409 under live mode', async () => {
  const rng = mulberry32(7);
  const made = createApp({
    dbPath: ':memory:',
    clock: () => NOW,
    timer: { setTimeout: () => 0 },
    rng,
  });

  const first = await request(made.app).post('/api/demo/seed');
  expect(first.status).toBe(200);
  expect(first.body.gated).toBe(false);
  expect(first.body.alreadySeeded).toBe(false);
  expect(first.body.inserted.trades).toBeGreaterThan(0);

  const second = await request(made.app).post('/api/demo/seed');
  expect(second.status).toBe(200);
  expect(second.body.alreadySeeded).toBe(true);

  made.repos.settings.set({ liveMode: 1 } as never);
  const third = await request(made.app).post('/api/demo/seed');
  expect(third.status).toBe(409);
  expect(third.body.error.code).toBe('conflict');

  const FORBIDDEN = /append-only|ghost|picker|grader|CLV|gatekeeper/i;
  for (const res of [first, second, third]) expect(res.text).not.toMatch(FORBIDDEN);
});
