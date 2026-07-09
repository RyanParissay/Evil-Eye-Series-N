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
import type { ArbLeg, ArbOpportunity, OddsEvent } from '../../../shared/types';

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
      const arb = evaluateMarket(event, marketKey, suspiciousProfitPct);
      if (arb && arb.profitPct >= minProfitPct) opportunities.push(arb);
    }
  }

  opportunities.sort((a, b) => b.profitPct - a.profitPct);
  return Number.isFinite(topN) ? opportunities.slice(0, Math.max(0, topN)) : opportunities;
}

function evaluateMarket(
  event: OddsEvent,
  marketKey: string,
  suspiciousProfitPct: number,
): ArbOpportunity | null {
  // Collect every offer per outcome name, across all bookmakers. The outcome
  // set is the union — a book missing one side still contributes the sides
  // it does price.
  const offersByOutcome = new Map<string, Offer[]>();

  for (const book of event.bookmakers) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      if (!Number.isFinite(outcome.price) || outcome.price <= 1) continue;
      const offers = offersByOutcome.get(outcome.name) ?? [];
      offers.push({
        bookmakerKey: book.key,
        bookmakerTitle: book.title,
        price: outcome.price,
        link: outcome.link ?? market.link ?? book.link ?? null,
      });
      offersByOutcome.set(outcome.name, offers);
    }
  }

  // A market needs at least two distinct outcomes; a single-outcome market
  // would trivially "arb" at S = 1/odds, which is meaningless.
  if (offersByOutcome.size < 2) return null;

  // Best price per outcome, keeping every bookmaker tied at that price so
  // tie-breaking below can spread legs across distinct books.
  const bestByOutcome = [...offersByOutcome.entries()].map(([name, offers]) => {
    const bestPrice = Math.max(...offers.map((o) => o.price));
    const tied = offers
      .filter((o) => o.price === bestPrice)
      .sort((a, b) => a.bookmakerKey.localeCompare(b.bookmakerKey));
    return { name, bestPrice, tied };
  });

  const arbIndex = bestByOutcome.reduce((sum, o) => sum + 1 / o.bestPrice, 0);
  if (arbIndex >= 1) return null;

  // Tie-break: greedily prefer a bookmaker not already used by another leg.
  // Same-book "arbs" are usually data quirks, so when identical odds are
  // available elsewhere, take the executable combination.
  const usedBooks = new Set<string>();
  const legs: ArbLeg[] = bestByOutcome.map(({ name, bestPrice, tied }) => {
    const offer = tied.find((o) => !usedBooks.has(o.bookmakerKey)) ?? tied[0];
    usedBooks.add(offer.bookmakerKey);
    const rawStake = (NOMINAL_TOTAL_STAKE * (1 / bestPrice)) / arbIndex;
    return {
      outcome: name,
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
