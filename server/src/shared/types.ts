// shared/types.ts — the single source of truth
export type Strategy = 'ARB' | 'MIDDLE' | 'EV';
export type TradeStatus = 'PENDING' | 'VERIFIED' | 'CONFIRMED' | 'UNCONFIRMED' | 'EXPIRED' | 'KILLED' | 'SETTLED';
export type KillReason = 'ONE_SPORT_RULE' | 'HEAT_GATE' | 'SHARP_VELOCITY_CAP' | 'MARKET_BREADTH_CAP' | 'ROUNDING_DESTROYS_MARGIN' | 'QUOTE_STALE' | 'FAILED_VERIFICATION';
export interface Leg { book: string; selection: string; odds: number; stakeCents: number | null; }
export interface Trade {
  id: string; profileId: number; category: Strategy; event: string; sport: string;
  legs: Leg[]; marginInitial: number; marginRecheck: number | null; marginFinal: number | null;
  status: TradeStatus; killReason: KillReason | null; resultCents: number | null;
  createdAt: number; verifyDueAt: number; verifiedAt: number | null; freshUntil: number | null;
  settledAt: number | null; eventStartsAt: number;
}
export interface Quote { book: string; sport: string; event: string; market: string;
  selection: string; odds: number; line: number | null; fetchedAt: number; eventStartsAt: number; }
export interface OddsProvider {
  fetchQuotes(now: number): Quote[];
  /** Live providers refresh their snapshot here (awaited by the runner and the
   *  scan route); sim never defines it. Must never throw — a failed refresh
   *  keeps the last cache and logs, so the chain survives (Plan 6 Design §4). */
  refresh?(now: number): Promise<void>;
}
export interface AlertSender { sendVerified(trade: Trade): void; } // sim: events_log row
