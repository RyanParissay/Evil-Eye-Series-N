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

function makeApp(startNow: number = NOW) {
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
  });
  return { ...made, sent, timers, advance: (ms: number): void => { now += ms; } };
}

/** Scan then advance past the 75s verify gap and tick — yields VERIFIED trades. */
async function promoteSome(h: ReturnType<typeof makeApp>) {
  await request(h.app).post('/api/scan').expect(200);
  h.advance(76_000);
  h.scheduler.tick();
  const state = await request(h.app).get('/api/state').expect(200);
  return state.body.trades.verified as Array<{ id: string; status: string }>;
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
  expect(h.timers[1]!.ms).toBe(75_000); // next due work is the 75s verify recheck
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

  h.timers[0]!.fn(); // boot tick: immediate scan, chain arms the +75s verify wake
  h.advance(76_000);
  h.timers[1]!.fn(); // wave-1 verify runs, chain arms the next cadence scan
  expect(h.timers).toHaveLength(3);
  expect(h.timers[2]!.ms).toBeGreaterThan(75_000); // mid-cadence sleep: the next wake is minutes away

  h.advance(120_000); // two minutes into the sleep — the common manual-scan moment
  const scanAt = NOW + 76_000 + 120_000;
  const scan = await request(h.app).post('/api/scan').expect(200);
  expect(scan.body.scan.created).toBeGreaterThan(0);

  // The manual scan must re-arm the chain: exactly ONE new wake, due at the
  // +75s verify recheck — NOT left to the old cadence wake minutes out.
  expect(h.timers).toHaveLength(4);
  expect(h.timers[3]!.ms).toBe(75_000);

  // Firing that wake at +75s verifies the manual scan's pendings on time.
  h.advance(75_000);
  h.timers[3]!.fn();
  const state = await request(h.app).get('/api/state').expect(200);
  expect(state.body.trades.pending).toHaveLength(0);
  const wave2 = (state.body.trades.verified as Array<{ verifiedAt: number | null }>)
    .filter((t) => t.verifiedAt === scanAt + 75_000);
  expect(wave2.length).toBeGreaterThan(0);
});

test('stale wake after a manual scan is a no-op: no double scan, no extra timer, cadence intact', async () => {
  const h = makeApp();
  h.timers[0]!.fn(); // boot scan; +75s verify wake armed
  h.advance(76_000);
  h.timers[1]!.fn(); // wave-1 verify; cadence scan wake armed — mid-cadence sleep begins
  const staleWake = h.timers[2]!; // superseded by the manual scan below

  h.advance(60_000);
  await request(h.app).post('/api/scan').expect(200);
  expect(h.timers).toHaveLength(4); // the manual scan armed the replacement wake

  h.advance(75_000);
  h.timers[3]!.fn(); // the live chain's wake: due work runs, next wake armed
  const timerCount = h.timers.length;
  const trades = tradeCount(h);
  const at = NOW + 76_000 + 60_000 + 75_000;
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
  expect(got.body.settings.verifyGapSecs).toBe(75); // untouched keys keep defaults
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
    createdAt: now, verifyDueAt: now + 75_000, verifiedAt: null, freshUntil: null,
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
