// Quote eligibility (Plan 5, Design §4): MY BOOKS ON/OFF and SPORTS & LEAGUES
// become a pure filter applied at BOTH ends of the pipe. Pure — no I/O.
import type { Quote } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Book } from '../db/repos.js';

export function disabledSportSet(s: Settings): Set<string> {
  return new Set(s.disabledSports.split(',').map((x) => x.trim()).filter((x) => x !== ''));
}

/** Quotes we are allowed to act on: book ON and sport ON. The caller keeps the
 *  FULL snapshot for the benchmark — the anchor is never a bet. */
export function eligibleQuotes(quotes: Quote[], books: Book[], s: Settings): Quote[] {
  const off = new Set(books.filter((b) => b.enabled === 0).map((b) => b.name));
  const sportsOff = disabledSportSet(s);
  return quotes.filter((q) => !off.has(q.book) && !sportsOff.has(q.sport));
}
