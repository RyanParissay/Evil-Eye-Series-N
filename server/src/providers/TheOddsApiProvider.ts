/**
 * Live adapter for The Odds API v4 (https://the-odds-api.com).
 *
 * Billing model this adapter encodes:
 *  - GET /v4/sports is free.
 *  - GET /v4/sports/{sport}/odds costs (markets × regions) credits.
 *  - Every response carries x-requests-used / x-requests-remaining headers,
 *    which we surface as the account usage meter.
 *
 * Uses global fetch (Node 18+). No Express imports.
 */
import type { OddsEvent, SportInfo } from '@shared/types';
import { creditsForOddsCall, regionEquivalentsForBookmakers } from '../engine/creditCost';
import type {
  FetchOddsParams,
  OddsProvider,
  OddsResult,
  SportsResult,
  UsageInfo,
} from './OddsProvider';
import { ProviderError } from './OddsProvider';

const DEFAULT_BASE_URL = 'https://api.the-odds-api.com/v4';

/** Wire shapes (snake_case) as The Odds API returns them. */
interface ApiSport {
  key: string;
  title: string;
  group: string;
  active: boolean;
  has_outrights: boolean;
}

interface ApiOutcome {
  name: string;
  price: number;
  /** Line for spreads/totals outcomes (e.g. -3.5, 220.5); absent for h2h. */
  point?: number;
  link?: string;
}

interface ApiMarket {
  key: string;
  outcomes: ApiOutcome[];
  link?: string;
}

interface ApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  link?: string;
  markets: ApiMarket[];
}

interface ApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: ApiBookmaker[];
}

export class TheOddsApiProvider implements OddsProvider {
  readonly mode = 'live' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async listSports(): Promise<SportsResult> {
    const { body, usage } = await this.request<ApiSport[]>('/sports', {}, 0);
    const sports: SportInfo[] = body.map((s) => ({
      key: s.key,
      title: s.title,
      group: s.group,
      active: s.active,
      hasOutrights: s.has_outrights,
    }));
    return { sports, usage };
  }

  async fetchOdds(sportKey: string, params: FetchOddsParams): Promise<OddsResult> {
    // The bookmakers param replaces regions (it takes priority server-side
    // anyway) and bills every 10 books as one region-equivalent.
    const byBookmakers = params.bookmakers && params.bookmakers.length > 0;
    const credits = creditsForOddsCall(
      params.markets.length,
      byBookmakers
        ? regionEquivalentsForBookmakers(params.bookmakers!.length)
        : params.regions.length,
    );
    const { body, usage } = await this.request<ApiEvent[]>(
      `/sports/${encodeURIComponent(sportKey)}/odds`,
      {
        ...(byBookmakers
          ? { bookmakers: params.bookmakers!.join(',') }
          : { regions: params.regions.join(',') }),
        markets: params.markets.join(','),
        oddsFormat: 'decimal', // the arbitrage math depends on decimal odds
        includeLinks: 'true', // bookmaker/market/outcome deep links when the plan has them
      },
      credits,
    );
    const events: OddsEvent[] = body.map((e) => ({
      id: e.id,
      sportKey: e.sport_key,
      sportTitle: e.sport_title,
      commenceTime: e.commence_time,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      bookmakers: (e.bookmakers ?? []).map((b) => ({
        key: b.key,
        title: b.title,
        lastUpdate: b.last_update,
        link: b.link,
        markets: (b.markets ?? []).map((m) => ({
          key: m.key,
          link: m.link,
          outcomes: (m.outcomes ?? []).map((o) => ({
            name: o.name,
            price: o.price,
            point: o.point,
            link: o.link,
          })),
        })),
      })),
    }));
    return { events, usage };
  }

  private async request<T>(
    path: string,
    query: Record<string, string>,
    creditsCharged: number,
  ): Promise<{ body: T; usage: UsageInfo }> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('apiKey', this.apiKey);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new ProviderError(
        `Network failure reaching The Odds API: ${err instanceof Error ? err.message : String(err)}`,
        'network',
      );
    }

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    const usage: UsageInfo = {
      requestsUsedTotal: parseHeaderNumber(response.headers.get('x-requests-used')),
      requestsRemainingTotal: parseHeaderNumber(response.headers.get('x-requests-remaining')),
      creditsCharged,
    };
    return { body: (await response.json()) as T, usage };
  }

  private async toProviderError(response: Response): Promise<ProviderError> {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string; error_code?: string };
      detail = body.message ?? body.error_code ?? '';
    } catch {
      // Non-JSON error body; status alone will have to do.
    }

    // The Odds API signals both bad keys and exhausted quotas with 401
    // (error_code OUT_OF_USAGE_CREDITS for the latter); 429 is rate limiting.
    const exhausted =
      response.status === 429 || /usage|quota|credit/i.test(detail);
    if (response.status === 401 || response.status === 429) {
      return exhausted
        ? new ProviderError(
            `Odds API quota exhausted: ${detail || 'no request credits remaining'}`,
            'quota_exhausted',
            response.status,
          )
        : new ProviderError(
            `Odds API rejected the key: ${detail || 'invalid API key'}`,
            'invalid_api_key',
            response.status,
          );
    }
    return new ProviderError(
      `Odds API error ${response.status}: ${detail || response.statusText}`,
      'provider_error',
      response.status,
    );
  }
}

function parseHeaderNumber(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
