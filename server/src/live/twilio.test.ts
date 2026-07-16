import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { Trade } from '../shared/types.js';
import { TwilioWhatsAppSender, verifiedMessageText } from './twilio.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);

function verified(): Trade {
  return {
    id: 't1', profileId: 1, category: 'ARB', event: 'Arsenal vs Chelsea', sport: 'soccer',
    legs: [
      { book: 'bet365', selection: 'home', odds: 3.1, stakeCents: 3_500 },
      { book: 'pinnacle', selection: 'draw', odds: 3.65, stakeCents: 3_000 },
    ],
    marginInitial: 0.1, marginRecheck: 0.1, marginFinal: 0.1, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: NOW, verifyDueAt: NOW,
    verifiedAt: NOW, freshUntil: NOW + 120_000, settledAt: null, eventStartsAt: NOW + 3_600_000,
  };
}

test('verifiedMessageText: verbatim card semantics + reply codes + optional link', () => {
  const text = verifiedMessageText(verified(), 'http://localhost:3000');
  expect(text).toContain('ARB Arsenal vs Chelsea · SOCCER');
  expect(text).toContain('Bet365 — home @ 3.10 │ BET $35');
  expect(text).toContain('Pinnacle — draw @ 3.65 │ BET $30');
  expect(text).toContain('MARGIN: 10.0%');
  expect(text).toContain('Reply 1 SECURED · 3 LIMITED');
  expect(text).toContain('http://localhost:3000');
  expect(verifiedMessageText(verified(), undefined)).not.toContain('http');
});

test('dev mode short-circuits BEFORE any network — throwing fetch proves it', () => {
  const repos = Repos(openDb(':memory:'));
  const fetchImpl = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const sender = TwilioWhatsAppSender(fetchImpl, { WHATSAPP_DEV_MODE: 'true' } as NodeJS.ProcessEnv, repos, () => NOW);
  sender.sendVerified(verified()); // must not throw
  const kinds = repos.eventsLog.all().map((e) => e.kind);
  expect(kinds).toContain('alert');   // same signal the sim sender writes
  expect(kinds).toContain('wa_dev');  // marked as a dev-mode send
});

test('live mode posts Messages.json with basic auth; failures log wa_error, never throw', async () => {
  const repos = Repos(openDb(':memory:'));
  repos.settings.set({ whatsappNumber: '+1 604 555 8112' });
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{"sid":"SMfake"}', { status: 201 });
  }) as typeof fetch;
  const env = {
    WHATSAPP_DEV_MODE: 'false', TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
  } as NodeJS.ProcessEnv;
  const sender = TwilioWhatsAppSender(fetchImpl, env, repos, () => NOW);
  sender.sendVerified(verified());
  await new Promise((r) => setTimeout(r, 0)); // fire-and-forget settles on the microtask queue
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain('/Accounts/ACfake/Messages.json');
  expect(String(calls[0]!.init.headers)).toBeDefined();
  expect(repos.eventsLog.all().some((e) => e.kind === 'alert')).toBe(true);

  const failing = (async () => { throw new Error('twilio down'); }) as unknown as typeof fetch;
  const sender2 = TwilioWhatsAppSender(failing, env, repos, () => NOW);
  sender2.sendVerified(verified()); // must not throw
  await new Promise((r) => setTimeout(r, 0));
  expect(repos.eventsLog.all().some((e) => e.kind === 'wa_error')).toBe(true);
});
