/**
 * Persistence for WhatsApp subscriptions and sent-alert records — a
 * JsonStore specialization. All mutations go through update(), which
 * serializes read-modify-write cycles so a scan's alert dispatch can't race
 * a settings change arriving from the UI.
 */
import { JsonStore } from '../lib/jsonStore';
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
  /**
   * Risk Mode opt-in: EV alerts are OFF by default — individual EV bets
   * lose by design, so getting paged about them is a choice.
   */
  evEnabled?: boolean;
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

export class WhatsAppStore extends JsonStore<WhatsAppData> implements WhatsAppDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ subscriptions: [], sentAlerts: [] }),
      (parsed) => {
        const partial = (parsed ?? {}) as Partial<WhatsAppData>;
        return {
          subscriptions: partial.subscriptions ?? [],
          sentAlerts: partial.sentAlerts ?? [],
        };
      },
    );
  }
}
