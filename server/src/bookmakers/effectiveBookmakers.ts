/**
 * Pure logic for the bookmaker configuration layer: merging feed-seen books
 * into the registry, and deciding how a scan should fetch and filter given
 * the user's per-book config. No I/O — the service wires in the store.
 */
import type { BookmakerConfig } from '@shared/types';
import type { RegionTabConfig } from '@shared/regionTabs';
import { regionEquivalentsForBookmakers } from '../engine/creditCost';

export interface SeenBookmaker {
  key: string;
  title: string;
}

/**
 * Upsert every bookmaker seen in a scan's raw feed. New books default to
 * enabled + active (the user opts OUT, not in). Known books refresh their
 * title and lastSeenAt only — manual fields are never touched.
 */
export function upsertSeenBookmakers(
  configs: BookmakerConfig[],
  seen: SeenBookmaker[],
  now: Date,
): BookmakerConfig[] {
  const at = now.toISOString();
  const byKey = new Map(configs.map((c) => [c.key, c]));
  for (const { key, title } of seen) {
    const existing = byKey.get(key);
    if (existing) {
      existing.title = title;
      existing.lastSeenAt = at;
    } else {
      byKey.set(key, {
        key,
        title,
        enabled: true,
        balance: null,
        status: 'active',
        notes: '',
        firstSeenAt: at,
        lastSeenAt: at,
      });
    }
  }
  return [...byKey.values()];
}

export interface FetchPlan {
  /**
   * Books to request via the API's `bookmakers` param (undefined = fetch by
   * regions as before). Only set when strictly cheaper than the tab's
   * regions — every 10 books bill as one region-equivalent.
   */
  bookmakersParam: string[] | undefined;
  /** Detection input filter: the tab allowlist minus disabled books. */
  allowedKeys: string[];
}

/**
 * The tab allowlist stays the outer accessibility boundary; the user's
 * config refines it. Unknown books (not yet in the registry) count as
 * enabled so they can be discovered.
 *
 * Benchmark keys (Speculative phase 9) ride the fetch even when disabled
 * for betting — dual-role: the FEED always carries the sharp book, the
 * DETECTION filter never gains it beyond today's rules. The strictly-
 * cheaper comparison uses the union count, so a benchmark pushing the
 * list past a 10-book boundary falls back to regions (same cost as ever)
 * rather than silently paying more.
 *
 * Trade-off, on purpose: while bookmakersParam is active the feed only
 * contains those books, so the registry won't discover books outside the
 * allowlist. Fetching by regions (the not-cheaper case) still surfaces them.
 */
export function planFetch(
  configs: BookmakerConfig[],
  tab: RegionTabConfig,
  benchmarkKeys: readonly string[] = [],
): FetchPlan {
  const byKey = new Map(configs.map((c) => [c.key, c]));
  const allowedKeys = tab.allowedBookmakers.filter((key) => byKey.get(key)?.enabled !== false);
  const fetchKeys = [...allowedKeys, ...benchmarkKeys.filter((k) => !allowedKeys.includes(k))];
  const strictlyCheaper =
    allowedKeys.length > 0 &&
    regionEquivalentsForBookmakers(fetchKeys.length) < tab.apiRegions.length;
  return { bookmakersParam: strictlyCheaper ? fetchKeys : undefined, allowedKeys };
}

/**
 * May this book carry an alerted (or Phase-3 stake-suggested) leg?
 * Limited/dead books stay visible in results but never page the phone.
 * Unknown books default to alertable.
 */
export function isBookAlertable(configs: BookmakerConfig[], key: string): boolean {
  const config = configs.find((c) => c.key === key);
  return !config || (config.enabled && config.status === 'active');
}
