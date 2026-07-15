// client/src/lib/analytics.ts — AnalyticsView contract mirror (server:
// analytics/report.ts) plus every pure display derivation for the ANALYTICS
// screen. No React, no fetch. Charts are hand-rolled SVG: chartGeometry maps a
// cents series onto the mockup's fixed 960×220 plate (inventory §4.4–4.5).
import { formatCents, parseDollarsToCents } from './format';
import { formatTimeShort } from './brain';
import type { KillReason, Strategy } from './api';

// ---- contract mirror --------------------------------------------------------

export type RangeKey = '1D' | '5D' | '30D' | '1Y' | 'MAX';
export const RANGE_KEYS: RangeKey[] = ['1D', '5D', '30D', '1Y', 'MAX'];

export interface ProfileView { id: number; name: string; startingCashCents: number; createdDate: string }
export interface SeriesPoint { day: string; profitCents: number }
export interface ChartStats { profitCents: number; returnPct: number; annualizedPct: number }
export interface ChartViewData { points: SeriesPoint[]; stats: ChartStats }
export interface MonthlyRow {
  month: string; cand: number; verif: number; sent: number; conf: number;
  unconf: number; exp: number; killed: number; followThruPct: number | null; plCents: number;
}
export interface FunnelCounts {
  under2: number; from2to5: number; from5to10: number; over10: number; dead: number; total: number;
}
export interface OpenBetView {
  category: Strategy; event: string; legsText: string; stakeCents: number; startsAt: number; live: boolean;
}
export interface BoardRow { book: string; count: number; pct: number }
export interface GateCostRow { reason: KillReason; costCents: number; note: string }
export interface OppRow { book: string; count: number; avgPct: number }
export interface AnalyticsView {
  simulated: boolean;
  today: string;
  profile: ProfileView;
  range: RangeKey;
  bankrollCents: number;
  confirmed: ChartViewData;
  all: ChartViewData;
  monthly: MonthlyRow[];
  funnel: FunnelCounts;
  advanced: {
    openBets: OpenBetView[];
    leaderboards: { since: string; boards: { title: string; rows: BoardRow[] }[] };
    costOfSafety: {
      rounding: { costCents: number; pairs: number } | null;
      retention: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null;
      gateCost: GateCostRow[];
      closingEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
    };
    limits: { when: number; book: string; sport: string; event: string; maxCents: number }[];
    opportunities: { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] };
  };
}

// ---- date words -----------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** '2026-05-01' → 'MAY 01 2026' (fund box, add-form note — day stays 2-digit). */
export function formatDateCaps(day: string): string {
  const [y, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${d} ${y}`;
}

/** '2026-07-05' → 'JUL 5' (chart date row — mockup days are unpadded). */
export function chartDate(day: string): string {
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** '2026-07' → 'JUL'. */
export function monthLabel(month: string): string {
  return MONTHS[Number(month.slice(5)) - 1] ?? month;
}

const DAY_SHORT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', month: 'short', day: '2-digit',
});

/** Epoch ms → 'JUL 12' (limits log dates), Vancouver. */
export function formatDayShort(epochMs: number): string {
  const parts = DAY_SHORT.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')}`;
}

// ---- money words ------------------------------------------------------------------

const group = (n: number): string => n.toLocaleString('en-US');

/** Signed whole dollars: 43_812 → '+$438' (chart PROFIT, monthly P/L). U+2212. */
export function formatSignedDollars(c: number): string {
  const sign = c < 0 ? '−' : '+';
  return `${sign}$${group(Math.round(Math.abs(c) / 100))}`;
}

export function formatReturn(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(2)}%`;
}

export function formatAnnualized(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`;
}

// ---- top row ------------------------------------------------------------------------

export function fundStartText(p: ProfileView): { amount: string; date: string } {
  return { amount: formatCents(p.startingCashCents), date: formatDateCaps(p.createdDate) };
}

export function profileItems(
  profiles: ProfileView[], currentId: number,
): { id: number; label: string; current: boolean }[] {
  return profiles.map((p) => ({
    id: p.id,
    label: p.id === currentId ? `● ${p.name.toUpperCase()}` : p.name.toUpperCase(),
    current: p.id === currentId,
  }));
}

/** CREATE PROFILE stays grey until the name is real and the cash parses positive. */
export function createEnabled(name: string, amount: string): boolean {
  const cents = parseDollarsToCents(amount);
  return name.trim() !== '' && cents !== null && cents > 0;
}

export function startsNote(today: string): string {
  return `STARTS THE DAY YOU CREATE IT — ${formatDateCaps(today)}`;
}

// ---- chart geometry ---------------------------------------------------------------
// Plate: viewBox 0 0 960 220; plot x∈[60,940], y∈[25,205] (baseline 205, top 25).
// Vertical gridlines are the mockup's fixed decoration; the y-scale adapts to data.

export interface ChartGeo {
  yLabels: { y: number; text: string }[];
  yMinors: number[];
  xMajors: number[];
  xMinors: number[];
  line: string | null;
  bullets: { x: number; y: number }[];
  last: { x: number; y: number };
  dates: string[];
}

const X_MAJORS = [207, 354, 500, 647, 794];
const X_MINORS = [133, 280, 427, 574, 720, 867];
const MAX_BULLETS = 60;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Whole-dollar axis label (steps are ≥ $1 so cents never appear). U+2212 for losses. */
function axisDollar(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${group(Math.abs(cents) / 100)}`;
}

export function chartGeometry(points: SeriesPoint[]): ChartGeo | null {
  const n = points.length;
  if (n === 0) return null;

  const values = points.map((p) => p.profitCents);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  let step = 100;
  outer: for (let k = 0; k < 12; k += 1) {
    for (const m of [1, 2, 5]) {
      step = m * 10 ** k * 100;
      if (Math.ceil(maxV / step) - Math.floor(minV / step) <= 6) break outer;
    }
  }
  const lo = Math.floor(minV / step) * step;
  let hi = Math.ceil(maxV / step) * step;
  if (hi === lo) hi = lo + step; // flat-at-a-line series still gets a scale

  const y = (v: number): number => r1(205 - ((v - lo) / (hi - lo)) * 180);
  const yLabels: { y: number; text: string }[] = [];
  for (let v = lo; v <= hi; v += step) yLabels.push({ y: y(v), text: axisDollar(v) });
  const yMinors = yLabels.slice(0, -1).map((l, i) => r1((l.y + yLabels[i + 1]!.y) / 2));

  const x = (i: number): number => (n === 1 ? 940 : r1(60 + (i / (n - 1)) * 880));
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.profitCents) }));

  const dateIdx = n <= 6
    ? points.map((_, i) => i)
    : Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  return {
    yLabels,
    yMinors,
    xMajors: X_MAJORS,
    xMinors: X_MINORS,
    line: n >= 2 ? pts.map((p) => `${p.x},${p.y}`).join(' ') : null,
    bullets: n <= MAX_BULLETS ? pts : [],
    last: pts[pts.length - 1]!,
    dates: [...new Set(dateIdx)].map((i) => chartDate(points[i]!.day)),
  };
}

// ---- stats + footnotes ------------------------------------------------------------------

export function statsTexts(stats: ChartStats): { ret: string; ann: string; profit: string; retTone: 'pos' | 'neg' } {
  return {
    ret: formatReturn(stats.returnPct),
    ann: formatAnnualized(stats.annualizedPct),
    profit: formatSignedDollars(stats.profitCents),
    retTone: stats.profitCents < 0 ? 'neg' : 'pos',
  };
}

export function bankrollFootnote(bankrollCents: number): string {
  return `RETURNS MEASURED AGAINST TOTAL BANKROLL (${formatCents(bankrollCents)}).`
    + ' ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.';
}

// ---- monthly table ------------------------------------------------------------------------

export const MONTHLY_HEADERS = [
  'MONTH', 'CAND', 'VERIF', 'SENT', 'CONF', 'UNCONF', 'EXP', 'KILLED', 'FOLLOW-THRU', 'P/L',
];

export function monthlyCells(r: MonthlyRow): string[] {
  return [
    monthLabel(r.month), String(r.cand), String(r.verif), String(r.sent), String(r.conf),
    String(r.unconf), String(r.exp), String(r.killed),
    r.followThruPct === null ? '—' : `${r.followThruPct}%`,
    formatSignedDollars(r.plCents),
  ];
}

// ---- TIME TO ACT funnel ---------------------------------------------------------------------

export interface FunnelRowView { label: string; pct: number | null; value: string; dead: boolean }

export function funnelRows(f: FunnelCounts): FunnelRowView[] {
  const pct = (n: number): number | null => (f.total > 0 ? Math.round((100 * n) / f.total) : null);
  const row = (label: string, n: number, dead = false): FunnelRowView => {
    const p = pct(n);
    return { label, pct: p, value: p === null ? '—' : `${p}%`, dead };
  };
  return [
    row('CONFIRMED < 2 MIN', f.under2),
    row('CONFIRMED 2–5 MIN', f.from2to5),
    row('CONFIRMED 5–10 MIN', f.from5to10),
    ...(f.over10 > 0 ? [row('CONFIRMED > 10 MIN', f.over10)] : []), // NEW copy — honest slow confirms
    row('EXPIRED / DEAD AT CONFIRM', f.dead, true),
  ];
}

// ---- advanced sections -------------------------------------------------------------------------

export function openBetText(b: OpenBetView): string {
  return `${b.category} · ${b.event} · ${b.legsText} · ${formatCents(b.stakeCents)}`;
}

export function openBetStatus(b: OpenBetView): string {
  return b.live ? 'LIVE' : `STARTS ${formatTimeShort(b.startsAt)}`; // LIVE is NEW copy (no quarter in sim)
}

export function sortOpp(rows: OppRow[], by: 'COUNT' | 'EDGE'): OppRow[] {
  return [...rows].sort((a, b) =>
    by === 'COUNT'
      ? b.count - a.count || b.avgPct - a.avgPct || (a.book < b.book ? -1 : 1)
      : b.avgPct - a.avgPct || b.count - a.count || (a.book < b.book ? -1 : 1));
}

export function oppToggle(open: boolean): string {
  return open ? 'SHOW FEWER ←' : 'SEE ALL →'; // SHOW FEWER ← is NEW copy (mockup button is inert)
}

export function limitRow(
  l: AnalyticsView['advanced']['limits'][number],
): { left: string; right: string } {
  return {
    left: `${formatDayShort(l.when)} · ${l.book} · ${l.sport.toUpperCase()} — ${l.event}`,
    right: `MAX ${formatCents(l.maxCents)}`,
  };
}

export interface GateBarView { reason: string; widthPct: number; cost: string; note: string; top: boolean }

export function gateBar(rows: GateCostRow[]): GateBarView[] {
  const max = Math.max(0, ...rows.map((r) => r.costCents));
  return rows.map((r) => ({
    reason: r.reason,
    widthPct: max > 0 ? Math.round((100 * r.costCents) / max) : 0,
    cost: `−$${group(Math.round(r.costCents / 100))}`,
    note: r.note,
    top: r.costCents === max && max > 0,
  }));
}

export function roundingTile(t: { costCents: number; pairs: number } | null): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO CONFIRMED PAIRS YET' }; // NEW copy
  const dollars = Math.floor(t.costCents / 100);
  const cents = String(t.costCents % 100).padStart(2, '0');
  return {
    value: `−$${group(dollars)}.${cents}`,
    note: `Σ (UNROUNDED − ROUNDED WORST-CASE) OVER ${t.pairs} CONFIRMED PAIRS`,
  };
}

export function retentionTile(
  t: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null,
): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO RECHECKS YET' }; // NEW copy
  return {
    value: `${t.medianPct}% MEDIAN`,
    note: `PROMOTION THRESHOLD ${t.thresholdPct}% · ${t.dieAtRecheckPct}% OF CANDIDATES DIE AT RECHECK`,
  };
}

export function closingEdgeTile(
  t: { avgPct: number; beatClosePct: number; legs: number } | null,
): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO CLOSES CAPTURED YET' }; // NEW copy
  const sign = t.avgPct < 0 ? '−' : '+';
  return {
    value: `${sign}${Math.abs(t.avgPct).toFixed(1)}% MEAN · ${t.beatClosePct}% POSITIVE`,
    note: 'FROM LAST CACHED PRE-START SWEEP',
  };
}
