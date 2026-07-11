/**
 * Apply a completed execution to the recorded book balances — bookkeeping
 * assistance only; the app never touches bookmaker accounts. Every apply
 * stores what it did on the record, so revert is an exact inverse rather
 * than a guess.
 */
import type { OpportunityRecord } from '@shared/types';
import type { BookmakerService } from '../bookmakers/bookmakerService';
import type { OpportunityService } from './opportunityService';

export interface ReconcileDeps {
  opportunities: OpportunityService;
  books: Pick<BookmakerService, 'adjustBalances'>;
}

export type ReconcileOutcome =
  | { ok: true; record: OpportunityRecord }
  | { ok: false; reason: 'not_found' | 'conflict' | 'bad_request'; message: string };

export async function applyToBalances(
  deps: ReconcileDeps,
  id: string,
  winningLegIndex: number,
): Promise<ReconcileOutcome> {
  const record = await deps.opportunities.get(id);
  if (!record) return { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
  const execution = record.execution;
  if (record.status !== 'completed' || !execution) {
    return {
      ok: false,
      reason: 'conflict',
      message: 'Only completions with filled numbers can reconcile balances',
    };
  }
  if (execution.balancesAppliedAt) {
    return { ok: false, reason: 'conflict', message: 'Already applied — revert first' };
  }
  if (record.strategy === 'ev') {
    // EV money comes from the grade, not a winning leg.
    if (execution.grade == null) {
      return { ok: false, reason: 'conflict', message: 'Grade the bet before reconciling balances' };
    }
    winningLegIndex = 0;
  } else if (record.strategy === 'middle') {
    // Middle money comes from the per-leg grades.
    if (execution.legGrades == null) {
      return { ok: false, reason: 'conflict', message: 'Grade both legs before reconciling balances' };
    }
    winningLegIndex = 0;
  } else if (!Number.isInteger(winningLegIndex) || !execution.filledLegs[winningLegIndex]) {
    return { ok: false, reason: 'bad_request', message: 'winningLegIndex must address a leg' };
  }

  await deps.books.adjustBalances(deltas(record, winningLegIndex, +1));
  const marked = await deps.opportunities.markBalancesApplied(id, winningLegIndex);
  if (!marked.ok) return marked;
  return { ok: true, record: marked.record };
}

export async function revertBalances(deps: ReconcileDeps, id: string): Promise<ReconcileOutcome> {
  const record = await deps.opportunities.get(id);
  if (!record) return { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
  const execution = record.execution;
  if (!execution?.balancesAppliedAt || execution.winningLegIndex == null) {
    return { ok: false, reason: 'conflict', message: 'Nothing applied to revert' };
  }

  await deps.books.adjustBalances(deltas(record, execution.winningLegIndex, -1));
  const marked = await deps.opportunities.markBalancesApplied(id, null);
  if (!marked.ok) return marked;
  return { ok: true, record: marked.record };
}

/**
 * Arb: −stake per leg book, +payout on the winner. EV: −stake, then the
 * grade decides — won pays stake×odds, void returns the stake, lost adds
 * nothing. sign −1 inverts exactly (revert).
 */
function deltas(
  record: OpportunityRecord,
  winningLegIndex: number,
  sign: 1 | -1,
): Array<{ key: string; delta: number }> {
  const execution = record.execution!;
  const out = record.legs.map((leg, i) => ({
    key: leg.bookmakerKey,
    delta: sign * -execution.filledLegs[i].stake,
  }));
  if (record.strategy === 'ev') {
    const [leg] = execution.filledLegs;
    const bookKey = record.legs[0].bookmakerKey;
    if (execution.grade === 'won') out.push({ key: bookKey, delta: sign * leg.stake * leg.odds });
    if (execution.grade === 'void') out.push({ key: bookKey, delta: sign * leg.stake });
    return out;
  }
  if (record.strategy === 'middle') {
    execution.legGrades!.forEach((grade, i) => {
      const leg = execution.filledLegs[i];
      const bookKey = record.legs[i].bookmakerKey;
      if (grade === 'won') out.push({ key: bookKey, delta: sign * leg.stake * leg.odds });
      if (grade === 'void') out.push({ key: bookKey, delta: sign * leg.stake });
    });
    return out;
  }
  const winner = execution.filledLegs[winningLegIndex];
  out.push({
    key: record.legs[winningLegIndex].bookmakerKey,
    delta: sign * winner.stake * winner.odds,
  });
  return out;
}
