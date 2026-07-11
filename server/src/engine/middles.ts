/**
 * Middles engine (Phase 12, strategy 'middle'). Pure, and deliberately
 * NOT a modification of arb detection: arbs pair opposite outcomes on
 * the SAME |point| line group; middles pair them across DIFFERENT lines,
 * gapped so both can win.
 *
 * Direction rules live in smart constructors — the both-legs-can-lose
 * trap (Over 216 + Under 210; inverted spread windows) returns null and
 * cannot flow downstream. Metrics are pure arithmetic on S = Σ1/odds:
 *   cost%      = (1 − 1/S) × 100   (worst case: one side wins)
 *   payout%    = (2/S − 1) × 100   (both sides win)
 *   breakeven  = cost/(cost+payout) = S − 1
 * No probability estimates anywhere — breakeven is a fact, hit chance
 * is the user's judgment.
 */
import type { MiddleContext, OddsEvent } from '@shared/types';

export interface MiddleOffer {
  bookmakerKey: string;
  bookmakerTitle: string;
  outcome: string;
  point: number;
  odds: number;
  link: string | null;
}

export interface MiddleCandidate extends MiddleContext {
  /** [low-side leg, high-side leg]: totals Over first; spreads lower signed point first. */
  legs: [MiddleOffer, MiddleOffer];
}

export interface MiddleBet {
  eventId: string;
  sportKey: string;
  sportTitle: string;
  eventName: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  legs: [MiddleOffer, MiddleOffer];
  sameBookmaker: boolean;
  middle: MiddleContext;
}

export interface FindMiddlesOptions {
  /** Markets actually fetched this scan — no data, no middles, no error. */
  marketKeys: readonly string[];
  maxCostPct: number;
  minWindow: number;
  /** Sport-key prefix → key numbers (e.g. americanfootball → [3,7,10]). */
  keyNumbers: Record<string, readonly number[]>;
  now: Date;
}

/** Over T₁ + Under T₂ — a middle IFF T₁ < T₂ (strict; equal lines are an arb). */
export function totalsMiddle(over: MiddleOffer, under: MiddleOffer): MiddleCandidate | null {
  if (over.outcome !== 'Over' || under.outcome !== 'Under') return null;
  if (!(under.point - over.point > 0)) return null;
  return build(over, under, over.point, under.point);
}

/**
 * Opposite teams at signed points p₁, p₂ — a middle IFF p₁ + p₂ > 0.
 * Window in margin-of-first-team terms: (−p₁, p₂).
 */
export function spreadsMiddle(a: MiddleOffer, b: MiddleOffer): MiddleCandidate | null {
  if (a.outcome === b.outcome) return null;
  if (!(a.point + b.point > 0)) return null;
  return build(a, b, -a.point, b.point);
}

function build(
  legA: MiddleOffer,
  legB: MiddleOffer,
  lowLine: number,
  highLine: number,
): MiddleCandidate {
  const S = 1 / legA.odds + 1 / legB.odds;
  const costPct = (1 - 1 / S) * 100;
  return {
    legs: [legA, legB],
    lowLine,
    highLine,
    windowSize: highLine - lowLine,
    costPct,
    payoutPct: (2 / S - 1) * 100,
    breakevenPct: (S - 1) * 100,
    freeMiddle: costPct <= 0,
    pushPossible: Number.isInteger(legA.point) || Number.isInteger(legB.point),
    keyNumbers: [], // filled by findMiddles, which knows the sport
  };
}

export function findMiddles(
  events: OddsEvent[],
  allowedBookmakers: readonly string[],
  options: FindMiddlesOptions,
): MiddleBet[] {
  const allowed = new Set(allowedBookmakers);
  const nowMs = options.now.getTime();
  const markets = ['totals', 'spreads'].filter((m) => options.marketKeys.includes(m));
  const bets: MiddleBet[] = [];

  for (const event of events) {
    if (Date.parse(event.commenceTime) <= nowMs) continue;
    for (const marketKey of markets) {
      // Best price per (outcome, point) across allowed books.
      const best = new Map<string, MiddleOffer>();
      for (const book of event.bookmakers) {
        if (!allowed.has(book.key)) continue;
        const market = book.markets.find((m) => m.key === marketKey);
        for (const outcome of market?.outcomes ?? []) {
          if (outcome.point == null || outcome.price <= 1) continue;
          const key = `${outcome.name}|${outcome.point}`;
          if ((best.get(key)?.odds ?? 0) >= outcome.price) continue;
          best.set(key, {
            bookmakerKey: book.key,
            bookmakerTitle: book.title,
            outcome: outcome.name,
            point: outcome.point,
            odds: outcome.price,
            link: outcome.link ?? market?.link ?? book.link ?? null,
          });
        }
      }

      const offers = [...best.values()];
      const candidates: MiddleCandidate[] = [];
      if (marketKey === 'totals') {
        const overs = offers.filter((o) => o.outcome === 'Over');
        const unders = offers.filter((o) => o.outcome === 'Under');
        for (const over of overs) {
          for (const under of unders) {
            if (under.point - over.point < options.minWindow) continue;
            const candidate = totalsMiddle(over, under);
            if (candidate) candidates.push(candidate);
          }
        }
      } else {
        // Unordered team pairs once (canonical: first leg = lower signed
        // point) — the reversed frame is the same middle, not a second one.
        const names = [...new Set(offers.map((o) => o.outcome))].sort();
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const sideA = offers.filter((o) => o.outcome === names[i]);
            const sideB = offers.filter((o) => o.outcome === names[j]);
            for (const a of sideA) {
              for (const b of sideB) {
                if (a.point + b.point < options.minWindow) continue;
                const [first, second] = a.point <= b.point ? [a, b] : [b, a];
                const candidate = spreadsMiddle(first, second);
                if (candidate) candidates.push(candidate);
              }
            }
          }
        }
      }

      for (const candidate of candidates) {
        if (candidate.costPct > options.maxCostPct) continue;
        bets.push({
          eventId: event.id,
          sportKey: event.sportKey,
          sportTitle: event.sportTitle,
          eventName: `${event.awayTeam} @ ${event.homeTeam}`,
          commenceTime: event.commenceTime,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          marketKey,
          legs: candidate.legs,
          sameBookmaker: candidate.legs[0].bookmakerKey === candidate.legs[1].bookmakerKey,
          middle: {
            lowLine: candidate.lowLine,
            highLine: candidate.highLine,
            windowSize: candidate.windowSize,
            costPct: candidate.costPct,
            payoutPct: candidate.payoutPct,
            breakevenPct: candidate.breakevenPct,
            freeMiddle: candidate.freeMiddle,
            pushPossible: candidate.pushPossible,
            keyNumbers: keyNumbersInWindow(
              event.sportKey,
              candidate.lowLine,
              candidate.highLine,
              options.keyNumbers,
            ),
          },
        });
      }
    }
  }

  // Lowest breakeven first; at ties, half-line middles beat push-prone ones.
  return bets.sort(
    (a, b) =>
      a.middle.breakevenPct - b.middle.breakevenPct ||
      Number(a.middle.pushPossible) - Number(b.middle.pushPossible),
  );
}

function keyNumbersInWindow(
  sportKey: string,
  low: number,
  high: number,
  config: Record<string, readonly number[]>,
): number[] {
  const match = Object.keys(config).find((prefix) => sportKey.startsWith(prefix));
  if (!match) return [];
  return config[match].filter((k) => k > low && k < high);
}
