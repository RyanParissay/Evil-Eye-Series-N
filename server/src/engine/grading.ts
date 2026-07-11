/**
 * Auto-grading engine (Phase 13). GRADING_RULES.md is BINDING — every
 * rule here traces to a numbered section there. Pure: no I/O, no clock,
 * no provider. Uncovered situations return { pending: 'needs_rules' },
 * never a guess.
 */
import type { GradeResult, OpportunityRecord, RecordGrading } from '@shared/types';
import { GRADING_RULES, rulesForSport } from '../config/gradingRules';

export interface FinalScore {
  home: number;
  away: number;
  /** Game cancelled/postponed beyond re-schedule → whole record void (§2). */
  cancelled?: boolean;
}

export type GradeOutcome =
  | { ok: true; grading: RecordGrading }
  | { ok: false; pending: 'needs_rules'; reason: string };

/**
 * Grade one record against a final score. `voidLegs` marks legs voided by
 * the book (broken-arb input, §2). Arbs are deterministic (odds math)
 * unless a leg voided — then survivors grade at their REAL result.
 */
export function gradeRecord(
  record: Pick<
    OpportunityRecord,
    'strategy' | 'legs' | 'marketKey' | 'sportKey' | 'eventName' | 'homeTeam' | 'awayTeam' | 'profitPct'
  >,
  score: FinalScore,
  now: Date,
  voidLegs?: boolean[],
): GradeOutcome {
  const rules = rulesForSport(record.sportKey, record.marketKey);
  if (!rules) {
    return { ok: false, pending: 'needs_rules', reason: `No rules entry for ${record.sportKey}` };
  }
  const teams = resolveTeams(record);
  if (!teams) {
    return { ok: false, pending: 'needs_rules', reason: 'Cannot resolve home/away teams' };
  }

  const anyVoid = score.cancelled || (voidLegs?.some(Boolean) ?? false);

  // §2 void: whole game gone → every leg void, record void, P&L 0.
  if (score.cancelled) {
    return done(record, record.legs.map(() => 'void' as const), undefined, [], now);
  }

  // Arbs: deterministic from odds math (§5) — unless broken (§2).
  if (record.strategy === 'arb' && !anyVoid) {
    return done(record, record.legs.map(() => 'win' as const), score, [], now, record.profitPct);
  }

  const legResults: GradeResult[] = [];
  for (let i = 0; i < record.legs.length; i++) {
    if (voidLegs?.[i]) {
      legResults.push('void');
      continue;
    }
    const graded = gradeLeg(record.legs[i], record.marketKey, teams, score);
    if (graded == null) {
      return { ok: false, pending: 'needs_rules', reason: `Unrecognized outcome '${record.legs[i].outcome}'` };
    }
    legResults.push(graded);
  }

  const flags = record.strategy === 'arb' && anyVoid ? ['broken_arb'] : [];
  return done(record, legResults, score, flags, now);
}

/** One leg vs the score. null = we don't know how to grade it (§ intro). */
function gradeLeg(
  leg: { outcome: string; point?: number },
  marketKey: string,
  teams: { home: string; away: string },
  score: FinalScore,
): GradeResult | null {
  if (marketKey === 'totals' || leg.outcome === 'Over' || leg.outcome === 'Under') {
    if (leg.point == null) return null;
    const total = score.home + score.away;
    if (total === leg.point) return 'push'; // only whole lines can land exactly (§2)
    if (leg.outcome === 'Over') return total > leg.point ? 'win' : 'loss';
    if (leg.outcome === 'Under') return total < leg.point ? 'win' : 'loss';
    return null;
  }

  const isHome = leg.outcome === teams.home;
  const isAway = leg.outcome === teams.away;
  const isDraw = leg.outcome === 'Draw';
  if (!isHome && !isAway && !isDraw) return null;

  const margin = isHome ? score.home - score.away : score.away - score.home;

  if (marketKey === 'spreads') {
    if (leg.point == null || isDraw) return null;
    const adjusted = margin + leg.point;
    if (adjusted === 0) return 'push';
    return adjusted > 0 ? 'win' : 'loss';
  }

  // h2h (2-way or 3-way with Draw).
  if (isDraw) return score.home === score.away ? 'win' : 'loss';
  if (score.home === score.away) return 'push'; // 2-way tie, no draw leg → stake back
  return margin > 0 ? 'win' : 'loss';
}

/** §2 money: win → stake×(odds−1); loss → −stake; push/void → 0. */
function done(
  record: Pick<OpportunityRecord, 'legs'>,
  legResults: GradeResult[],
  score: FinalScore | undefined,
  flags: string[],
  now: Date,
  deterministicPnl?: number,
): GradeOutcome {
  const pnlPer100 =
    deterministicPnl ??
    Math.round(
      legResults.reduce((sum, result, i) => {
        const leg = record.legs[i];
        if (result === 'win') return sum + leg.stake * (leg.odds - 1);
        if (result === 'loss') return sum - leg.stake;
        return sum; // push/void: stake refunded (§2)
      }, 0) * 100,
    ) / 100;

  const result = recordResult(legResults, pnlPer100);
  return {
    ok: true,
    grading: {
      result,
      legResults,
      pnlPer100: Math.round(pnlPer100 * 100) / 100,
      flags,
      ...(score && !score.cancelled && { score: { home: score.home, away: score.away } }),
      gradedAt: now.toISOString(),
      source: 'auto',
      audit: [{ at: now.toISOString(), old: null, next: result }],
    },
  };
}

/** Exactly one of win/loss/push/void (§2). Multi-leg: money decides. */
function recordResult(legResults: GradeResult[], pnl: number): GradeResult {
  if (legResults.every((r) => r === 'void')) return 'void';
  if (legResults.every((r) => r === 'win')) return 'win';
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'push';
}

function resolveTeams(
  record: Pick<OpportunityRecord, 'homeTeam' | 'awayTeam' | 'eventName'>,
): { home: string; away: string } | null {
  if (record.homeTeam && record.awayTeam) return { home: record.homeTeam, away: record.awayTeam };
  // Legacy records: eventName is always constructed as "Away @ Home".
  const parts = record.eventName.split(' @ ');
  if (parts.length !== 2) return null;
  return { home: parts[1], away: parts[0] };
}

export { GRADING_RULES };
