/**
 * Rotation telemetry (Phase 17) — pure, ADVISORY only. It never rejects and
 * never touches a score. Over the trailing 30 days of acted-on records
 * (alerted OR Hub-purchased), it counts, per soft book, which outcome-side
 * that book's legs held, and flags a book that has sat on the same side ≥80%
 * of the time across ≥5 samples ("BookX has taken the same side 9 of last 10
 * arbs — consider rotating"). neverLimit (sharp/exchange) books are exempt:
 * you never rotate off Pinnacle.
 *
 * "Side" is normalized so it aggregates across events: totals legs keep their
 * Over/Under name; h2h/spread legs map to home/away via the record's teams;
 * anything else falls back to the raw outcome string.
 */
import type { ArbLeg, OpportunityRecord } from '@shared/types';

export const ROTATION_WINDOW_DAYS = 30;
export const ROTATION_MIN_SAMPLES = 5;
export const ROTATION_IMBALANCE_THRESHOLD = 0.8;

const DAY_MS = 24 * 3_600_000;

export interface RotationBookStat {
  bookmakerKey: string;
  samples: number;
  /** Per-side counts, sorted by count desc then side asc. */
  sides: Array<{ side: string; count: number }>;
  topSide: string;
  /** topCount / samples, 0–1 (rounded to 3 decimals). */
  topShare: number;
  imbalanced: boolean;
  /** Advisory hint string when imbalanced, else null. */
  hint: string | null;
}

export interface RotationReport {
  windowDays: number;
  minSamples: number;
  imbalanceThreshold: number;
  books: RotationBookStat[];
}

export interface RotationInputs {
  history: OpportunityRecord[];
  hubPurchasedIds: ReadonlySet<string>;
  neverLimitBooks: string[];
  now: Date;
}

export function computeRotation(inputs: RotationInputs): RotationReport {
  const { history, hubPurchasedIds, neverLimitBooks, now } = inputs;
  const never = new Set(neverLimitBooks);
  const windowStartMs = now.getTime() - ROTATION_WINDOW_DAYS * DAY_MS;

  const acted = history.filter((r) => {
    if (!(r.alerted === true || hubPurchasedIds.has(r.id))) return false;
    const at = Date.parse(r.alertedAt ?? r.lastSeenAt);
    return Number.isFinite(at) && at >= windowStartMs && at <= now.getTime();
  });

  const byBook = new Map<string, Map<string, number>>();
  for (const record of acted) {
    for (const leg of record.legs) {
      if (never.has(leg.bookmakerKey)) continue;
      const side = sideOf(record, leg);
      const sides = byBook.get(leg.bookmakerKey) ?? new Map<string, number>();
      sides.set(side, (sides.get(side) ?? 0) + 1);
      byBook.set(leg.bookmakerKey, sides);
    }
  }

  const books: RotationBookStat[] = [];
  for (const [bookmakerKey, sides] of byBook) {
    const sideList = [...sides.entries()]
      .map(([side, count]) => ({ side, count }))
      .sort((a, b) => b.count - a.count || a.side.localeCompare(b.side));
    const samples = sideList.reduce((sum, s) => sum + s.count, 0);
    const top = sideList[0];
    const topShare = samples > 0 ? Math.round((top.count / samples) * 1000) / 1000 : 0;
    const imbalanced = samples >= ROTATION_MIN_SAMPLES && topShare >= ROTATION_IMBALANCE_THRESHOLD;
    books.push({
      bookmakerKey,
      samples,
      sides: sideList,
      topSide: top.side,
      topShare,
      imbalanced,
      hint: imbalanced
        ? `${bookmakerKey} has taken the ${top.side} side ${top.count} of last ${samples} arbs — consider rotating`
        : null,
    });
  }
  books.sort((a, b) => b.samples - a.samples || a.bookmakerKey.localeCompare(b.bookmakerKey));

  return {
    windowDays: ROTATION_WINDOW_DAYS,
    minSamples: ROTATION_MIN_SAMPLES,
    imbalanceThreshold: ROTATION_IMBALANCE_THRESHOLD,
    books,
  };
}

function sideOf(record: OpportunityRecord, leg: ArbLeg): string {
  if (leg.outcome === 'Over' || leg.outcome === 'Under') return leg.outcome;
  if (record.homeTeam && leg.outcome === record.homeTeam) return 'home';
  if (record.awayTeam && leg.outcome === record.awayTeam) return 'away';
  return leg.outcome;
}
