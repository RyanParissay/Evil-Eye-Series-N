import { expect, test } from 'vitest';
import { runKillBattery, type Candidate, type GateContext } from './gates.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import type { Book } from '../db/repos.js';

const NOW = 1_800_000_000_000; // epoch ms (schema convention: timestamps are INTEGER ms)
const FRESH = NOW - 10_000; // 10s old — well inside freshWindowSecs (120s)

function mkBook(name: string, sport: string, sharpExempt: 0 | 1, heat: number): Book {
  return { name, sport, sharpExempt, heat, health: 'green', maxBeliefCents: null, enabled: 1 };
}

/** bet365: basketball, heat 0 · pinnacle: ANY, sharp-exempt, heat 99 · fanduel: basketball, heat 70 */
function mkCtx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: NOW,
    books: new Map([
      ['bet365', mkBook('bet365', 'basketball', 0, 0)],
      ['pinnacle', mkBook('pinnacle', 'ANY', 1, 99)],
      ['fanduel', mkBook('fanduel', 'basketball', 0, 70)],
    ]),
    s: DEFAULT_SETTINGS,
    sentTodayByBook: () => 0,
    sentThisWeekByBookMarket: () => 0,
    ...over,
  };
}

/** Clean 2-leg ARB at 2.1/2.1: rounded stakes $50/$50 → margin +5%, survives every gate. */
function mkCand(over: Partial<Candidate> = {}): Candidate {
  return {
    category: 'ARB',
    sport: 'basketball',
    event: 'LAL @ BOS',
    market: 'h2h',
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 2.1, fetchedAt: FRESH },
      { book: 'pinnacle', selection: 'BOS', odds: 2.1, fetchedAt: FRESH },
    ],
    edge: 0.05,
    fairProbs: null,
    eventStartsAt: NOW + 3_600_000,
    ...over,
  };
}

test('ONE_SPORT_RULE: leg on a book assigned another sport → kill', () => {
  // bet365 is a basketball book; a soccer candidate may not use it
  const c = mkCand({ sport: 'soccer' });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'ONE_SPORT_RULE' });
});

test('ONE_SPORT_RULE: leg on a book missing from ctx.books → kill', () => {
  // An unknown book cannot be validated against its sport assignment → same kill reason
  const c = mkCand({
    legs: [
      { book: 'mysterybook', selection: 'LAL', odds: 2.1, fetchedAt: FRESH },
      { book: 'pinnacle', selection: 'BOS', odds: 2.1, fetchedAt: FRESH },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'ONE_SPORT_RULE' });
});

test('pinnacle is exempt from ONE_SPORT_RULE and HEAT_GATE', () => {
  // pinnacle: sport 'ANY' + sharpExempt, heat 99 (≥ stopHeat 60) — soccer candidate still passes
  const c = mkCand({
    sport: 'soccer',
    legs: [
      { book: 'pinnacle', selection: 'CHE', odds: 2.1, fetchedAt: FRESH },
      { book: 'pinnacle', selection: 'ARS', odds: 2.1, fetchedAt: FRESH },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'pass' });
});

test('HEAT_GATE: any non-exempt leg book heat ≥ stopHeat(60) → kill', () => {
  // fanduel is basketball (sport rule passes) but heat 70 ≥ stopHeat 60
  const c = mkCand({
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 2.1, fetchedAt: FRESH },
      { book: 'fanduel', selection: 'BOS', odds: 2.1, fetchedAt: FRESH },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'HEAT_GATE' });
});

test('HEAT_GATE boundary: heat exactly at stopHeat(60) → kill (≥, not >)', () => {
  const ctx = mkCtx();
  ctx.books.set('bet365', mkBook('bet365', 'basketball', 0, 60));
  expect(runKillBattery(mkCand(), ctx)).toEqual({ verdict: 'kill', reason: 'HEAT_GATE' });
});

test('SHARP_VELOCITY_CAP: sentTodayByBook ≥ 3 → kill', () => {
  const ctx = mkCtx({ sentTodayByBook: (book) => (book === 'bet365' ? 3 : 0) });
  expect(runKillBattery(mkCand(), ctx)).toEqual({ verdict: 'kill', reason: 'SHARP_VELOCITY_CAP' });
});

test('sharp-exempt books are NOT exempt from velocity/breadth caps', () => {
  // pinnacle skips sport+heat gates but still counts against the per-book daily cap
  const ctx = mkCtx({ sentTodayByBook: (book) => (book === 'pinnacle' ? 3 : 0) });
  expect(runKillBattery(mkCand(), ctx)).toEqual({ verdict: 'kill', reason: 'SHARP_VELOCITY_CAP' });
});

test('MARKET_BREADTH_CAP: sentThisWeekByBookMarket ≥ 2 → kill', () => {
  const ctx = mkCtx({
    sentThisWeekByBookMarket: (book, market) => (book === 'bet365' && market === 'h2h' ? 2 : 0),
  });
  expect(runKillBattery(mkCand(), ctx)).toEqual({ verdict: 'kill', reason: 'MARKET_BREADTH_CAP' });
});

test('ROUNDING_DESTROYS_MARGIN: thin ARB whose rounded-stake margin ≤ 0 → kill', () => {
  // odds [1.98, 2.035]: pre-rounding margin ≈ +0.36%, but the $100 pair splits
  // 5068.5/4931.5 cents → both round to $50.00 → min payout $99.00 on $100.00 → −1%
  const c = mkCand({
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 1.98, fetchedAt: FRESH },
      { book: 'pinnacle', selection: 'BOS', odds: 2.035, fetchedAt: FRESH },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'ROUNDING_DESTROYS_MARGIN' });
});

test('ROUNDING gate applies to ARB only: EV candidate with thin odds is not killed by it', () => {
  const c = mkCand({
    category: 'EV',
    legs: [{ book: 'bet365', selection: 'LAL', odds: 1.98, fetchedAt: FRESH }],
    fairProbs: [0.55],
    edge: 0.02,
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'pass' });
});

test('QUOTE_STALE: any leg fetchedAt older than freshWindowSecs → kill', () => {
  // second leg is 121s old; freshWindowSecs = 120
  const c = mkCand({
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 2.1, fetchedAt: FRESH },
      { book: 'pinnacle', selection: 'BOS', odds: 2.1, fetchedAt: NOW - 121_000 },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'QUOTE_STALE' });
});

test('QUOTE_STALE boundary: a leg exactly freshWindowSecs old is still fresh', () => {
  const c = mkCand({
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 2.1, fetchedAt: NOW - 120_000 },
      { book: 'pinnacle', selection: 'BOS', odds: 2.1, fetchedAt: FRESH },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'pass' });
});

test('gate order: first failure wins — hot book AND stale quote kills on HEAT_GATE', () => {
  // fanduel heat 70 and both quotes 999s stale: HEAT_GATE precedes QUOTE_STALE
  const c = mkCand({
    legs: [
      { book: 'bet365', selection: 'LAL', odds: 2.1, fetchedAt: NOW - 999_000 },
      { book: 'fanduel', selection: 'BOS', odds: 2.1, fetchedAt: NOW - 999_000 },
    ],
  });
  expect(runKillBattery(c, mkCtx())).toEqual({ verdict: 'kill', reason: 'HEAT_GATE' });
});

test('clean candidate passes', () => {
  expect(runKillBattery(mkCand(), mkCtx())).toEqual({ verdict: 'pass' });
});
