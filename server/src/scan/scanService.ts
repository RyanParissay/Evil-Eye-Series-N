/**
 * Orchestrates one scan: sports catalogue (free) → odds per selected sport
 * → arbitrage engine → usage report. This is the only place the provider,
 * engine, and persistence meet.
 */
import type { ArbOpportunity, ScanMeta, ScanResponse, UsageReport } from '@shared/types';
import { bookmakerHomepage } from '../config/bookmakerLinks';
import {
  MARKETS,
  MIN_PROFIT_PCT,
  PLAN_MONTHLY_CREDITS,
  PLAN_MONTHLY_PRICE,
  SPORT_PRIORITY,
  SUSPICIOUS_PROFIT_PCT,
} from '../config/constants';
import { findArbitrageOpportunities } from '../engine/arbitrage';
import { filterEventsToBookmakers } from '../engine/bookmakerFilter';
import { estimateDollarCost } from '../engine/creditCost';
import { sportsForScan } from '../engine/sportSelection';
import type { OddsProvider, OddsResult } from '../providers/OddsProvider';
import type { ScanRequest } from './scanRequest';
import type { ScanStore } from './scanStore';

export interface ScanDeps {
  provider: OddsProvider;
  store: ScanStore;
  /** Markets to fetch AND evaluate. Defaults to the MARKETS constant. */
  markets?: readonly string[];
  now?: () => Date;
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

  // 3. Fetch odds for every target sport concurrently. One failing sport
  //    (e.g. temporarily unavailable market) shouldn't sink the whole scan.
  const settled = await Promise.allSettled(
    targets.map((sport) =>
      provider.fetchOdds(sport.key, { regions, markets }),
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

  // 4. Drop bookmakers a Canadian cannot register at BEFORE detection, so
  //    best-odds selection only ever sees accessible books.
  const events = filterEventsToBookmakers(
    results.flatMap((r) => r.events),
    tab.allowedBookmakers,
  );
  // The engine must evaluate exactly the markets we paid to fetch — without
  // this, adding a market to MARKETS would spend credits on odds the engine
  // then ignores.
  const opportunities = findArbitrageOpportunities(events, {
    minProfitPct: MIN_PROFIT_PCT,
    suspiciousProfitPct: SUSPICIOUS_PROFIT_PCT,
    topN,
    now: now(),
    marketKeys: [...markets],
  });
  fillLinkFallbacks(opportunities);

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

/** API links win; otherwise fall back to the bookmaker's homepage. */
function fillLinkFallbacks(opportunities: ArbOpportunity[]): void {
  for (const arb of opportunities) {
    for (const leg of arb.legs) {
      leg.link ??= bookmakerHomepage(leg.bookmakerKey);
    }
  }
}

function maxOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

function minOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}
