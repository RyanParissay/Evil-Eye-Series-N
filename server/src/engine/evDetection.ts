/**
 * EV detection (Risk Mode, Speculative phase 10). Pure. For every soft-
 * book price with a same-line sharp benchmark: edge = p_fair × odds − 1.
 * Individual bets can lose — everything downstream must say "expected",
 * never "guaranteed".
 *
 * Guards are structural, not advisory: no benchmark → no bet (never
 * soft-consensus), line mismatch → typed rejection via fairForLineGroup,
 * stale benchmark → phantom-edge protection, longshots capped.
 */
import type { EvContext, OddsEvent } from '@shared/types';
import { fairForLineGroup } from './fairProbability';

export interface EvDetectionOptions {
  showMinEdgePct: number;
  maxOdds: number;
  maxBenchmarkAgeMins: number;
  now: Date;
}

export interface EvBet {
  eventId: string;
  sportKey: string;
  sportTitle: string;
  eventName: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  outcome: string;
  point?: number;
  bookmakerKey: string;
  bookmakerTitle: string;
  odds: number;
  link: string | null;
  ev: EvContext;
}

export function findEvBets(
  events: OddsEvent[],
  allowedBookmakers: readonly string[],
  benchmarkKeys: readonly string[],
  options: EvDetectionOptions,
): EvBet[] {
  const allowed = new Set(allowedBookmakers);
  const nowMs = options.now.getTime();
  const maxAgeMs = options.maxBenchmarkAgeMins * 60_000;
  const bets: EvBet[] = [];

  for (const event of events) {
    if (Date.parse(event.commenceTime) <= nowMs) continue;
    const benchmark = event.bookmakers.find((b) => benchmarkKeys.includes(b.key));
    if (!benchmark) continue;
    if (nowMs - Date.parse(benchmark.lastUpdate) > maxAgeMs) continue;

    for (const benchMarket of benchmark.markets) {
      // Line groups within the benchmark market: outcomes sharing |point|.
      const groups = new Map<string, Array<{ name: string; point?: number; price: number }>>();
      for (const outcome of benchMarket.outcomes) {
        const key = outcome.point == null ? 'h2h' : String(Math.abs(outcome.point));
        (groups.get(key) ?? groups.set(key, []).get(key)!).push({
          name: outcome.name,
          point: outcome.point,
          price: outcome.price,
        });
      }

      for (const groupOutcomes of groups.values()) {
        const sides = groupOutcomes.map(({ name, point }) => ({ name, point }));
        const fair = fairForLineGroup(groupOutcomes, sides);
        if (!fair.ok) continue;

        for (const book of event.bookmakers) {
          if (!allowed.has(book.key) || benchmarkKeys.includes(book.key)) continue;
          const market = book.markets.find((m) => m.key === benchMarket.key);
          if (!market) continue;
          sides.forEach((side, i) => {
            const offered = market.outcomes.find(
              (o) => o.name === side.name && (o.point ?? null) === (side.point ?? null),
            );
            if (!offered || offered.price > options.maxOdds || offered.price <= 1) return;
            const p = fair.fair.probabilities[i];
            const edgePct = (p * offered.price - 1) * 100;
            if (edgePct < options.showMinEdgePct) return;
            bets.push({
              eventId: event.id,
              sportKey: event.sportKey,
              sportTitle: event.sportTitle,
              eventName: `${event.awayTeam} @ ${event.homeTeam}`,
              commenceTime: event.commenceTime,
              homeTeam: event.homeTeam,
              awayTeam: event.awayTeam,
              marketKey: benchMarket.key,
              outcome: side.name,
              point: side.point,
              bookmakerKey: book.key,
              bookmakerTitle: book.title,
              odds: offered.price,
              link: offered.link ?? market.link ?? book.link ?? null,
              ev: {
                benchmarkKey: benchmark.key,
                benchmarkOdds: groupOutcomes[i].price,
                fairProbability: p,
                edgePct: Math.round(edgePct * 100) / 100,
                benchmarkLastUpdate: benchmark.lastUpdate,
              },
            });
          });
        }
      }
    }
  }

  return bets.sort((a, b) => b.ev.edgePct - a.ev.edgePct);
}
