/**
 * Store-backed façade over opportunity persistence — what scanService, the
 * routes, and the alert notifier composition talk to.
 */
import type { ArbOpportunity, OpportunityRecord, OpportunityStatus } from '@shared/types';
import {
  applyScanToRecords,
  applyStatusChange,
  partitionForArchive,
  type CockpitStatus,
  type ScanScope,
} from './opportunityLifecycle';
import type { OpportunityArchiveWriter, OpportunityDataStore } from './opportunityStore';

export type UpdateStatusOutcome =
  | { ok: true; record: OpportunityRecord }
  | { ok: false; reason: 'not_found' | 'conflict'; message: string };

export class OpportunityService {
  constructor(
    private readonly store: OpportunityDataStore,
    private readonly archive: OpportunityArchiveWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Upsert a scan's detections, apply lifecycle, age settled records out. */
  async recordScan(opportunities: ArbOpportunity[], scope: ScanScope): Promise<void> {
    const at = this.now();
    await this.store.update(async (data) => {
      const { records } = applyScanToRecords(data.records, opportunities, scope, at);
      const { keep, archive } = partitionForArchive(records, at);
      if (archive.length > 0) {
        try {
          await this.archive.append(archive, at);
        } catch (err) {
          // Archive failure must not lose history — keep them active instead.
          console.warn('Opportunity archive append failed; keeping records in active file:', err);
          return { data: { records }, result: undefined };
        }
      }
      return { data: { records: keep }, result: undefined };
    });
  }

  /** Flag records whose fingerprints were actually sent as WhatsApp alerts. */
  async markAlerted(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return;
    const at = this.now().toISOString();
    const wanted = new Set(fingerprints);
    await this.store.update((data) => {
      for (const record of data.records) {
        if (wanted.has(record.fingerprint) && !record.alerted) {
          record.alerted = true;
          record.alertedAt = at;
        }
      }
      return { data, result: undefined };
    });
  }

  /** Cockpit-driven transition (degraded/completed) on one record. */
  async updateStatus(id: string, target: CockpitStatus): Promise<UpdateStatusOutcome> {
    const at = this.now();
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      if (!record) {
        return {
          data,
          result: {
            ok: false as const,
            reason: 'not_found' as const,
            message: `Unknown opportunity: ${id}`,
          },
        };
      }
      const change = applyStatusChange(record, target, at);
      const result: UpdateStatusOutcome = change.ok
        ? { ok: true, record }
        : { ok: false, reason: 'conflict', message: change.message };
      return { data, result };
    });
  }

  async get(id: string): Promise<OpportunityRecord | null> {
    const { records } = await this.store.read();
    return records.find((r) => r.id === id) ?? null;
  }

  /** Newest first; optionally filtered by status. */
  async list(status?: OpportunityStatus): Promise<OpportunityRecord[]> {
    const { records } = await this.store.read();
    return records
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }
}
