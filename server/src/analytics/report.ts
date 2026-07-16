// Analytics read model (Plan 4): ONE deterministic serialization of everything the
// ANALYTICS screen renders. Read-only — building the view never mutates state; the
// shadow chart recomputes identically on every poll. Client mirror:
// client/src/lib/analytics.ts. Every number names its source table.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Profile } from '../db/db.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName } from '../brain/pass.js';
import { closingEdge } from '../brain/closes.js';
import {
  allBaseline, allSeries, baselineFor, chartStats, confirmedSeries, dayAxis,
  type ChartStats, type RangeKey, type SeriesPoint,
} from './series.js';
import {
  funnelCounts, gateCost, leaderboards, monthlyRows, openBets, opportunities,
  retention, roundingCost,
  type BoardRow, type FunnelCounts, type GateCostRow, type MonthlyRow, type OpenBetView, type OppRow,
} from './rollups.js';

export const RANGE_KEYS: readonly RangeKey[] = ['1D', '5D', '30D', '1Y', 'MAX'];

export interface ProfileView { id: number; name: string; startingCashCents: number; createdDate: string }
export interface ChartView { points: SeriesPoint[]; stats: ChartStats }

export interface AnalyticsView {
  simulated: boolean;
  today: string;
  profile: ProfileView;
  range: RangeKey;
  bankrollCents: number;
  confirmed: ChartView;
  all: ChartView;
  monthly: MonthlyRow[];
  funnel: FunnelCounts;
  advanced: {
    openBets: OpenBetView[];
    leaderboards: { since: string; boards: { title: string; rows: BoardRow[] }[] };
    costOfSafety: {
      rounding: { costCents: number; pairs: number } | null;
      retention: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null;
      gateCost: GateCostRow[];
      closingEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
    };
    limits: { when: number; book: string; sport: string; event: string; maxCents: number }[];
    opportunities: { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] };
  };
}

export function profileView(p: Profile): ProfileView {
  return { id: p.id, name: p.name, startingCashCents: p.startingCashCents, createdDate: p.createdDate };
}

export function buildAnalyticsView(deps: PipeDeps, profile: Profile, range: RangeKey, now: number): AnalyticsView {
  const { repos } = deps;
  const s = deps.s();
  const rows = repos.trades.analyticsRows(profile.id);
  const snaps = repos.snapshots.byProfile(profile.id);
  const axis = dayAxis(now, range, profile.createdDate);

  const confirmedPts = confirmedSeries(snaps, axis, profile.startingCashCents);
  const allPts = allSeries(rows, axis, now);

  const ret = retention(rows);
  const limits = repos.limitsReports.all().map((l) => {
    const t = repos.trades.byId(l.tradeId);
    return {
      when: l.sentAt,
      book: displayName(l.book),
      sport: t?.sport ?? '',
      event: t?.event ?? '',
      maxCents: l.maxAllowedCents,
    };
  }).reverse(); // newest first — TRADE LIMITED? reports prepend live (inventory §2.2)

  return {
    simulated: s.liveMode !== 1, // honest in both modes (Plan 6)
    today: dayKey(now),
    profile: profileView(profile),
    range,
    bankrollCents: s.bankrollCents,
    confirmed: {
      points: confirmedPts,
      stats: chartStats(confirmedPts, baselineFor(snaps, axis, profile.startingCashCents), s.bankrollCents),
    },
    all: {
      points: allPts,
      stats: chartStats(allPts, allBaseline(rows, axis, now), s.bankrollCents),
    },
    monthly: monthlyRows(rows),
    funnel: funnelCounts(rows),
    advanced: {
      openBets: openBets(rows, now, displayName),
      leaderboards: { since: profile.createdDate, boards: leaderboards(rows, displayName) },
      costOfSafety: {
        rounding: roundingCost(rows),
        retention: ret === null ? null : { ...ret, thresholdPct: Math.round(100 - s.tolerancePct) },
        gateCost: gateCost(rows, s, displayName),
        closingEdge: closingEdge(repos, now),
      },
      limits,
      opportunities: opportunities(rows, displayName),
    },
  };
}
