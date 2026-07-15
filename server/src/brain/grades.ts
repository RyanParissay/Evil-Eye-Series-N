// Strategy grades (Plan 3, Design §7): actual wins vs the engine's own expected
// win probabilities over SETTLED trades. grade = round(100 × min(1, (wins+1)/(expWins+2)))
// — +1/+2 smoothing pins zero data at a neutral 50 and makes small samples
// conservative by construction. Under 30 settled a grade is PROVISIONAL (honesty
// rule): shown, but labeled. Deterministic — no rng, no LLM.
import type { Strategy, Trade } from '../shared/types.js';
import { middleMetrics } from '../engine/odds.js';

export interface Grade {
  strategy: Strategy;
  grade: number;
  settled: number;
  wins: number;
  expectedWins: number;
  provisional: boolean;
  note: string;
}

export const PROVISIONAL_MIN_SETTLED = 30;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** What the engine believed this trade's win probability was, from stored data only. */
export function expectedWinProb(t: Trade): number {
  switch (t.category) {
    case 'ARB':
      return 1; // an arb must pay — promotion re-gates the rounded margin
    case 'EV': {
      const odds = t.legs[0]?.odds ?? 2;
      const edge = t.marginFinal ?? t.marginRecheck ?? t.marginInitial;
      return clamp((1 + edge) / odds, 0.01, 1); // ev_edge = p·o − 1 ⇒ p = (1+edge)/o
    }
    case 'MIDDLE': {
      const [a, b] = t.legs;
      if (!a || !b) return 0.05;
      const m = middleMetrics(a.odds, b.odds);
      const breakeven = m.bothWinPayoutFrac > 0 ? Math.max(m.costFrac, 0) / m.bothWinPayoutFrac : 0;
      // The qualification bar (Plan 1 Task 4): P(hit) ≥ middleRatio × breakeven.
      return clamp(1.5 * breakeven, 0.05, 1);
    }
  }
}

export function gradeStrategy(strategy: Strategy, settledTrades: Trade[]): Grade {
  const settled = settledTrades.length;
  const wins = settledTrades.filter((t) => (t.resultCents ?? 0) > 0).length;
  const expectedWins = settledTrades.reduce((sum, t) => sum + expectedWinProb(t), 0);
  const grade = Math.round(100 * Math.min(1, (wins + 1) / (expectedWins + 2)));
  const provisional = settled < PROVISIONAL_MIN_SETTLED;
  const core = `${wins} ${provisional ? 'won' : `of ${settled} won`} vs ${expectedWins.toFixed(1)} expected`;
  const note = provisional
    ? `provisional — ${settled} of ${PROVISIONAL_MIN_SETTLED} settled · ${core}`
    : core;
  return { strategy, grade, settled, wins, expectedWins, provisional, note };
}

/** The STRATEGY PERFORMANCE panel's fixed row order. */
export function gradeAll(settledTrades: Trade[]): Grade[] {
  const order: Strategy[] = ['ARB', 'EV', 'MIDDLE'];
  return order.map((s) => gradeStrategy(s, settledTrades.filter((t) => t.category === s)));
}
