// Pure odds math. All values are fractions (0.012 = 1.2%), never percents.

/** Multiplicative de-vig: normalize implied probabilities (1/odds) to sum to 1. */
export function devigFairProbs(odds: number[]): number[] {
  const implied = odds.map((o) => 1 / o);
  const sum = implied.reduce((a, b) => a + b, 0);
  return implied.map((p) => p / sum);
}

/** Arbitrage margin = 1 - Σ(1/odds). Positive means guaranteed profit. */
export function arbMargin(odds: number[]): number {
  return 1 - odds.reduce((a, o) => a + 1 / o, 0);
}

/** Expected-value edge = fairProb * odds - 1. */
export function evEdge(fairProb: number, odds: number): number {
  return fairProb * odds - 1;
}

export interface MiddleMetrics {
  /** S = 1/oddsA + 1/oddsB */
  sumInv: number;
  /** Cost of the middle as a fraction of total stake = sumInv - 1 (≤ 0 for free middles). */
  costFrac: number;
  /** Payout if both legs win, as a fraction of total stake = 2/sumInv - 1. */
  bothWinPayoutFrac: number;
  /** bothWinPayoutFrac / costFrac; Infinity for free middles. */
  ratio: number;
  /** Free middle: sumInv <= 1 (no cost when the middle misses). */
  free: boolean;
}

/**
 * Middle metrics for a two-leg middle. Locked interpretation: a costed middle
 * qualifies when ratio >= settings.middleRatio; free middles always qualify.
 * (ratio >= 1.5 is equivalent to breakeven hit rate costFrac/bothWinPayoutFrac <= 1/1.5.)
 */
export function middleMetrics(oddsA: number, oddsB: number): MiddleMetrics {
  const sumInv = 1 / oddsA + 1 / oddsB;
  const costFrac = sumInv - 1;
  const bothWinPayoutFrac = 2 / sumInv - 1;
  const free = sumInv <= 1;
  const ratio = free ? Infinity : bothWinPayoutFrac / costFrac;
  return { sumInv, costFrac, bothWinPayoutFrac, ratio, free };
}
