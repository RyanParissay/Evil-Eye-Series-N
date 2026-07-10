/**
 * Store-backed façade over the bookmaker config layer — the one object
 * scanService, the routes, and the alert notifier talk to.
 */
import type { ArbOpportunity, BookmakerConfig, OddsEvent } from '@shared/types';
import type { RegionTabConfig } from '@shared/regionTabs';
import type { BookmakerDataStore } from './bookmakerStore';
import {
  isBookAlertable,
  planFetch,
  upsertSeenBookmakers,
  type FetchPlan,
} from './effectiveBookmakers';
import type { BookmakerPatch } from './bookmakerRequests';

export class BookmakerService {
  constructor(
    private readonly store: BookmakerDataStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<BookmakerConfig[]> {
    const { bookmakers } = await this.store.read();
    return [...bookmakers].sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Applies a validated patch. Null when the key isn't in the registry. */
  async patch(key: string, patch: BookmakerPatch): Promise<BookmakerConfig | null> {
    return this.store.update((data) => {
      const config = data.bookmakers.find((c) => c.key === key);
      if (config) Object.assign(config, patch);
      return { data, result: config ?? null };
    });
  }

  /** Registers every book present in a scan's raw feed. */
  async recordSeen(events: OddsEvent[]): Promise<void> {
    const seen = new Map<string, string>();
    for (const event of events) {
      for (const book of event.bookmakers) seen.set(book.key, book.title);
    }
    if (seen.size === 0) return;
    await this.store.update((data) => {
      data.bookmakers = upsertSeenBookmakers(
        data.bookmakers,
        [...seen].map(([key, title]) => ({ key, title })),
        this.now(),
      );
      return { data, result: undefined };
    });
  }

  async fetchPlan(tab: RegionTabConfig): Promise<FetchPlan> {
    return planFetch((await this.store.read()).bookmakers, tab);
  }

  /** Drops opportunities with any leg at a disabled/limited/dead book. */
  async filterAlertable(opportunities: ArbOpportunity[]): Promise<ArbOpportunity[]> {
    const { bookmakers } = await this.store.read();
    return opportunities.filter((arb) =>
      arb.legs.every((leg) => isBookAlertable(bookmakers, leg.bookmakerKey)),
    );
  }
}
