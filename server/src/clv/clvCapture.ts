/**
 * Closing-line capture (Phase 18) — the zero-credit, structural pass that
 * piggybacks on every scan (same fire-and-forget discipline as leaderboards /
 * backups). Given the fresh raw snapshot's events and the persisted records,
 * it builds a RecordClosing for every record whose event is in the snapshot
 * AND has not yet commenced, to OVERWRITE record.closing. A record whose
 * commence has passed is omitted entirely — the last pre-commence write is
 * frozen as its closing line.
 *
 * ZERO CREDITS IS STRUCTURAL: nothing in this file (or engine/clv.ts) imports
 * a provider. It reads the snapshot that a scan already fetched and de-vigs the
 * benchmark through the pure fairProbability engine — never a fresh API call.
 *
 * Per leg it records:
 *   - legOdds[i]           — the leg's OWN book's price for the exact outcome +
 *     line, or null if that book no longer prices it in this feed.
 *   - benchmarkLegOdds[i]  — the benchmark (Pinnacle) price for the same
 *     outcome + line, null where unquoted (present only if a benchmark book is
 *     in the event at all).
 *   - benchmarkFairProb[i] — the de-vigged fair probability of the leg's
 *     outcome, from the benchmark's line group (h2h: the whole market; a point
 *     market: the same-|point| mirror), null where the group can't be formed.
 */
import type {
  ArbLeg,
  Bookmaker,
  MarketOutcome,
  OddsEvent,
  OpportunityRecord,
  RecordClosing,
} from '@shared/types';
import { BENCHMARK_BOOKS } from '../config/constants';
import { fairForLineGroup } from '../engine/fairProbability';

export interface ClosingUpdate {
  id: string;
  closing: RecordClosing;
}

/**
 * Build the closing overwrites for this scan. Records whose event is absent
 * from the snapshot keep their prior closing untouched; records that have
 * commenced are frozen (omitted). Pure — deterministic in (events, records, now).
 */
export function captureClosings(
  events: OddsEvent[],
  records: OpportunityRecord[],
  now: Date,
): ClosingUpdate[] {
  const nowMs = now.getTime();
  const eventById = new Map(events.map((e) => [e.id, e]));
  const updates: ClosingUpdate[] = [];
  for (const record of records) {
    if (!(Date.parse(record.commenceTime) > nowMs)) continue; // frozen once commence passes
    const event = eventById.get(record.eventId);
    if (!event) continue; // not in this snapshot — leave the prior closing be
    updates.push({ id: record.id, closing: buildClosing(event, record, now) });
  }
  return updates;
}

function buildClosing(event: OddsEvent, record: OpportunityRecord, now: Date): RecordClosing {
  const legOdds = record.legs.map((leg) => priceAt(bookByKey(event, leg.bookmakerKey), record.marketKey, leg));
  const benchmark = benchmarkBook(event);
  const minutesToCommence = Math.round((Date.parse(record.commenceTime) - now.getTime()) / 60_000);
  const closing: RecordClosing = {
    legOdds,
    capturedAt: now.toISOString(),
    minutesToCommence,
  };
  if (benchmark) {
    closing.benchmarkLegOdds = record.legs.map((leg) => priceAt(benchmark, record.marketKey, leg));
    closing.benchmarkFairProb = record.legs.map((leg) => benchmarkFairProb(benchmark, record.marketKey, leg));
  }
  return closing;
}

function bookByKey(event: OddsEvent, key: string): Bookmaker | null {
  return event.bookmakers.find((b) => b.key === key) ?? null;
}

/** The first benchmark book (BENCHMARK_BOOKS, currently pinnacle) in the event. */
function benchmarkBook(event: OddsEvent): Bookmaker | null {
  for (const key of BENCHMARK_BOOKS) {
    const found = event.bookmakers.find((b) => b.key === key);
    if (found) return found;
  }
  return null;
}

function marketOutcomes(book: Bookmaker | null, marketKey: string): MarketOutcome[] | null {
  const market = book?.markets.find((m) => m.key === marketKey);
  return market ? market.outcomes : null;
}

/** A book's decimal price for the exact outcome + line, or null. */
function priceAt(book: Bookmaker | null, marketKey: string, leg: ArbLeg): number | null {
  const outcomes = marketOutcomes(book, marketKey);
  if (!outcomes) return null;
  const match = outcomes.find(
    (o) => o.name === leg.outcome && (o.point ?? null) === (leg.point ?? null),
  );
  return match ? match.price : null;
}

/**
 * The de-vigged fair probability of the leg's outcome from the benchmark's
 * line group. h2h → the whole market (2- or 3-way); a point market → the
 * same-|point| mirror (Over/Under at the line, spread ±p). Null where the
 * benchmark doesn't quote the leg's exact side or can't form a ≥2-side group.
 */
function benchmarkFairProb(benchmark: Bookmaker, marketKey: string, leg: ArbLeg): number | null {
  const outcomes = marketOutcomes(benchmark, marketKey);
  if (!outcomes) return null;
  const groupSides =
    leg.point == null
      ? outcomes.filter((o) => o.point == null).map((o) => ({ name: o.name, point: o.point }))
      : outcomes
          .filter((o) => o.point != null && Math.abs(o.point) === Math.abs(leg.point as number))
          .map((o) => ({ name: o.name, point: o.point }));
  const idx = groupSides.findIndex(
    (s) => s.name === leg.outcome && (s.point ?? null) === (leg.point ?? null),
  );
  if (idx < 0) return null; // benchmark doesn't quote the leg's own side
  const result = fairForLineGroup(outcomes, groupSides);
  return result.ok ? result.fair.probabilities[idx] : null;
}
