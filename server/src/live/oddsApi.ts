// The Odds API provider (Plan 6, Design §4 + Decision 4): async refresh fills a
// cache; fetchQuotes stays synchronous so the pipeline is untouched. Injected
// fetchImpl only — tests stub it; NOTHING here can run against the real API in
// a test (HARD GATE 2). Credits come from the API's own usage headers.
import type { FeedHealth, OddsProvider, Quote } from '../shared/types.js';
import type { Repos } from '../db/db.js';

const BASE = 'https://api.the-odds-api.com/v4';

/** Sport keys we scan ↔ engine sport slugs. Unknown keys drop the event. */
const SPORTS: Record<string, string> = {
  basketball_nba: 'basketball',
  baseball_mlb: 'baseball',
  icehockey_nhl: 'hockey',
  soccer_epl: 'soccer',
  tennis_atp: 'tennis',
};

/** the-odds-api bookmaker keys ↔ the seeded roster slugs. Unknown books drop. */
const BOOKS: Record<string, string> = {
  pinnacle: 'pinnacle', betmgm: 'betmgm', fanduel: 'fanduel', draftkings: 'draftkings',
  caesars: 'caesars', betway: 'betway', unibet: 'unibet', betrivers: 'betrivers',
  bet365: 'bet365', williamhill_us: 'caesars', betvictor: 'betvictor', bwin: 'bwin',
  leovegas: 'leovegas', bodog: 'bodog', pointsbetus: 'pointsbet',
};

interface ApiOutcome { name: string; price: number; point?: number }
interface ApiMarket { key: string; outcomes: ApiOutcome[] }
interface ApiBookmaker { key: string; markets: ApiMarket[] }
export interface OddsApiEvent {
  id: string; sport_key: string; commence_time: string;
  home_team: string; away_team: string; bookmakers: ApiBookmaker[];
}

/** Pure v4 → Quote[] mapping. Selections use the engine's slugs; soccer h2h is 1X2. */
export function mapEvents(events: OddsApiEvent[], now: number): Quote[] {
  const out: Quote[] = [];
  for (const e of events) {
    const sport = SPORTS[e.sport_key];
    if (sport === undefined) continue;
    const eventStartsAt = Date.parse(e.commence_time);
    const eventName = `${e.away_team} @ ${e.home_team}`;
    const soccer = sport === 'soccer';
    for (const bm of e.bookmakers) {
      const book = BOOKS[bm.key];
      if (book === undefined) continue;
      for (const m of bm.markets) {
        for (const o of m.outcomes) {
          const q = mapOutcome(m.key, o, e, soccer);
          if (q === null) continue;
          out.push({
            book, sport, event: eventName, market: q.market, selection: q.selection,
            odds: o.price, line: q.line, fetchedAt: now, eventStartsAt,
          });
        }
      }
    }
  }
  return out;
}

function mapOutcome(
  marketKey: string, o: ApiOutcome, e: OddsApiEvent, soccer: boolean,
): { market: string; selection: string; line: number | null } | null {
  switch (marketKey) {
    case 'h2h': {
      const selection = o.name === e.home_team ? 'home' : o.name === e.away_team ? 'away' : o.name === 'Draw' ? 'draw' : null;
      if (selection === null) return null;
      return { market: soccer ? '1X2' : 'moneyline', selection, line: null };
    }
    case 'totals': {
      const selection = o.name === 'Over' ? 'over' : o.name === 'Under' ? 'under' : null;
      if (selection === null || o.point === undefined) return null;
      return { market: 'total', selection, line: o.point };
    }
    case 'spreads': {
      const selection = o.name === e.home_team ? 'home' : o.name === e.away_team ? 'away' : null;
      if (selection === null || o.point === undefined) return null;
      return { market: 'spread', selection, line: o.point };
    }
    default:
      return null;
  }
}

/** Header delta → credits_usage. First sighting seeds the baseline (Decision 7). */
export function recordCredits(repos: Repos, headers: Headers, now: number): void {
  const used = Number(headers.get('x-requests-used'));
  if (!Number.isFinite(used)) return;
  const rows = repos.eventsLog.all().filter((e) => e.kind === 'odds_api_used');
  const last = rows.length > 0 ? (JSON.parse(rows[rows.length - 1]!.payload) as { used: number }).used : null;
  repos.eventsLog.add(now, 'odds_api_used', JSON.stringify({ used }));
  if (last === null) return; // baseline
  const delta = Math.max(0, used - last);
  if (delta > 0) repos.credits.add(now, delta);
}

export function OddsApiProvider(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos): OddsProvider {
  let cache: Quote[] = [];
  // §2.2: feed health, the honest record refresh()'s own catch used to hide.
  // lastFetchOk starts null (no attempt yet) — distinct from a failed attempt.
  let health: FeedHealth = {
    lastFetchAt: null, lastFetchOk: null, lastFetchError: null, lastSuccessfulFetchAt: null,
  };
  return {
    fetchQuotes(): Quote[] {
      return cache;
    },
    async refresh(now: number): Promise<void> {
      try {
        const merged: OddsApiEvent[] = [];
        let headers: Headers | null = null;
        for (const sportKey of Object.keys(SPORTS)) {
          const url = `${BASE}/sports/${sportKey}/odds?regions=us,eu&markets=h2h,totals,spreads`
            + `&oddsFormat=decimal&apiKey=${env.ODDS_API_KEY ?? ''}`;
          const res = await fetchImpl(url);
          if (!res.ok) throw new Error(`odds api ${res.status} for ${sportKey}`);
          headers = res.headers;
          merged.push(...((await res.json()) as OddsApiEvent[]));
        }
        cache = mapEvents(merged, now);
        if (headers !== null) recordCredits(repos, headers, now);
        health = { lastFetchAt: now, lastFetchOk: true, lastFetchError: null, lastSuccessfulFetchAt: now };
      } catch (err) {
        // Keep the stale cache; the message NEVER contains a value (HARD GATE 3).
        const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
        repos.eventsLog.add(now, 'provider_error', JSON.stringify({ message }));
        // Preserve lastSuccessfulFetchAt across the failure — "time since last good fetch" must stay honest.
        health = { ...health, lastFetchAt: now, lastFetchOk: false, lastFetchError: message };
      }
    },
    health(): FeedHealth {
      return health;
    },
  };
}
