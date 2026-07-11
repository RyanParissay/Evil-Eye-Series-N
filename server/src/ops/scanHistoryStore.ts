/**
 * Append-only per-scan history — the one new persistence primitive of
 * Phase 8. Coverage, survival, and budget projection all derive from it
 * at zero API cost. Monthly JSONL files (the opportunity-archive
 * pattern), streamed line-by-line, never whole-file reads.
 */
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ScanLogEntry } from '@shared/types';

export class ScanHistoryStore {
  constructor(private readonly dir: string) {}

  async append(entry: ScanLogEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const month = entry.scannedAt.slice(0, 7);
    await appendFile(join(this.dir, `${month}.jsonl`), JSON.stringify(entry) + '\n', 'utf8');
  }

  /** Oldest → newest across month files. */
  async *entries(): AsyncGenerator<ScanLogEntry> {
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {
      return; // no history yet — normal on a fresh install
    }
    for (const file of files) {
      const lines = createInterface({
        input: createReadStream(join(this.dir, file), 'utf8'),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as ScanLogEntry;
        } catch {
          console.warn(`Skipping unparseable scan-history line in ${file}`);
        }
      }
    }
  }

  /** The most recent N entries, oldest first — bounded memory. */
  async lastN(n: number): Promise<ScanLogEntry[]> {
    const kept: ScanLogEntry[] = [];
    for await (const entry of this.entries()) {
      kept.push(entry);
      if (kept.length > n) kept.shift();
    }
    return kept;
  }
}
