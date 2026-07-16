import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Trade } from '../shared/types.js';
import { runSimSettlement } from '../pipeline/actions.js';
import { modeLabel, wireMode } from './mode.js';

const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;

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

test('modeLabel follows the settings key', () => {
  const deps = mkDeps();
  expect(modeLabel(deps.s())).toBe('SIMULATED');
  deps.repos.settings.set({ liveMode: 1 });
  expect(modeLabel(deps.s())).toBe('LIVE');
});

test('wireMode: sim wires the sim provider (no refresh); live wires the live pair', () => {
  const deps = mkDeps();
  expect(wireMode(deps, {} as NodeJS.ProcessEnv, deps.repos, throwing)).toBe('SIMULATED');
  expect(deps.provider.refresh).toBeUndefined(); // sim provider has no refresh

  deps.repos.settings.set({ liveMode: 1 });
  const env = {
    ODDS_API_KEY: 'fake', TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111', WHATSAPP_DEV_MODE: 'true',
  } as NodeJS.ProcessEnv;
  expect(wireMode(deps, env, deps.repos, throwing)).toBe('LIVE');
  expect(typeof deps.provider.refresh).toBe('function'); // the live provider took the seam
  deps.sender.sendVerified({ // dev mode: events only — the throwing fetch proves no network
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2, stakeCents: 1_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: 0, verifyDueAt: 0, verifiedAt: 0,
    freshUntil: 1, settledAt: null, eventStartsAt: 9,
  });
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_dev')).toBe(true);
});

test('LIVE mode never rng-settles — sim settlement is a no-op on real money (Design §13)', () => {
  const deps = mkDeps();
  const confirmed: Trade = {
    id: 'real-1', profileId: 1, category: 'EV', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 2_000 }],
    marginInitial: 0.03, marginRecheck: 0.03, marginFinal: 0.03, status: 'CONFIRMED',
    killReason: null, resultCents: null, createdAt: 0, verifyDueAt: 0, verifiedAt: 0,
    freshUntil: 1, settledAt: null, eventStartsAt: 0, // +3h cutoff long past at NOW below
  };
  deps.repos.trades.insert(confirmed, '2026-07-14', null);
  // Sanctioned unit pattern (HARD GATE 1, same as the wireMode unit above): the key is
  // set directly on the isolated repos — no POST /api/mode, no wiring, no network.
  deps.repos.settings.set({ liveMode: 1 });
  const NOW = Date.UTC(2026, 6, 14, 19, 0);
  expect(runSimSettlement(deps, NOW)).toEqual({ settled: 0, won: 0, lost: 0 });
  expect(deps.repos.trades.byId('real-1')!.status).toBe('CONFIRMED'); // untouched — no fabricated money
  expect(deps.repos.trades.byId('real-1')!.resultCents).toBeNull();
  deps.repos.settings.set({ liveMode: 0 });
  expect(runSimSettlement(deps, NOW).settled).toBe(1); // paper money settles exactly as before
});
