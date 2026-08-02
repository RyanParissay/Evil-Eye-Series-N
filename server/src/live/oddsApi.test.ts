import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { OddsApiProvider, mapEvents, recordCredits } from './oddsApi.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/odds-api-sample.json', import.meta.url), 'utf8'),
);
const ENV = { ODDS_API_KEY: 'fake-key' } as NodeJS.ProcessEnv;

test('mapEvents: h2h/totals/spreads map to engine markets; unknown books/sports drop', () => {
  const quotes = mapEvents(FIXTURE, NOW);
  const nba = quotes.filter((q) => q.event === 'Nuggets @ Suns' && q.market === 'moneyline');
  expect(nba.length).toBeGreaterThan(0);
  expect(nba[0]).toMatchObject({ sport: 'basketball', market: 'moneyline', line: null });
  expect(new Set(nba.map((q) => q.selection))).toEqual(new Set(['home', 'away']));
  expect(nba.every((q) => q.eventStartsAt === Date.parse('2026-07-15T02:10:00Z'))).toBe(true);
  expect(nba.every((q) => q.fetchedAt === NOW)).toBe(true);

  const totals = quotes.filter((q) => q.market === 'total');
  expect(totals.some((q) => q.selection === 'over' && q.line === 8.5)).toBe(true);

  const soccer = quotes.filter((q) => q.sport === 'soccer');
  expect(soccer.every((q) => q.market === '1X2')).toBe(true); // 3-leg arbs keep working
  expect(new Set(soccer.map((q) => q.selection))).toEqual(new Set(['home', 'away', 'draw']));

  expect(quotes.some((q) => q.book === 'nowhere-book')).toBe(false);   // unknown bookmaker dropped
  expect(quotes.some((q) => q.sport === 'cricket_odi')).toBe(false);   // unknown sport dropped
});

test('refresh caches quotes; fetchQuotes stays synchronous; credits come from headers', async () => {
  const repos = Repos(openDb(':memory:'));
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(FIXTURE), {
      status: 200,
      headers: { 'x-requests-used': '120', 'x-requests-remaining': '99880' },
    });
  }) as typeof fetch;

  const p = OddsApiProvider(fetchImpl, ENV, repos);
  expect(p.fetchQuotes(NOW)).toEqual([]); // no refresh yet — empty cache, no throw
  await p.refresh!(NOW);
  expect(p.fetchQuotes(NOW).length).toBeGreaterThan(0);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((u) => u.includes('apiKey='))).toBe(true);
  expect(repos.credits.all()).toHaveLength(0); // first sighting seeds the baseline only

  await p.refresh!(NOW + 60_000); // headers now report 135 used
  // second stub response below overrides used — see fetch closure in implementation note
});

test('credit DELTAS are recorded, first sighting seeds', () => {
  const repos = Repos(openDb(':memory:'));
  const mkHeaders = (used: string) => new Headers({ 'x-requests-used': used });
  recordCredits(repos, mkHeaders('120'), NOW);          // baseline
  expect(repos.credits.all()).toHaveLength(0);
  recordCredits(repos, mkHeaders('135'), NOW + 60_000); // +15
  expect(repos.credits.all()).toEqual([expect.objectContaining({ ts: NOW + 60_000, n: 15 })]);
  recordCredits(repos, mkHeaders('135'), NOW + 120_000); // no burn → no row
  expect(repos.credits.all()).toHaveLength(1);
});

test('a failed refresh keeps the last cache and writes provider_error — never throws', async () => {
  const repos = Repos(openDb(':memory:'));
  let fail = false;
  const fetchImpl = (async () => {
    if (fail) throw new Error('network down');
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  }) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  await p.refresh!(NOW);
  const cached = p.fetchQuotes(NOW).length;
  expect(cached).toBeGreaterThan(0);
  fail = true;
  await p.refresh!(NOW + 60_000); // must not reject
  expect(p.fetchQuotes(NOW + 60_000)).toHaveLength(cached); // stale cache stands
  const errs = repos.eventsLog.all().filter((e) => e.kind === 'provider_error');
  expect(errs).toHaveLength(1);
  expect(errs[0]!.payload).not.toContain('fake-key'); // NEVER a value in the payload
});

// ---- feed health (§2.2 live-fetch hardening) --------------------------------
// A broken feed (401/429/500) must never look identical to "no opportunities" —
// health() surfaces what refresh()'s own catch used to hide silently.

test('health(): before any refresh, no-attempt state — never attempted is NOT the same as failed', () => {
  const repos = Repos(openDb(':memory:'));
  const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  expect(p.health!()).toEqual({
    lastFetchAt: null, lastFetchOk: null, lastFetchError: null, lastSuccessfulFetchAt: null,
  });
});

test('health(): a successful refresh marks ok and stamps both fetch timestamps', async () => {
  const repos = Repos(openDb(':memory:'));
  const fetchImpl = (async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  await p.refresh!(NOW);
  expect(p.health!()).toEqual({
    lastFetchAt: NOW, lastFetchOk: true, lastFetchError: null, lastSuccessfulFetchAt: NOW,
  });
});

test('health(): a 401/429/500-style refresh failure is captured with a short, safe message', async () => {
  const repos = Repos(openDb(':memory:'));
  const fetchImpl = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  await p.refresh!(NOW); // must not reject
  const h = p.health!();
  expect(h.lastFetchAt).toBe(NOW);
  expect(h.lastFetchOk).toBe(false);
  expect(h.lastFetchError).toContain('401');
  expect(h.lastFetchError).not.toContain('fake-key'); // NEVER a value (HARD GATE 3)
  expect(h.lastSuccessfulFetchAt).toBeNull(); // never succeeded yet
});

test('health(): after a success then a failure, lastSuccessfulFetchAt survives the failure', async () => {
  const repos = Repos(openDb(':memory:'));
  let fail = false;
  const fetchImpl = (async () => {
    if (fail) return new Response('rate limited', { status: 429 });
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  }) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  await p.refresh!(NOW);
  fail = true;
  await p.refresh!(NOW + 60_000);
  const h = p.health!();
  expect(h.lastFetchAt).toBe(NOW + 60_000);   // most recent attempt, even though it failed
  expect(h.lastFetchOk).toBe(false);
  expect(h.lastFetchError).toContain('429');
  expect(h.lastSuccessfulFetchAt).toBe(NOW);  // the last GOOD fetch, honestly distinct from the last attempt
});
