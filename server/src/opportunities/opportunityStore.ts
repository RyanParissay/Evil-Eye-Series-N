/**
 * Persistence for opportunity records: a JsonStore active file plus an
 * append-only monthly JSONL archive for settled history. The active file is
 * rewritten per scan and stays small because settled records age out into
 * the archive; the archive only ever grows by appending.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpportunityRecord } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export interface OpportunityData {
  records: OpportunityRecord[];
}

/** Structural interface so tests can substitute an in-memory store. */
export interface OpportunityDataStore {
  read(): Promise<OpportunityData>;
  update<T>(
    mutate: (
      data: OpportunityData,
    ) => { data: OpportunityData; result: T } | Promise<{ data: OpportunityData; result: T }>,
  ): Promise<T>;
}

export class OpportunityStore extends JsonStore<OpportunityData> implements OpportunityDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ records: [] }),
      (parsed) => ({
        // Pre-Phase-5 files lack the strategy discriminator; they were all arbs.
        records: (((parsed ?? {}) as Partial<OpportunityData>).records ?? []).map((r) => ({
          ...r,
          strategy: r.strategy ?? ('arb' as const),
        })),
      }),
    );
  }
}

export interface OpportunityArchiveWriter {
  append(records: OpportunityRecord[], now: Date): Promise<void>;
}

/** One JSONL file per month of archiving (data/opportunity-archive/2026-07.jsonl). */
export class OpportunityArchive implements OpportunityArchiveWriter {
  constructor(private readonly dir: string) {}

  async append(records: OpportunityRecord[], now: Date): Promise<void> {
    if (records.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await appendFile(join(this.dir, `${month}.jsonl`), lines, 'utf8');
  }
}
