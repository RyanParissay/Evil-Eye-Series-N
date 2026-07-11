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

/** Survival-derived haircut, when the ops layer can measure one. */
export type HaircutOracle = () => Promise<{
  qualified: boolean;
  measuredPct: number | null;
  detail: string;
}>;

export class PaperService {
  constructor(
    private readonly store: PaperDataStore,
    private readonly now: () => Date = () => new Date(),
    private readonly haircutOracle?: HaircutOracle,
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
    // 'measured' uses the survival-derived number once qualified; anything
    // else — including an unqualified measurement — is honestly ASSUMED.
    let haircut: PaperView['haircut'] = {
      source: 'assumed',
      pct: data.settings.haircutPercent,
      detail: 'manual assumption',
    };
    if (data.settings.haircutSource === 'measured' && this.haircutOracle) {
      const measured = await this.haircutOracle();
      if (measured.qualified && measured.measuredPct != null) {
        haircut = { source: 'measured', pct: measured.measuredPct, detail: measured.detail };
      } else {
        haircut = { ...haircut, detail: measured.detail };
      }
    }
    return {
      simulated: true,
      settings: data.settings,
      haircut,
      book: settlePaperBook(
        data.entries,
        { ...data.settings, haircutPercent: haircut.pct },
        this.now(),
      ),
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
