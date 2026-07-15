import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { backupHook, pruneBackups, runNightlyBackup } from './backup.js';

const NOON = Date.UTC(2026, 6, 14, 19, 0);   // 12:00 PDT
const NIGHT = Date.UTC(2026, 6, 14, 8, 0);   // 01:00 PDT — before 03:00

test('runNightlyBackup writes a dated file and the events row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-backup-'));
  const db = openDb(':memory:');
  const repos = Repos(db);
  const file = await runNightlyBackup(db, repos, dir, NOON);
  expect(file.endsWith('evil-eye-2026-07-14.db')).toBe(true);
  expect(existsSync(file)).toBe(true);
  const rows = repos.eventsLog.all().filter((e) => e.kind === 'backup');
  expect(rows).toHaveLength(1);
  expect((JSON.parse(rows[0]!.payload) as { file: string }).file).toContain('evil-eye-2026-07-14.db');
});

test('pruneBackups keeps the newest 14 files, deletes the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-prune-'));
  for (let i = 1; i <= 17; i += 1) {
    writeFileSync(join(dir, `evil-eye-2026-06-${String(i).padStart(2, '0')}.db`), 'x');
  }
  writeFileSync(join(dir, 'not-a-backup.txt'), 'x'); // non-matching files are never touched
  const deleted = pruneBackups(dir, 14);
  expect(deleted).toEqual([
    'evil-eye-2026-06-01.db', 'evil-eye-2026-06-02.db', 'evil-eye-2026-06-03.db',
  ]);
  const left = readdirSync(dir).sort();
  expect(left).toContain('evil-eye-2026-06-04.db');
  expect(left).toContain('evil-eye-2026-06-17.db');
  expect(left).toContain('not-a-backup.txt');
  expect(left.filter((f) => f.startsWith('evil-eye-')).length).toBe(14);
});

test('backupHook: due after 03:00 Vancouver once per day, regardless of mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-hook-'));
  const db = openDb(':memory:');
  const repos = Repos(db);
  const hook = backupHook(db, repos, dir, () => NOON);
  expect(hook.nextAt(NIGHT)).toBeNull();       // 01:00 — not due yet (no mid-quiet wake)
  expect(hook.nextAt(NOON)).toBe(NOON);        // past 03:00, none today → due now
  await hook.run(NOON);
  expect(hook.nextAt(NOON + 60_000)).toBeNull(); // done for the day
  expect(readdirSync(dir)).toEqual(['evil-eye-2026-07-14.db']);
});
