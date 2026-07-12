/**
 * Daily backup of server/data/ (Phase 15 #6). One dated directory per
 * calendar day under BACKUP_DIR, copying everything under the data dir
 * EXCEPT the backups dir itself, pruned to the newest 14 dailies. No
 * server-side timers, ever (CLAUDE.md: "scans are on-demand only" extends
 * here) — this only runs when explicitly triggered (server startup,
 * fire-and-forget after each scan) and no-ops if today's dir already
 * exists. Never throws: a backup failure must not break startup or a scan.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const RETAIN_DAILIES = 14;
const DAY_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BackupService {
  constructor(
    /** server/data — the directory being backed up. */
    private readonly dataDir: string,
    /** BACKUP_DIR — where dated snapshots land. */
    private readonly backupDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** No-ops if today's dated dir already exists. */
  async runIfNeeded(): Promise<void> {
    const dayDir = join(this.backupDir, dayKey(this.now()));
    if (await exists(dayDir)) return;
    await this.copyDataDir(dayDir);
    await this.pruneToNewest();
  }

  private async copyDataDir(dayDir: string): Promise<void> {
    await mkdir(dayDir, { recursive: true });
    const resolvedBackupDir = resolve(this.backupDir);
    let entries: string[] = [];
    try {
      entries = await readdir(this.dataDir);
    } catch {
      return; // No data dir yet — nothing to back up (fresh install).
    }
    for (const entry of entries) {
      const src = join(this.dataDir, entry);
      if (resolve(src) === resolvedBackupDir) continue; // never nest the backups dir into itself
      await cp(src, join(dayDir, entry), { recursive: true });
    }
  }

  private async pruneToNewest(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.backupDir);
    } catch {
      return;
    }
    const dailies = entries.filter((e) => DAY_DIR_PATTERN.test(e)).sort();
    const excess = dailies.length - RETAIN_DAILIES;
    if (excess <= 0) return;
    for (const stale of dailies.slice(0, excess)) {
      await rm(join(this.backupDir, stale), { recursive: true, force: true });
    }
  }
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
