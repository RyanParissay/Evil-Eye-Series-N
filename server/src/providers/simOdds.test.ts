import { expect, test } from 'vitest';
import { SimOddsProvider } from './simOdds.js';
import { arbMargin, devigFairProbs, evEdge, middleMetrics } from '../engine/odds.js';
import type { Quote } from '../shared/types.js';

/** mulberry32 — deterministic PRNG; tests never touch Math.random or the clock. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = 1_760_000_000_000; // fixed epoch ms
const MIN_START = 30 * 60_000;
const MAX_START = 48 * 3_600_000;

/** Seeded books (db.ts SEED_BOOKS) — provider must never emit anything else. */
const BOOK_SPORT: Record<string, string> = {
  pinnacle: 'ANY', bet365: 'basketball', fanduel: 'basketball', draftkings: 'baseball',
  betmgm: 'baseball', caesars: 'hockey', bet99: 'hockey', sportsinteraction: 'soccer',
  betway: 'soccer', pointsbet: 'basketball', bwin: 'soccer', unibet: 'tennis',
  bodog: 'tennis', betvictor: 'soccer', leovegas: 'hockey', betrivers: 'baseball',
};

const OUTCOMES: Record<string, string[]> = {
  moneyline: ['home', 'away'], '1X2': ['home', 'draw', 'away'], total: ['over', 'under'],
};

function byEvent(quotes: Quote[]): Map<string, Quote[]> {
  const m = new Map<string, Quote[]>();
  for (const q of quotes) {
    const arr = m.get(q.event);
    if (arr) arr.push(q); else m.set(q.event, [q]);
  }
  return m;
}

test('deterministic under a seed', () => {
  const a = SimOddsProvider(mulberry32(42));
  const b = SimOddsProvider(mulberry32(42));
  expect(a.fetchQuotes(T0)).toEqual(b.fetchQuotes(T0));
  expect(a.fetchQuotes(T0 + 300_000)).toEqual(b.fetchQuotes(T0 + 300_000)); // drift path too
  const other = SimOddsProvider(mulberry32(7)).fetchQuotes(T0);
  expect(other).not.toEqual(SimOddsProvider(mulberry32(42)).fetchQuotes(T0));
});

test('every event has pinnacle quotes', () => {
  const events = byEvent(SimOddsProvider(mulberry32(1)).fetchQuotes(T0));
  expect(events.size).toBe(10);
  for (const [, evQuotes] of events) {
    const pinn = evQuotes.filter((q) => q.book === 'pinnacle');
    expect(pinn.length).toBeGreaterThanOrEqual(2);
    // pinnacle quotes one market+line per event and covers ALL its outcomes → devig-able benchmark
    expect(new Set(pinn.map((q) => `${q.market}|${q.line}`)).size).toBe(1);
    expect(new Set(pinn.map((q) => q.selection))).toEqual(new Set(OUTCOMES[pinn[0]!.market]));
  }
});

test('uses only seeded books on their sports; odds > 1; starts 30min-48h out', () => {
  const quotes = SimOddsProvider(mulberry32(2)).fetchQuotes(T0);
  expect(quotes.length).toBeGreaterThan(0);
  for (const q of quotes) {
    expect(q.odds).toBeGreaterThan(1);
    expect(BOOK_SPORT).toHaveProperty(q.book);
    if (q.book !== 'pinnacle') expect(BOOK_SPORT[q.book]).toBe(q.sport);
    expect(q.eventStartsAt).toBeGreaterThanOrEqual(T0 + MIN_START);
    expect(q.eventStartsAt).toBeLessThanOrEqual(T0 + MAX_START);
    expect(q.fetchedAt).toBe(T0);
  }
});

test('plants at least one 3-leg soccer arb (margin > 0.75% after devig check)', () => {
  const quotes = SimOddsProvider(mulberry32(3)).fetchQuotes(T0);
  let found = false;
  for (const [, evQuotes] of byEvent(quotes)) {
    if (evQuotes[0]!.sport !== 'soccer') continue;
    const softs = evQuotes.filter((q) => q.book !== 'pinnacle' && q.market === '1X2');
    const pinn = evQuotes.filter((q) => q.book === 'pinnacle' && q.market === '1X2');
    if (softs.length === 0 || pinn.length !== 3) continue;
    const sels = ['home', 'draw', 'away'];
    const best = sels.map((sel) =>
      softs.filter((q) => q.selection === sel).reduce((m, q) => Math.max(m, q.odds), 0));
    if (best.some((o) => o <= 1)) continue;
    const fair = devigFairProbs(sels.map((sel) => pinn.find((q) => q.selection === sel)!.odds));
    const legsBeatFair = best.every((odds, i) => evEdge(fair[i]!, odds) > 0);
    if (legsBeatFair && arbMargin(best) > 0.0075) found = true;
  }
  expect(found).toBe(true);
});

test('plants a 2-leg arb across two books (margin > 0.75%)', () => {
  const quotes = SimOddsProvider(mulberry32(4)).fetchQuotes(T0);
  let found = false;
  for (const [, evQuotes] of byEvent(quotes)) {
    const softs = evQuotes.filter((q) => q.book !== 'pinnacle' && q.market === 'moneyline');
    const best = (sel: string) => softs
      .filter((q) => q.selection === sel)
      .reduce<Quote | null>((acc, q) => (!acc || q.odds > acc.odds ? q : acc), null);
    const h = best('home');
    const a = best('away');
    if (h && a && h.book !== a.book && arbMargin([h.odds, a.odds]) > 0.0075) found = true;
  }
  expect(found).toBe(true);
});

test('plants at least two EV spots priced >= 3.5% above pinnacle devig fair', () => {
  const quotes = SimOddsProvider(mulberry32(5)).fetchQuotes(T0);
  const evEvents = new Set<string>();
  for (const [event, evQuotes] of byEvent(quotes)) {
    const pinn = evQuotes.filter((q) => q.book === 'pinnacle');
    const sels = pinn.map((q) => q.selection);
    const fair = devigFairProbs(pinn.map((q) => q.odds));
    for (const q of evQuotes) {
      if (q.book === 'pinnacle' || q.market !== pinn[0]!.market || q.line !== pinn[0]!.line) continue;
      const i = sels.indexOf(q.selection);
      if (i >= 0 && evEdge(fair[i]!, q.odds) >= 0.035) evEvents.add(event); // > minEvEdgePct with room
    }
  }
  expect(evEvents.size).toBeGreaterThanOrEqual(2);
});

test('plants a qualifying middle pair on different lines of the same total', () => {
  const quotes = SimOddsProvider(mulberry32(6)).fetchQuotes(T0);
  let found = false;
  for (const [, evQuotes] of byEvent(quotes)) {
    const softs = evQuotes.filter((q) => q.book !== 'pinnacle' && q.market === 'total');
    for (const over of softs.filter((q) => q.selection === 'over')) {
      for (const under of softs.filter((q) => q.selection === 'under')) {
        if (over.line === null || under.line === null) continue;
        if (over.line >= under.line || over.book === under.book) continue; // real middle window
        const m = middleMetrics(over.odds, under.odds);
        if (m.free || m.ratio >= 1.5) found = true;
      }
    }
  }
  expect(found).toBe(true);
});

test('consecutive fetches drift but keep event identity', () => {
  const p = SimOddsProvider(mulberry32(9));
  const now2 = T0 + 20 * 60_000; // next scan tick — before any event starts (min 30min out)
  const first = p.fetchQuotes(T0);
  const second = p.fetchQuotes(now2);
  const key = (q: Quote) => `${q.event}|${q.book}|${q.market}|${q.selection}|${q.line}`;
  expect(second.map(key).sort()).toEqual(first.map(key).sort());
  const starts = new Map(first.map((q) => [q.event, q.eventStartsAt]));
  const prev = new Map(first.map((q) => [key(q), q.odds]));
  let moved = 0;
  for (const q of second) {
    expect(q.eventStartsAt).toBe(starts.get(q.event)); // identity kept
    expect(q.fetchedAt).toBe(now2);
    const before = prev.get(key(q))!;
    expect(Math.abs(q.odds / before - 1)).toBeLessThanOrEqual(0.0215); // ±2% step + rounding
    if (q.odds !== before) moved += 1;
  }
  expect(moved).toBeGreaterThan(0);
});

test('expired events are replaced with fresh identities', () => {
  const p = SimOddsProvider(mulberry32(11));
  const firstNames = new Set(p.fetchQuotes(T0).map((q) => q.event));
  const later = T0 + MAX_START + 3_600_000; // every event has started by now
  const second = p.fetchQuotes(later);
  const secondNames = new Set(second.map((q) => q.event));
  expect(secondNames.size).toBe(10);
  for (const name of secondNames) expect(firstNames.has(name)).toBe(false);
  for (const q of second) {
    expect(q.eventStartsAt).toBeGreaterThanOrEqual(later + MIN_START);
    expect(q.eventStartsAt).toBeLessThanOrEqual(later + MAX_START);
  }
});
