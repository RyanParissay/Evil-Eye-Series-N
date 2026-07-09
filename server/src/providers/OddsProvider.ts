/**
 * Provider adapter boundary. The scan service and engine only know this
 * interface — swap in a different odds source by implementing it. No
 * Express/React imports allowed here.
 */
import type { ApiErrorCode, OddsEvent, SportInfo } from '../../../shared/types';

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
}

export interface OddsProvider {
  readonly mode: 'live' | 'mock';
  /** List the sports catalogue. Free on The Odds API. */
  listSports(): Promise<SportsResult>;
  /** Fetch decimal-format odds for one sport across regions/markets. */
  fetchOdds(sportKey: string, params: FetchOddsParams): Promise<OddsResult>;
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
