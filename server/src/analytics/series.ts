// Analytics series (Plan 4, Design §3–7): pure folds from snapshots/trades to the
// two charts' day series and stats. No I/O, no Date.now, no mutation. The ALL
// chart's shadow outcomes come from a per-trade seeded rng (fnv1a32 → mulberry32)
// reusing simOutcome's exact payout math — identical on every poll, forever, and
// never written to the database ("a shadow position, not a live promise").
import type { AnalyticsTradeRow, BankrollSnapshot } from '../db/repos.js';
import type { Trade } from '../shared/types.js';
import { simOutcome } from '../pipeline/actions.js';
import { dayKey } from '../scheduler/vancouverTime.js';

export type RangeKey = '1D' | '5D' | '30D' | '1Y' | 'MAX';
export interface SeriesPoint { day: string; profitCents: number }
export interface ChartStats { profitCents: number; returnPct: number; annualizedPct: number }

const DAY_MS = 86_400_000;
const SETTLE_CUTOFF_MS = 3 * 3_600_000; // mirrors pipeline/actions.ts — shadows settle at the sim cutoff
const MAX_AXIS_DAYS = 4_000;            // hard stop ≈ 11 years of MAX

export const RANGE_DAYS: Record<RangeKey, number | null> = { '1D': 1, '5D': 5, '30D': 30, '1Y': 365, MAX: null };

/** Trailing Vancouver-day axis ending today, clipped to the profile's creation date.
 *  Epoch −24h steps never skip a Vancouver day (DST days are 23/25h); repeats dedupe. */
export function dayAxis(now: number, range: RangeKey, createdDate: string): string[] {
  const wanted = RANGE_DAYS[range];
  const days: string[] = [];
  for (let i = 0; i < MAX_AXIS_DAYS; i += 1) {
    if (wanted !== null && days.length >= wanted) break;
    const d = dayKey(now - i * DAY_MS);
    if (days[days.length - 1] === d) continue; // 25h fall-back day hit twice
    if (d < createdDate) break;                // clip at the fund start
    days.push(d);
  }
  if (days.length === 0) days.push(dayKey(now)); // created today under clipping, or future-dated
  return days.reverse();
}

/** FNV-1a 32-bit — the stable per-trade shadow seed. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — the suite's deterministic PRNG, reused for shadow outcomes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "If every pick was followed": each SENT pick that expired unconfirmed and whose
 * event is past the settle cutoff gets the outcome sim settlement WOULD have given
 * it, from its own seeded rng. Read-time only — nothing is stored.
 */
export function shadowResults(rows: AnalyticsTradeRow[], now: number): { day: string; resultCents: number }[] {
  const out: { day: string; resultCents: number }[] = [];
  for (const r of rows) {
    if (r.status !== 'EXPIRED' || r.verifiedAt === null) continue;
    const settleAt = r.eventStartsAt + SETTLE_CUTOFF_MS;
    if (settleAt >= now) continue; // event not over — nothing to imagine yet
    const t = { id: r.id, category: r.category, legs: r.legs, marginFinal: r.marginFinal } as Trade;
    const { resultCents } = simOutcome(t, mulberry32(fnv1a32(r.id)));
    out.push({ day: dayKey(settleAt), resultCents });
  }
  return out;
}

/** Chart 1: snapshots carry forward across gap days; profit is relative to the fund start. */
export function confirmedSeries(snapshots: BankrollSnapshot[], axis: string[], startCents: number): SeriesPoint[] {
  let i = 0;
  let carried = startCents;
  const points: SeriesPoint[] = [];
  for (const day of axis) {
    while (i < snapshots.length && snapshots[i]!.dayKey <= day) {
      carried = snapshots[i]!.bankrollCents;
      i += 1;
    }
    points.push({ day, profitCents: carried - startCents });
  }
  return points;
}

/** The confirmed value carried into the day BEFORE the window (fund start when none). */
export function baselineFor(snapshots: BankrollSnapshot[], axis: string[], startCents: number): number {
  const first = axis[0] ?? '';
  let carried = startCents;
  for (const s of snapshots) {
    if (s.dayKey < first) carried = s.bankrollCents;
    else break;
  }
  return carried - startCents;
}

/** Real settled results + shadow results, as (day, cents) events in day order. */
function allEvents(rows: AnalyticsTradeRow[], now: number): { day: string; cents: number }[] {
  const events: { day: string; cents: number }[] = [];
  for (const r of rows) {
    if (r.status === 'SETTLED' && r.settledAt !== null) {
      events.push({ day: dayKey(r.settledAt), cents: r.resultCents ?? 0 });
    }
  }
  for (const s of shadowResults(rows, now)) events.push({ day: s.day, cents: s.resultCents });
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Chart 2: cumulative all-follow profit along the axis (starts at 0 profit before any event). */
export function allSeries(rows: AnalyticsTradeRow[], axis: string[], now: number): SeriesPoint[] {
  const events = allEvents(rows, now);
  let i = 0;
  let cum = 0;
  const points: SeriesPoint[] = [];
  for (const day of axis) {
    while (i < events.length && events[i]!.day <= day) {
      cum += events[i]!.cents;
      i += 1;
    }
    points.push({ day, profitCents: cum });
  }
  return points;
}

/** The all-follow profit carried into the day before the window. */
export function allBaseline(rows: AnalyticsTradeRow[], axis: string[], now: number): number {
  const first = axis[0] ?? '';
  let cum = 0;
  for (const e of allEvents(rows, now)) {
    if (e.day < first) cum += e.cents;
    else break;
  }
  return cum;
}

/** PROFIT vs the baseline; RETURN vs the ONE total bankroll; ANNUALIZED ×365/axis-days. */
export function chartStats(points: SeriesPoint[], baselineCents: number, bankrollCents: number): ChartStats {
  if (points.length === 0) return { profitCents: 0, returnPct: 0, annualizedPct: 0 };
  const last = points[points.length - 1]!.profitCents;
  const profitCents = last - baselineCents;
  const returnPct = bankrollCents > 0 ? (profitCents / bankrollCents) * 100 : 0;
  const annualizedPct = returnPct * (365 / points.length);
  return { profitCents, returnPct, annualizedPct };
}
