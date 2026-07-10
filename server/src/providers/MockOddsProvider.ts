/**
 * Fixture-backed provider so the whole app is demo-able without an API key.
 *
 * The fixtures deliberately contain, so every UI state is reachable:
 *  - a real 2-way arb (NBA, ~5.5%, two different books)
 *  - a real 3-way arb (EPL soccer with draw, ~3.4%, three books)
 *  - a same-bookmaker arb (NHL — flagged, often not executable)
 *  - a "too good to be true" arb (tennis, ~20% — flagged suspicious)
 *  - efficient no-arb markets (MLB, NBA)
 *  - an already-commenced event (must be filtered as stale)
 *
 * Simulates the credit meter: starts with some usage and burns
 * (markets × regions) credits per odds call — or markets × ceil(books/10)
 * when the bookmakers param is used — like the real API.
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

const PLAN_CREDITS = 20_000;

export class MockOddsProvider implements OddsProvider {
  readonly mode = 'mock' as const;

  private requestsUsed = 123; // pretend some credits were already spent

  constructor(private readonly now: () => Date = () => new Date()) {}

  async listSports(): Promise<SportsResult> {
    const sports: SportInfo[] = [
      { key: 'soccer_epl', title: 'EPL', group: 'Soccer', active: true, hasOutrights: false },
      { key: 'basketball_nba', title: 'NBA', group: 'Basketball', active: true, hasOutrights: false },
      { key: 'baseball_mlb', title: 'MLB', group: 'Baseball', active: true, hasOutrights: false },
      { key: 'icehockey_nhl', title: 'NHL', group: 'Ice Hockey', active: true, hasOutrights: false },
      { key: 'tennis_atp_wimbledon', title: 'ATP Wimbledon', group: 'Tennis', active: true, hasOutrights: false },
      { key: 'mma_mixed_martial_arts', title: 'MMA', group: 'Mixed Martial Arts', active: true, hasOutrights: false },
      // Must be excluded from scans: futures-only and out-of-season entries.
      { key: 'soccer_uefa_champs_league_winner', title: 'UCL Winner', group: 'Soccer', active: true, hasOutrights: true },
      { key: 'americanfootball_nfl', title: 'NFL', group: 'American Football', active: false, hasOutrights: false },
    ];
    return { sports, usage: this.usage(0) };
  }

  async fetchOdds(sportKey: string, params: FetchOddsParams): Promise<OddsResult> {
    // Mirror the real API's bookmakers-param behavior: it replaces regions
    // (both in the response and in the ceil(n/10) billing).
    const byBookmakers = params.bookmakers && params.bookmakers.length > 0;
    const credits = creditsForOddsCall(
      params.markets.length,
      byBookmakers
        ? regionEquivalentsForBookmakers(params.bookmakers!.length)
        : params.regions.length,
    );
    this.requestsUsed += credits;
    let events = this.fixtures()[sportKey] ?? [];
    if (byBookmakers) {
      const wanted = new Set(params.bookmakers);
      events = events
        .map((e) => ({ ...e, bookmakers: e.bookmakers.filter((b) => wanted.has(b.key)) }))
        .filter((e) => e.bookmakers.length > 0);
    }
    return { events, usage: this.usage(credits) };
  }

  private usage(creditsCharged: number): UsageInfo {
    return {
      requestsUsedTotal: this.requestsUsed,
      requestsRemainingTotal: PLAN_CREDITS - this.requestsUsed,
      creditsCharged,
    };
  }

  /** Commence times are generated relative to "now" so fixtures never go stale. */
  private hoursFromNow(hours: number): string {
    return new Date(this.now().getTime() + hours * 3_600_000).toISOString();
  }

  private fixtures(): Record<string, OddsEvent[]> {
    const updated = this.now().toISOString();
    const book = (
      key: string,
      title: string,
      prices: Record<string, number>,
      link?: string,
    ) => ({
      key,
      title,
      lastUpdate: updated,
      link,
      markets: [
        {
          key: 'h2h',
          outcomes: Object.entries(prices).map(([name, price]) => ({ name, price })),
        },
      ],
    });

    return {
      basketball_nba: [
        {
          // Real 2-way arb: best Lakers 2.10 (FanDuel) + best Celtics 2.12
          // (DraftKings) → S ≈ 0.948, ~5.5% profit.
          id: 'mock-nba-arb',
          sportKey: 'basketball_nba',
          sportTitle: 'NBA',
          commenceTime: this.hoursFromNow(3),
          homeTeam: 'Los Angeles Lakers',
          awayTeam: 'Boston Celtics',
          bookmakers: [
            book('fanduel', 'FanDuel', { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.78 }, 'https://sportsbook.fanduel.com/basketball/nba'),
            book('draftkings', 'DraftKings', { 'Los Angeles Lakers': 1.83, 'Boston Celtics': 2.12 }, 'https://sportsbook.draftkings.com/leagues/basketball/nba'),
            book('betmgm', 'BetMGM', { 'Los Angeles Lakers': 1.95, 'Boston Celtics': 1.87 }),
            // Never the best price on either side — feed variety only.
            book('betway', 'Betway', { 'Los Angeles Lakers': 1.9, 'Boston Celtics': 1.85 }),
            book('williamhill_us', 'Caesars', { 'Los Angeles Lakers': 1.88, 'Boston Celtics': 1.9 }),
            book('betrivers', 'BetRivers', { 'Los Angeles Lakers': 1.92, 'Boston Celtics': 1.84 }),
          ],
        },
        {
          // Efficient market — no arb.
          id: 'mock-nba-efficient',
          sportKey: 'basketball_nba',
          sportTitle: 'NBA',
          commenceTime: this.hoursFromNow(6),
          homeTeam: 'Denver Nuggets',
          awayTeam: 'Golden State Warriors',
          bookmakers: [
            book('fanduel', 'FanDuel', { 'Denver Nuggets': 1.91, 'Golden State Warriors': 1.91 }),
            book('draftkings', 'DraftKings', { 'Denver Nuggets': 1.89, 'Golden State Warriors': 1.93 }),
          ],
        },
        {
          // Already commenced — the engine must filter this as stale even
          // though the numbers would otherwise be a huge "arb".
          id: 'mock-nba-stale',
          sportKey: 'basketball_nba',
          sportTitle: 'NBA',
          commenceTime: this.hoursFromNow(-2),
          homeTeam: 'Phoenix Suns',
          awayTeam: 'Miami Heat',
          bookmakers: [
            book('fanduel', 'FanDuel', { 'Phoenix Suns': 2.6, 'Miami Heat': 1.5 }),
            book('draftkings', 'DraftKings', { 'Phoenix Suns': 1.5, 'Miami Heat': 2.6 }),
          ],
        },
      ],
      soccer_epl: [
        {
          // Real 3-way arb: Arsenal 3.00 (bet365) + Draw 3.45 (Pinnacle) +
          // Chelsea 2.90 (Betfair) → S ≈ 0.968, ~3.3% profit.
          id: 'mock-epl-arb',
          sportKey: 'soccer_epl',
          sportTitle: 'EPL',
          commenceTime: this.hoursFromNow(24),
          homeTeam: 'Arsenal',
          awayTeam: 'Chelsea',
          bookmakers: [
            book('bet365', 'Bet365', { Arsenal: 3.0, Draw: 3.2, Chelsea: 2.45 }, 'https://www.bet365.com'),
            book('pinnacle', 'Pinnacle', { Arsenal: 2.72, Draw: 3.45, Chelsea: 2.6 }),
            // Betfair is not Canadian-accessible, so on the Canada tabs the
            // third leg must come from Coolbet for the arb to survive.
            book('betfair_ex_uk', 'Betfair', { Arsenal: 2.86, Draw: 3.3, Chelsea: 2.9 }, 'https://www.betfair.com/exchange'),
            book('coolbet', 'Coolbet', { Arsenal: 2.8, Draw: 3.35, Chelsea: 2.9 }),
            // Never the best price on any outcome — feed variety only.
            book('betvictor', 'BetVictor', { Arsenal: 2.7, Draw: 3.2, Chelsea: 2.5 }),
            book('leovegas', 'LeoVegas', { Arsenal: 2.75, Draw: 3.25, Chelsea: 2.55 }),
          ],
        },
        {
          // Efficient 3-way market — no arb.
          id: 'mock-epl-efficient',
          sportKey: 'soccer_epl',
          sportTitle: 'EPL',
          commenceTime: this.hoursFromNow(26),
          homeTeam: 'Liverpool',
          awayTeam: 'Manchester City',
          bookmakers: [
            book('bet365', 'Bet365', { Liverpool: 2.6, Draw: 3.4, 'Manchester City': 2.55 }),
            book('pinnacle', 'Pinnacle', { Liverpool: 2.65, Draw: 3.45, 'Manchester City': 2.6 }),
          ],
        },
      ],
      icehockey_nhl: [
        {
          // Same-book arb: Pinnacle alone has the best price on both sides.
          // S ≈ 0.953 (~4.9%) but flagged — one book arbing itself is
          // usually a listing quirk, not free money.
          id: 'mock-nhl-samebook',
          sportKey: 'icehockey_nhl',
          sportTitle: 'NHL',
          commenceTime: this.hoursFromNow(8),
          homeTeam: 'Colorado Avalanche',
          awayTeam: 'Toronto Maple Leafs',
          bookmakers: [
            book('pinnacle', 'Pinnacle', { 'Colorado Avalanche': 2.15, 'Toronto Maple Leafs': 2.05 }),
            book('fanduel', 'FanDuel', { 'Colorado Avalanche': 1.8, 'Toronto Maple Leafs': 1.92 }),
            book('sport888', '888sport', { 'Colorado Avalanche': 1.85, 'Toronto Maple Leafs': 1.9 }),
          ],
        },
      ],
      tennis_atp_wimbledon: [
        {
          // "Too good to be true": S ≈ 0.827 → ~20.9% profit. Flagged
          // suspicious — almost certainly stale/errored odds.
          id: 'mock-tennis-suspicious',
          sportKey: 'tennis_atp_wimbledon',
          sportTitle: 'ATP Wimbledon',
          commenceTime: this.hoursFromNow(5),
          homeTeam: 'Carlos Alcaraz',
          awayTeam: 'Jannik Sinner',
          bookmakers: [
            book('betonlineag', 'BetOnline.ag', { 'Carlos Alcaraz': 2.3, 'Jannik Sinner': 1.55 }),
            book('mybookieag', 'MyBookie.ag', { 'Carlos Alcaraz': 1.52, 'Jannik Sinner': 2.55 }),
          ],
        },
      ],
      baseball_mlb: [
        {
          id: 'mock-mlb-efficient',
          sportKey: 'baseball_mlb',
          sportTitle: 'MLB',
          commenceTime: this.hoursFromNow(4),
          homeTeam: 'New York Yankees',
          awayTeam: 'Houston Astros',
          bookmakers: [
            book('fanduel', 'FanDuel', { 'New York Yankees': 1.74, 'Houston Astros': 2.1 }),
            book('draftkings', 'DraftKings', { 'New York Yankees': 1.72, 'Houston Astros': 2.14 }),
            book('betsson', 'Betsson', { 'New York Yankees': 1.7, 'Houston Astros': 2.05 }),
            book('nordicbet', 'NordicBet', { 'New York Yankees': 1.71, 'Houston Astros': 2.08 }),
          ],
        },
      ],
      mma_mixed_martial_arts: [],
    };
  }
}
