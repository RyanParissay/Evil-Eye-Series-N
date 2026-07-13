/**
 * CLV display helpers (Phase 18) — pure, client-side, DISPLAY-GRADE ONLY.
 *
 * Aggregate CLV math is server-side (clv/clvSummary.ts behind GET
 * /api/clv/summary); these helpers only format what the server computed and
 * arrange the gate-quality comparison. The ONE place the client computes CLV
 * is `cockpitClv` — the cockpit's own-record readout — and it MIRRORS
 * server/src/engine/clv.ts semantics exactly (excluded null legs,
 * renormalized stake weights, degenerate equal-weight fallback). engine/clv.ts
 * is the authority; if the two ever disagree, the engine is right and this
 * file is the bug.
 *
 * Field semantics (see ClvCell in shared/types.ts — the names lie a little):
 *   - meanClvPct / medianClvPct are PERCENTAGE values at 2dp (5 = +5%).
 *   - beatClosePct / trueClv.beatPct are FRACTIONS 0..1 at 4dp — ×100 to show.
 *   - signal/execution cell.records counts RECORDS; byBook counts LEGS.
 */
import type { ClvCell, ClvSummary, OpportunityRecord, OpportunityStrategy } from '../../shared/types';

/** Below this many observations a cell is muted and chipped "n<10" —
 *  two records must never masquerade as a finding. */
export const SMALL_N = 10;

export function isSmallN(records: number): boolean {
  return records < SMALL_N;
}

/* ————— formatting ————— */

const MINUS = '−'; // U+2212, the app-wide money-minus convention

/** '+5.00%' / '−2.50%' / '—'. Input is the server's percentage value (5 = +5%). */
export function formatClvPct(v: number | null): string {
  if (v == null) return '—';
  return `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(2)}%`;
}

/** '+1.80pp' — a DIFFERENCE between two CLV percentages is percentage points. */
export function formatPpDelta(v: number): string {
  return `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(2)}pp`;
}

/** Server sends beat-the-close shares as FRACTIONS 0..1 → '62%'. */
export function formatBeatShare(frac: number | null): string {
  if (frac == null) return '—';
  return `${Math.round(frac * 100)}%`;
}

/** Median capture lead: minutes under 90, hours at 1dp above. */
export function formatCaptureLead(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 90) return `${Math.round(mins)} min`;
  return `${(mins / 60).toFixed(1)} h`;
}

/* ————— gate-quality comparison (signal cells → one visual unit) ————— */

export type GateOutcome = 'alerted' | 'filtered' | 'single_sighting';

export interface GateRow {
  gateOutcome: GateOutcome;
  cell: ClvCell;
  /** True when this non-alerted cell's mean CLV ≥ the alerted cell's, at
   *  n ≥ SMALL_N — the "gates may be discarding value" flag. Small-N
   *  challengers are never flagged. */
  beatsAlerted: boolean;
}

export interface GateGroup {
  strategy: OpportunityStrategy;
  /** Present cells only, in alerted → filtered → single_sighting order. */
  rows: GateRow[];
  /** Alerted mean minus each challenger's mean, in pp (positive = the gate
   *  keeps the better bets). Present only where both means exist. */
  margins: Array<{ vs: Exclude<GateOutcome, 'alerted'>; pp: number }>;
}

const GATE_ORDER: GateOutcome[] = ['alerted', 'filtered', 'single_sighting'];

/** Regroup the server's flat signal cells by strategy, preserving the
 *  server's strategy order, and compute the alerted-vs-challenger margins. */
export function gateGroups(signal: ClvSummary['signal']): GateGroup[] {
  const byStrategy = new Map<OpportunityStrategy, ClvSummary['signal']>();
  for (const entry of signal) {
    const list = byStrategy.get(entry.strategy) ?? [];
    list.push(entry);
    byStrategy.set(entry.strategy, list);
  }
  return [...byStrategy.entries()].map(([strategy, entries]) => {
    const ordered = GATE_ORDER.flatMap((outcome) =>
      entries.filter((e) => e.gateOutcome === outcome),
    );
    const alertedMean =
      ordered.find((e) => e.gateOutcome === 'alerted')?.cell.meanClvPct ?? null;
    const rows: GateRow[] = ordered.map((e) => ({
      gateOutcome: e.gateOutcome,
      cell: e.cell,
      beatsAlerted:
        e.gateOutcome !== 'alerted' &&
        alertedMean != null &&
        e.cell.meanClvPct != null &&
        e.cell.meanClvPct >= alertedMean &&
        !isSmallN(e.cell.records),
    }));
    const margins: GateGroup['margins'] = [];
    if (alertedMean != null) {
      for (const e of ordered) {
        if (e.gateOutcome === 'alerted' || e.cell.meanClvPct == null) continue;
        margins.push({
          vs: e.gateOutcome,
          pp: Math.round((alertedMean - e.cell.meanClvPct) * 100) / 100,
        });
      }
    }
    return { strategy, rows, margins };
  });
}

/** The ONE shared scale for every bar in the unit: the largest |mean| across
 *  all rows of all groups; 1 when there is nothing (or only zero) to scale. */
export function gateScaleMax(groups: GateGroup[]): number {
  let max = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.cell.meanClvPct != null) max = Math.max(max, Math.abs(row.cell.meanClvPct));
    }
  }
  return max > 0 ? max : 1;
}

/** Diverging bar geometry: zero sits mid-track, so a full-scale bar spans
 *  half the track (pct is % of the WHOLE track width, 0..50). */
export function barGeometry(
  meanClvPct: number | null,
  scaleMax: number,
): { side: 'pos' | 'neg'; pct: number } | null {
  if (meanClvPct == null) return null;
  const pct = Math.min(50, (Math.abs(meanClvPct) / scaleMax) * 50);
  return { side: meanClvPct < 0 ? 'neg' : 'pos', pct };
}

/** byBook rows by LEG count desc (cell.records counts legs there); ties keep
 *  the server's alphabetical order (stable sort). */
export function topBooks(byBook: ClvSummary['byBook'], limit = 8): ClvSummary['byBook'] {
  return [...byBook].sort((a, b) => b.cell.records - a.cell.records).slice(0, limit);
}

/* ————— cockpit per-record CLV (the display mirror of engine/clv.ts) ————— */

export interface CockpitLegClv {
  /** The price the bettor got (fills when recorded, else the alert's odds). */
  basisOdds: number;
  /** The same book's frozen closing price; null = no longer offered there. */
  closingOdds: number | null;
  /** (basisOdds ÷ closingOdds − 1) × 100; null = excluded (no closing price). */
  rawClvPct: number | null;
  /** (basisOdds × de-vigged fair closing prob − 1) × 100; null where the
   *  benchmark didn't quote the leg's line group. */
  trueClvPct: number | null;
}

export interface CockpitClv {
  /** Which odds are "the price you got": recorded fills beat the alert basis. */
  basis: 'execution' | 'signal';
  /** Aligned with record.legs. */
  legs: CockpitLegClv[];
  /** Stake-weighted across legs the close still priced (weights renormalize
   *  over usable legs); null when zero legs were measurable. */
  rawClvPct: number | null;
  trueClvPct: number | null;
  usableLegs: number;
  trueLegs: number;
}

/**
 * The cockpit's own-record CLV readout. Returns null when there is nothing
 * honest to show: no closing captured, the event has not commenced (the
 * close hasn't frozen yet), or the record carries no bet basis (no fills and
 * no confirmedLegOdds — such records surface only in coverage, same as the
 * server). MIRRORS engine/clv.ts exactly, with ONE display-grade divergence:
 * where the engine returns null for a zero-usable-legs record, this returns
 * the per-leg rows (rawClvPct null) so the cockpit can say WHY it is
 * unmeasured instead of going silent.
 */
export function cockpitClv(record: OpportunityRecord, nowMs: number): CockpitClv | null {
  const closing = record.closing;
  if (!closing) return null;
  if (Date.parse(record.commenceTime) > nowMs) return null; // not frozen yet
  if (closing.legOdds.length !== record.legs.length) return null;

  // Basis selection mirrors the server's two bases; the cockpit prefers the
  // money actually staked (execution) over the alert price (signal).
  const filled = record.execution?.filledLegs;
  const confirmed = record.confirmation?.confirmedLegOdds;
  let basis: CockpitClv['basis'];
  let basisLegs: Array<{ odds: number; weight: number }>;
  if (filled && filled.length === record.legs.length) {
    basis = 'execution';
    basisLegs = filled.map((f) => ({ odds: f.odds, weight: f.stake }));
  } else if (confirmed && confirmed.length === record.legs.length) {
    basis = 'signal';
    basisLegs = record.legs.map((leg, i) => ({ odds: confirmed[i], weight: leg.stake }));
  } else {
    return null; // no bet basis — coverage-only record
  }

  const fair = closing.benchmarkFairProb;
  const legs: CockpitLegClv[] = basisLegs.map((leg, i) => {
    const closeOdds = closing.legOdds[i];
    const fp = fair?.[i] ?? null;
    return {
      basisOdds: leg.odds,
      closingOdds: closeOdds,
      rawClvPct:
        closeOdds != null && closeOdds > 0 && leg.odds > 0
          ? (leg.odds / closeOdds - 1) * 100
          : null,
      trueClvPct: fp != null && leg.odds > 0 ? (leg.odds * fp - 1) * 100 : null,
    };
  });

  const rawItems = legs
    .map((l, i) => ({ clv: l.rawClvPct, weight: basisLegs[i].weight }))
    .filter((x): x is { clv: number; weight: number } => x.clv != null);
  const trueItems = legs
    .map((l, i) => ({ clv: l.trueClvPct, weight: basisLegs[i].weight }))
    .filter((x): x is { clv: number; weight: number } => x.clv != null);

  return {
    basis,
    legs,
    rawClvPct: weightedMean(rawItems),
    trueClvPct: weightedMean(trueItems),
    usableLegs: rawItems.length,
    trueLegs: trueItems.length,
  };
}

/** Engine-parity weighted mean: excluded legs are already gone (weights
 *  renormalize by construction); all-zero weights → equal-weight, never 0/0. */
function weightedMean(items: Array<{ clv: number; weight: number }>): number | null {
  if (items.length === 0) return null;
  const wsum = items.reduce((s, x) => s + x.weight, 0);
  if (!(wsum > 0)) return items.reduce((s, x) => s + x.clv, 0) / items.length;
  return items.reduce((s, x) => s + x.weight * x.clv, 0) / wsum;
}
