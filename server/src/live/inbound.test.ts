import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Trade } from '../shared/types.js';
import { inboundPollHook, pollInbound } from './inbound.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 12:00 PDT — awake
const QUIET = Date.UTC(2026, 6, 14, 9, 0); // 02:00 PDT — quiet hours

const ENV = {
  TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
} as NodeJS.ProcessEnv;

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

function sentVerified(id: string, verifiedAt: number): Trade {
  return {
    id, profileId: 1, category: 'ARB', event: `E-${id}`, sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: verifiedAt, verifyDueAt: verifiedAt,
    verifiedAt, freshUntil: verifiedAt + 120_000, settledAt: null, eventStartsAt: verifiedAt + 3_600_000,
  };
}

function twilioListResponse(messages: { sid: string; body: string; date_sent: string }[]): Response {
  return new Response(JSON.stringify({ messages }), { status: 200 });
}

test("reply '1' confirms the newest sent VERIFIED trade exactly once (SID dedupe)", async () => {
  const deps = mkDeps();
  deps.repos.trades.insert(sentVerified('old', NOW - 60_000), '2026-07-14', null);
  deps.repos.trades.insert(sentVerified('new', NOW - 10_000), '2026-07-14', null);
  const fetchImpl = (async () => twilioListResponse([
    { sid: 'SM1', body: '1', date_sent: new Date(NOW - 5_000).toISOString() },
  ])) as typeof fetch;

  expect(await pollInbound(deps, fetchImpl, ENV, NOW)).toBe(1);
  expect(deps.repos.trades.byId('new')!.status).toBe('CONFIRMED');
  expect(deps.repos.trades.byId('old')!.status).toBe('VERIFIED'); // newest wins, not both

  expect(await pollInbound(deps, fetchImpl, ENV, NOW + 45_000)).toBe(0); // SM1 already handled
  const replies = deps.repos.eventsLog.all().filter((e) => e.kind === 'wa_reply');
  expect(replies).toHaveLength(1);
});

test("reply '3' journals the in-app pointer; reply '1' with nothing live journals honestly", async () => {
  const deps = mkDeps();
  const fetchImpl = (async () => twilioListResponse([
    { sid: 'SM2', body: '3', date_sent: new Date(NOW - 5_000).toISOString() },
    { sid: 'SM3', body: '1 SECURED', date_sent: new Date(NOW - 4_000).toISOString() },
  ])) as typeof fetch;
  await pollInbound(deps, fetchImpl, ENV, NOW);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('WhatsApp reply 3 received — report the limit with book and amount on the TRADES screen');
  expect(texts).toContain('WhatsApp reply 1 received — nothing awaiting confirmation');
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_reply_limited')).toBe(true);
});

test('the hook gates on live mode + quiet hours and paces at 45s', () => {
  const deps = mkDeps();
  const hook = inboundPollHook(deps, (async () => twilioListResponse([])) as typeof fetch, ENV);
  expect(hook.nextAt(NOW)).toBeNull();               // sim mode → never
  deps.repos.settings.set({ liveMode: 1 });
  expect(hook.nextAt(NOW)).toBe(NOW);                // live, never polled → now
  deps.repos.eventsLog.add(NOW, 'wa_poll', '{}');
  expect(hook.nextAt(NOW + 10_000)).toBe(NOW + 45_000); // watermark + 45s
  expect(hook.nextAt(QUIET)).toBeNull();             // quiet hours → no polls
});

test('poll failures write wa_error and resolve — the chain survives', async () => {
  const deps = mkDeps();
  const failing = (async () => { throw new Error('twilio down'); }) as unknown as typeof fetch;
  expect(await pollInbound(deps, failing, ENV, NOW)).toBe(0); // resolves, no reject
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_error')).toBe(true);
});
