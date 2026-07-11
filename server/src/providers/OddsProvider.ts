/**
 * Provider adapter boundary. The scan service and engine only know this
 * interface — swap in a different odds source by implementing it. No
 * Express/React imports allowed here.
 */
import type { ApiErrorCode, OddsEvent, SportInfo } from '@shared/types';

/** Usage accounting attached to every provider response. */
export interface UsageInfo {
  /** Account total from the x-requests-used header; null if not reported. */
  requestsUsedTotal: number | null;
  /** Account total from the x-requests-remaining header; null if not reported. */
  requestsRemainingTotal: number | null;
  /** Credits this single call cost (markets × regions; 0 for the sports list). */
  creditsCharged: number;
}

export interface SportsResult {
  sports: SportInfo[];
  usage: UsageInfo;
}

export interface OddsResult {
  events: OddsEvent[];
  usage: UsageInfo;
}

export interface FetchOddsParams {
  regions: readonly string[];
  markets: readonly string[];
  /**
   * Fetch these specific books instead of whole regions (The Odds API bills
   * every 10 books as one region-equivalent). When set, `regions` is only
   * a fallback description — providers must prefer this list.
   */
  bookmakers?: readonly string[];
}

/** One event's final score (Phase 13, GRADING_RULES.md §4). */
export interface ScoreEntry {
  eventId: string;
  completed: boolean;
  home: number | null;
  away: number | null;
  homeTeam: string;
  awayTeam: string;
}

export interface FetchScoresParams {
  /** Odds API: reach further back than the default lookback (costs more). */
  daysFrom?: number;
  /** Only poll for these events — the credits-discipline knob (§4). */
  eventIds?: readonly string[];
}

export interface ScoresResult {
  scores: ScoreEntry[];
  usage: UsageInfo;
}

export interface OddsProvider {
  readonly mode: 'live' | 'mock';
  /** List the sports catalogue. Free on The Odds API. */
  listSports(): Promise<SportsResult>;
  /** Fetch decimal-format odds for one sport across regions/markets. */
  fetchOdds(sportKey: string, params: FetchOddsParams): Promise<OddsResult>;
  /** Fetch final scores for one sport (Phase 13 grading). */
  fetchScores(sportKey: string, params: FetchScoresParams): Promise<ScoresResult>;
}

/** Typed provider failure, mapped to an HTTP status + UI message upstream. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
