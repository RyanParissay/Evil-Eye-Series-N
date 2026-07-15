import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import type { OddsProvider, Quote, Trade } from '../shared/types.js';
import type { PipeDeps } from './scan.js';
import { runScan } from './scan.js';
import { runVerifyDue } from './verify.js';

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
