// Trade actions + sim settlement (Task 12). The user-facing verbs: the
// confirm/unconfirm cycle, limited reports, manual settlement — plus the sim
// auto-settlement pass that resolves stale CONFIRMED/UNCONFIRMED trades via
// the seeded rng. In-memory db, stub rng, fake now — tests never sleep.
import { expect, test } from 'vitest';
import { openDb, Repos } from '../db/db.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import type { AlertSender, OddsProvider, Trade } from '../shared/types.js';
import type { PipeDeps } from './scan.js';
import {
  ConflictError,
  NotFoundError,
  confirmTrade,
  reportLimited,
  runSimSettlement,
  settleTrade,
  unconfirmTrade,
} from './actions.js';

const NOW = 1_784_000_000_000; // 2026-07-13 ~20:33 Vancouver — same instant as the pipeline tests
const DAY = dayKey(NOW);
const H3 = 3 * 3_600_000; // sim settlement cutoff: eventStartsAt + 3h < now

/** Hand-built fixture; defaults are a promoted single-leg EV (stakes present from VERIFIED on). */
function mkTrade(o: Partial<Trade> & { id: string }): Trade {
  return {
    profileId: 1,
    category: 'EV',
    event: `SEED-${o.id}`,
    sport: 'baseball',
    legs: [{ book: 'seedbook', selection: 'home', odds: 2.1, stakeCents: 1_500 }],
    marginInitial: 0.03,
    marginRecheck: 0.03,
    marginFinal: 0.03,
    status: 'VERIFIED',
    killReason: null,
    resultCents: null,
    createdAt: NOW - 200_000,
    verifyDueAt: NOW - 190_000,
    verifiedAt: NOW - 100_000,
    freshUntil: NOW + 20_000,
    settledAt: null,
    eventStartsAt: NOW + 3_600_000,
    ...o,
  };
}

function harness(rolls: number[] = []) {
  const db = openDb(':memory:');
  const repos = Repos(db);
  let fetches = 0;
  const provider: OddsProvider = {
    fetchQuotes: () => {
      fetches += 1;
      return [];
    },
  };
  const sender: AlertSender = { sendVerified: () => {} };
  let i = 0;
  const rng = () => (i < rolls.length ? rolls[i++]! : 0.999); // queued rolls, then always-lose
  const deps: PipeDeps = { repos, provider, sender, s: () => repos.settings.all(), rng };
  return { repos, deps, fetched: () => fetches };
}

// ---- the confirm/unconfirm cycle -------------------------------------------

test('confirmTrade: VERIFIED → CONFIRMED, persisted and returned', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a' }), DAY);

  const t = confirmTrade(repos, 'a', NOW);
  expect(t.status).toBe('CONFIRMED');
  expect(repos.trades.byId('a')!.status).toBe('CONFIRMED');
  expect(repos.trades.byId('a')!.resultCents).toBeNull(); // confirm never touches money
});

test('unconfirmTrade: CONFIRMED → VERIFIED (the UI cycle back)', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED' }), DAY);

  const t = unconfirmTrade(repos, 'a', NOW);
  expect(t.status).toBe('VERIFIED');
  expect(repos.trades.byId('a')!.status).toBe('VERIFIED');
});

test('double-taps are no-op successes: confirm a CONFIRMED, unconfirm a VERIFIED', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED' }), DAY);
  repos.trades.insert(mkTrade({ id: 'b' }), DAY); // VERIFIED

  expect(confirmTrade(repos, 'a', NOW).status).toBe('CONFIRMED'); // re-applying the current status
  expect(unconfirmTrade(repos, 'b', NOW).status).toBe('VERIFIED');
  expect(repos.trades.byId('a')!.status).toBe('CONFIRMED');
  expect(repos.trades.byId('b')!.status).toBe('VERIFIED');
});

test('invalid transitions throw ConflictError and leave the trade untouched', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'p', status: 'PENDING', legs: [{ book: 'seedbook', selection: 'home', odds: 2.1, stakeCents: null }], marginRecheck: null, marginFinal: null, verifiedAt: null, freshUntil: null }), DAY);
  repos.trades.insert(mkTrade({ id: 'v' }), DAY); // VERIFIED

  expect(() => confirmTrade(repos, 'p', NOW)).toThrow(ConflictError);
  expect(repos.trades.byId('p')!.status).toBe('PENDING');
  // Settlement needs the confirm decision first: VERIFIED never settles by hand either.
  expect(() => settleTrade(repos, 'v', 'WON', 1_000, NOW)).toThrow(ConflictError);
  expect(repos.trades.byId('v')!.status).toBe('VERIFIED');
});

test('missing trade id throws NotFoundError, distinguishable from ConflictError', () => {
  const { repos } = harness();
  expect(() => confirmTrade(repos, 'nope', NOW)).toThrow(NotFoundError);
  expect(() => unconfirmTrade(repos, 'nope', NOW)).toThrow(NotFoundError);
  expect(() => settleTrade(repos, 'nope', 'WON', 1_000, NOW)).toThrow(NotFoundError);
  expect(() => reportLimited(repos, 'nope', 'bet365', 5_000, NOW)).toThrow(NotFoundError);
  // Task 13 maps 404 vs 409 off the class — they must never blur together.
  expect(new NotFoundError('x')).not.toBeInstanceOf(ConflictError);
  expect(new ConflictError('x')).not.toBeInstanceOf(NotFoundError);
});

// ---- limited reports ---------------------------------------------------------

test('reportLimited: writes limits_reports + journal, trade status unchanged', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED' }), DAY);

  reportLimited(repos, 'a', 'bet365', 2_500, NOW);

  const reports = repos.limitsReports.all();
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ tradeId: 'a', book: 'bet365', maxAllowedCents: 2_500, sentAt: NOW });
  const journal = repos.journal.all();
  expect(journal).toHaveLength(1);
  expect(journal[0]!.ts).toBe(NOW);
  expect(journal[0]!.text).toContain('bet365');
  expect(repos.trades.byId('a')!.status).toBe('CONFIRMED'); // limited ≠ any status change
});

// ---- manual settlement -------------------------------------------------------

test('settleTrade WON: CONFIRMED → SETTLED with positive resultCents and settledAt', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED' }), DAY);

  const t = settleTrade(repos, 'a', 'WON', 2_000, NOW);
  expect(t.status).toBe('SETTLED');
  expect(t.resultCents).toBe(2_000);
  expect(t.settledAt).toBe(NOW);
  expect(repos.trades.byId('a')).toMatchObject({ status: 'SETTLED', resultCents: 2_000, settledAt: NOW });
});

test('settleTrade LOST: UNCONFIRMED → SETTLED with NEGATIVE resultCents', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'UNCONFIRMED' }), DAY);

  const t = settleTrade(repos, 'a', 'LOST', 1_500, NOW);
  expect(t.resultCents).toBe(-1_500); // losses are signed — the caller sends the magnitude
  expect(t.status).toBe('SETTLED');
});

test('settleTrade double-tap on SETTLED is a no-op: the original result survives', () => {
  const { repos } = harness();
  repos.trades.insert(mkTrade({ id: 'a', status: 'SETTLED', resultCents: 777, settledAt: NOW - 5_000 }), DAY);

  const t = settleTrade(repos, 'a', 'LOST', 9_999, NOW);
  expect(t.resultCents).toBe(777);
  expect(t.settledAt).toBe(NOW - 5_000);
  expect(repos.trades.byId('a')!.resultCents).toBe(777);
});

// ---- sim settlement ----------------------------------------------------------

/** Promoted two-leg ARB fixture: $75/$25 at 1.347/4.04, marginFinal 1.008%. */
function arbTrade(o: Partial<Trade> & { id: string }): Trade {
  return mkTrade({
    category: 'ARB',
    sport: 'basketball',
    legs: [
      { book: 'bet365', selection: 'home', odds: 1.347, stakeCents: 7_500 },
      { book: 'fanduel', selection: 'away', odds: 4.04, stakeCents: 2_500 },
    ],
    marginInitial: 0.01008,
    marginRecheck: 0.01008,
    marginFinal: 0.01008,
    ...o,
  });
}

test('sim settlement: ARB always WON, paying exactly round(totalStaked × marginFinal)', () => {
  // rng is the always-lose 0.999 — an ARB must ignore the roll entirely.
  const { repos, deps, fetched } = harness();
  repos.trades.insert(arbTrade({ id: 'arb', status: 'CONFIRMED', eventStartsAt: NOW - H3 - 60_000 }), DAY);

  const res = runSimSettlement(deps, NOW);
  expect(res).toEqual({ settled: 1, won: 1, lost: 0 });

  const t = repos.trades.byId('arb')!;
  expect(t.status).toBe('SETTLED');
  expect(t.settledAt).toBe(NOW);
  expect(t.resultCents).toBe(Math.round(10_000 * 0.01008)); // 100.8 → 101, the rounded margin exactly
  expect(t.resultCents).toBe(101);
  expect(fetched()).toBe(0); // settlement never spends a provider fetch
  expect(repos.credits.all()).toHaveLength(0); // …or a credit
});

test('sim settlement: EV win (roll < 0.55) pays stake × (odds − 1); loss forfeits the stake', () => {
  const { repos, deps } = harness([0.5, 0.6]); // first roll wins, second loses
  repos.trades.insert(mkTrade({ id: 'win', status: 'CONFIRMED', createdAt: NOW - 200_000, eventStartsAt: NOW - H3 - 1 }), DAY);
  repos.trades.insert(mkTrade({ id: 'lose', status: 'CONFIRMED', createdAt: NOW - 100_000, eventStartsAt: NOW - H3 - 1 }), DAY);

  const res = runSimSettlement(deps, NOW);
  expect(res).toEqual({ settled: 2, won: 1, lost: 1 });
  expect(repos.trades.byId('win')!.resultCents).toBe(1_650); // round(1500 × 2.1) − 1500
  expect(repos.trades.byId('lose')!.resultCents).toBe(-1_500); // the whole stake, signed
});

test('sim settlement: MIDDLE win (roll < 0.30) pays both legs; miss pays the worse leg', () => {
  const { repos, deps } = harness([0.25, 0.35]);
  repos.trades.insert(
    mkTrade({
      id: 'hit', category: 'MIDDLE', status: 'CONFIRMED', createdAt: NOW - 200_000, eventStartsAt: NOW - H3 - 1,
      legs: [
        { book: 'pointsbet', selection: 'over', odds: 1.95, stakeCents: 5_000 },
        { book: 'bet365', selection: 'under', odds: 1.95, stakeCents: 5_000 },
      ],
      marginFinal: 0.0243,
    }),
    DAY,
  );
  repos.trades.insert(
    mkTrade({
      id: 'miss', category: 'MIDDLE', status: 'CONFIRMED', createdAt: NOW - 100_000, eventStartsAt: NOW - H3 - 1,
      legs: [
        { book: 'pointsbet', selection: 'over', odds: 2.2, stakeCents: 4_000 },
        { book: 'bet365', selection: 'under', odds: 1.8, stakeCents: 5_000 },
      ],
      marginFinal: 0.02,
    }),
    DAY,
  );

  const res = runSimSettlement(deps, NOW);
  expect(res).toEqual({ settled: 2, won: 1, lost: 1 });
  // Hit: both legs cash — round(5000×1.95 + 5000×1.95) − 10000.
  expect(repos.trades.byId('hit')!.resultCents).toBe(9_500);
  // Miss: one side cashes; the worse payout is the basis — round(min(8800, 9000)) − 9000.
  expect(repos.trades.byId('miss')!.resultCents).toBe(-200);
});

test('sim settlement scope: UNCONFIRMED settles, VERIFIED never does, 3h cutoff is strict', () => {
  const { repos, deps } = harness();
  repos.trades.insert(arbTrade({ id: 'unconf', status: 'UNCONFIRMED', eventStartsAt: NOW - H3 - 1 }), DAY);
  // VERIFIED trades expire via the pipeline sweep (Task 11) — settlement must never touch them.
  repos.trades.insert(arbTrade({ id: 'verified', status: 'VERIFIED', eventStartsAt: NOW - H3 - 60_000 }), DAY);
  repos.trades.insert(arbTrade({ id: 'boundary', status: 'CONFIRMED', eventStartsAt: NOW - H3 }), DAY); // +3h == now, not < now
  repos.trades.insert(arbTrade({ id: 'future', status: 'CONFIRMED', eventStartsAt: NOW + 3_600_000 }), DAY);

  const res = runSimSettlement(deps, NOW);
  expect(res).toEqual({ settled: 1, won: 1, lost: 0 });
  expect(repos.trades.byId('unconf')!.status).toBe('SETTLED');
  expect(repos.trades.byId('unconf')!.resultCents).toBe(101);
  expect(repos.trades.byId('verified')!.status).toBe('VERIFIED');
  expect(repos.trades.byId('verified')!.resultCents).toBeNull();
  expect(repos.trades.byId('boundary')!.status).toBe('CONFIRMED');
  expect(repos.trades.byId('future')!.status).toBe('CONFIRMED');
});

test('sim settlement rolls in a fixed order: CONFIRMED (oldest first), then UNCONFIRMED', () => {
  // The UNCONFIRMED trade is OLDER — if settlement ordered by age across both
  // statuses it would take the winning roll instead. Reproducible sims need
  // the order pinned.
  const { repos, deps } = harness([0.5, 0.6]);
  repos.trades.insert(mkTrade({ id: 'conf-ev', status: 'CONFIRMED', createdAt: NOW - 100_000, eventStartsAt: NOW - H3 - 1 }), DAY);
  repos.trades.insert(mkTrade({ id: 'unconf-ev', status: 'UNCONFIRMED', createdAt: NOW - 900_000, eventStartsAt: NOW - H3 - 1 }), DAY);

  runSimSettlement(deps, NOW);
  expect(repos.trades.byId('conf-ev')!.resultCents).toBe(1_650); // took the 0.5 → won
  expect(repos.trades.byId('unconf-ev')!.resultCents).toBe(-1_500); // took the 0.6 → lost
});

test('sim settlement logs one events_log row per run that settles anything', () => {
  const { repos, deps } = harness();
  repos.trades.insert(arbTrade({ id: 'arb', status: 'CONFIRMED', eventStartsAt: NOW - H3 - 1 }), DAY);

  runSimSettlement(deps, NOW); // settles 1 → logs
  runSimSettlement(deps, NOW); // nothing left → silent
  const rows = repos.eventsLog.all().filter((e) => e.kind === 'settlement');
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toEqual({ settled: 1, won: 1, lost: 0 });
});
