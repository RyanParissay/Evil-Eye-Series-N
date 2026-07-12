import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the Phase-16 invariant that REPLACED "no server-side timers": all
 * wall-clock scheduling lives in server/src/scheduler/, so a bare
 * setTimeout/setInterval call is allowed there and nowhere else in server/src.
 * (This test's own file is under scheduler/, so its literal tokens are fine.)
 */
const SRC = join(__dirname, '..');
const CALL = /\b(setTimeout|setInterval)\s*\(/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('timer scope invariant', () => {
  it('setTimeout/setInterval appear only under server/src/scheduler/', () => {
    const offenders = tsFiles(SRC)
      .filter((f) => !f.includes(`${join('src', 'scheduler')}`) && !f.includes('/scheduler/'))
      .filter((f) => CALL.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
