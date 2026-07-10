/**
 * Cockpit display math. The server's engine owns all arb math; the stakes
 * it ships are per a nominal $100, so scaling them to a bankroll is pure
 * proportion — this module never re-derives odds splits. Same injectable
 * Storage pattern as autoScan.ts.
 */

export interface ScaledStakes {
  /** Per-leg stakes at the chosen bankroll, rounded to cents. */
  stakes: number[];
  totalStaked: number;
  /** Worst-case payout minus everything staked — negative when the arb is gone. */
  guaranteedProfit: number;
}

const DEFAULT_BANKROLL = 100;

export function scaleLegStakes(
  legs: Array<{ odds: number; stake: number }>,
  bankroll: number,
): ScaledStakes {
  const total = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : DEFAULT_BANKROLL;
  const stakes = legs.map((leg) => Math.round(leg.stake * total) / 100);
  const totalStaked = stakes.reduce((sum, s) => sum + s, 0);
  const worstPayout = Math.min(...legs.map((leg, i) => stakes[i] * leg.odds));
  return { stakes, totalStaked, guaranteedProfit: worstPayout - totalStaked };
}

const BANKROLL_KEY = 'evil-eye:bankroll';

export function loadBankroll(storage: Storage): number {
  const parsed = Number(storage.getItem(BANKROLL_KEY));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BANKROLL;
}

export function saveBankroll(storage: Storage, bankroll: number): void {
  storage.setItem(BANKROLL_KEY, String(bankroll));
}
