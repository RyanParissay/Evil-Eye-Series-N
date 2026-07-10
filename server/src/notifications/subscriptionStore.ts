/**
 * File-based persistence for WhatsApp subscriptions and sent-alert records —
 * the same deliberately-not-a-database pattern as ScanStore. All mutations
 * go through update(), which serializes read-modify-write cycles so a scan's
 * alert dispatch can't race a settings change arriving from the UI.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PendingVerification } from './verification';

export interface WhatsAppSubscription {
  phoneE164: string;
  /** Alert only on opportunities at or above this profit %. */
  thresholdPercent: number;
  verified: boolean;
  active: boolean;
  /** Consecutive alert-send failures; resets on any successful send. */
  failedSendCount: number;
  verification: PendingVerification | null;
  /** ISO timestamps of recent sends, for the per-hour rate limit. */
  sendTimestamps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SentAlertRecord {
  phoneE164: string;
  /** Stable opportunity identity — see alertService.opportunityFingerprint. */
  fingerprint: string;
  profitPct: number;
  sentAt: string;
}

export interface WhatsAppData {
  subscriptions: WhatsAppSubscription[];
  sentAlerts: SentAlertRecord[];
}

/**
 * What consumers (routes, alert service) actually depend on — lets tests
 * substitute an in-memory store.
 */
export interface WhatsAppDataStore {
  read(): Promise<WhatsAppData>;
  update<T>(
    mutate: (
      data: WhatsAppData,
    ) => { data: WhatsAppData; result: T } | Promise<{ data: WhatsAppData; result: T }>,
  ): Promise<T>;
}

export class WhatsAppStore implements WhatsAppDataStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<WhatsAppData> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WhatsAppData>;
      return {
        subscriptions: parsed.subscriptions ?? [],
        sentAlerts: parsed.sentAlerts ?? [],
      };
    } catch {
      // Missing or corrupt file → nobody subscribed yet.
      return { subscriptions: [], sentAlerts: [] };
    }
  }

  /**
   * Serialized read-modify-write: mutators run one at a time, in call order,
   * each seeing the previous one's writes. The mutator returns the next
   * state plus a result to hand back to the caller.
   */
  update<T>(
    mutate: (
      data: WhatsAppData,
    ) => { data: WhatsAppData; result: T } | Promise<{ data: WhatsAppData; result: T }>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const { data, result } = await mutate(await this.read());
      await this.write(data);
      return result;
    };
    const next = this.queue.then(run, run);
    // A rejected mutator must not wedge the chain for later callers.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(data: WhatsAppData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // Write-then-rename so a crash mid-write can't corrupt the record.
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
