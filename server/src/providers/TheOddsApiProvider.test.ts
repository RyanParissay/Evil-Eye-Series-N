/**
 * Characterization tests for the live adapter's error mapping — above all
 * the CLAUDE.md gotcha: The Odds API signals quota exhaustion with 401
 * (OUT_OF_USAGE_CREDITS), the same status as a bad key. The distinction is
 * what the UI shows ("top up credits" vs "fix your key"), so it must never
 * regress silently.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from './OddsProvider';
import { TheOddsApiProvider } from './TheOddsApiProvider';

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers })),
  );
}

async function errorFrom(provider: TheOddsApiProvider): Promise<ProviderError> {
  try {
    await provider.listSports();
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error('expected listSports to throw');
}

describe('TheOddsApiProvider error mapping', () => {
  afterEach(() => vi.unstubAllGlobals());

  const provider = new TheOddsApiProvider('test-key');

  it('maps a 401 quota message to quota_exhausted, not invalid_api_key', async () => {
    stubFetch(401, {
      message: 'Usage quota has been reached.',
      error_code: 'OUT_OF_USAGE_CREDITS',
    });
    expect((await errorFrom(provider)).code).toBe('quota_exhausted');
  });

  it('maps a plain 401 to invalid_api_key', async () => {
    stubFetch(401, { message: 'Invalid API key.' });
    expect((await errorFrom(provider)).code).toBe('invalid_api_key');
  });

  it('maps 429 rate limiting to quota_exhausted', async () => {
    stubFetch(429, { message: 'Too many requests.' });
    expect((await errorFrom(provider)).code).toBe('quota_exhausted');
  });

  it('maps other statuses to provider_error even with a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 503 })));
    const err = await errorFrom(provider);
    expect(err.code).toBe('provider_error');
    expect(err.message).not.toContain('test-key'); // the key never leaks into errors
  });

  it('maps fetch rejection to a network ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    expect((await errorFrom(provider)).code).toBe('network');
  });

  it('parses usage headers on success', async () => {
    stubFetch(200, [], { 'x-requests-used': '133', 'x-requests-remaining': '19867' });
    const { usage } = await provider.listSports();
    expect(usage).toMatchObject({ requestsUsedTotal: 133, requestsRemainingTotal: 19867 });
  });
});

describe('TheOddsApiProvider.fetchScores', () => {
  afterEach(() => vi.unstubAllGlobals());
  const provider = new TheOddsApiProvider('test-key');

  it('decimal-parses the scores array, matched to home/away by team name', async () => {
    stubFetch(200, [
      {
        id: 'evt-1',
        sport_key: 'basketball_nba',
        commence_time: '2026-07-11T19:00:00Z',
        completed: true,
        home_team: 'Los Angeles Lakers',
        away_team: 'Boston Celtics',
        scores: [
          { name: 'Boston Celtics', score: '104' },
          { name: 'Los Angeles Lakers', score: '112' },
        ],
        last_update: '2026-07-11T22:00:00Z',
      },
    ]);
    const { scores, usage } = await provider.fetchScores('basketball_nba', { eventIds: ['evt-1'] });
    expect(scores).toEqual([
      {
        eventId: 'evt-1',
        completed: true,
        home: 112,
        away: 104,
        homeTeam: 'Los Angeles Lakers',
        awayTeam: 'Boston Celtics',
      },
    ]);
    expect(usage.creditsCharged).toBe(1); // no daysFrom
  });

  it('null scores (not yet final) map to null home/away', async () => {
    stubFetch(200, [
      {
        id: 'evt-2',
        sport_key: 'basketball_nba',
        commence_time: '2026-07-11T19:00:00Z',
        completed: false,
        home_team: 'Los Angeles Lakers',
        away_team: 'Boston Celtics',
        scores: null,
        last_update: null,
      },
    ]);
    const { scores } = await provider.fetchScores('basketball_nba', {});
    expect(scores[0]).toMatchObject({ completed: false, home: null, away: null });
  });

  it('daysFrom costs 2 credits instead of 1', async () => {
    stubFetch(200, []);
    const { usage } = await provider.fetchScores('basketball_nba', { daysFrom: 1 });
    expect(usage.creditsCharged).toBe(2);
  });
});
