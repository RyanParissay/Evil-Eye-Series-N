// Pure staking math. Money is integer cents; every stake returned here is
// already rounded per roundStake.

import type { Settings } from '../shared/defaults.js';

/** Round to the nearest `roundToCents`; results below `minStakeCents` are bumped up to it. */
export function roundStake(cents: number, s: Settings): number {
  const rounded = Math.round(cents / s.roundToCents) * s.roundToCents;
  return rounded < s.minStakeCents ? s.minStakeCents : rounded;
}

/** Per-leg cap in cents: kellyCapPct% of the TOTAL bankroll. */
function capCents(s: Settings): number {
  return (s.kellyCapPct / 100) * s.bankrollCents;
}

/**
 * Fractional Kelly vs TOTAL bankroll: f* = (p·o − 1)/(o − 1); if f* ≤ 0 there
 * is no stake (returns 0 — the minStakeCents floor applies to stakes, not to
 * "no stake"). Otherwise × kellyFraction, capped at kellyCapPct% of bankroll,
 * then rounded.
 */
export function kellyStakeCents(fairProb: number, odds: number, s: Settings): number {
  const fStar = (fairProb * odds - 1) / (odds - 1);
  if (fStar <= 0) return 0;
  const raw = fStar * s.kellyFraction * s.bankrollCents;
  return roundStake(Math.min(raw, capCents(s)), s);
}

/**
 * Equal-payout arb split. Leg i gets total × (1/oᵢ)/Σ(1/o), where total is
 * flatPairCents (2-leg) or flatPairCents × 1.5 (3-leg). Each leg is capped at
 * kellyCapPct% of bankroll before rounding. roundedMargin is recomputed from
 * the ROUNDED stakes as (minPayout − totalStaked) / totalStaked.
 */
export function arbStakesCents(odds: number[], s: Settings): { stakes: number[]; roundedMargin: number } {
  const total = odds.length === 3 ? s.flatPairCents * 1.5 : s.flatPairCents;
  const inv = odds.map((o) => 1 / o);
  const sumInv = inv.reduce((a, b) => a + b, 0);
  const cap = capCents(s);
  const stakes = inv.map((w) => roundStake(Math.min(total * (w / sumInv), cap), s));
  const totalStaked = stakes.reduce((a, b) => a + b, 0);
  const minPayout = Math.min(...stakes.map((st, i) => st * odds[i]!));
  return { stakes, roundedMargin: (minPayout - totalStaked) / totalStaked };
}
