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
 * When fetching with the `bookmakers` param instead of regions, every group
 * of 10 bookmakers bills as one region-equivalent (per The Odds API v4
 * docs): 1–10 books = 1, 11–20 = 2, …
 */
export function regionEquivalentsForBookmakers(bookmakerCount: number): number {
  return Math.max(1, Math.ceil(bookmakerCount / 10));
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
