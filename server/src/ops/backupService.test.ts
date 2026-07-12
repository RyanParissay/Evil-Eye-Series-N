/**
 * BackupService tests run entirely against mkdtemp'd directories — never
 * the real server/data/backups. Every test cleans up after itself.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupService } from './backupService';

let root: string;
let dataDir: string;
let backupDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'backup-'));
  dataDir = join(root, 'data');
  backupDir = join(dataDir, 'backups'); // mirrors the real default nesting
  await mkdir(dataDir, { recursive: true });
});

afterEach(() => rm(root, { recursive: true, force: true }));

const NOW = () => new Date('2026-07-11T09:00:00Z');

describe('BackupService.runIfNeeded', () => {
  it('copies everything under dataDir except the backups dir itself into BACKUP_DIR/YYYY-MM-DD', async () => {
    await writeFile(join(dataDir, 'ops.json'), '{"a":1}', 'utf8');
    await mkdir(join(dataDir, 'scan-history'), { recursive: true });
    await writeFile(join(dataDir, 'scan-history', '2026-07.jsonl'), '{"line":1}\n', 'utf8');

    const service = new BackupService(dataDir, backupDir, NOW);
    await service.runIfNeeded();

    const dayDir = join(backupDir, '2026-07-11');
    const opsCopy = await readFile(join(dayDir, 'ops.json'), 'utf8');
    expect(opsCopy).toBe('{"a":1}');
    const historyCopy = await readFile(join(dayDir, 'scan-history', '2026-07.jsonl'), 'utf8');
    expect(historyCopy).toBe('{"line":1}\n');

    // The backups dir must never be copied into itself.
    await expect(stat(join(dayDir, 'backups'))).rejects.toThrow();
  });

  it('no-ops if today\'s dated dir already exists', async () => {
    await writeFile(join(dataDir, 'ops.json'), '{"a":1}', 'utf8');
    const service = new BackupService(dataDir, backupDir, NOW);
    await service.runIfNeeded();

    // Change source data AFTER the first backup ran today.
    await writeFile(join(dataDir, 'ops.json'), '{"a":2}', 'utf8');
    await service.runIfNeeded();

    const stillOriginal = await readFile(join(backupDir, '2026-07-11', 'ops.json'), 'utf8');
    expect(stillOriginal).toBe('{"a":1}');
  });

  it('never throws when dataDir does not exist yet', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'backup-empty-'));
    const missingData = join(emptyRoot, 'data');
    const service = new BackupService(missingData, join(missingData, 'backups'), NOW);
    await expect(service.runIfNeeded()).resolves.toBeUndefined();
    await rm(emptyRoot, { recursive: true, force: true });
  });

  it('prunes to the newest 14 dated dirs', async () => {
    await mkdir(backupDir, { recursive: true });
    // 16 fake dailies, oldest to newest.
    const dates = Array.from({ length: 16 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
    for (const date of dates) {
      await mkdir(join(backupDir, date), { recursive: true });
      await writeFile(join(backupDir, date, 'marker.txt'), date, 'utf8');
    }

    const service = new BackupService(dataDir, backupDir, () => new Date('2026-07-11T09:00:00Z'));
    await service.runIfNeeded(); // adds a 17th dated dir, then prunes to 14

    const remaining = (await readdir(backupDir)).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
    expect(remaining).toHaveLength(14);
    // The two oldest of the original 16 must be gone; today's must survive.
    expect(remaining).not.toContain('2026-06-01');
    expect(remaining).not.toContain('2026-06-02');
    expect(remaining).toContain('2026-06-16');
    expect(remaining).toContain('2026-07-11');
  });
});
