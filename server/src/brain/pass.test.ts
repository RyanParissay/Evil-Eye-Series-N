import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Trade } from '../shared/types.js';
import {
  BRAIN_PASS_KIND, CUT_KIND, applyLimitsReport, brainPassIfDue, displayName, runBrainPass,
} from './pass.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT — awake hours
const HOUR = 3_600_000;

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

function settledArb(repos: PipeDeps['repos'], id: string): void {
  const t: Trade = {
    id, profileId: 1, category: 'ARB', event: `E-${id}`, sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'SETTLED',
    killReason: null, resultCents: 200, createdAt: NOW, verifyDueAt: NOW, verifiedAt: NOW,
    freshUntil: NOW, settledAt: NOW, eventStartsAt: NOW,
  };
  repos.trades.insert(t, '2026-07-14', 'moneyline');
}

test('first pass: ledger row, daily check, all 16 books scored', () => {
  const deps = mkDeps();
  const payload = runBrainPass(deps, NOW);
  expect(deps.repos.eventsLog.byKind(BRAIN_PASS_KIND)).toHaveLength(1);
  expect(Object.keys(payload.heats)).toHaveLength(16);
  expect(payload.healths['pinnacle']).toBe('green');
  const journal = deps.repos.journal.all();
  expect(journal).toHaveLength(1);
  expect(journal[0]!.text).toBe('Daily check: 16 of 16 books green · grades ARB 50 / EV 50 / MIDDLE 50');
});

test('second pass the same Vancouver day writes no duplicate daily check', () => {
  const deps = mkDeps();
  runBrainPass(deps, NOW);
  runBrainPass(deps, NOW + 6 * HOUR);
  expect(deps.repos.journal.all()).toHaveLength(1);
});

test('a limits report raises heat, sets belief, flips health amber on the pass', () => {
  const deps = mkDeps();
  deps.repos.limitsReports.add('t1', 'bet365', 12_000, NOW);
  runBrainPass(deps, NOW);
  const b = deps.repos.books.byName('bet365')!;
  expect(b.heat).toBe(23);
  expect(b.health).toBe('yellow'); // fresh incident keeps it amber even under goGentleHeat
  expect(b.maxBeliefCents).toBe(12_000);
});

test('health transitions journal display name, policy text and heat move', () => {
  const deps = mkDeps();
  runBrainPass(deps, NOW); // baseline: everything green
  deps.repos.limitsReports.add('t1', 'bet365', 12_000, NOW + 6 * HOUR);
  deps.repos.limitsReports.add('t2', 'bet365', 2_500, NOW + 6 * HOUR);
  deps.repos.eventsLog.add(NOW + 6 * HOUR, CUT_KIND, '{"book":"bet365"}');
  runBrainPass(deps, NOW + 6 * HOUR); // 23 + 23 + 14 = 60 → red
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Consolidation pass: Bet365 red → nothing sharp goes there (heat 0→60)');
});

test('grade shifts of 5+ points journal the move', () => {
  const deps = mkDeps();
  runBrainPass(deps, NOW); // grades 50/50/50
  for (let i = 0; i < 11; i += 1) settledArb(deps.repos, `arb-${i}`);
  runBrainPass(deps, NOW + 6 * HOUR);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts.some((t) => t.startsWith('ARB grade 50→92 — '))).toBe(true);
});

test('pinnacle never accumulates heat, even with a limits report', () => {
  const deps = mkDeps();
  deps.repos.limitsReports.add('t1', 'pinnacle', 1_000, NOW);
  runBrainPass(deps, NOW);
  expect(deps.repos.books.byName('pinnacle')!.heat).toBe(0);
  expect(deps.repos.books.byName('pinnacle')!.health).toBe('green');
});

test('brainPassIfDue honors the 6h cadence and the kill switch', () => {
  const deps = mkDeps();
  expect(brainPassIfDue(deps, NOW)).toBe(true);
  expect(brainPassIfDue(deps, NOW + 3 * HOUR)).toBe(false);
  expect(brainPassIfDue(deps, NOW + 6 * HOUR)).toBe(true);
  deps.repos.settings.set({ brainKillSwitch: 1 });
  expect(brainPassIfDue(deps, NOW + 13 * HOUR)).toBe(false);
});

test('applyLimitsReport recomputes one book immediately and journals the report line', () => {
  const deps = mkDeps();
  const s = deps.repos.settings.all();
  const t = { category: 'EV', event: 'SIM-EVT-3' } as Trade;
  deps.repos.limitsReports.add('t9', 'fanduel', 12_000, NOW); // the caller inserts the row first
  applyLimitsReport(deps.repos, s, t, 'fanduel', 12_000, NOW);
  expect(deps.repos.books.byName('fanduel')!.heat).toBe(23);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('EV SIM-EVT-3: FanDuel limit report → heat 0→23, max bet $500→$120, going gentle');
});

test('applyLimitsReport on pinnacle journals the sharp note and applies no heat', () => {
  const deps = mkDeps();
  const s = deps.repos.settings.all();
  const t = { category: 'ARB', event: 'SIM-EVT-1' } as Trade;
  deps.repos.limitsReports.add('t9', 'pinnacle', 1_000, NOW);
  applyLimitsReport(deps.repos, s, t, 'pinnacle', 1_000, NOW);
  expect(deps.repos.books.byName('pinnacle')!.heat).toBe(0);
  expect(deps.repos.journal.all()[0]!.text)
    .toBe('ARB SIM-EVT-1: Pinnacle limit report noted — sharp books don’t limit winners; no heat applied');
});

test('displayName maps the seeded slugs', () => {
  expect(displayName('sportsinteraction')).toBe('Sports Interaction');
  expect(displayName('betvictor')).toBe('Bet Victor');
  expect(displayName('someday-book')).toBe('someday-book');
});
