/**
 * The shadow fund. Entry selection is the SAME alertWorthy core the
 * WhatsApp path uses (threshold, non-suspicious, non-same-book, dedup) —
 * an entry happens iff a push would have been worthy. Settlement math
 * lives in paperMath (pure); this façade only moves facts in and out of
 * the store. It never touches credits, balances, or opportunity records.
 */
import type { ArbOpportunity, PaperSettings, PaperView } from '@shared/types';
import { alertWorthy } from '../notifications/alertService';
import { opportunityIdFromFingerprint } from '../opportunities/opportunityId';
import { settlePaperBook } from './paperMath';
import type { PaperDataStore } from './paperStore';

export class PaperService {
  constructor(
    private readonly store: PaperDataStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Fire-and-forget from the scan notifier; returns how many entered. */
  async considerEntries(opportunities: ArbOpportunity[]): Promise<number> {
    const at = this.now().toISOString();
    return this.store.update((data) => {
      if (!data.settings.enabled) return { data, result: 0 };
      const seen = new Set(data.entries.map((e) => e.fingerprint));
      const picks = alertWorthy(opportunities, data.settings.thresholdPercent, (fp) =>
        seen.has(fp),
      );
      for (const { opportunity, fingerprint } of picks) {
        data.entries.push({
          id: opportunityIdFromFingerprint(fingerprint),
          fingerprint,
          eventId: opportunity.eventId,
          eventName: opportunity.eventName,
          sportKey: opportunity.sportKey,
          sportTitle: opportunity.sportTitle,
          marketKey: opportunity.marketKey,
          profitPct: opportunity.profitPct,
          arbIndex: opportunity.arbIndex,
          legs: opportunity.legs,
          enteredAt: at,
          commenceTime: opportunity.commenceTime,
        });
      }
      return { data, result: picks.length };
    });
  }

  async book(): Promise<PaperView> {
    const data = await this.store.read();
    return {
      simulated: true,
      settings: data.settings,
      book: settlePaperBook(data.entries, data.settings, this.now()),
    };
  }

  async patchSettings(patch: Partial<PaperSettings>): Promise<PaperView> {
    await this.store.update((data) => {
      data.settings = { ...data.settings, ...patch };
      return { data, result: undefined };
    });
    return this.book();
  }

  async reset(): Promise<PaperView> {
    await this.store.update((data) => {
      data.entries = [];
      return { data, result: undefined };
    });
    return this.book();
  }
}
