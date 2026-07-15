// Kill battery — six ordered gates that filter candidates before they become
// trades. First failure wins; order matches pipeline §3:
// ONE_SPORT_RULE → HEAT_GATE → SHARP_VELOCITY_CAP → MARKET_BREADTH_CAP →
// ROUNDING_DESTROYS_MARGIN → QUOTE_STALE.

import type { KillReason, Strategy } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Book } from '../db/repos.js';
import { arbStakesCents } from './stakes.js';

export interface Candidate {
  category: Strategy;
  sport: string;
  event: string;
  market: string;
  legs: { book: string; selection: string; odds: number; fetchedAt: number }[];
  edge: number;
  fairProbs: number[] | null;
  eventStartsAt: number;
}

export interface GateContext {
  now: number;
  books: Map<string, Book>;
  s: Settings;
  /** SENT semantics: counts verified/sent picks today with a leg at `book`. */
  sentTodayByBook(book: string): number;
  /** SENT semantics: counts verified/sent picks this week at `book` in `market`. */
  sentThisWeekByBookMarket(book: string, market: string): number;
}

export type GateVerdict = { verdict: 'pass' } | { verdict: 'kill'; reason: KillReason };

function kill(reason: KillReason): GateVerdict {
  return { verdict: 'kill', reason };
}

export function runKillBattery(c: Candidate, ctx: GateContext): GateVerdict {
  const { s } = ctx;

  // 1. ONE_SPORT_RULE — a non-exempt leg book assigned another sport kills.
  // A book missing from ctx.books ALSO kills here: an unknown book can't be
  // validated against its sport assignment, so it must never reach a trade.
  // Sharp-exempt books (pinnacle: sport 'ANY') skip this gate and HEAT_GATE,
  // but NOT the velocity/breadth caps below.
  const legBooks: Book[] = [];
  for (const leg of c.legs) {
    const book = ctx.books.get(leg.book);
    if (!book) return kill('ONE_SPORT_RULE');
    if (s.oneSportRule !== 0 && !book.sharpExempt && book.sport !== c.sport) return kill('ONE_SPORT_RULE');
    legBooks.push(book);
  }

  // 2. HEAT_GATE — any non-exempt leg book at or past stopHeat.
  for (const book of legBooks) {
    if (!book.sharpExempt && book.heat >= s.stopHeat) return kill('HEAT_GATE');
  }

  // 3. SHARP_VELOCITY_CAP — counts have SENT semantics (verified/sent picks);
  // at the cap means the next send would exceed it, so ≥ kills.
  for (const leg of c.legs) {
    if (ctx.sentTodayByBook(leg.book) >= s.sharpVelocityPerDayPerBook) {
      return kill('SHARP_VELOCITY_CAP');
    }
  }

  // 4. MARKET_BREADTH_CAP — same SENT semantics, per book+market per week.
  for (const leg of c.legs) {
    if (ctx.sentThisWeekByBookMarket(leg.book, c.market) >= s.marketBreadthPerWeekPerBook) {
      return kill('MARKET_BREADTH_CAP');
    }
  }

  // 5. ROUNDING_DESTROYS_MARGIN — ARB only: kill when the margin recomputed
  // from the ROUNDED stakes is ≤ 0 (a thin arb can be eaten by $5 rounding).
  if (c.category === 'ARB') {
    const { roundedMargin } = arbStakesCents(c.legs.map((l) => l.odds), s);
    if (roundedMargin <= 0) return kill('ROUNDING_DESTROYS_MARGIN');
  }

  // 6. QUOTE_STALE — any leg fetched more than freshWindowSecs before now
  // (timestamps are epoch ms; exactly freshWindowSecs old is still fresh).
  for (const leg of c.legs) {
    if (ctx.now - leg.fetchedAt > s.freshWindowSecs * 1000) return kill('QUOTE_STALE');
  }

  return { verdict: 'pass' };
}
