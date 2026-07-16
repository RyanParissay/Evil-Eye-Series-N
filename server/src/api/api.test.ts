// API + scheduler runner (Task 13) — supertest against an app wired to :memory:,
// a seeded rng and a FAKE clock/timer. These tests NEVER sleep: time moves by
// mutating `now`, and due work runs via the scheduler handle's tick() hook (or
// by firing the captured timer callbacks). The only real setTimeout in the
// codebase lives in index.ts's timer argument.
import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from './routes.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import { dayKey, isQuietHours } from '../scheduler/vancouverTime.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import type { OddsProvider, Quote, Trade } from '../shared/types.js';

/** mulberry32 — deterministic PRNG; same helper as the pipeline tests. */
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

/** Refetches replay the scan snapshot verbatim (drift frozen) — verification always sees the same odds. */
function frozen(base: OddsProvider): OddsProvider {
  let first: Quote[] | null = null;
  return {
    fetchQuotes(now: number): Quote[] {
      first ??= base.fetchQuotes(now);
      return first.map((q) => ({ ...q, fetchedAt: now }));
    },
  };
}

const NOW = 1_784_000_000_000; // 2026-07-13 20:33 Vancouver — outside quiet hours
const QUIET_NOW = NOW + 6 * 3_600_000; // 2026-07-14 02:33 Vancouver — inside 00:00-08:00 quiet

function makeApp(startNow: number = NOW, env: NodeJS.ProcessEnv = {}) {
  let now = startNow;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const rng = mulberry32(42);
  const sent: Trade[] = [];
  const made = createApp({
    dbPath: ':memory:',
    clock: () => now,
    timer: { setTimeout: (fn: () => void, ms: number): unknown => timers.push({ fn, ms }) },
    rng,
    provider: frozen(SimOddsProvider(rng)),
    sender: { sendVerified: (t: Trade): void => { sent.push(t); } },
    fetchImpl: (() => { throw new Error('NETWORK CALL ATTEMPTED IN SIM SUITE'); }) as unknown as typeof fetch,
    env,
  });
  return { ...made, sent, timers, advance: (ms: number): void => { now += ms; } };
}

/** Scan then advance past the 75s verify gap and tick — yields VERIFIED trades. */
async function promoteSome(h: ReturnType<typeof makeApp>) {
  await request(h.app).post('/api/scan').expect(200);
  h.advance(76_000);
  h.scheduler.tick();
  const state = await request(h.app).get('/api/state').expect(200);
  return state.body.trades.verified as Array<{ id: string; status: string; legs: { book: string }[] }>;
}

test('clock guards: NOW is active hours, QUIET_NOW is quiet hours', () => {
  expect(isQuietHours(NOW, DEFAULT_SETTINGS)).toBe(false);
  expect(isQuietHours(QUIET_NOW, DEFAULT_SETTINGS)).toBe(true);
});

test('boot → POST /api/scan → pending appear WITHOUT stakes', async () => {
  const h = makeApp();
  const scan = await request(h.app).post('/api/scan');
  expect(scan.status).toBe(200);
  expect(scan.body.scan.created).toBeGreaterThan(0);

  const res = await request(h.app).get('/api/state');
  expect(res.status).toBe(200);
  expect(res.body.mode).toBe('SIMULATED');
  expect(res.body.now).toBe(NOW);
  expect(typeof res.body.nextScanAt).toBe('number');
  expect(res.body.quietHours).toBe(false);
  expect(res.body.trades.verified).toHaveLength(0);
  expect(res.body.trades.pending.length).toBe(scan.body.scan.created);
  for (const t of res.body.trades.pending) {
    expect(t.status).toBe('PENDING');
    expect(typeof t.marginPct).toBe('number');
    expect(typeof t.edgePct).toBe('number');
    expect(t.marginPct).toBe(Math.round(t.marginPct * 100) / 100); // 2dp
    for (const leg of t.legs) {
      expect(leg).not.toHaveProperty('stakeCents'); // money NEVER shows on a pending card
      expect(typeof leg.book).toBe('string');
      expect(typeof leg.selection).toBe('string');
      expect(leg.odds).toBeGreaterThan(1);
    }
  }
  expect(res.body.counts).toEqual({ verifiedToday: 0, killedToday: scan.body.scan.killed });
  // Scan wrote a daily bankroll snapshot.
  expect(h.repos.snapshots.byProfile(1).length).toBe(1);
});

test('advance fake clock 76s → verify runs → GET /api/state shows verified WITH stakes', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  expect(verified.length).toBeGreaterThan(0);

  const res = await request(h.app).get('/api/state');
  expect(res.body.trades.pending).toHaveLength(0); // every due pending resolved
  for (const t of res.body.trades.verified) {
    expect(t.status).toBe('VERIFIED');
    expect(t.verifiedAt).toBe(NOW + 76_000);
    for (const leg of t.legs) {
      expect(Number.isInteger(leg.stakeCents)).toBe(true);
      expect(leg.stakeCents).toBeGreaterThanOrEqual(1000); // >= $10 min stake
      expect(leg.stakeCents % 500).toBe(0); //               $5 rounding
    }
  }
  expect(res.body.counts.verifiedToday).toBe(verified.length);
  expect(h.sent).toHaveLength(verified.length); // one alert per promotion
});

test('scheduler chain: firing the captured timer callback boot-scans and reschedules exactly once', () => {
  const h = makeApp();
  expect(h.timers).toHaveLength(1); // startScheduler seeded the chain
  h.timers[0]!.fn(); // boot tick: lastScanAt null → immediate scan, then reschedule
  expect(h.timers).toHaveLength(2); // single chain: exactly one new timeout
  expect(h.timers[1]!.ms).toBe(60_000); // next due work is the 60s verify recheck
  expect(h.repos.trades.byStatus('PENDING').length).toBeGreaterThan(0);
});

/** Every trade row in the db regardless of status — a stale wake must not add or move any. */
const ALL_STATUSES = ['PENDING', 'VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED', 'KILLED', 'SETTLED'] as const;
function tradeCount(h: ReturnType<typeof makeApp>): number {
  return ALL_STATUSES.reduce((n, st) => n + h.repos.trades.byStatus(st).length, 0);
}

test('manual scan mid-cadence-sleep re-arms the chain to its +75s verify wake', async () => {
  const h = makeApp();
  // Generous caps so the second wave's survivors are not held back — this test
  // is about the scheduling seam, not the kill battery.
  await request(h.app)
    .patch('/api/settings')
    .send({ dailyPickCap: 500, sharpVelocityPerDayPerBook: 500, marketBreadthPerWeekPerBook: 500 })
    .expect(200);

  h.timers[0]!.fn(); // boot tick: immediate scan, chain arms the +60s verify wake
  h.advance(61_000);
  h.timers[1]!.fn(); // wave-1 verify runs, chain arms the next cadence scan
  expect(h.timers).toHaveLength(3);
  expect(h.timers[2]!.ms).toBeGreaterThan(60_000); // mid-cadence sleep: the next wake is minutes away

  h.advance(120_000); // two minutes into the sleep — the common manual-scan moment
  const scanAt = NOW + 61_000 + 120_000;
  const scan = await request(h.app).post('/api/scan').expect(200);
  expect(scan.body.scan.created).toBeGreaterThan(0);

  // The manual scan must re-arm the chain: exactly ONE new wake, due at the
  // +60s verify recheck — NOT left to the old cadence wake minutes out.
  expect(h.timers).toHaveLength(4);
  expect(h.timers[3]!.ms).toBe(60_000);

  // Firing that wake at +60s verifies the manual scan's pendings on time.
  h.advance(60_000);
  h.timers[3]!.fn();
  const state = await request(h.app).get('/api/state').expect(200);
  expect(state.body.trades.pending).toHaveLength(0);
  const wave2 = (state.body.trades.verified as Array<{ verifiedAt: number | null }>)
    .filter((t) => t.verifiedAt === scanAt + 60_000);
  expect(wave2.length).toBeGreaterThan(0);
});

test('stale wake after a manual scan is a no-op: no double scan, no extra timer, cadence intact', async () => {
  const h = makeApp();
  h.timers[0]!.fn(); // boot scan; +60s verify wake armed
  h.advance(61_000);
  h.timers[1]!.fn(); // wave-1 verify; cadence scan wake armed — mid-cadence sleep begins
  const staleWake = h.timers[2]!; // superseded by the manual scan below

  h.advance(60_000);
  await request(h.app).post('/api/scan').expect(200);
  expect(h.timers).toHaveLength(4); // the manual scan armed the replacement wake

  h.advance(60_000);
  h.timers[3]!.fn(); // the live chain's wake: due work runs, next wake armed
  const timerCount = h.timers.length;
  const trades = tradeCount(h);
  const at = NOW + 61_000 + 60_000 + 60_000;
  const nextScan = h.scheduler.nextScanAt(at);

  staleWake.fn(); // the pre-manual-scan wake finally fires — stale generation
  expect(h.timers).toHaveLength(timerCount); // it did NOT reschedule: exactly one live chain
  expect(tradeCount(h)).toBe(trades); // and did NOT scan or verify anything
  expect(h.scheduler.nextScanAt(at)).toBe(nextScan); // cadence intact
});

test('confirm → unconfirm cycle via API', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  const id = verified[0]!.id;

  const c = await request(h.app).post(`/api/trades/${id}/confirm`);
  expect(c.status).toBe(200);
  expect(c.body.trade.status).toBe('CONFIRMED');

  const again = await request(h.app).post(`/api/trades/${id}/confirm`); // double-tap is a no-op success
  expect(again.status).toBe(200);
  expect(again.body.trade.status).toBe('CONFIRMED');

  const u = await request(h.app).post(`/api/trades/${id}/unconfirm`);
  expect(u.status).toBe(200);
  expect(u.body.trade.status).toBe('VERIFIED');

  // Settling a VERIFIED (never confirmed) trade is an invalid transition → 409 conflict.
  const s = await request(h.app).post(`/api/trades/${id}/settle`).send({ result: 'WON', amountCents: 500 });
  expect(s.status).toBe(409);
  expect(s.body.error.code).toBe('conflict');

  // Unknown id → 404 not_found (never a 409).
  const nf = await request(h.app).post('/api/trades/no-such-trade/confirm');
  expect(nf.status).toBe(404);
  expect(nf.body.error.code).toBe('not_found');
});

test('limited report and manual settle round-trip', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  const id = verified[0]!.id;

  const lim = await request(h.app).post(`/api/trades/${id}/limited`).send({ book: 'bet365', maxAllowedCents: 2500 });
  expect(lim.status).toBe(200);
  expect(lim.body).toEqual({ ok: true });
  expect(h.repos.limitsReports.all()).toHaveLength(1);

  const badLim = await request(h.app).post(`/api/trades/${id}/limited`).send({ maxAllowedCents: 2500 });
  expect(badLim.status).toBe(400);
  expect(badLim.body.error.code).toBe('bad_request');

  await request(h.app).post(`/api/trades/${id}/confirm`).expect(200);
  const settle = await request(h.app).post(`/api/trades/${id}/settle`).send({ result: 'LOST', amountCents: 750 });
  expect(settle.status).toBe(200);
  expect(settle.body.trade.status).toBe('SETTLED');
  expect(settle.body.trade.resultCents).toBe(-750); // LOST stores the magnitude negative

  const badSettle = await request(h.app).post(`/api/trades/${id}/settle`).send({ result: 'PUSH', amountCents: 1 });
  expect(badSettle.status).toBe(400);

  const history = await request(h.app).get('/api/trades?view=history');
  expect(history.status).toBe(200);
  expect(history.body.trades.some((t: { id: string }) => t.id === id)).toBe(true);

  const all = await request(h.app).get('/api/trades?view=all');
  expect(all.body.trades.every((t: { status: string }) => t.status !== 'SETTLED')).toBe(true);
  const created: number[] = all.body.trades.map((t: { createdAt: number }) => t.createdAt);
  expect(created).toEqual([...created].sort((a, b) => b - a)); // newest-first

  const badView = await request(h.app).get('/api/trades?view=nope');
  expect(badView.status).toBe(400);
});

test('PATCH settings tolerance 101 → 400', async () => {
  const h = makeApp();
  const bad = await request(h.app).patch('/api/settings').send({ tolerancePct: 101 });
  expect(bad.status).toBe(400);
  expect(bad.body.error.code).toBe('bad_request');

  const negative = await request(h.app).patch('/api/settings').send({ scanBaseMin: -5 });
  expect(negative.status).toBe(400); // steppers must be positive

  const unknown = await request(h.app).patch('/api/settings').send({ nonsenseKey: 1 });
  expect(unknown.status).toBe(400);

  const ok = await request(h.app).patch('/api/settings').send({ tolerancePct: 10, scanBaseMin: 15 });
  expect(ok.status).toBe(200);
  expect(ok.body.settings.tolerancePct).toBe(10);
  expect(ok.body.settings.scanBaseMin).toBe(15);

  const got = await request(h.app).get('/api/settings');
  expect(got.status).toBe(200);
  expect(got.body.settings.scanBaseMin).toBe(15); // persisted
  expect(got.body.settings.verifyGapSecs).toBe(60); // untouched keys keep defaults
});

test('quiet-hours scan → 503 quiet_hours', async () => {
  const h = makeApp(QUIET_NOW);
  const res = await request(h.app).post('/api/scan');
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe('quiet_hours');
  expect(h.repos.trades.byStatus('PENDING')).toHaveLength(0); // nothing scanned

  const state = await request(h.app).get('/api/state');
  expect(state.body.quietHours).toBe(true);
  expect(state.body.nextScanAt).toBeGreaterThan(QUIET_NOW); // sleeps until quiet ends
});

test('no response body ever contains the forbidden words', async () => {
  const FORBIDDEN = /append-only|ghost|picker|grader|CLV|gatekeeper/i;
  const bodies: string[] = [];
  const grab = (res: { text: string }): void => { bodies.push(res.text); };

  const h = makeApp();
  grab(await request(h.app).post('/api/scan'));
  grab(await request(h.app).get('/api/state'));
  h.advance(76_000);
  h.scheduler.tick();
  grab(await request(h.app).get('/api/state'));

  const verified = (await request(h.app).get('/api/state')).body.trades.verified as Array<{ id: string }>;
  const id = verified[0]!.id;
  grab(await request(h.app).post(`/api/trades/${id}/confirm`));
  grab(await request(h.app).post(`/api/trades/${id}/unconfirm`));
  grab(await request(h.app).post(`/api/trades/${id}/limited`).send({ book: 'bet365', maxAllowedCents: 2500 }));
  grab(await request(h.app).post(`/api/trades/${id}/confirm`));
  grab(await request(h.app).post(`/api/trades/${id}/settle`).send({ result: 'WON', amountCents: 1250 }));
  grab(await request(h.app).post(`/api/trades/${id}/settle`).send({ result: 'WON', amountCents: 1250 })); // no-op repeat
  grab(await request(h.app).post(`/api/trades/${id}/unconfirm`)); // 409 conflict body
  grab(await request(h.app).post('/api/trades/missing/confirm')); // 404 body
  grab(await request(h.app).get('/api/trades?view=all'));
  grab(await request(h.app).get('/api/trades?view=history'));
  grab(await request(h.app).get('/api/trades?view=bogus')); // 400 body
  grab(await request(h.app).get('/api/settings'));
  grab(await request(h.app).patch('/api/settings').send({ tolerancePct: 7 }));
  grab(await request(h.app).patch('/api/settings').send({ tolerancePct: 101 })); // 400 body
  grab(await request(h.app).get('/api/definitely-not-a-route')); // 404 catch-all body

  const quiet = makeApp(QUIET_NOW);
  grab(await request(quiet.app).post('/api/scan')); // 503 quiet_hours body

  expect(bodies.length).toBeGreaterThanOrEqual(18); // every route + every error shape sampled
  for (const body of bodies) expect(body).not.toMatch(FORBIDDEN);
});

// ---- display labels (bookLabel / selectionLabel) ----------------------------

/** Minimal PENDING trade inserted directly via repos — bypasses the pipeline so
 *  legs/event are fully controlled, letting label tests assert exact values. */
function pendingTrade(id: string, now: number, event: string, category: Trade['category'],
  legs: Trade['legs']): Trade {
  return {
    id, profileId: 1, category, event, sport: 'basketball', legs,
    marginInitial: 0.02, marginRecheck: null, marginFinal: null,
    status: 'PENDING', killReason: null, resultCents: null,
    createdAt: now, verifyDueAt: now + 60_000, verifiedAt: null, freshUntil: null,
    settledAt: null, eventStartsAt: now + 3_600_000,
  };
}

test('leg bookLabel/selectionLabel: home/away/draw resolve off the event string, over/under title-case', async () => {
  const h = makeApp();
  const trade = pendingTrade('label-test-1', NOW, 'Lakers @ Celtics', 'ARB', [
    { book: 'betway', selection: 'home', odds: 2.1, stakeCents: null },
    { book: 'bwin', selection: 'away', odds: 2.05, stakeCents: null },
    { book: 'sportsinteraction', selection: 'draw', odds: 3.4, stakeCents: null },
    { book: 'pinnacle', selection: 'under', odds: 1.95, stakeCents: null },
    { book: 'some-new-book', selection: 'over', odds: 1.9, stakeCents: null },
  ]);
  h.repos.trades.insert(trade, dayKey(NOW));

  const res = await request(h.app).get('/api/state');
  const t = (res.body.trades.pending as Array<{ id: string; legs: Array<Record<string, unknown>> }>)
    .find((x) => x.id === 'label-test-1')!;
  const byBook = new Map(t.legs.map((l) => [l.book as string, l]));
  expect(byBook.get('betway')).toMatchObject({ bookLabel: 'Betway', selection: 'home', selectionLabel: 'Lakers' });
  expect(byBook.get('bwin')).toMatchObject({ bookLabel: 'bwin', selection: 'away', selectionLabel: 'Celtics' });
  expect(byBook.get('sportsinteraction')).toMatchObject({ bookLabel: 'Sports Interaction', selectionLabel: 'Draw' });
  expect(byBook.get('pinnacle')).toMatchObject({ bookLabel: 'Pinnacle', selectionLabel: 'Under' });
  expect(byBook.get('some-new-book')).toMatchObject({ bookLabel: 'some-new-book', selectionLabel: 'Over' });
  // raw fields stay — the client's limited-flow POSTs keep using slugs
  for (const l of t.legs) {
    expect(typeof l.book).toBe('string');
    expect(typeof l.selection).toBe('string');
  }
});

test('bookLabel covers all 16 seeded books via the title-case map; unknown books fall back to raw', async () => {
  const h = makeApp();
  const BOOK_LABELS: Record<string, string> = {
    pinnacle: 'Pinnacle', bet365: 'bet365', fanduel: 'FanDuel', draftkings: 'DraftKings',
    betmgm: 'BetMGM', caesars: 'Caesars', bet99: 'Bet99', sportsinteraction: 'Sports Interaction',
    betway: 'Betway', pointsbet: 'PointsBet', bwin: 'bwin', unibet: 'Unibet',
    bodog: 'Bodog', betvictor: 'BetVictor', leovegas: 'LeoVegas', betrivers: 'BetRivers',
  };
  const books = [...Object.keys(BOOK_LABELS), 'some-future-book'];
  const trade = pendingTrade('label-test-books', NOW, 'Arsenal vs Chelsea', 'EV',
    books.map((book) => ({ book, selection: 'home', odds: 1.9, stakeCents: null })));
  h.repos.trades.insert(trade, dayKey(NOW));

  const res = await request(h.app).get('/api/state');
  const t = (res.body.trades.pending as Array<{ id: string; legs: Array<{ book: string; bookLabel: string }> }>)
    .find((x) => x.id === 'label-test-books')!;
  for (const leg of t.legs) expect(leg.bookLabel).toBe(BOOK_LABELS[leg.book] ?? leg.book);
});

// ---- MIDDLE display edge scale -----------------------------------------------

test('MIDDLE edgePct (costed): (middleRatio - 1) * costFrac at the settings-assumed hit rate', async () => {
  const h = makeApp();
  const trade = pendingTrade('middle-costed', NOW, 'Lakers @ Celtics', 'MIDDLE', [
    { book: 'pointsbet', selection: 'over', odds: 1.9, stakeCents: null },
    { book: 'bet365', selection: 'under', odds: 1.95, stakeCents: null },
  ]);
  h.repos.trades.insert(trade, dayKey(NOW));

  const res = await request(h.app).get('/api/state');
  const t = (res.body.trades.pending as Array<{ id: string; edgePct: number }>)
    .find((x) => x.id === 'middle-costed')!;
  // costFrac = 1/1.9 + 1/1.95 - 1 = 0.039136...; default middleRatio 1.5 →
  // edgePct = (1.5 - 1) * 0.039136 * 100 = 1.9568 → 1.96
  expect(t.edgePct).toBe(1.96);
});

test('MIDDLE edgePct (free): costFrac <= 0 is the guaranteed margin, -costFrac', async () => {
  const h = makeApp();
  const trade = pendingTrade('middle-free', NOW, 'Lakers @ Celtics', 'MIDDLE', [
    { book: 'pointsbet', selection: 'over', odds: 2.5, stakeCents: null },
    { book: 'bet365', selection: 'under', odds: 2.5, stakeCents: null },
  ]);
  h.repos.trades.insert(trade, dayKey(NOW));

  const res = await request(h.app).get('/api/state');
  const t = (res.body.trades.pending as Array<{ id: string; edgePct: number }>)
    .find((x) => x.id === 'middle-free')!;
  // costFrac = 1/2.5 + 1/2.5 - 1 = -0.2 → edgePct = -(-0.2) * 100 = 20
  expect(t.edgePct).toBe(20);
});

test('MIDDLE edgePct scales with settings.middleRatio, read fresh at serialization time', async () => {
  const h = makeApp();
  await request(h.app).patch('/api/settings').send({ middleRatio: 2 });
  const trade = pendingTrade('middle-ratio2', NOW, 'Lakers @ Celtics', 'MIDDLE', [
    { book: 'pointsbet', selection: 'over', odds: 1.9, stakeCents: null },
    { book: 'bet365', selection: 'under', odds: 1.95, stakeCents: null },
  ]);
  h.repos.trades.insert(trade, dayKey(NOW));

  const res = await request(h.app).get('/api/state');
  const t = (res.body.trades.pending as Array<{ id: string; edgePct: number }>)
    .find((x) => x.id === 'middle-ratio2')!;
  // ratio 2 → edgePct = (2 - 1) * 0.039136 * 100 = 3.9136 → 3.91
  expect(t.edgePct).toBe(3.91);
});

test('ARB/EV edgePct is untouched by the MIDDLE display change (still mirrors marginPct)', async () => {
  const h = makeApp();
  await request(h.app).post('/api/scan');
  const res = await request(h.app).get('/api/state');
  const pending = res.body.trades.pending as Array<{ category: string; marginPct: number; edgePct: number }>;
  expect(pending.length).toBeGreaterThan(0);
  for (const t of pending) {
    if (t.category !== 'MIDDLE') expect(t.edgePct).toBe(t.marginPct);
  }
});

test('PATCH settings: brain keys accept their special ranges', async () => {
  const h = makeApp();
  const ok = await request(h.app).patch('/api/settings')
    .send({ heatWeightWithdrawal: -4, anchorIdx: 2, brainKillSwitch: 1 });
  expect(ok.status).toBe(200);
  expect(ok.body.settings.heatWeightWithdrawal).toBe(-4);
  expect(ok.body.settings.anchorIdx).toBe(2);
  const badAnchor = await request(h.app).patch('/api/settings').send({ anchorIdx: 3 });
  expect(badAnchor.status).toBe(400);
  const badWithdrawal = await request(h.app).patch('/api/settings').send({ heatWeightWithdrawal: 1 });
  expect(badWithdrawal.status).toBe(400);
  const badSwitch = await request(h.app).patch('/api/settings').send({ brainKillSwitch: 2 });
  expect(badSwitch.status).toBe(400);
});

// ---- brain read model + API routes (Task 7) ----------------------------------

test('GET /api/brain: books, tiles, rationale, grades, journal from live tables', async () => {
  const h = makeApp();
  h.scheduler.scanNow(NOW);
  h.advance(76_000);
  h.scheduler.scanNow(NOW + 76_000);
  const res = await request(h.app).get('/api/brain');
  expect(res.status).toBe(200);
  const b = res.body;
  expect(b.books).toHaveLength(16);
  expect(b.books[0]).toMatchObject({
    name: 'pinnacle', displayName: 'Pinnacle', sharpExempt: true,
    heat: 0, health: 'green', maxBetCents: null, wasCents: null,
  });
  expect(b.books.find((x: { name: string }) => x.name === 'sportsinteraction').displayName)
    .toBe('Sports Interaction');
  expect(b.tiles.credits.planCredits).toBe(100_000);
  expect(b.tiles.credits.remainingCredits).toBeLessThan(100_000); // scans burned credits
  expect(b.tiles.todaysPicks.sent).toBeGreaterThan(0);
  expect(b.tiles.todaysPicks.of).toBe(b.tiles.todaysPicks.sent + b.tiles.todaysPicks.heldBack);
  expect(b.tiles.doubleVerification.rechecked).toBeGreaterThan(0);
  expect(b.rationale.candidates).toBeGreaterThanOrEqual(b.rationale.passed);
  expect(b.rationale.passed).toBeGreaterThanOrEqual(b.rationale.sent);
  expect(b.rationale.heldBackClauses.length).toBeGreaterThan(0);
  expect(b.lastFullPassAt).toBe(NOW); // the first tick ran the pass
  expect(b.killSwitch).toBe(false);
  expect(b.grades.map((g: { strategy: string }) => g.strategy)).toEqual(['ARB', 'EV', 'MIDDLE']);
  expect(b.journal.total).toBeGreaterThan(0);
  expect(b.controls).toEqual({ limit: 23, reject: 9, cut: 14, withdrawal: -2, halfLifeDays: 21, cadenceHours: 6 });
});

test('POST /api/brain/pass runs immediately and stamps lastFullPassAt', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/brain/pass');
  expect(res.status).toBe(200);
  expect(res.body.lastFullPassAt).toBe(NOW);
});

test('POST /api/brain/anchor: persists, journals honestly, effective stays PINNACLE', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/brain/anchor').send({ idx: 1 });
  expect(res.status).toBe(200);
  expect(res.body.anchor).toMatchObject({ idx: 1, label: 'CIRCA', effective: 'PINNACLE' });
  const texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Reference pricer switched to CIRCA — simulated mode maps every anchor to Pinnacle prices');
  const bad = await request(h.app).post('/api/brain/anchor').send({ idx: 3 });
  expect(bad.status).toBe(400);
});

test('a TRADE LIMITED? report moves heat end-to-end through the API', async () => {
  const h = makeApp();
  h.scheduler.scanNow(NOW);
  h.advance(76_000);
  h.scheduler.scanNow(NOW + 76_000);
  const verified = h.repos.trades.byStatus('VERIFIED');
  const target = verified.flatMap((t) => t.legs.map((l) => ({ id: t.id, book: l.book })))
    .find((x) => x.book !== 'pinnacle')!;
  const res = await request(h.app)
    .post(`/api/trades/${target.id}/limited`).send({ book: target.book, maxAllowedCents: 2_500 });
  expect(res.status).toBe(200);
  const brain = (await request(h.app).get('/api/brain')).body;
  const book = brain.books.find((x: { name: string }) => x.name === target.book);
  expect(book.heat).toBeGreaterThanOrEqual(23);
  expect(book.maxBetCents).toBe(2_500);
  expect(book.wasCents).toBe(50_000);
  expect(brain.limitsThisMonth).toBe(1);
  expect(brain.books.find((x: { name: string }) => x.name === target.book).marks)
    .toContainEqual({ ts: NOW + 76_000, kind: 'LIMIT REPORTED' });
});

test('forbidden words never appear in the brain payload', async () => {
  const h = makeApp();
  h.scheduler.scanNow(NOW);
  const res = await request(h.app).get('/api/brain');
  expect(/append-only|ghost|picker|grader|gatekeeper|CLV/i.test(JSON.stringify(res.body))).toBe(false);
});

test('GET /api/profiles lists the seeded profile; POST validates, creates, 409s duplicates', async () => {
  const h = makeApp();
  const list = await request(h.app).get('/api/profiles');
  expect(list.status).toBe(200);
  expect(list.body.profiles[0]).toMatchObject({ id: 1, name: 'RYAN', startingCashCents: 1_000_000 });

  const bad = await request(h.app).post('/api/profiles').send({ name: '', startingCashCents: 500_000 });
  expect(bad.status).toBe(400);
  const badCash = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 0 });
  expect(badCash.status).toBe(400);

  const ok = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 500_000 });
  expect(ok.status).toBe(200);
  expect(ok.body.profile).toMatchObject({ id: 2, name: 'LEA', startingCashCents: 500_000, createdDate: '2026-07-13' });

  const dup = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 100 });
  expect(dup.status).toBe(409);
});

test('GET /api/analytics: defaults, structure, honest empty charts', async () => {
  const h = makeApp();
  const res = await request(h.app).get('/api/analytics');
  expect(res.status).toBe(200);
  const v = res.body;
  expect(v.simulated).toBe(true);
  expect(v.range).toBe('30D');
  expect(v.today).toBe('2026-07-13');
  expect(v.profile.name).toBe('RYAN');
  expect(v.bankrollCents).toBe(1_000_000);
  expect(v.confirmed.points.length).toBeGreaterThan(0);
  expect(v.confirmed.points.every((p: { profitCents: number }) => p.profitCents === 0)).toBe(true);
  expect(v.confirmed.stats).toEqual({ profitCents: 0, returnPct: 0, annualizedPct: 0 });
  expect(v.all.points[v.all.points.length - 1]).toMatchObject({ day: '2026-07-13' });
  expect(v.funnel).toEqual({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
  expect(v.advanced.openBets).toEqual([]);
  expect(v.advanced.costOfSafety.rounding).toBeNull();
  expect(v.advanced.costOfSafety.closingEdge).toBeNull();

  const badRange = await request(h.app).get('/api/analytics?range=7D');
  expect(badRange.status).toBe(400);
  const badProfile = await request(h.app).get('/api/analytics?profileId=99');
  expect(badProfile.status).toBe(404);
});

test('analytics reflects the driven pipeline: confirm → monthly/funnel/leaderboards move', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  expect(verified.length).toBeGreaterThan(0);
  await request(h.app).post(`/api/trades/${verified[0]!.id}/confirm`).expect(200);

  const v = (await request(h.app).get('/api/analytics?range=MAX')).body;
  const jul = v.monthly.find((m: { month: string }) => m.month === '2026-07');
  expect(jul.cand).toBeGreaterThan(0);
  expect(jul.sent).toBeGreaterThanOrEqual(1);
  expect(jul.conf).toBe(1);
  expect(jul.followThruPct).toBe(Math.round((100 * jul.conf) / jul.sent));
  expect(v.funnel.under2).toBe(1); // confirmed 76s after promotion? — no: confirm at +76s of verify; still < 2 min
  expect(v.funnel.total).toBe(1);
  expect(v.advanced.openBets.length).toBe(1);
  expect(v.advanced.openBets[0].stakeCents).toBeGreaterThan(0);
  const all = v.advanced.leaderboards.boards.find((b: { title: string }) => b.title === 'ALL CATEGORIES');
  expect(all.rows.length).toBeGreaterThan(0);
  expect(v.advanced.costOfSafety.retention.thresholdPct).toBe(92); // 100 − default tolerance 8
});

test('a limited report surfaces in the analytics limits log with display names', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  const target = verified
    .flatMap((t: { id: string; legs: { book: string }[] }) => t.legs.map((l) => ({ id: t.id, book: l.book })))
    .find((x: { book: string }) => x.book !== 'pinnacle')!;
  await request(h.app).post(`/api/trades/${target.id}/limited`)
    .send({ book: target.book, maxAllowedCents: 2_500 }).expect(200);
  const v = (await request(h.app).get('/api/analytics')).body;
  expect(v.advanced.limits).toHaveLength(1);
  expect(v.advanced.limits[0]).toMatchObject({ maxCents: 2_500 });
  expect(v.advanced.limits[0].event).not.toBe(''); // joined through the trade
  expect(v.advanced.limits[0].when).toBe(NOW + 76_000);
});

test('the analytics payload is deterministic between polls and forbidden-word-free', async () => {
  const h = makeApp();
  await promoteSome(h);
  const a = (await request(h.app).get('/api/analytics')).body;
  const b = (await request(h.app).get('/api/analytics')).body;
  expect(b).toEqual(a); // shadow settlement never drifts between reads
  expect(/append-only|ghost|picker|grader|gatekeeper|CLV/i.test(JSON.stringify(a))).toBe(false);
});

test('PATCH settings: strings validate, the mix trio is all-or-nothing and sums to 100', async () => {
  const h = makeApp();
  const okStr = await request(h.app).patch('/api/settings')
    .send({ whatsappNumber: '+1 604 555 8112', disabledSports: 'soccer' });
  expect(okStr.status).toBe(200);
  expect(okStr.body.settings.whatsappNumber).toBe('+1 604 555 8112');
  expect((await request(h.app).patch('/api/settings').send({ whatsappNumber: 'hello' })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ whatsappNumber: '' })).status).toBe(200); // clearing is legal
  expect((await request(h.app).patch('/api/settings').send({ disabledSports: 'SOCCER!' })).status).toBe(400);

  expect((await request(h.app).patch('/api/settings').send({ mixArbPct: 50 })).status).toBe(400); // trio only
  expect((await request(h.app).patch('/api/settings')
    .send({ mixArbPct: 50, mixMiddlePct: 30, mixEvPct: 30 })).status).toBe(400); // 110 ≠ 100
  const okMix = await request(h.app).patch('/api/settings')
    .send({ mixArbPct: 100, mixMiddlePct: 0, mixEvPct: 0 });
  expect(okMix.status).toBe(200);
  expect(okMix.body.settings.mixArbPct).toBe(100);

  expect((await request(h.app).patch('/api/settings').send({ anchorFallback: 3 })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ journalMinPerDay: 5 })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ oneSportRule: 0 })).status).toBe(200);
});

test('PATCH settings: safety keys are calm-locked; advanced keys journal their changes', async () => {
  const h = makeApp();
  const ok = await request(h.app).patch('/api/settings').send({ goGentleHeat: 25 });
  expect(ok.status).toBe(200); // every book green — editable
  let texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Settings changed: goGentleHeat 30 → 25');

  h.repos.books.update('bet365', 41, 'yellow', null); // one book struggles (Plan 3 writer)
  const locked = await request(h.app).patch('/api/settings').send({ stopHeat: 70 });
  expect(locked.status).toBe(409);
  const alsoLocked = await request(h.app).patch('/api/settings').send({ oneSportRule: 0 });
  expect(alsoLocked.status).toBe(409);
  const nonSafety = await request(h.app).patch('/api/settings').send({ minEvEdgePct: 2.5 });
  expect(nonSafety.status).toBe(200); // only SAFETY keys lock
  texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Settings changed: minEvEdgePct 2 → 2.5');

  const mainPanel = await request(h.app).patch('/api/settings').send({ staleRemoveMin: 12 });
  expect(mainPanel.status).toBe(200);
  expect(h.repos.journal.all().some((j) => j.text.includes('staleRemoveMin'))).toBe(false); // not advanced — no journal
});

// ---- settings view read model + routes (Task 4) -------------------------------

test('GET /api/settings/view: one payload, live derivations, sim-honest fields', async () => {
  const h = makeApp();
  await promoteSome(h); // burn credits, write scan events, make some rows
  const res = await request(h.app).get('/api/settings/view');
  expect(res.status).toBe(200);
  const v = res.body;
  expect(v.mode).toBe('SIMULATED');
  expect(v.settings.mixArbPct).toBe(47);
  expect(v.forecaster.planMonthly).toBe(100_000);
  expect(v.forecaster.usedThisMonth).toBeGreaterThan(0);
  expect(v.forecaster.dailyAllowance).toBe(3_333); // floor(100_000 / 30)
  expect(v.forecaster.remaining).toBe(100_000 - v.forecaster.usedThisMonth);
  expect(v.brain.llmSpentCents).toBe(0); // honest zero until Plan 6 spends
  expect(v.brain.llmCapCents).toBe(300);
  expect(v.brain.weightsCustom).toBe(false);
  expect(v.books).toHaveLength(16);
  expect(v.books[0]).toMatchObject({ name: 'pinnacle', sharpExempt: true, enabled: true });
  expect(v.sports.map((x: { sport: string }) => x.sport))
    .toEqual(['baseball', 'basketball', 'hockey', 'soccer', 'tennis']);
  expect(v.safetyLocked).toBe(false);
  expect(v.memory.receipts).toBeGreaterThan(0);
  expect(v.lastTickAt).not.toBeNull();
  expect(v.backups).toEqual({ lastAt: null, keep: 14 });

  await request(h.app).patch('/api/settings').send({ heatWeightLimit: 30 });
  const custom = (await request(h.app).get('/api/settings/view')).body;
  expect(custom.brain.weightsCustom).toBe(true);
  h.repos.books.update('bet365', 41, 'yellow', null);
  expect((await request(h.app).get('/api/settings/view')).body.safetyLocked).toBe(true);
});

test('PATCH /api/books/:name: toggles + sport changes journal; sharp books refuse', async () => {
  const h = makeApp();
  const off = await request(h.app).patch('/api/books/bet365').send({ enabled: 0 });
  expect(off.status).toBe(200);
  expect(off.body.book).toMatchObject({ name: 'bet365', enabled: false });
  const sport = await request(h.app).patch('/api/books/bet365').send({ sport: 'tennis' });
  expect(sport.status).toBe(200);
  expect(sport.body.book.sport).toBe('tennis');
  const texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Books: Bet365 turned OFF'); // displayName casing per design-inventory §5.7 (plan test had the raw slug)
  expect(texts).toContain('Books: Bet365 sport basketball → tennis');

  expect((await request(h.app).patch('/api/books/pinnacle').send({ enabled: 0 })).status).toBe(409);
  expect((await request(h.app).patch('/api/books/nobody').send({ enabled: 0 })).status).toBe(404);
  expect((await request(h.app).patch('/api/books/bet365').send({ sport: 'cricket' })).status).toBe(400);
  expect((await request(h.app).patch('/api/books/bet365').send({})).status).toBe(400);
});

test('POST /api/whatsapp/test: writes the event, sends NOTHING anywhere', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/whatsapp/test');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, simulated: true });
  const rows = h.repos.eventsLog.all().filter((e) => e.kind === 'wa_test');
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toEqual({ to: null, simulated: true }); // no number set yet
});

test('exports: complete deterministic dumps, no mutation', async () => {
  const h = makeApp();
  await promoteSome(h);
  const csv = await request(h.app).get('/api/export/trades.csv');
  expect(csv.status).toBe(200);
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.headers['content-disposition']).toContain('evil-eye-trades.csv');
  const lines = csv.text.split('\n');
  expect(lines[0]!.startsWith('id,')).toBe(true);
  expect(lines[0]!).toContain('day_key');
  expect(lines.length - 1).toBe(h.repos.trades.exportRows().length); // header + one line per trade

  const json = await request(h.app).get('/api/export/all.json');
  expect(json.status).toBe(200);
  expect(json.headers['content-disposition']).toContain('evil-eye-export.json');
  for (const table of ['settings', 'profiles', 'books', 'trades', 'journal', 'eventsLog', 'creditsUsage', 'limitsReports', 'bankrollSnapshots']) {
    expect(json.body).toHaveProperty(table);
  }
  const again = await request(h.app).get('/api/export/all.json');
  expect(again.body).toEqual(json.body); // read-only — nothing moved
});

test('PATCH /api/settings refuses liveMode — POST /api/mode owns it', async () => {
  const h = makeApp();
  const res = await request(h.app).patch('/api/settings').send({ liveMode: 1 });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('/api/mode');
  expect(h.repos.settings.all().liveMode).toBe(0); // untouched
});

test('POST /api/mode: refuses LIVE with missing env NAMES (values never appear)', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/mode').send({ live: 1 });
  expect(res.status).toBe(409);
  expect(res.body.error.message).toBe(
    'cannot go live — missing: ODDS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM',
  );
  expect(h.repos.settings.all().liveMode).toBe(0); // still simulated
  expect((await request(h.app).get('/api/state')).body.mode).toBe('SIMULATED');

  const bad = await request(h.app).post('/api/mode').send({ live: 2 });
  expect(bad.status).toBe(400);

  const toSim = await request(h.app).post('/api/mode').send({ live: 0 }); // always allowed
  expect(toSim.status).toBe(200);
  expect(toSim.body.mode).toBe('SIMULATED');
});

test('sim mode never attempts a network call anywhere in the app lifecycle', async () => {
  // makeApp is amended in this task to pass a THROWING fetchImpl — if any code
  // path in the sim suite touches fetch, the whole suite fails loudly.
  const h = makeApp();
  await promoteSome(h); // scans, verifies, sends (sim sender), snapshots — no fetch
  expect((await request(h.app).get('/api/state')).body.mode).toBe('SIMULATED');
});

test('SIM is STRUCTURALLY network-inert even with a real-looking ANTHROPIC key (F7)', async () => {
  // Fake creds PRESENT + a THROWING fetch: in SIMULATED mode NO hook may touch the
  // network — the digest is gated on liveMode, not on key presence. If the digest
  // ever reached fetch it would land an 'llm_error' row (the throwing stub is caught).
  const h = makeApp(NOW, { ANTHROPIC_API_KEY: 'fake-key-would-be-billable' });
  h.repos.journal.add(NOW - 1, 'Daily check: 16 of 16 books green'); // a line the digest would consume
  await h.scheduler.pump(); // provider.refresh? + every hook + due actions — must attempt ZERO network
  const kinds = h.repos.eventsLog.all().map((e) => e.kind);
  expect(kinds).not.toContain('llm_error');          // a real fetch attempt would surface here
  expect(kinds).not.toContain('llm_spend');
  expect(kinds).not.toContain('llm_skipped_budget');
  expect(h.repos.journal.all().some((j) => j.text.startsWith('Consolidation digest:'))).toBe(false);
  expect(h.repos.settings.all().liveMode).toBe(0);   // never left SIMULATED
});
