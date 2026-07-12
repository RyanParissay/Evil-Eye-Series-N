/**
 * Orchestrates one scan: sports catalogue (free) → odds per selected sport
 * → arbitrage engine → usage report. This is the only place the provider,
 * engine, and persistence meet.
 */
import type {
  ArbOpportunity,
  EvSettings,
  MiddlesSettings,
  OddsEvent,
  ScanLogEntry,
  ScanMeta,
  ScanResponse,
  UsageReport,
} from '@shared/types';
import { BENCHMARK_BOOKS, KEY_NUMBERS } from '../config/constants';
import { findEvBets, type EvBet } from '../engine/evDetection';
import { priceLegs } from '../engine/arbitrage';
import { findMiddles, type MiddleBet } from '../engine/middles';
import { opportunityFingerprint, opportunityIdFromFingerprint } from '../opportunities/opportunityId';
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
  /** Per-scan history line (ops/scanHistoryStore.ts). Optional, non-fatal. */
  scanLog?: ScanLogIntegration;
  /**
   * Book leaderboard accrual (ops/leaderboardStore.ts). Optional, non-fatal,
   * zero credits — fed only from data this scan already fetched.
   */
  leaderboard?: LeaderboardIntegration;
  /**
   * Risk Mode: EV detection rides the same raw feed — zero extra credits.
   * EV opportunities go to persistence and the notifier, NEVER into the
   * arb scan response.
   */
  ev?: { settings(): Promise<EvSettings> };
  /**
   * Extra-market toggles (ops settings). Each enabled market multiplies
   * every odds call's credits — the operator flips these deliberately.
   */
  marketSettings?: { read(): Promise<{ totals: boolean; spreads: boolean }> };
  /** Middles detection (Phase 12) — runs only on markets actually fetched. */
  middles?: { settings(): Promise<MiddlesSettings> };
}

/** What runScan needs from ScanHistoryStore — structural, for tests. */
export interface ScanLogIntegration {
  append(entry: ScanLogEntry): Promise<void>;
}

/** What runScan needs from LeaderboardStore — structural, for tests. */
export interface LeaderboardIntegration {
  accrue(input: { events: OddsEvent[]; opportunities: ArbOpportunity[] }): Promise<void>;
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
  const { provider, store } = deps;
  const { topN, tab } = request;

  // Effective markets: the base config plus the operator's toggles.
  // Every enabled market multiplies every odds call's credits.
  let markets: readonly string[] = deps.markets ?? MARKETS;
  if (deps.marketSettings) {
    const toggles = await deps.marketSettings.read();
    markets = [
      ...markets,
      ...(toggles.totals && !markets.includes('totals') ? ['totals'] : []),
      ...(toggles.spreads && !markets.includes('spreads') ? ['spreads'] : []),
    ];
  }

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

  // 4¼. Risk Mode: EV bets from the SAME raw feed against the sharp
  //      benchmark — expected value, not guaranteed; they join persistence
  //      and alerts below but never the arb response.
  let evOpportunities: ArbOpportunity[] = [];
  if (deps.ev) {
    try {
      const settings = await deps.ev.settings();
      const allowed = plan ? plan.allowedKeys : tab.allowedBookmakers;
      evOpportunities = findEvBets(rawEvents, allowed, BENCHMARK_BOOKS, {
        showMinEdgePct: settings.showMinEdgePct,
        maxOdds: settings.maxOdds,
        maxBenchmarkAgeMins: settings.maxBenchmarkAgeMins,
        now: now(),
      }).map(evBetToOpportunity);
    } catch (err) {
      console.warn('EV detection failed (arb scan unaffected):', err);
    }
  }
  // 4⅖. Middles from the same feed — only on markets actually fetched.
  let middleOpportunities: ArbOpportunity[] = [];
  if (deps.middles) {
    try {
      const settings = await deps.middles.settings();
      const allowed = plan ? plan.allowedKeys : tab.allowedBookmakers;
      middleOpportunities = findMiddles(rawEvents, allowed, {
        marketKeys: [...markets],
        maxCostPct: settings.maxCostPct,
        minWindow: settings.minWindow,
        keyNumbers: KEY_NUMBERS,
        now: now(),
      }).map(middleBetToOpportunity);
    } catch (err) {
      console.warn('Middles detection failed (arb scan unaffected):', err);
    }
  }

  const allDetected = [...opportunities, ...evOpportunities, ...middleOpportunities];

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
      await deps.opportunityLog.recordScan(allDetected, {
        sportsScanned: scannedKeys,
        regionTab: tab.key,
      });
    } catch (err) {
      console.warn('Opportunity persistence failed:', err);
    }
  }

  // 4½. Alert dispatch is deliberately not awaited: subscribers get their
  //     WhatsApp messages while the HTTP response returns immediately.
  //     The notifier receives BOTH strategies; the composition splits them.
  if (deps.notifier) {
    try {
      void Promise.resolve(deps.notifier(allDetected)).catch((err) => {
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

  // 6½. One history line per scan — coverage, survival, and budget
  //     projection all derive from this. Non-fatal like every store.
  if (deps.scanLog) {
    try {
      await deps.scanLog.append({
        scannedAt: meta.scannedAt,
        regionTab: tab.key,
        sportsScanned: scannedKeys,
        creditsComputed: creditsComputed,
        requestsUsedTotal: usage.requestsUsedTotal,
        distinctBooks: [...new Set(rawEvents.flatMap((e) => e.bookmakers.map((b) => b.key)))],
        eventCount: rawEvents.length,
      });
    } catch (err) {
      console.warn('Scan-history append failed:', err);
    }
  }

  // 6¾. Book leaderboard accrual (Phase 15 #1) — appearances from the raw
  //     feed, opportunity-leg counts by strategy from what was detected.
  //     Zero credits, fed only from data this scan already fetched.
  if (deps.leaderboard) {
    try {
      await deps.leaderboard.accrue({ events: rawEvents, opportunities: allDetected });
    } catch (err) {
      console.warn('Leaderboard accrual failed:', err);
    }
  }

  return { opportunities, meta };
}

/** An EV bet as a single-leg opportunity riding the shared record rails. */
function evBetToOpportunity(bet: EvBet): ArbOpportunity {
  const opportunity: ArbOpportunity = {
    ev: bet.ev,
    eventId: bet.eventId,
    sportKey: bet.sportKey,
    sportTitle: bet.sportTitle,
    eventName: bet.eventName,
    commenceTime: bet.commenceTime,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    marketKey: bet.marketKey,
    arbIndex: 1, // meaningless for EV; never displayed on EV surfaces
    profitPct: bet.ev.edgePct, // semantics: EXPECTED edge, not guaranteed
    legs: [
      {
        outcome: bet.outcome,
        point: bet.point,
        bookmakerKey: bet.bookmakerKey,
        bookmakerTitle: bet.bookmakerTitle,
        odds: bet.odds,
        stake: 100, // placeholder split; Risk Mode quotes flat/Kelly stakes
        link: bet.link,
      },
    ],
    sameBookmaker: false,
    suspicious: false,
  };
  opportunity.id = opportunityIdFromFingerprint(opportunityFingerprint(opportunity));
  return opportunity;
}

/**
 * A middle as a two-leg opportunity on the shared rails. Stakes are the
 * equal-risk 1/odds split (the same shared math); profitPct carries the
 * WORST-CASE floor (−cost%) — honest, never the hoped-for middle hit.
 */
function middleBetToOpportunity(bet: MiddleBet): ArbOpportunity {
  const { arbIndex, stakes } = priceLegs(bet.legs.map((l) => l.odds));
  const opportunity: ArbOpportunity = {
    middle: bet.middle,
    eventId: bet.eventId,
    sportKey: bet.sportKey,
    sportTitle: bet.sportTitle,
    eventName: bet.eventName,
    commenceTime: bet.commenceTime,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    marketKey: bet.marketKey,
    arbIndex,
    profitPct: -bet.middle.costPct, // the floor; positive only for free middles
    legs: bet.legs.map((leg, i) => ({
      outcome: leg.outcome,
      point: leg.point,
      bookmakerKey: leg.bookmakerKey,
      bookmakerTitle: leg.bookmakerTitle,
      odds: leg.odds,
      stake: stakes[i],
      link: leg.link,
    })),
    sameBookmaker: bet.sameBookmaker,
    suspicious: false,
  };
  opportunity.id = opportunityIdFromFingerprint(opportunityFingerprint(opportunity));
  return opportunity;
}

function maxOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

function minOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}
