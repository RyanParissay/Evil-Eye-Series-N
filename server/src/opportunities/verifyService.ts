/**
 * Cockpit re-verify: one cheap live fetch answering "are MY legs still
 * priced?" — the record's sport only, fetched by the legs' bookmaker keys
 * (≤10 books = 1 region-equivalent, so ~1 credit for a 1-market record).
 * Deliberately NOT a snapshot recompute (see CLAUDE.md) and deliberately
 * not part of last-scan usage meters — the response reports its own cost.
 */
import type { OddsEvent, OpportunityRecord } from '@shared/types';
import type { OddsProvider } from '../providers/OddsProvider';
import type { OpportunityService } from './opportunityService';

export interface VerifyDeps {
  provider: OddsProvider;
  opportunities: OpportunityService;
  now?: () => Date;
}

export type VerifyOutcome =
  | {
      ok: true;
      record: OpportunityRecord;
      /** Fresh odds aligned with record.legs; null = leg no longer offered. */
      legOdds: Array<number | null>;
      creditsCharged: number;
    }
  | { ok: false; reason: 'not_found' | 'conflict'; message: string };

export async function verifyOpportunity(deps: VerifyDeps, id: string): Promise<VerifyOutcome> {
  const now = (deps.now ?? (() => new Date()))();

  const record = await deps.opportunities.get(id);
  if (!record) {
    return { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
  }
  if (record.status === 'completed') {
    return { ok: false, reason: 'conflict', message: 'Cannot verify a completed opportunity' };
  }

  // A commenced event is dead by definition — don't spend a call proving it.
  let legOdds: Array<number | null>;
  let creditsCharged = 0;
  if (Date.parse(record.commenceTime) <= now.getTime()) {
    legOdds = record.legs.map(() => null);
  } else {
    const books = [...new Set(record.legs.map((leg) => leg.bookmakerKey))];
    const { events, usage } = await deps.provider.fetchOdds(record.sportKey, {
      regions: [],
      markets: [record.marketKey],
      bookmakers: books,
    });
    legOdds = repriceLegs(record, events);
    creditsCharged = usage.creditsCharged;
  }

  const outcome = await deps.opportunities.applyVerification(id, legOdds);
  if (!outcome.ok) return outcome;
  return { ok: true, record: outcome.record, legOdds, creditsCharged };
}

/**
 * Current odds for the record's exact legs (event + market + book +
 * outcome + |line|), null where no longer offered. Pure.
 */
export function repriceLegs(
  record: OpportunityRecord,
  events: OddsEvent[],
): Array<number | null> {
  const event = events.find((e) => e.id === record.eventId);
  return record.legs.map((leg) => {
    const market = event?.bookmakers
      .find((b) => b.key === leg.bookmakerKey)
      ?.markets.find((m) => m.key === record.marketKey);
    const outcome = market?.outcomes.find(
      (o) => o.name === leg.outcome && (o.point ?? null) === (leg.point ?? null),
    );
    return outcome?.price ?? null;
  });
}
