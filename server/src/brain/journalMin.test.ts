import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { ensureJournalMinimum } from './journalMin.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT

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

test('writes deterministic observations up to the minimum, then stops', () => {
  const deps = mkDeps();
  deps.repos.settings.set({ journalMinPerDay: 3 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(3);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts[0]).toMatch(/^Watch list: /);
  expect(texts[1]).toBe('Today so far: 0 candidates · 0 sent · 0 killed');
  expect(texts[2]).toBe('Credits used this month: 0 of 100,000');
  expect(ensureJournalMinimum(deps, NOW + 60_000)).toBe(0); // minimum already met today
});

test('existing entries today count toward the minimum', () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1_000, 'Daily check: …');
  expect(ensureJournalMinimum(deps, NOW)).toBe(0); // min 1, one entry exists
  deps.repos.settings.set({ journalMinPerDay: 2 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(1); // tops up exactly one
});

test('the kill switch stops autonomous writing', () => {
  const deps = mkDeps();
  deps.repos.settings.set({ brainKillSwitch: 1, journalMinPerDay: 4 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(0);
  expect(deps.repos.journal.all()).toHaveLength(0);
});
