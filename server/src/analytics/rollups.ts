// Analytics rollups (Plan 4, Design §8–11): monthly table, TIME TO ACT funnel and
// every ADVANCED ANALYTICS aggregation. Pure folds over AnalyticsTradeRow — no I/O.
// Every derived number names its source columns; demo mockup values are filler,
// never expectations.
import type { AnalyticsTradeRow } from '../db/repos.js';
import type { KillReason, Strategy } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import { arbMargin } from '../engine/odds.js';
import { dayKey } from '../scheduler/vancouverTime.js';

const MIN_MS = 60_000;

export interface MonthlyRow {
  month: string; cand: number; verif: number; sent: number; conf: number;
  unconf: number; exp: number; killed: number; followThruPct: number | null; plCents: number;
}

const sent = (r: AnalyticsTradeRow): boolean => r.verifiedAt !== null;
/** Passed the recheck but never promoted (daily cap / zero stake) — Plan 3's held-back signature. */
const heldBack = (r: AnalyticsTradeRow): boolean =>
  r.status === 'EXPIRED' && r.verifiedAt === null && r.marginRecheck !== null;
const confirmedMoney = (r: AnalyticsTradeRow): boolean =>
  r.status === 'SETTLED' && r.confirmedAt !== null && r.settledAt !== null;

/** Newest month first; a month exists if any trade was created OR settled in it. */
export function monthlyRows(rows: AnalyticsTradeRow[]): MonthlyRow[] {
  const months = new Set<string>();
  for (const r of rows) {
    months.add(r.dayKey.slice(0, 7));
    if (confirmedMoney(r)) months.add(dayKey(r.settledAt!).slice(0, 7));
  }
  return [...months].sort().reverse().map((month) => {
    const inMonth = rows.filter((r) => r.dayKey.slice(0, 7) === month);
    const sentN = inMonth.filter(sent).length;
    const confN = inMonth.filter((r) => r.confirmedAt !== null).length;
    const plCents = rows
      .filter((r) => confirmedMoney(r) && dayKey(r.settledAt!).slice(0, 7) === month)
      .reduce((sum, r) => sum + (r.resultCents ?? 0), 0);
    return {
      month,
      cand: inMonth.length,
      verif: sentN + inMonth.filter(heldBack).length,
      sent: sentN,
      conf: confN,
      unconf: inMonth.filter((r) => r.status === 'UNCONFIRMED').length, // honest zero until Plan 6
      exp: inMonth.filter((r) => r.status === 'EXPIRED').length,
      killed: inMonth.filter((r) => r.status === 'KILLED').length,
      followThruPct: sentN > 0 ? Math.round((100 * confN) / sentN) : null,
      plCents,
    };
  });
}

export interface FunnelCounts {
  under2: number; from2to5: number; from5to10: number; over10: number; dead: number; total: number;
}

/** Population = sent picks with a KNOWN confirmation outcome; live VERIFIED cards wait. */
export function funnelCounts(rows: AnalyticsTradeRow[]): FunnelCounts {
  const f = { under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 };
  for (const r of rows) {
    if (!sent(r)) continue;
    if (r.confirmedAt !== null) {
      const dt = r.confirmedAt - r.verifiedAt!;
      if (dt < 2 * MIN_MS) f.under2 += 1;
      else if (dt < 5 * MIN_MS) f.from2to5 += 1;
      else if (dt < 10 * MIN_MS) f.from5to10 += 1;
      else f.over10 += 1;
      f.total += 1;
    } else if (r.status === 'EXPIRED' || r.status === 'UNCONFIRMED') {
      f.dead += 1;
      f.total += 1;
    }
  }
  return f;
}

export interface OpenBetView {
  category: Strategy; event: string; legsText: string; stakeCents: number; startsAt: number; live: boolean;
}

/** Money actually at stake: CONFIRMED, not yet settled. */
export function openBets(rows: AnalyticsTradeRow[], now: number, label: (book: string) => string): OpenBetView[] {
  return rows
    .filter((r) => r.status === 'CONFIRMED')
    .map((r) => ({
      category: r.category,
      event: r.event,
      legsText: r.legs.map((l) => `${label(l.book)} ${l.selection} @ ${l.odds.toFixed(2)}`).join(' / '),
      stakeCents: r.legs.reduce((sum, l) => sum + (l.stakeCents ?? 0), 0),
      startsAt: r.eventStartsAt,
      live: r.eventStartsAt <= now,
    }));
}

export interface BoardRow { book: string; count: number; pct: number }
type BoardTitle = 'ARB' | 'EV' | 'MIDDLES' | 'ALL CATEGORIES';

/** Confirmed legs credit their books; pct = share of the category's confirmed trades. */
export function leaderboards(
  rows: AnalyticsTradeRow[], label: (book: string) => string,
): { title: BoardTitle; rows: BoardRow[] }[] {
  const confirmed = rows.filter((r) => r.confirmedAt !== null);
  const board = (subset: AnalyticsTradeRow[]): BoardRow[] => {
    const counts = new Map<string, number>();
    for (const r of subset) for (const l of r.legs) counts.set(l.book, (counts.get(l.book) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([book, count]) => ({
        book: label(book), count, pct: Math.round((100 * count) / subset.length),
      }));
  };
  const byCat = (c: Strategy): AnalyticsTradeRow[] => confirmed.filter((r) => r.category === c);
  return [
    { title: 'ARB', rows: board(byCat('ARB')) },
    { title: 'EV', rows: board(byCat('EV')) },
    { title: 'MIDDLES', rows: board(byCat('MIDDLE')) },
    { title: 'ALL CATEGORIES', rows: board(confirmed) },
  ];
}

/** Σ (ideal equal-payout profit − rounded worst-case profit) over confirmed ARB pairs,
 *  recomputed from each trade's own stored legs — nothing extra is persisted. */
export function roundingCost(rows: AnalyticsTradeRow[]): { costCents: number; pairs: number } | null {
  const pairs = rows.filter(
    (r) => r.category === 'ARB' && r.confirmedAt !== null && r.legs.every((l) => typeof l.stakeCents === 'number'),
  );
  if (pairs.length === 0) return null;
  let costCents = 0;
  for (const r of pairs) {
    const stakes = r.legs.map((l) => l.stakeCents!);
    const total = stakes.reduce((a, b) => a + b, 0);
    const ideal = Math.round(total * arbMargin(r.legs.map((l) => l.odds)));
    const worst = Math.min(...r.legs.map((l, i) => Math.round(l.odds * stakes[i]!))) - total;
    costCents += Math.max(0, ideal - worst);
  }
  return { costCents, pairs: pairs.length };
}

/** Median recheck/initial retention and the share of rechecked candidates the gate killed. */
export function retention(rows: AnalyticsTradeRow[]): { medianPct: number; dieAtRecheckPct: number } | null {
  const rechecked = rows.filter((r) => r.marginRecheck !== null && r.marginInitial > 0);
  if (rechecked.length === 0) return null;
  const ratios = rechecked.map((r) => r.marginRecheck! / r.marginInitial).sort((a, b) => a - b);
  const mid = ratios.length % 2 === 1
    ? ratios[(ratios.length - 1) / 2]!
    : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2;
  const died = rechecked.filter((r) => r.status === 'KILLED' && r.killReason === 'FAILED_VERIFICATION').length;
  return {
    medianPct: Math.round(mid * 100),
    dieAtRecheckPct: Math.round((100 * died) / rechecked.length),
  };
}

export interface GateCostRow { reason: KillReason; costCents: number; note: string }

/** Battery order (engine/gates.ts); FAILED_VERIFICATION is the recheck's, not the battery's. */
const BATTERY_ORDER: KillReason[] = [
  'ONE_SPORT_RULE', 'HEAT_GATE', 'SHARP_VELOCITY_CAP', 'MARKET_BREADTH_CAP',
  'ROUNDING_DESTROYS_MARGIN', 'QUOTE_STALE',
];

/** Estimated EV of killed candidates: round(max(0, marginInitial) × flatPairCents) —
 *  the flat pair is the deterministic stake proxy for candidates that never got stakes.
 *  Each kill's cost attributes to its FIRST leg's book for the top-book note. */
export function gateCost(
  rows: AnalyticsTradeRow[], s: Settings, label: (book: string) => string,
): GateCostRow[] {
  const est = (r: AnalyticsTradeRow): number => Math.round(Math.max(0, r.marginInitial) * s.flatPairCents);
  const out: GateCostRow[] = [];
  for (const reason of BATTERY_ORDER) {
    const kills = rows.filter((r) => r.status === 'KILLED' && r.killReason === reason);
    if (kills.length === 0) continue;
    const costCents = kills.reduce((sum, r) => sum + est(r), 0);
    let note: string;
    if (reason === 'SHARP_VELOCITY_CAP') note = `${s.sharpVelocityPerDayPerBook}/DAY PER BOOK`;
    else if (reason === 'MARKET_BREADTH_CAP') note = `${s.marketBreadthPerWeekPerBook} / MARKET / BOOK / WEEK`;
    else {
      const byBook = new Map<string, number>();
      for (const r of kills) {
        const book = r.legs[0]?.book ?? '';
        byBook.set(book, (byBook.get(book) ?? 0) + est(r));
      }
      const top = [...byBook.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      note = top && costCents > 0
        ? `${Math.round((100 * top[1]) / costCents)}% OF LINE ITEM IS ${label(top[0]).toUpperCase()}`
        : '—';
    }
    out.push({ reason, costCents, note });
  }
  return out;
}

export interface OppRow { book: string; count: number; avgPct: number }

/** Every candidate the scanner FOUND (kills included); legs credit books; avg = mean
 *  initial margin/edge %. Unsorted, uncapped — the client owns sort + reveal. */
export function opportunities(
  rows: AnalyticsTradeRow[], label: (book: string) => string,
): { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] } {
  const byCat = (c: Strategy): OppRow[] => {
    const agg = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      if (r.category !== c) continue;
      for (const l of r.legs) {
        const cur = agg.get(l.book) ?? { count: 0, sum: 0 };
        cur.count += 1;
        cur.sum += r.marginInitial * 100;
        agg.set(l.book, cur);
      }
    }
    return [...agg.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)) // stable name order; the client re-sorts
      .map(([book, a]) => ({ book: label(book), count: a.count, avgPct: a.sum / a.count }));
  };
  return {
    since: rows[0]?.dayKey ?? '',
    arb: byCat('ARB'),
    ev: byCat('EV'),
    middles: byCat('MIDDLE'),
  };
}
