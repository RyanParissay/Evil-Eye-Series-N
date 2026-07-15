// Pipeline core loop (Task 11) — scan creates PENDING work without money on
// it; the 75s recheck promotes (stakes appear) or kills. In-memory db, seeded
// sim provider, fake now — tests never sleep and never touch Math.random.
import { expect, test } from 'vitest';
import { openDb, Repos } from '../db/db.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import type { AlertSender, Leg, OddsProvider, Quote, Trade } from '../shared/types.js';
import { runScan, type PipeDeps } from './scan.js';
import { runVerifyDue } from './verify.js';

/** mulberry32 — deterministic PRNG; same helper as the sim provider tests. */
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

const NOW = 1_784_000_000_000; // 2026-07-13 ~20:33 Vancouver — same day across the whole loop
const VNOW = NOW + 75_000; //    one default verify gap later
const DAY = dayKey(NOW);

/** Refetches replay the scan snapshot verbatim (drift frozen) — recheck edge equals initial edge. */
function frozen(base: OddsProvider): OddsProvider {
  let first: Quote[] | null = null;
  return {
    fetchQuotes(now: number): Quote[] {
      first ??= base.fetchQuotes(now);
      return first.map((q) => ({ ...q, fetchedAt: now }));
    },
  };
}

/** First fetch is the real snapshot; every refetch collapses all odds by `factor`. */
function collapsed(base: OddsProvider, factor: number): OddsProvider {
  let first: Quote[] | null = null;
  return {
    fetchQuotes(now: number): Quote[] {
      if (!first) {
        first = base.fetchQuotes(now);
        return first;
      }
      return first.map((q) => ({ ...q, odds: Math.round(q.odds * factor * 1000) / 1000, fetchedAt: now }));
    },
  };
}

function makeHarness(wrap: (base: OddsProvider) => OddsProvider = (p) => p) {
  const db = openDb(':memory:');
  const repos = Repos(db);
  const rng = mulberry32(42);
  const sent: Trade[] = [];
  const sender: AlertSender = {
    sendVerified(t: Trade): void {
      sent.push(t);
      repos.eventsLog.add(t.verifiedAt ?? 0, 'alert', JSON.stringify({ id: t.id, category: t.category }));
    },
  };
  const deps: PipeDeps = { repos, provider: wrap(SimOddsProvider(rng)), sender, s: () => repos.settings.all(), rng };
  return { db, repos, deps, sent };
}

/** Hand-built trade for direct inserts; books/markets deliberately off the sim roster. */
function mkTrade(o: Partial<Trade> & { id: string }): Trade {
  return {
    profileId: 1,
    category: 'EV',
    event: `SEED-${o.id}`,
    sport: 'baseball',
    legs: [{ book: 'seedbook', selection: 'home', odds: 2.0, stakeCents: null }],
    marginInitial: 0.03,
    marginRecheck: null,
    marginFinal: null,
    status: 'PENDING',
    killReason: null,
    resultCents: null,
    createdAt: NOW - 10_000,
    verifyDueAt: NOW + 600_000,
    verifiedAt: null,
    freshUntil: null,
    settledAt: null,
    eventStartsAt: NOW + 3_600_000,
    ...o,
  };
}

test('scan creates PENDING trades with null stakes and 75s verifyDueAt', () => {
  const { deps, repos } = makeHarness();
  const res = runScan(deps, NOW);

  expect(res.created).toBeGreaterThan(0);
  const pending = repos.trades.byStatus('PENDING');
  expect(pending).toHaveLength(res.created);
  for (const t of pending) {
    expect(t.status).toBe('PENDING');
    expect(t.verifyDueAt).toBe(NOW + 75_000); // default verifyGapSecs = 75
    expect(t.createdAt).toBe(NOW);
    expect(t.verifiedAt).toBeNull();
    expect(t.freshUntil).toBeNull();
    expect(t.marginInitial).toBeGreaterThan(0);
    expect(t.marginRecheck).toBeNull();
    expect(t.marginFinal).toBeNull();
    for (const leg of t.legs) expect(leg.stakeCents).toBeNull();
  }
  // Battery kills land in the graveyard with their reason, never counted as sent.
  const killedRows = repos.trades.byStatus('KILLED');
  expect(killedRows).toHaveLength(res.killed);
  for (const t of killedRows) expect(t.killReason).not.toBeNull();
  // One provider snapshot = one credit; the scan is journaled to the events log.
  const credits = repos.credits.all();
  expect(credits).toHaveLength(1);
  expect(credits[0]!.n).toBe(1);
  expect(repos.eventsLog.all().some((e) => e.kind === 'scan')).toBe(true);
  // Snapshot cached on deps for the recheck.
  expect(deps.lastQuotes?.length ?? 0).toBeGreaterThan(0);
});

test('verify: edge held → VERIFIED with rounded stakes, fresh window, alert logged', () => {
  const { deps, repos, sent } = makeHarness(frozen);
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);
  repos.settings.set({ dailyPickCap: 100 }); // s() is read fresh per call — the recheck must see this

  const res = runVerifyDue(deps, VNOW);
  expect(res).toEqual({ promoted: scan.created, killed: 0, expired: 0 });
  expect(repos.trades.byStatus('PENDING')).toHaveLength(0);

  const verified = repos.trades.byStatus('VERIFIED');
  expect(verified).toHaveLength(scan.created);
  for (const t of verified) {
    expect(t.verifiedAt).toBe(VNOW);
    expect(t.freshUntil).toBe(VNOW + 120_000); // default freshWindowSecs = 120
    expect(t.marginRecheck).not.toBeNull();
    expect(t.marginRecheck!).toBeCloseTo(t.marginInitial, 12); // frozen quotes: edge held exactly
    expect(t.marginFinal).not.toBeNull();
    for (const leg of t.legs) {
      expect(leg.stakeCents).not.toBeNull();
      expect(leg.stakeCents! % 500).toBe(0); // $5 rounding
      // ARB split and promoted EV Kelly always clear the $10 floor; a costed
      // middle may Kelly to 0 (no stake is not a stake — the floor never applies).
      if (t.category !== 'MIDDLE') expect(leg.stakeCents!).toBeGreaterThanOrEqual(1_000);
      else expect(leg.stakeCents!).toBeGreaterThanOrEqual(0);
    }
  }
  // Every promotion fired exactly one alert; the sim sender logs each to events_log.
  expect(sent.map((t) => t.id).sort()).toEqual(verified.map((t) => t.id).sort());
  expect(repos.eventsLog.all().filter((e) => e.kind === 'alert')).toHaveLength(res.promoted);
});

test('verify: edge collapsed beyond tolerance → KILLED FAILED_VERIFICATION', () => {
  const { deps, repos, sent } = makeHarness((p) => collapsed(p, 0.9)); // ~10% odds drop >> 5% tolerance
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);

  const res = runVerifyDue(deps, VNOW);
  expect(res).toEqual({ promoted: 0, killed: scan.created, expired: 0 });
  expect(repos.trades.byStatus('VERIFIED')).toHaveLength(0);
  expect(sent).toHaveLength(0);

  const failed = repos.trades.byStatus('KILLED').filter((t) => t.killReason === 'FAILED_VERIFICATION');
  expect(failed).toHaveLength(scan.created);
  for (const t of failed) {
    expect(t.verifiedAt).toBeNull();
    expect(t.marginRecheck).not.toBeNull();
    expect(t.marginRecheck!).toBeLessThan(t.marginInitial); // the collapse was recorded
    for (const leg of t.legs) expect(leg.stakeCents).toBeNull(); // killed trades never carry stakes
  }
});

test('daily pick cap: 13th promotion of the day → EXPIRED, journal notes held back', () => {
  const { deps, repos } = makeHarness(frozen);
  // 11 picks already sent today: the next promotion is the 12th (fills the cap),
  // the one after that is the 13th (held back).
  for (let i = 0; i < 11; i++) {
    repos.trades.insert(
      mkTrade({
        id: `seed-${i}`,
        status: 'VERIFIED',
        legs: [{ book: 'seedbook', selection: 'home', odds: 2.0, stakeCents: 1_500 }],
        verifiedAt: NOW - 1_000,
        freshUntil: NOW + 120_000, // still fresh — the stale sweep must not touch these
        marginRecheck: 0.03,
        marginFinal: 0.03,
      }),
      DAY,
      'seed-market',
    );
  }

  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(1); // need both a 12th and a 13th attempt

  const res = runVerifyDue(deps, VNOW);
  expect(res.promoted).toBe(1); // the 12th of the day fills the cap
  expect(res.killed).toBe(0);
  expect(res.expired).toBe(scan.created - 1); // everything past the cap is held back
  expect(repos.trades.verifiedSentToday(DAY)).toBe(12); // cap never exceeded

  const heldBack = repos.trades.byStatus('EXPIRED');
  expect(heldBack).toHaveLength(scan.created - 1);
  for (const t of heldBack) {
    expect(t.verifiedAt).toBeNull(); // held back was never sent
    for (const leg of t.legs) expect(leg.stakeCents).toBeNull();
  }
  expect(repos.journal.all().some((j) => j.text.includes('held back'))).toBe(true);
});

test('stale sweep: VERIFIED past freshUntil+10min → EXPIRED', () => {
  const { deps, repos } = makeHarness();
  let fetches = 0;
  const base = deps.provider;
  deps.provider = {
    fetchQuotes(now: number): Quote[] {
      fetches += 1;
      return base.fetchQuotes(now);
    },
  };
  const verifiedLegs: Leg[] = [{ book: 'seedbook', selection: 'home', odds: 2.0, stakeCents: 1_500 }];
  repos.trades.insert(
    mkTrade({
      id: 'stale', status: 'VERIFIED', legs: verifiedLegs, verifiedAt: NOW - 800_000,
      freshUntil: NOW - 601_000, marginRecheck: 0.03, marginFinal: 0.03, // 10min+1s past fresh
    }),
    DAY, 'seed-market',
  );
  repos.trades.insert(
    mkTrade({
      id: 'boundary', status: 'VERIFIED', legs: verifiedLegs, verifiedAt: NOW - 700_000,
      freshUntil: NOW - 600_000, marginRecheck: 0.03, marginFinal: 0.03, // exactly 10min past fresh
    }),
    DAY, 'seed-market',
  );
  repos.trades.insert(
    mkTrade({ id: 'started', eventStartsAt: NOW - 1, verifyDueAt: NOW + 50_000 }), // PENDING, not yet due
    DAY, 'seed-market',
  );

  const res = runVerifyDue(deps, NOW);
  expect(res).toEqual({ promoted: 0, killed: 0, expired: 2 });
  expect(repos.trades.byId('stale')!.status).toBe('EXPIRED');
  expect(repos.trades.byId('boundary')!.status).toBe('VERIFIED'); // "older than" is strict
  expect(repos.trades.byId('started')!.status).toBe('EXPIRED'); // event started → pending expires
  expect(fetches).toBe(0); // no due PENDING work — the sweep never spends a fetch
});

test('no stakes ever appear on PENDING serializations', () => {
  const { deps, repos, db } = makeHarness();
  runScan(deps, NOW);

  const rows = db.prepare("SELECT legs FROM trades WHERE status = 'PENDING'").all() as { legs: string }[];
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(/"stakeCents":\s*\d/.test(r.legs)).toBe(false); // stored JSON carries no amounts
    for (const leg of JSON.parse(r.legs) as Leg[]) expect(leg.stakeCents).toBeNull();
  }
  for (const t of repos.trades.byStatus('PENDING')) {
    expect(/"stakeCents":\s*\d/.test(JSON.stringify(t))).toBe(false); // nor does any API-bound shape
  }
});
