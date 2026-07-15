import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { defaultPlanDeps, startScheduler, type HookTask } from './runner.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // awake hours

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

test('pump runs due hooks and skips future ones; hook errors never kill the chain', async () => {
  const deps = mkDeps();
  let now = NOW;
  const ran: string[] = [];
  const hooks: HookTask[] = [
    { name: 'due', nextAt: () => now, run: async () => { ran.push('due'); } },
    { name: 'future', nextAt: () => NOW + 60_000, run: async () => { ran.push('future'); } },
    { name: 'silent', nextAt: () => null, run: async () => { ran.push('silent'); } },
    { name: 'boom', nextAt: () => now, run: async () => { throw new Error('boom'); } },
  ];
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => now, hooks);
  await scheduler.pump(); // must not reject despite 'boom'
  expect(ran).toEqual(['due']);
  now += 61_000;
  await scheduler.pump();
  expect(ran).toEqual(['due', 'due', 'future']);
});

test('pump awaits provider.refresh before the scan work', async () => {
  const order: string[] = [];
  const deps = mkDeps();
  deps.provider = {
    fetchQuotes: () => { order.push('fetch'); return []; },
    refresh: async () => { order.push('refresh'); },
  };
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => NOW, []);
  await scheduler.pump();
  expect(order[0]).toBe('refresh'); // snapshot refreshed before runDue scans it
  expect(order).toContain('fetch');
});

test('tick() stays synchronous and hook-free — sim tests keep their contract', () => {
  const deps = mkDeps();
  const ran: string[] = [];
  const hooks: HookTask[] = [{ name: 'h', nextAt: () => NOW, run: async () => { ran.push('h'); } }];
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => NOW, hooks);
  scheduler.tick();
  expect(ran).toEqual([]); // hooks run through pump/the timer, never tick
});
