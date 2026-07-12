/**
 * Analytics Hub — pure client-side display helpers (formatting/filtering
 * only). No money math lives here: every dollar figure is copied verbatim
 * from HubProfileReport (server-computed); this file only narrows a list
 * for a filter control or rebases a chart's baseline for display — the
 * same relative-to-start transform PortfoliosPage already applies to its
 * series before charting (see equityToCumulativeProfit there).
 */
import type {
  GradeResult,
  HubEquityPoint,
  HubPosition,
  HubStake,
  OpportunityStrategy,
} from '../../shared/types';

export type PositionResultFilter = 'all' | GradeResult | 'pending';
export type PositionStrategyFilter = 'all' | OpportunityStrategy;

/** Narrow the position list by strategy and/or result — 'pending' means no
 *  `result` yet (ungraded). Both filters default to 'all' independently. */
export function filterPositions(
  positions: HubPosition[],
  filters: { strategy: PositionStrategyFilter; result: PositionResultFilter },
): HubPosition[] {
  return positions.filter((p) => {
    if (filters.strategy !== 'all' && p.purchase.strategy !== filters.strategy) return false;
    if (filters.result === 'all') return true;
    if (filters.result === 'pending') return p.result === undefined;
    return p.result === filters.result;
  });
}

/** Lifetime equity curve as cumulative profit relative to the profile's
 *  starting bankroll, for EquityChart (which plots cumulative profit, not
 *  raw bankroll). */
export function equityToProfitCurve(
  equity: HubEquityPoint[],
  startingBankroll: number,
): Array<{ at: string; cumulativeProfit: number }> {
  return equity.map((p) => ({
    at: p.at,
    cumulativeProfit: Math.round((p.bankroll - startingBankroll) * 100) / 100,
  }));
}

/** Human label for a HubStake — "$50 flat" or "5% of start". */
export function describeStake(stake: HubStake): string {
  return stake.type === 'flat' ? `$${stake.value} flat` : `${stake.value}% of start`;
}

/** Human label for a position's grade result — 'Pending' when ungraded. */
export function resultLabel(result: GradeResult | undefined): string {
  if (result === undefined) return 'Pending';
  return { win: 'Win', loss: 'Loss', push: 'Push', void: 'Void' }[result];
}
