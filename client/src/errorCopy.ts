/**
 * Friendly titles/hints for ApiError codes, shared by the scan page and the
 * cockpit so both surfaces explain failures the same way.
 */
import type { ApiErrorCode } from '../../shared/types';

export function errorTitle(code: ApiErrorCode): string {
  switch (code) {
    case 'invalid_api_key':
      return 'The Odds API rejected the key.';
    case 'quota_exhausted':
      return 'Out of API credits.';
    case 'network':
      return 'Network failure.';
    case 'quiet_hours':
      return 'Quiet hours — the eye is resting.';
    default:
      return 'Scan failed.';
  }
}

export function errorHint(code: ApiErrorCode): string {
  switch (code) {
    case 'invalid_api_key':
      return 'Check ODDS_API_KEY in your .env file, then restart the server.';
    case 'quota_exhausted':
      return 'Your monthly credit allowance is spent — wait for reset or upgrade the plan.';
    case 'network':
      return 'Check your connection and that the server can reach the-odds-api.com, then retry.';
    case 'quiet_hours':
      return 'No Odds API calls run 01:00–08:00 America/Vancouver. Try again after 08:00.';
    default:
      return 'Retry the scan; if it persists, check the server logs.';
  }
}
