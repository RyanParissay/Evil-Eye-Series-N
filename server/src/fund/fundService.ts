/**
 * The fund's position: settings + float + realized P&L + the paper fund
 * alongside (labeled simulated), with the two safety nudges. Pure
 * assembly — callers hand in the registry, ledger total, and paper view.
 */
import type { BookmakerConfig, FundPosition, FundSettings } from '@shared/types';
import { STALE_BALANCE_AFTER_MS } from '../config/constants';
import type { FundDataStore } from './fundStore';

export class FundService {
  constructor(
    private readonly store: FundDataStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async settings(): Promise<FundSettings> {
    return this.store.read();
  }

  async patchSettings(patch: Partial<FundSettings>): Promise<FundSettings> {
    return this.store.update((data) => {
      const next = { ...data, ...patch };
      return { data: next, result: next };
    });
  }

  async position(
    books: BookmakerConfig[],
    realProfit: number,
    paper: { bankrollIdeal: number; bankrollHaircut: number } | null,
  ): Promise<FundPosition> {
    const settings = await this.store.read();
    const staleCutoff = this.now().getTime() - STALE_BALANCE_AFTER_MS;

    const tracked = books.filter((b) => b.balance != null);
    return {
      settings,
      totalFloat: round2(tracked.reduce((sum, b) => sum + (b.balance ?? 0), 0)),
      realProfit: round2(realProfit),
      paper: paper
        ? { simulated: true, bankrollIdeal: paper.bankrollIdeal, bankrollHaircut: paper.bankrollHaircut }
        : null,
      warnings: {
        lowBalance: tracked
          .filter((b) => b.enabled && (b.balance ?? 0) < settings.defaultStake)
          .map((b) => b.key),
        staleBalance: tracked
          .filter((b) => b.balanceUpdatedAt != null && Date.parse(b.balanceUpdatedAt) < staleCutoff)
          .map((b) => b.key),
      },
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
