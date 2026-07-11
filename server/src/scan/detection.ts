/**
 * The scan's detection slice — allowlist filter → arb engine → link
 * fallbacks — as one reusable function. runScan threads live fetches through
 * it; the cockpit's re-verify and Phase-4 presets feed it snapshot or
 * single-event data instead. Pure: no provider, no I/O.
 */
import type { ArbOpportunity, OddsEvent } from '@shared/types';
import { bookmakerHomepage } from '../config/bookmakerLinks';
import { MIN_PROFIT_PCT, SUSPICIOUS_PROFIT_PCT } from '../config/constants';
import { findArbitrageOpportunities } from '../engine/arbitrage';
import { filterEventsToBookmakers } from '../engine/bookmakerFilter';
import { opportunityFingerprint, opportunityIdFromFingerprint } from '../opportunities/opportunityId';

export interface DetectionOptions {
  topN: number;
  now: Date;
  /** The engine must evaluate exactly the markets that were fetched. */
  marketKeys: string[];
  minProfitPct?: number;
  suspiciousProfitPct?: number;
}

export function detectOpportunities(
  rawEvents: OddsEvent[],
  allowedBookmakers: readonly string[],
  options: DetectionOptions,
): ArbOpportunity[] {
  const events = filterEventsToBookmakers(rawEvents, allowedBookmakers);
  const opportunities = findArbitrageOpportunities(events, {
    minProfitPct: options.minProfitPct ?? MIN_PROFIT_PCT,
    suspiciousProfitPct: options.suspiciousProfitPct ?? SUSPICIOUS_PROFIT_PCT,
    topN: options.topN,
    now: options.now,
    marketKeys: options.marketKeys,
  });
  fillLinkFallbacks(opportunities);
  // Phase 13: homeTeam/awayTeam ride along for score→outcome mapping at
  // grading time. Attached here (not inside the pure arb engine) so the
  // engine's pinned numeric output never changes shape.
  const teamsByEvent = new Map(events.map((e) => [e.id, { homeTeam: e.homeTeam, awayTeam: e.awayTeam }]));
  for (const arb of opportunities) {
    const teams = teamsByEvent.get(arb.eventId);
    if (teams) {
      arb.homeTeam = teams.homeTeam;
      arb.awayTeam = teams.awayTeam;
    }
    arb.id = opportunityIdFromFingerprint(opportunityFingerprint(arb));
  }
  return opportunities;
}

/** API links win; otherwise fall back to the bookmaker's homepage. */
function fillLinkFallbacks(opportunities: ArbOpportunity[]): void {
  for (const arb of opportunities) {
    for (const leg of arb.legs) {
      leg.link ??= bookmakerHomepage(leg.bookmakerKey);
    }
  }
}
