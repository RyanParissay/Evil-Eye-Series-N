// Nightly backups ×14 (Plan 6, Design §9): once per Vancouver day, on the first
// pump at-or-after 03:00 (in practice the quiet-end wake — the chain never wakes
// mid-quiet just to copy a file). FILES rotate; database rows are forever.
// Runs in BOTH modes: sim data is data.
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db, Repos } from '../db/db.js';
import type { HookTask } from '../scheduler/runner.js';
import { dayKey } from '../scheduler/vancouverTime.js';

export const KEEP_BACKUPS = 14;
const DUE_HOUR = 3; // Vancouver

const HOUR_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23',
});
const vancouverHour = (epochMs: number): number => Number(HOUR_FMT.format(epochMs));

const BACKUP_RE = /^evil-eye-\d{4}-\d{2}-\d{2}\.db$/;

/** Delete all but the newest `keep` backup files (name IS the date — lexicographic order). */
export function pruneBackups(backupDir: string, keep: number): string[] {
  const files = readdirSync(backupDir).filter((f) => BACKUP_RE.test(f)).sort();
  const doomed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of doomed) rmSync(join(backupDir, f));
  return doomed;
}

export async function runNightlyBackup(db: Db, repos: Repos, backupDir: string, now: number): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `evil-eye-${dayKey(now)}.db`);
  await db.backup(file); // better-sqlite3's online backup — safe against a live db
  pruneBackups(backupDir, KEEP_BACKUPS);
  repos.eventsLog.add(now, 'backup', JSON.stringify({ file }));
  return file;
}

/** Due when Vancouver hour ≥ 3 and no backup event carries today's day key. */
export function backupHook(db: Db, repos: Repos, backupDir: string, clock: () => number): HookTask {
  return {
    name: 'nightly-backup',
    nextAt(now: number): number | null {
      if (vancouverHour(now) < DUE_HOUR) return null;
      const today = dayKey(now);
      const done = repos.eventsLog.all().some((e) => e.kind === 'backup' && dayKey(e.ts) === today);
      return done ? null : now;
    },
    async run(now: number): Promise<void> {
      try {
        await runNightlyBackup(db, repos, backupDir, now);
      } catch (err) {
        repos.eventsLog.add(now, 'backup_error', JSON.stringify({
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
      }
    },
  };
}
