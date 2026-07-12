/**
 * Pure display logic for the ScanPage credit-spend widget (Phase 15 #7).
 * Fed entirely by existing accounting — /api/ops/scoreboard credits +
 * /api/grading/status scoresSpendToday/cap — no client-side money math
 * beyond these two thresholds. React-free and DOM-free, like cadence.ts.
 */

export type CreditSpendSeverity = 'ok' | 'amber' | 'red';

/**
 * Amber at projected month-end spend ≥80% of budget, red at ≥100%
 * (Ryan's spec — numeric danger state, not the arb red). No projection
 * yet (the provider hasn't reported usage) reads as 'ok': nothing to warn
 * about yet.
 */
export function creditSpendSeverity(
  projectedMonthEnd: number | null,
  budget: number,
): CreditSpendSeverity {
  if (projectedMonthEnd == null || budget <= 0) return 'ok';
  const pct = projectedMonthEnd / budget;
  if (pct >= 1) return 'red';
  if (pct >= 0.8) return 'amber';
  return 'ok';
}

/**
 * Today's scores-endpoint credit spend as a share of the daily scores cap
 * (/api/grading/status: scoresSpendToday, cap) — the one "scores share
 * today" number the widget shows. Null cap reads as null: nothing to
 * divide by.
 */
export function scoresSharePct(scoresSpendToday: number, cap: number): number | null {
  if (cap <= 0) return null;
  return Math.round((scoresSpendToday / cap) * 100);
}

/** The confirmation block of /api/ops/cost-estimate (Phase 16 Part A). */
export interface ConfirmationCostView {
  intervalSecs: number;
  /** Share of recent scans that left ≥1 candidate (and so bought a scan B). */
  hitRate: number;
  /** MEASURED from ≥50 logged scans in 14 days, else the ASSUMED 30%. */
  hitRateSource: 'measured' | 'assumed';
  samples: number;
  /** cost(A) + hitRate × cost(B) — the honest per-window number. */
  creditsPerPairWindow: number;
}

/** "≈13 credits/window · 30% hit rate (ASSUMED)" — server-computed numbers,
 *  display-only here (the client does no credit math of its own). */
export function describePairCost(c: ConfirmationCostView): string {
  const pct = Math.round(c.hitRate * 100);
  return `≈${c.creditsPerPairWindow} credits/window · ${pct}% hit rate (${c.hitRateSource.toUpperCase()})`;
}
