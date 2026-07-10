/**
 * Stake planning under real balance constraints — THE single
 * implementation, imported by the server (alert messages) and the client
 * (cockpit display) so cap math can never drift between them. Pure and
 * dependency-free like everything in shared/.
 */

export interface StakePlan {
  /** Per-leg stakes in dollars, rounded to cents; aligned with the input legs. */
  stakes: number[];
  totalStaked: number;
  /** Worst-leg payout minus everything staked (the engine's lockedProfit rule). */
  guaranteedProfit: number;
  /** True when a book's recorded balance forced the position below target. */
  capped: boolean;
  /** The binding book's key when capped. */
  cappedBy: string | null;
}

/**
 * Split `targetTotal` across the legs by ideal arb shares (1/odds ÷ S).
 * A leg's stake may never exceed its book's recorded balance; when one
 * would, the WHOLE position rescales down to the binding book so the
 * proportions — and therefore the guarantee — survive. Unknown (null /
 * absent) balances never constrain.
 */
export function planStakes(
  legs: Array<{ odds: number; bookmakerKey: string }>,
  targetTotal: number,
  balances: Map<string, number | null>,
): StakePlan {
  const arbIndex = legs.reduce((sum, leg) => sum + 1 / leg.odds, 0);
  const shares = legs.map((leg) => 1 / leg.odds / arbIndex);

  let total = Number.isFinite(targetTotal) && targetTotal > 0 ? targetTotal : 0;
  let cappedBy: string | null = null;
  legs.forEach((leg, i) => {
    const balance = balances.get(leg.bookmakerKey);
    if (balance == null) return;
    const maxTotal = balance / shares[i];
    if (maxTotal < total) {
      total = maxTotal;
      cappedBy = leg.bookmakerKey;
    }
  });

  const stakes = shares.map((share) => round2(share * total));
  const totalStaked = round2(stakes.reduce((sum, s) => sum + s, 0));
  const worstPayout = Math.min(...stakes.map((stake, i) => stake * legs[i].odds));
  return {
    stakes,
    totalStaked,
    guaranteedProfit: round2(worstPayout - totalStaked),
    capped: cappedBy != null,
    cappedBy,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
