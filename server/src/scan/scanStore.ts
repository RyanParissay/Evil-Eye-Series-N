/**
 * File-based persistence for last-scan metadata, so the usage panel
 * survives page refreshes and server restarts. Deliberately not a database.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScanMeta } from '../../../shared/types';

export class ScanStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<ScanMeta | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as ScanMeta;
    } catch {
      // Missing or corrupt file → no last scan; not an error worth surfacing.
      return null;
    }
  }

  async write(meta: ScanMeta): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // Write-then-rename so a crash mid-write can't corrupt the record.
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
