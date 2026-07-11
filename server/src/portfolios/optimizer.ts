/**
 * Phase 14 — combo optimizer: deterministic mean-variance (Markowitz-style)
 * weighting across the three paper-portfolio strategy groups (arb / EV /
 * middles). Pure, no randomness: an exhaustive grid search over the weight
 * simplex at 1% steps, each weight bounded [0, boundsPct]%, summing to
 * 100% — the same input always produces the same output. Every surface
 * this reaches must label it MODEL: in-sample only, never a live promise.
 */

export interface OptimizerResult {
  /** Fractions (0–1) aligned with the input series order, summing to 1. */
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpe: number;
}

/**
 * `seriesReturns[i]` is series i's chronological per-signal return stream
 * (fraction of bankroll per period). Shorter series are padded with 0s up
 * to the longest series' length so every candidate weighting scores over
 * the same number of periods. `boundsPct` bounds each weight in [0, 100].
 */
export function optimizeWeights(seriesReturns: number[][], boundsPct = 70): OptimizerResult {
  if (seriesReturns.length === 0) {
    return { weights: [], expectedReturn: 0, volatility: 0, sharpe: 0 };
  }

  const bound = Math.max(0, Math.min(100, Math.round(boundsPct)));
  let best: OptimizerResult | null = null;

  forEachWeightVector(seriesReturns.length, bound, (weights) => {
    const evaluated = evaluateWeights(seriesReturns, weights);
    if (!best || evaluated.sharpe > best.sharpe) {
      best = { weights, ...evaluated };
    }
  });

  // seriesReturns.length ≥ 1 always yields at least one candidate UNLESS
  // 100% can't be reached within the bound for every series (e.g. a
  // single series with boundsPct < 100) — callers here only ever pass the
  // three strategy-group streams at a 70% bound, so this never trips in
  // practice; fall back to equal weight rather than throw.
  return best ?? equalWeightFallback(seriesReturns);
}

/** Mean, population std, and mean/std of the weighted per-period return;
 *  std = 0 falls back to the mean itself as the score (a flat, riskless
 *  stream still has to rank against the others). */
export function evaluateWeights(
  seriesReturns: number[][],
  weights: number[],
): { expectedReturn: number; volatility: number; sharpe: number } {
  const periods = Math.max(0, ...seriesReturns.map((s) => s.length));
  const combined: number[] = [];
  for (let t = 0; t < periods; t++) {
    let sum = 0;
    for (let i = 0; i < seriesReturns.length; i++) {
      sum += (weights[i] ?? 0) * (seriesReturns[i][t] ?? 0);
    }
    combined.push(sum);
  }
  const mean = combined.length ? combined.reduce((a, b) => a + b, 0) / combined.length : 0;
  const variance = combined.length
    ? combined.reduce((a, b) => a + (b - mean) ** 2, 0) / combined.length
    : 0;
  const volatility = Math.sqrt(variance);
  // Effectively-riskless check uses a tolerance, not strict equality: three
  // bit-identical inputs can still produce a variance of ~1e-34 rather than
  // exact 0 (mean = (x+x+x)/3 doesn't always round-trip to x), and dividing
  // by that near-zero volatility would explode the ratio into noise.
  const sharpe = volatility < 1e-9 ? mean : mean / volatility;
  return { expectedReturn: round(mean), volatility: round(volatility), sharpe: round(sharpe) };
}

/** Enumerates every integer-percent weight vector summing to 100, each
 *  bounded [0, boundsPct] — a fixed, deterministic order (the first index
 *  varies slowest) so score ties always resolve to the same candidate. */
function forEachWeightVector(n: number, boundsPct: number, visit: (weights: number[]) => void): void {
  const acc: number[] = [];
  function recurse(remaining: number, left: number) {
    if (left === 1) {
      if (remaining >= 0 && remaining <= boundsPct) visit([...acc, remaining / 100]);
      return;
    }
    for (let pct = 0; pct <= Math.min(boundsPct, remaining); pct++) {
      acc.push(pct / 100);
      recurse(remaining - pct, left - 1);
      acc.pop();
    }
  }
  recurse(100, n);
}

function equalWeightFallback(seriesReturns: number[][]): OptimizerResult {
  const weights = seriesReturns.map(() => 1 / seriesReturns.length);
  return { weights, ...evaluateWeights(seriesReturns, weights) };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
