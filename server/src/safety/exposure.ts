/**
 * Exposure derivation (Phase 17) — assembles the ExposureView the safety
 * engine's per-book budget/cooldown component reads, PURELY FROM EXISTING
 * RECORDS. No new mutable state, so it is deterministic and replayable: score
 * the same record against the same history twice → identical view.
 *
 * "Acted on" = the record was alerted (record.alerted) OR has at least one
 * Hub purchase (recordId ∈ hubPurchasedIds, from the hub store). Budgets
 * count acted-on records of ANY strategy — exposure is exposure (design
 * note). The record being scored is excluded: at the confirmation transition
 * it has not been acted on yet, and it must never count against itself.
 *
 * Timestamps: a record's acted-on instant is its alertedAt when alerted,
 * else its lastSeenAt — which, for a confirmed record, is scan B's sighting
 * ≈ the Hub purchase time. Both are always present and derive from the record
 * alone (no hub-purchase timestamp needed), keeping the view replayable.
 *
 * Day windows are Vancouver-local (reuse scheduler/vancouverTime.ts); week +
 * hot-streak windows are trailing 7 days. Cooldown-until = the most recent
 * winning-side acted-on time + cooldownDays, set only once the winning-side
 * count reaches hotStreakCount (for a fresh streak of exactly that many, the
 * most recent win IS the nth win — the design's "nth-win time").
 */
import type { OpportunityRecord, SafetySettings } from '@shared/types';
import { sameVancouverDay } from '../scheduler/vancouverTime';
import type { BookExposure, ExposureView } from '../engine/safety';

const DAY_MS = 24 * 3_600_000;

export interface ExposureInputs {
  /** The record being scored — its leg books get exposure entries. */
  target: Pick<OpportunityRecord, 'id' | 'legs'>;
  /** Full record history (active + archived) the counts derive from. */
  history: OpportunityRecord[];
  /** Record ids with ≥1 Hub purchase, from the hub store. */
  hubPurchasedIds: ReadonlySet<string>;
  settings: SafetySettings;
  now: Date;
}

/** True when the record was acted on (alerted or Hub-purchased). */
export function isActedOn(
  record: Pick<OpportunityRecord, 'id' | 'alerted'>,
  hubPurchasedIds: ReadonlySet<string>,
): boolean {
  return record.alerted === true || hubPurchasedIds.has(record.id);
}

/** The acted-on instant (epoch ms): alertedAt if alerted, else lastSeenAt. */
function actedAtMsOf(record: OpportunityRecord): number {
  return Date.parse(record.alertedAt ?? record.lastSeenAt);
}

/** True when this book's own leg of the record graded a win. */
function wonOnBook(record: OpportunityRecord, bookmakerKey: string): boolean {
  const legResults = record.grading?.legResults;
  if (!legResults) return false;
  return record.legs.some((l, i) => l.bookmakerKey === bookmakerKey && legResults[i] === 'win');
}

export function assembleExposureView(inputs: ExposureInputs): ExposureView {
  const { target, history, hubPurchasedIds, settings, now } = inputs;
  const nowMs = now.getTime();
  const weekStartMs = nowMs - 7 * DAY_MS;
  const { hotStreakCount, cooldownDays } = settings.budgets;

  const actedOn = history.filter(
    (r) => r.id !== target.id && isActedOn(r, hubPurchasedIds),
  );

  const books: Record<string, BookExposure> = {};
  for (const bookmakerKey of new Set(target.legs.map((l) => l.bookmakerKey))) {
    let dayCount = 0;
    let weekCount = 0;
    const winTimes: number[] = [];
    for (const r of actedOn) {
      if (!r.legs.some((l) => l.bookmakerKey === bookmakerKey)) continue;
      const at = actedAtMsOf(r);
      if (!Number.isFinite(at)) continue;
      if (sameVancouverDay(new Date(at), now)) dayCount += 1;
      const inWeek = at >= weekStartMs && at <= nowMs;
      if (inWeek) weekCount += 1;
      if (inWeek && wonOnBook(r, bookmakerKey)) winTimes.push(at);
    }
    const winningStreak = winTimes.length;
    const cooldownUntilMs =
      winningStreak >= hotStreakCount ? Math.max(...winTimes) + cooldownDays * DAY_MS : null;
    books[bookmakerKey] = { dayCount, weekCount, winningStreak, cooldownUntilMs };
  }
  return { books };
}
