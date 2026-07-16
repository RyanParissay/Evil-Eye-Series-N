import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import type { OddsProvider, Quote, Trade } from '../shared/types.js';
import type { PipeDeps } from './scan.js';
import { runScan } from './scan.js';
import { runVerifyDue } from './verify.js';
import { arbMargin } from '../engine/odds.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const VNOW = NOW + 76_000;
const DAY = '2026-07-14';

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

function frozen(base: OddsProvider): OddsProvider {
  let first: Quote[] | null = null;
  return {
    fetchQuotes(now: number): Quote[] {
      first ??= base.fetchQuotes(now);
      return first.map((x) => ({ ...x, fetchedAt: now }));
    },
  };
}

function mkDeps() {
  const repos = Repos(openDb(':memory:'));
  const rng = mulberry32(42);
  const deps: PipeDeps = {
    repos,
    provider: frozen(SimOddsProvider(rng)),
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng,
  };
  return { deps, repos };
}

function sentSeed(id: string, category: Trade['category']): Trade {
  return {
    id, profileId: 1, category, event: `seed-${id}`, sport: 'basketball',
    legs: [{ book: 'seedbook', selection: 'home', odds: 2.0, stakeCents: 1_500 }],
    marginInitial: 0.03, marginRecheck: 0.03, marginFinal: 0.03, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: NOW - 1_000, verifyDueAt: NOW - 1_000,
    verifiedAt: NOW - 1_000, freshUntil: NOW + 120_000, settledAt: null, eventStartsAt: NOW + 9_999_999,
  };
}

test('a category at its mix allowance is held back with the mix clause; others promote', () => {
  const { deps, repos } = mkDeps();
  // ARB allowance at defaults = 6; seed 6 sent ARBs today, so ARB starts at its cap.
  // (The seed-42 snapshot kills its own ARB candidates at scan, so the category the
  //  mix clause actually bites at verification is EV — the one it over-supplies.)
  for (let i = 0; i < 6; i += 1) repos.trades.insert(sentSeed(`arb-${i}`, 'ARB'), DAY, null);
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);
  runVerifyDue(deps, VNOW);
  expect(repos.trades.sentTodayByCategory(DAY, 'ARB')).toBe(6); // no 7th ARB, ever
  // EV allowance = round(12 × 29%) = 3; the snapshot plants 7 EV candidates, so the
  // 4 extras pass verification but are held back with the mix clause.
  expect(repos.trades.sentTodayByCategory(DAY, 'EV')).toBe(3); // never more than the EV mix share
  const texts = repos.journal.all().map((j) => j.text);
  expect(texts.some((t) => t.includes('held back — EV mix at its 29% cap'))).toBe(true);
  // The other categories were NOT starved by the mix caps.
  const promotedCats = repos.trades.byStatus('VERIFIED')
    .filter((t) => !t.id.startsWith('arb-')).map((t) => t.category);
  expect(promotedCats.length).toBeGreaterThan(0);
  expect(promotedCats.every((c) => c !== 'ARB')).toBe(true);
  expect(promotedCats.includes('MIDDLE')).toBe(true);
});

test('an ARB that SURVIVES verification is held back at its own mix cap (F2)', () => {
  // The seed-42 snapshot kills its ARB candidates at scan (ROUNDING_DESTROYS_MARGIN),
  // so the ARB mix clause never bites there. This plants a genuine cross-book ARB that
  // DOES survive the recheck, with the ARB category already at its allowance.
  const repos = Repos(openDb(':memory:'));
  const EVENT = 'Suns vs Nuggets';
  const q = (book: string, selection: string): Quote => ({
    book, sport: 'basketball', event: EVENT, market: 'moneyline', selection,
    odds: 2.2, line: null, fetchedAt: VNOW, eventStartsAt: VNOW + 3_600_000,
  });
  const deps: PipeDeps = {
    repos,
    provider: { fetchQuotes: () => [q('fanduel', 'home'), q('draftkings', 'away')] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: mulberry32(1),
  };
  // ARB allowance at defaults = round(12 × 47%) = 6 — fill it with 6 sent ARBs today.
  for (let i = 0; i < 6; i += 1) repos.trades.insert(sentSeed(`arb-${i}`, 'ARB'), DAY, null);
  // A healthy 2-leg ARB (home 2.20 / away 2.20 → margin ≈ 9%): survives the tolerance
  // gate (recheck === initial) and keeps a positive margin after $5 rounding.
  const survivor: Trade = {
    id: 'arb-survivor', profileId: 1, category: 'ARB', event: EVENT, sport: 'basketball',
    legs: [
      { book: 'fanduel', selection: 'home', odds: 2.2, stakeCents: null },
      { book: 'draftkings', selection: 'away', odds: 2.2, stakeCents: null },
    ],
    marginInitial: arbMargin([2.2, 2.2]), marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: NOW, verifyDueAt: NOW + 60_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: VNOW + 3_600_000,
  };
  repos.trades.insert(survivor, DAY, 'moneyline');

  runVerifyDue(deps, VNOW);

  // It passed verification but the ARB mix is already full → held back, not sent.
  expect(repos.trades.byId('arb-survivor')!.status).toBe('EXPIRED');
  expect(repos.trades.sentTodayByCategory(DAY, 'ARB')).toBe(6); // never a 7th ARB
  const texts = repos.journal.all().map((j) => j.text);
  expect(texts).toContain(`ARB ${EVENT} passed verification but was held back — ARB mix at its 47% cap.`);
});

test('anchor-down CONSENSUS EV survives the recheck via the leave-one-out consensus (F1)', () => {
  const repos = Repos(openDb(':memory:'));
  repos.settings.set({ anchorFallback: 0 });
  const EVENT = 'X vs Y';
  const mk = (book: string, selection: string, odds: number): Quote => ({
    book, sport: 'basketball', event: EVENT, market: 'moneyline', selection,
    odds, line: null, fetchedAt: VNOW, eventStartsAt: VNOW + 3_600_000,
  });
  // NO pinnacle → anchor down. bet365 home 2.10 beats the fanduel/draftkings consensus.
  const snapshot = [
    mk('bet365', 'home', 2.10), mk('bet365', 'away', 1.80),
    mk('fanduel', 'home', 1.95), mk('fanduel', 'away', 1.85),
    mk('draftkings', 'home', 1.90), mk('draftkings', 'away', 1.88),
  ];
  const deps: PipeDeps = {
    repos,
    provider: { fetchQuotes: () => snapshot },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: mulberry32(1),
  };
  const ev: Trade = {
    id: 'ev-consensus', profileId: 1, category: 'EV', event: EVENT, sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.10, stakeCents: null }],
    marginInitial: 0.0308, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: NOW, verifyDueAt: NOW + 60_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: VNOW + 3_600_000,
  };
  repos.trades.insert(ev, DAY, 'moneyline');

  runVerifyDue(deps, VNOW);

  const after = repos.trades.byId('ev-consensus')!;
  expect(after.status).toBe('VERIFIED'); // re-priced via consensus — NOT killed QUOTE_STALE
  expect(after.marginFinal).toBeCloseTo(0.0308, 3);
});

test('a 0% mix share promotes nothing of that category', () => {
  const { deps, repos } = mkDeps();
  repos.settings.set({ mixArbPct: 71, mixMiddlePct: 0, mixEvPct: 29 });
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);
  runVerifyDue(deps, VNOW);
  expect(repos.trades.byStatus('VERIFIED').every((t) => t.category !== 'MIDDLE')).toBe(true);
  expect(repos.trades.sentTodayByCategory(DAY, 'MIDDLE')).toBe(0);
});

test('a disabled book produces no candidates at scan', () => {
  const { deps, repos } = mkDeps();
  const probe = mkDeps(); // same seed → same snapshot; find a soft book that quotes
  const probeScan = runScan(probe.deps, NOW);
  expect(probeScan.created).toBeGreaterThan(0);
  const probeBooks = new Set(
    [...probe.repos.trades.byStatus('PENDING'), ...probe.repos.trades.byStatus('KILLED')]
      .flatMap((t) => t.legs.map((l) => l.book)).filter((b) => b !== 'pinnacle'),
  );
  const target = [...probeBooks].sort()[0]!;
  repos.books.setEnabled(target, 0);
  runScan(deps, NOW);
  const legBooks = [...repos.trades.byStatus('PENDING'), ...repos.trades.byStatus('KILLED')]
    .flatMap((t) => t.legs.map((l) => l.book));
  expect(legBooks).not.toContain(target);
});

test('a disabled sport produces no candidates of that sport', () => {
  const { deps, repos } = mkDeps();
  const probe = mkDeps();
  runScan(probe.deps, NOW);
  const sports = [...new Set(
    [...probe.repos.trades.byStatus('PENDING'), ...probe.repos.trades.byStatus('KILLED')].map((t) => t.sport),
  )].sort();
  expect(sports.length).toBeGreaterThan(0);
  const target = sports[0]!;
  repos.settings.set({ disabledSports: target });
  runScan(deps, NOW);
  const created = [...repos.trades.byStatus('PENDING'), ...repos.trades.byStatus('KILLED')];
  expect(created.every((t) => t.sport !== target)).toBe(true);
});

test('disabling a pending trade\'s book mid-flight kills it QUOTE_STALE at the recheck', () => {
  const { deps, repos } = mkDeps();
  runScan(deps, NOW);
  const pending = repos.trades.byStatus('PENDING');
  expect(pending.length).toBeGreaterThan(0);
  const victim = pending[0]!;
  const book = victim.legs.map((l) => l.book).find((b) => b !== 'pinnacle') ?? victim.legs[0]!.book;
  repos.books.setEnabled(book, 0);
  runVerifyDue(deps, VNOW);
  const after = repos.trades.byId(victim.id)!;
  expect(after.status).toBe('KILLED');
  expect(after.killReason).toBe('QUOTE_STALE'); // the quote is no longer available TO US
});
