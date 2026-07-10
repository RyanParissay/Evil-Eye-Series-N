/**
 * Orchestrates one scan: sports catalogue (free) → odds per selected sport
 * → arbitrage engine → usage report. This is the only place the provider,
 * engine, and persistence meet.
 */
import type { ArbOpportunity, OddsEvent, ScanMeta, ScanResponse, UsageReport } from '@shared/types';
import type { RegionTabConfig } from '@shared/regionTabs';
import type { FetchPlan } from '../bookmakers/effectiveBookmakers';
import {
  MARKETS,
  PLAN_MONTHLY_CREDITS,
  PLAN_MONTHLY_PRICE,
  SPORT_PRIORITY,
} from '../config/constants';
import { estimateDollarCost } from '../engine/creditCost';
import { sportsForScan } from '../engine/sportSelection';
import type { OddsProvider, OddsResult } from '../providers/OddsProvider';
import { detectOpportunities } from './detection';
import type { ScanRequest } from './scanRequest';
import type { ScanStore } from './scanStore';

export interface ScanDeps {
  provider: OddsProvider;
  store: ScanStore;
  /** Markets to fetch AND evaluate. Defaults to the MARKETS constant. */
  markets?: readonly string[];
  now?: () => Date;
  /**
   * Alert dispatch (WhatsApp), invoked fire-and-forget with each scan's
   * opportunities. A notifier failure must never slow or fail the scan.
   */
  notifier?: (opportunities: ArbOpportunity[]) => void | Promise<void>;
  /** Bookmaker config layer (see bookmakers/). Optional: scans work without it. */
  books?: BookmakerIntegration;
  /** Opportunity persistence (see opportunities/). Optional. */
  opportunityLog?: OpportunityLogIntegration;
  /** Latest-raw-snapshot persistence (snapshotStore.ts). Optional. */
  snapshots?: SnapshotIntegration;
}

/** What runScan needs from BookmakerService — structural, for tests. */
export interface BookmakerIntegration {
  fetchPlan(tab: RegionTabConfig): Promise<FetchPlan>;
  recordSeen(events: OddsEvent[]): Promise<void>;
}

/** What runScan needs from OpportunityService — structural, for tests. */
export interface OpportunityLogIntegration {
  recordScan(
    opportunities: ArbOpportunity[],
    scope: { sportsScanned: string[]; regionTab: string },
  ): Promise<void>;
}

/** What runScan needs from SnapshotStore — structural, for tests. */
export interface SnapshotIntegration {
  save(snapshot: {
    fetchedAt: string;
    regionTab: string;
    markets: string[];
    sportsScanned: string[];
    events: OddsEvent[];
  }): Promise<void>;
}

export async function runScan(deps: ScanDeps, request: ScanRequest): Promise<ScanResponse> {
  const now = deps.now ?? (() => new Date());
  const { provider, store, markets = MARKETS } = deps;
  const { topN, tab } = request;

  // The request arrives validated (scanRequest.ts). The tab plays two roles:
  // pre-call credit efficiency — it decides which API regions we pay for —
  // and post-call correctness — its allowlist filters bookmakers before arb
  // detection (step 4).
  const regions = tab.apiRegions;

  // 1. Free catalogue call. Its headers give us the pre-scan usage baseline.
  const sportsResult = await provider.listSports();
  const baselineUsed = sportsResult.usage.requestsUsedTotal;

  // 2. The slider controls breadth: how many sports (= paid odds calls) we hit.
  const targets = sportsForScan(sportsResult.sports, topN, SPORT_PRIORITY);

  // 2½. The bookmaker config layer may shrink the fetch itself: when the
  //     enabled allowlist is strictly cheaper than the tab's regions
  //     (10 books = 1 region-equivalent), fetch by book list instead.
  const plan = deps.books ? await deps.books.fetchPlan(tab) : null;

  // 3. Fetch odds for every target sport concurrently. One failing sport
  //    (e.g. temporarily unavailable market) shouldn't sink the whole scan.
  const settled = await Promise.allSettled(
    targets.map((sport) =>
      provider.fetchOdds(sport.key, { regions, markets, bookmakers: plan?.bookmakersParam }),
    ),
  );

  const results: OddsResult[] = [];
  const sportsFailed: string[] = [];
  let firstFailure: unknown = null;
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      sportsFailed.push(targets[i].key);
      firstFailure ??= outcome.reason;
      // The scan proceeds without this sport; leave the why in the server log.
      console.warn(`Odds fetch failed for ${targets[i].key}:`, outcome.reason);
    }
  });

  // Every call failing means something systemic (bad key, quota, network) —
  // surface the real cause instead of an empty result.
  if (targets.length > 0 && results.length === 0 && firstFailure) {
    throw firstFailure;
  }

  // 3½. Register every book present in the raw feed, so the settings UI
  //     lists exactly what the feed carries. Not critical-path.
  const rawEvents = results.flatMap((r) => r.events);
  if (deps.books) {
    try {
      await deps.books.recordSeen(rawEvents);
    } catch (err) {
      console.warn('Bookmaker registry update failed:', err);
    }
  }

  // 4. Detection slice (see detection.ts): drop bookmakers a Canadian cannot
  //    register at — and any the user disabled — BEFORE the engine, and
  //    evaluate exactly the markets we paid to fetch.
  const opportunities = detectOpportunities(
    rawEvents,
    plan ? plan.allowedKeys : tab.allowedBookmakers,
    { topN, now: now(), marketKeys: [...markets] },
  );

  // 4⅓. Persist: the raw snapshot (offline recomputation) and the
  //      opportunity records (IDs, lifecycle). Neither failure is fatal,
  //      but recording MUST precede alert dispatch so markAlerted has
  //      records to flag.
  const scannedKeys = targets.map((s) => s.key);
  if (deps.snapshots) {
    try {
      await deps.snapshots.save({
        fetchedAt: now().toISOString(),
        regionTab: tab.key,
        markets: [...markets],
        sportsScanned: scannedKeys,
        events: rawEvents,
      });
    } catch (err) {
      console.warn('Snapshot persistence failed:', err);
    }
  }
  if (deps.opportunityLog) {
    try {
      await deps.opportunityLog.recordScan(opportunities, {
        sportsScanned: scannedKeys,
        regionTab: tab.key,
      });
    } catch (err) {
      console.warn('Opportunity persistence failed:', err);
    }
  }

  // 4½. Alert dispatch is deliberately not awaited: subscribers get their
  //     WhatsApp messages while the HTTP response returns immediately.
  if (deps.notifier) {
    try {
      void Promise.resolve(deps.notifier(opportunities)).catch((err) => {
        console.warn('Alert notifier failed:', err);
      });
    } catch (err) {
      console.warn('Alert notifier failed:', err);
    }
  }

  // 5. Usage report: credits computed from the markets × regions math,
  //    cross-checked against the header delta.
  const creditsComputed = results.reduce((sum, r) => sum + r.usage.creditsCharged, 0);
  const latestUsed = maxOrNull(results.map((r) => r.usage.requestsUsedTotal));
  const latestRemaining = minOrNull(results.map((r) => r.usage.requestsRemainingTotal));

  const usage: UsageReport = {
    creditsComputedThisScan: creditsComputed,
    creditsHeaderDeltaThisScan:
      latestUsed != null && baselineUsed != null ? latestUsed - baselineUsed : null,
    requestsUsedTotal: latestUsed ?? baselineUsed,
    requestsRemainingTotal: latestRemaining ?? sportsResult.usage.requestsRemainingTotal,
    estimatedDollarCost: estimateDollarCost(creditsComputed, PLAN_MONTHLY_PRICE, PLAN_MONTHLY_CREDITS),
    apiCallCount: 1 + targets.length, // sports call + one odds call per sport
  };

  const meta: ScanMeta = {
    scannedAt: now().toISOString(),
    sportsScanned: targets.map((s) => s.key),
    sportsFailed,
    regions: [...regions],
    regionTab: tab.key,
    topN,
    providerMode: provider.mode,
    usage,
  };

  // 6. Persist so the usage panel survives refresh/restart. A persistence
  //    failure shouldn't fail the scan itself.
  try {
    await store.write(meta);
  } catch (err) {
    console.warn('Failed to persist last-scan metadata:', err);
  }

  return { opportunities, meta };
}

function maxOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

function minOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}
