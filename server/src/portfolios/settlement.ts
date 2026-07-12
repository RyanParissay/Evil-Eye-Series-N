/**
 * The settlement/P&L primitives shared by every SIMULATED engine series —
 * the Phase 14 scenario engine AND the Phase 16 Analytics Hub both call
 * these, so the derivation lives once (the phase acceptance greps for
 * duplicated P&L/drawdown math). Pure: no I/O, no clock.
 */
import type { RecordGrading } from '@shared/types';

/**
 * Signal P&L for a given total stake, from a graded record: the SAME
 * derivation the scenario engine uses — stake × pnlPer100 / 100, to cents.
 * pnlPer100 is GRADING_RULES.md §2 money-per-$100 (win/loss/push/void all
 * already folded in), so this is outcome-agnostic here.
 */
export function pnlForStake(stake: number, grading: RecordGrading): number {
  return round2((stake * grading.pnlPer100) / 100);
}

/**
 * Peak-to-trough on a running-bankroll sequence, in dollars (≥ 0) — Phase
 * 14's drawdown, extracted so the Hub reuses it rather than restating it.
 * The first element is the starting bankroll; each subsequent element is the
 * bankroll after one settled bet.
 */
export function maxDrawdownOf(bankrolls: number[]): number {
  if (bankrolls.length === 0) return 0;
  let peak = bankrolls[0];
  let maxDrawdown = 0;
  for (const bankroll of bankrolls) {
    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, round2(peak - bankroll));
  }
  return maxDrawdown;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
