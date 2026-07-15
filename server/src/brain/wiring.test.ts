import { expect, test } from 'vitest';
import { createApp } from '../api/routes.js';
import { BRAIN_PASS_KIND } from './pass.js';
import { CLOSE_KIND } from './closes.js';

const START = Date.UTC(2026, 6, 14, 19, 0); // 12:00 PDT — awake hours
const HOUR = 3_600_000;

function seededRng(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function mkHarness() {
  let now = START;
  const a = createApp({
    dbPath: ':memory:',
    clock: () => now,
    timer: { setTimeout: () => 0 }, // wakes are irrelevant — scanNow drives the tests
    rng: seededRng(),
  });
  return { ...a, setNow: (n: number) => { now = n; } };
}

test('every scan tick runs the brain pass gate; the 6h cadence holds', () => {
  const h = mkHarness();
  h.scheduler.scanNow(START);
  expect(h.repos.eventsLog.byKind(BRAIN_PASS_KIND)).toHaveLength(1);
  h.setNow(START + 76_000);
  h.scheduler.scanNow(START + 76_000); // verifies pendings; cadence not yet due
  expect(h.repos.eventsLog.byKind(BRAIN_PASS_KIND)).toHaveLength(1);
  h.setNow(START + 6 * HOUR + 1);
  h.scheduler.scanNow(START + 6 * HOUR + 1);
  expect(h.repos.eventsLog.byKind(BRAIN_PASS_KIND)).toHaveLength(2);
});

test('close capture fires when a sent trade enters the hot window', () => {
  const h = mkHarness();
  h.scheduler.scanNow(START);
  h.setNow(START + 76_000);
  h.scheduler.scanNow(START + 76_000); // promotions happen here
  const sent = (['VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED'] as const)
    .flatMap((st) => h.repos.trades.byStatus(st))
    .filter((t) => t.verifiedAt !== null)
    .sort((a, b) => a.eventStartsAt - b.eventStartsAt);
  expect(sent.length).toBeGreaterThan(0);
  const first = sent[0]!;
  const at = first.eventStartsAt - 30_000; // 30s before start — still quoted, inside the window
  h.setNow(at);
  h.scheduler.scanNow(at);
  const captures = h.repos.eventsLog.byKind(CLOSE_KIND)
    .map((r) => (JSON.parse(r.payload) as { tradeId: string }).tradeId);
  expect(captures).toContain(first.id);
});

test('the brain journal grows from the wired system, not from seeds', () => {
  const h = mkHarness();
  h.scheduler.scanNow(START);
  const texts = h.repos.journal.all().map((j) => j.text);
  expect(texts.some((t) => t.startsWith('Daily check: '))).toBe(true);
});
