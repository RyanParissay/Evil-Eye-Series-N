/**
 * Cockpit persistence helpers. Stake math itself lives in
 * shared/stakePlanning.ts — the SAME implementation the server uses for
 * alert dollars, so cap logic can never drift. Same injectable Storage
 * pattern as autoScan.ts.
 */

const DEFAULT_BANKROLL = 100;
const BANKROLL_KEY = 'evil-eye:bankroll';

export function loadBankroll(storage: Storage): number {
  const parsed = Number(storage.getItem(BANKROLL_KEY));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BANKROLL;
}

export function saveBankroll(storage: Storage, bankroll: number): void {
  storage.setItem(BANKROLL_KEY, String(bankroll));
}
