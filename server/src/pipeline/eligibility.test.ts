import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import type { Quote } from '../shared/types.js';
import { disabledSportSet, eligibleQuotes } from './eligibility.js';

function q(book: string, sport: string): Quote {
  return {
    book, sport, event: 'A vs B', market: 'moneyline', selection: 'home',
    odds: 2.0, line: null, fetchedAt: 0, eventStartsAt: 9_999,
  };
}

test('disabledSportSet parses the CSV, ignoring blanks', () => {
  expect(disabledSportSet({ ...DEFAULT_SETTINGS, disabledSports: '' }).size).toBe(0);
  const set = disabledSportSet({ ...DEFAULT_SETTINGS, disabledSports: 'soccer,tennis' });
  expect(set.has('soccer')).toBe(true);
  expect(set.has('hockey')).toBe(false);
});

test('eligibleQuotes drops disabled books and disabled sports, keeps the rest', () => {
  const r = Repos(openDb(':memory:'));
  r.books.setEnabled('bet365', 0);
  const books = r.books.all();
  const s = { ...DEFAULT_SETTINGS, disabledSports: 'tennis' };
  const quotes = [q('bet365', 'basketball'), q('fanduel', 'basketball'), q('unibet', 'tennis'), q('pinnacle', 'basketball')];
  expect(eligibleQuotes(quotes, books, s).map((x) => x.book)).toEqual(['fanduel', 'pinnacle']);
});
