/**
 * The shadow fund. Entry selection is the SAME alertWorthy core the
 * WhatsApp path uses (threshold, non-suspicious, non-same-book, dedup) —
 * an entry happens iff a push would have been worthy. Settlement math
 * lives in paperMath (pure); this façade only moves facts in and out of
 * the store. It never touches credits, balances, or opportunity records.
 */
import type { ArbOpportunity, PaperSettings, PaperView } from '@shared/types';
import { alertWorthy } from '../notifications/alertService';
import { opportunityFingerprint, opportunityIdFromFingerprint } from '../opportunities/opportunityId';
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
    /** Graded real records by fingerprint → profit per $1 (middle FLOOR→actual). */
    private readonly actualsLookup?: () => Promise<Map<string, number>>,
  ) {}

  /**
   * Fire-and-forget from the scan notifier; returns how many entered.
   * Arbs enter via alertWorthy at the paper threshold. Middles enter at
   * alert parity too: non-same-book, breakeven ≤ the alert cap, deduped —
   * stored at their worst-case FLOOR profitPct.
   */
  async considerEntries(
    opportunities: ArbOpportunity[],
    middleMaxBreakevenPct?: number,
  ): Promise<number> {
    const at = this.now().toISOString();
    return this.store.update((data) => {
      if (!data.settings.enabled) return { data, result: 0 };
      const seen = new Set(data.entries.map((e) => e.fingerprint));

      const arbs = opportunities.filter((o) => !o.middle && !o.ev);
      const picks = alertWorthy(arbs, data.settings.thresholdPercent, (fp) => seen.has(fp)).map(
        ({ opportunity, fingerprint }) => ({ opportunity, fingerprint }),
      );
      if (middleMaxBreakevenPct != null) {
        for (const opportunity of opportunities) {
          const middle = opportunity.middle;
          if (!middle || opportunity.sameBookmaker || opportunity.suspicious) continue;
          if (!middle.freeMiddle && middle.breakevenPct > middleMaxBreakevenPct) continue;
          const fingerprint = opportunityFingerprint(opportunity);
          if (seen.has(fingerprint)) continue;
          picks.push({ opportunity, fingerprint });
        }
      }

      for (const { opportunity, fingerprint } of picks) {
        seen.add(fingerprint);
        data.entries.push({
          id: opportunityIdFromFingerprint(fingerprint),
          fingerprint,
          strategy: opportunity.middle ? 'middle' : 'arb',
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

  async book(actuals?: Map<string, number>): Promise<PaperView> {
    const data = await this.store.read();
    actuals ??= await this.actualsLookup?.();
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
        actuals,
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
