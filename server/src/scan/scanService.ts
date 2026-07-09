/**
 * Orchestrates one scan: sports catalogue (free) → odds per selected sport
 * → arbitrage engine → usage report. This is the only place the provider,
 * engine, and persistence meet.
 */
import type { ArbOpportunity, ScanMeta, ScanResponse, UsageReport } from '../../../shared/types';
import { bookmakerHomepage } from '../config/bookmakerLinks';
import {
  MARKETS,
  MIN_PROFIT_PCT,
  PLAN_MONTHLY_CREDITS,
  PLAN_MONTHLY_PRICE,
  REGIONS,
  SPORT_PRIORITY,
  SUSPICIOUS_PROFIT_PCT,
} from '../config/constants';
import { findArbitrageOpportunities } from '../engine/arbitrage';
import { estimateDollarCost } from '../engine/creditCost';
import { sportsForScan } from '../engine/sportSelection';
import type { OddsProvider, OddsResult } from '../providers/OddsProvider';
import type { ScanStore } from './scanStore';

export interface ScanDeps {
  provider: OddsProvider;
  store: ScanStore;
  now?: () => Date;
}

export async function runScan(deps: ScanDeps, topN: number): Promise<ScanResponse> {
  const now = deps.now ?? (() => new Date());
  const { provider, store } = deps;

  // 1. Free catalogue call. Its headers give us the pre-scan usage baseline.
  const sportsResult = await provider.listSports();
  const baselineUsed = sportsResult.usage.requestsUsedTotal;

  // 2. The slider controls breadth: how many sports (= paid odds calls) we hit.
  const targets = sportsForScan(sportsResult.sports, topN, SPORT_PRIORITY);

  // 3. Fetch odds for every target sport concurrently. One failing sport
  //    (e.g. temporarily unavailable market) shouldn't sink the whole scan.
  const settled = await Promise.allSettled(
    targets.map((sport) =>
      provider.fetchOdds(sport.key, { regions: REGIONS, markets: MARKETS }),
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
    }
  });

  // Every call failing means something systemic (bad key, quota, network) —
  // surface the real cause instead of an empty result.
  if (targets.length > 0 && results.length === 0 && firstFailure) {
    throw firstFailure;
  }

  // 4. Arbitrage detection over everything we fetched.
  const events = results.flatMap((r) => r.events);
  const opportunities = findArbitrageOpportunities(events, {
    minProfitPct: MIN_PROFIT_PCT,
    suspiciousProfitPct: SUSPICIOUS_PROFIT_PCT,
    topN,
    now: now(),
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
    regions: [...REGIONS],
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
