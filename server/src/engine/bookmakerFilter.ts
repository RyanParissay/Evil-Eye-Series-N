/**
 * Post-API-call filtering: strip bookmakers the user cannot actually access
 * BEFORE arbitrage detection, so best-odds selection never considers an
 * inaccessible book. Pure module — no framework imports.
 */
import type { OddsEvent } from '@shared/types';

/**
 * Returns new events containing only allowlisted bookmakers; events left
 * with no bookmakers are dropped entirely. Inputs are not mutated.
 */
export function filterEventsToBookmakers(
  events: OddsEvent[],
  allowedKeys: readonly string[],
): OddsEvent[] {
  const allowed = new Set(allowedKeys);
  return events
    .map((event) => ({
      ...event,
      bookmakers: event.bookmakers.filter((b) => allowed.has(b.key)),
    }))
    .filter((event) => event.bookmakers.length > 0);
}
