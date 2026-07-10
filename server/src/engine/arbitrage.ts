/**
 * The arbitrage engine. Pure TypeScript — no imports from Express, React,
 * or Node built-ins — so it can be unit-tested and reused as-is.
 *
 * Math, per market:
 *   S (arbitrage index) = Σ over outcomes of 1 / best_odds_for_outcome
 *   S < 1  →  guaranteed profit of (1/S − 1) × 100 percent
 *   stake_i for a nominal $100 total = 100 × (1/odds_i) / S
 * The stake split makes every leg pay out the same amount (100/S), which is
 * what makes the profit guaranteed regardless of the result.
 */
import type { ArbLeg, ArbOpportunity, OddsEvent } from '@shared/types';

export interface ArbEngineOptions {
  /** Drop opportunities below this profit percentage. Default 0. */
  minProfitPct?: number;
  /** Flag opportunities above this profit percentage as suspicious. Default 15. */
  suspiciousProfitPct?: number;
  /** Keep only the best N opportunities. Default: keep all. */
  topN?: number;
  /** Reference time for stale-event filtering. Callers should pass this in. */
  now?: Date;
  /** Markets to evaluate. Default ['h2h']. */
  marketKeys?: string[];
}

/** One bookmaker's offer on one outcome, with links resolved per precedence. */
interface Offer {
  bookmakerKey: string;
  bookmakerTitle: string;
  price: number;
  link: string | null;
}

/**
 * One side of a line group: a distinct (outcome name, signed point) pair,
 * with every bookmaker's offer on it. For h2h, point is undefined and the
 * name alone identifies the side.
 */
interface OutcomeSide {
  name: string;
  point: number | undefined;
  offers: Offer[];
}

const NOMINAL_TOTAL_STAKE = 100;

export function findArbitrageOpportunities(
  events: OddsEvent[],
  options: ArbEngineOptions = {},
): ArbOpportunity[] {
  const {
    minProfitPct = 0,
    suspiciousProfitPct = 15,
    topN = Number.POSITIVE_INFINITY,
    now = new Date(),
    marketKeys = ['h2h'],
  } = options;

  const opportunities: ArbOpportunity[] = [];

  for (const event of events) {
    // Stale filter: events that have already commenced are in-play; pre-match
    // odds for them are unreliable and often frozen.
    if (new Date(event.commenceTime).getTime() <= now.getTime()) continue;

    for (const marketKey of marketKeys) {
      for (const arb of evaluateMarket(event, marketKey, suspiciousProfitPct)) {
        if (arb.profitPct >= minProfitPct) opportunities.push(arb);
      }
    }
  }

  opportunities.sort((a, b) => b.profitPct - a.profitPct);
  return Number.isFinite(topN) ? opportunities.slice(0, Math.max(0, topN)) : opportunities;
}

/**
 * Evaluates one market of one event and returns every arb found in it.
 *
 * An arb is only valid across outcomes that jointly cover the event, so the
 * market is first split into LINE GROUPS and each group is priced
 * independently:
 *
 *  - h2h: no points — the whole market is one group keyed by outcome names.
 *  - totals: Over 220.5 / Under 220.5 share point 220.5 → one group per line.
 *    Over 219.5 + Under 221.5 has S < 1 numerically but BOTH bets lose when
 *    the total lands between the lines, so lines must never be mixed.
 *  - spreads: Lakers −3.5 / Celtics +3.5 mirror each other → grouped by
 *    |point|. A −3.5 leg never pairs with a +4.5 leg.
 *
 * Within a group, a side is a distinct (name, signed point) pair. This also
 * defuses alternate-line markets: flipped pairs (Lakers +3.5 / Celtics −3.5)
 * land in the same |point| group as four distinct sides, pushing S ≥ 1 —
 * they are skipped rather than mispriced. (Supporting alternates properly
 * means pairing sides within a group; see README "How to extend".)
 */
function evaluateMarket(
  event: OddsEvent,
  marketKey: string,
  suspiciousProfitPct: number,
): ArbOpportunity[] {
  // Group offers by line, then by side within the line. The side set is the
  // union across books — a book missing one side still contributes the sides
  // it does price.
  const lineGroups = new Map<string, Map<string, OutcomeSide>>();

  for (const book of event.bookmakers) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      if (!Number.isFinite(outcome.price) || outcome.price <= 1) continue;

      const lineKey = outcome.point == null ? '' : String(Math.abs(outcome.point));
      const sideKey = outcome.point == null ? outcome.name : `${outcome.name}@${outcome.point}`;

      const sides = lineGroups.get(lineKey) ?? new Map<string, OutcomeSide>();
      const side = sides.get(sideKey) ?? { name: outcome.name, point: outcome.point, offers: [] };
      side.offers.push({
        bookmakerKey: book.key,
        bookmakerTitle: book.title,
        price: outcome.price,
        link: outcome.link ?? market.link ?? book.link ?? null,
      });
      sides.set(sideKey, side);
      lineGroups.set(lineKey, sides);
    }
  }

  const arbs: ArbOpportunity[] = [];
  for (const sides of lineGroups.values()) {
    const arb = evaluateLineGroup(event, marketKey, [...sides.values()], suspiciousProfitPct);
    if (arb) arbs.push(arb);
  }
  return arbs;
}

/** Prices one line group: best odds per side → arb index → stake split. */
function evaluateLineGroup(
  event: OddsEvent,
  marketKey: string,
  sides: OutcomeSide[],
  suspiciousProfitPct: number,
): ArbOpportunity | null {
  // A group needs at least two distinct sides; a single-sided group would
  // trivially "arb" at S = 1/odds, which is meaningless.
  if (sides.length < 2) return null;

  // Best price per side, keeping every bookmaker tied at that price so
  // tie-breaking below can spread legs across distinct books.
  const bestBySide = sides.map((side) => {
    const bestPrice = Math.max(...side.offers.map((o) => o.price));
    const tied = side.offers
      .filter((o) => o.price === bestPrice)
      .sort((a, b) => a.bookmakerKey.localeCompare(b.bookmakerKey));
    return { side, bestPrice, tied };
  });

  const arbIndex = bestBySide.reduce((sum, o) => sum + 1 / o.bestPrice, 0);
  if (arbIndex >= 1) return null;

  // Tie-break: greedily prefer a bookmaker not already used by another leg.
  // Same-book "arbs" are usually data quirks, so when identical odds are
  // available elsewhere, take the executable combination.
  const usedBooks = new Set<string>();
  const legs: ArbLeg[] = bestBySide.map(({ side, bestPrice, tied }) => {
    const offer = tied.find((o) => !usedBooks.has(o.bookmakerKey)) ?? tied[0];
    usedBooks.add(offer.bookmakerKey);
    const rawStake = (NOMINAL_TOTAL_STAKE * (1 / bestPrice)) / arbIndex;
    return {
      outcome: side.name,
      point: side.point,
      bookmakerKey: offer.bookmakerKey,
      bookmakerTitle: offer.bookmakerTitle,
      odds: bestPrice,
      stake: Math.round(rawStake * 100) / 100,
      link: offer.link,
    };
  });

  const distinctBooks = new Set(legs.map((l) => l.bookmakerKey));
  const profitPct = (1 / arbIndex - 1) * 100;

  return {
    eventId: event.id,
    sportKey: event.sportKey,
    sportTitle: event.sportTitle,
    eventName: `${event.awayTeam} @ ${event.homeTeam}`,
    commenceTime: event.commenceTime,
    marketKey,
    arbIndex,
    profitPct,
    legs,
    sameBookmaker: distinctBooks.size < legs.length,
    suspicious: profitPct > suspiciousProfitPct,
  };
}
