/**
 * Credit and dollar-cost math for The Odds API billing model.
 * Pure functions — no framework imports.
 */

/**
 * One call to /v4/sports/{sport}/odds costs (markets × regions) credits.
 * Calls to /v4/sports are free.
 */
export function creditsForOddsCall(marketCount: number, regionCount: number): number {
  return marketCount * regionCount;
}

/**
 * Dollars for a number of credits, derived from the monthly plan:
 * cost_per_credit = planMonthlyPrice / planMonthlyCredits.
 * Returns 0 on a free/zero-credit plan rather than dividing by zero.
 */
export function estimateDollarCost(
  credits: number,
  planMonthlyPrice: number,
  planMonthlyCredits: number,
): number {
  if (planMonthlyCredits <= 0) return 0;
  return credits * (planMonthlyPrice / planMonthlyCredits);
}
