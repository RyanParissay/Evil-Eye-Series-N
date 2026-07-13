/**
 * Closing Line Value math (Phase 18) — PURE like the rest of engine/: no
 * fs/env/Express/provider imports, no clocks. The capture pass (clv/) builds
 * a RecordClosing from a fresh snapshot; this module turns a record + its
 * frozen/rolling closing into CLV percentages. Same inputs → identical output.
 *
 * Two measures, both per leg then stake-weighted across the legs of one record:
 *   - raw CLV%  = (basisOdds ÷ closingOdds − 1) × 100 — did the price we bet
 *     beat the same book's closing price? The headline "beat the close" number.
 *   - true CLV% = (basisOdds × benchmarkFairProb − 1) × 100 — did the price
 *     beat the SHARP (de-vigged Pinnacle) fair closing probability? Available
 *     only where the benchmark quoted the leg's line group.
 *
 * BASIS (what "the price we bet" means), decided from what the record carries:
 *   - signal    → confirmation.confirmedLegOdds (scan B's fresh odds — what a
 *     bettor acting on the alert got); WEIGHTS = record.legs[i].stake, the
 *     stored equal-risk $100-nominal split (planStakes-proportional — the
 *     persisted split IS the proportional plan; a live balance-binding rescale
 *     is not reconstructable at read time and stake-weighting is scale-free).
 *   - execution → execution.filledLegs[i].odds; WEIGHTS = filledLegs[i].stake
 *     (the actual dollars staked).
 *
 * HONEST EXCLUSION: a leg the closing snapshot no longer priced (legOdds[i] ===
 * null) is EXCLUDED from the weighted mean — dropped from numerator AND
 * denominator, never counted as 0% — so the weights renormalize over the legs
 * we could actually measure. A record with zero usable legs has a null CLV.
 */
import type { OpportunityRecord } from '@shared/types';

/** Which price is "the price we bet" — see the basis note above. */
export type ClvBasis = 'signal' | 'execution';

export interface RecordClv {
  /** Stake-weighted raw CLV% across legs the closing snapshot still priced. */
  rawClvPct: number | null;
  /** Stake-weighted true CLV% across legs with a de-vigged benchmark close. */
  trueClvPct: number | null;
  /** Legs that contributed to rawClvPct (had a closing price). */
  usableLegs: number;
  /** Legs that contributed to trueClvPct (had a benchmark fair probability). */
  trueLegs: number;
}

/** Per-leg raw CLV%: (basisOdds ÷ closingOdds − 1) × 100. */
export function legRawClvPct(basisOdds: number, closingOdds: number): number {
  return (basisOdds / closingOdds - 1) * 100;
}

/** Per-leg true CLV% vs the de-vigged benchmark close: (basisOdds × fair − 1) × 100. */
export function legTrueClvPct(basisOdds: number, benchmarkFairProb: number): number {
  return (basisOdds * benchmarkFairProb - 1) * 100;
}

/** One leg's CLV under a basis, plus its stake weight — nulls where unmeasurable. */
export interface LegClv {
  rawClvPct: number | null;
  trueClvPct: number | null;
  /** Stake weight for the record-level aggregation. */
  weight: number;
}

/** The basis odds + stake weight for each leg, or null if the basis is absent. */
function basisLegs(
  record: OpportunityRecord,
  basis: ClvBasis,
): Array<{ odds: number; weight: number }> | null {
  if (basis === 'signal') {
    const odds = record.confirmation?.confirmedLegOdds;
    if (!odds || odds.length !== record.legs.length) return null;
    return record.legs.map((leg, i) => ({ odds: odds[i], weight: leg.stake }));
  }
  const filled = record.execution?.filledLegs;
  if (!filled || filled.length !== record.legs.length) return null;
  return filled.map((f) => ({ odds: f.odds, weight: f.stake }));
}

/**
 * Per-leg CLV under a basis, aligned with record.legs — the byBook input
 * (each leg attributes its own CLV to its own book). Null when the basis is
 * unavailable (no closing at all, or the basis odds array is absent/misaligned).
 */
export function recordLegClvs(record: OpportunityRecord, basis: ClvBasis): LegClv[] | null {
  const closing = record.closing;
  if (!closing) return null;
  const legs = basisLegs(record, basis);
  if (!legs || closing.legOdds.length !== record.legs.length) return null;
  const fair = closing.benchmarkFairProb;
  return legs.map((leg, i) => {
    const closeOdds = closing.legOdds[i];
    const fp = fair?.[i] ?? null;
    return {
      rawClvPct:
        closeOdds != null && closeOdds > 0 && leg.odds > 0
          ? legRawClvPct(leg.odds, closeOdds)
          : null,
      trueClvPct: fp != null && leg.odds > 0 ? legTrueClvPct(leg.odds, fp) : null,
      weight: leg.weight,
    };
  });
}

function weightedMean(items: Array<{ clv: number; weight: number }>): number | null {
  if (items.length === 0) return null;
  const wsum = items.reduce((s, x) => s + x.weight, 0);
  // Degenerate (every usable weight is 0) → equal-weight, never 0-divide.
  if (!(wsum > 0)) return items.reduce((s, x) => s + x.clv, 0) / items.length;
  return items.reduce((s, x) => s + x.weight * x.clv, 0) / wsum;
}

/**
 * Record-level stake-weighted CLV under a basis. Null when the basis is
 * unavailable OR no leg is usable (raw drives inclusion — a record with no
 * measurable closing price has no CLV, and is surfaced by coverage, never
 * zeroed into a cell). When non-null, rawClvPct is a number and trueClvPct
 * may still be null (the benchmark didn't quote the legs' line groups).
 */
export function recordClv(record: OpportunityRecord, basis: ClvBasis): RecordClv | null {
  const legClvs = recordLegClvs(record, basis);
  if (!legClvs) return null;
  const rawItems = legClvs
    .filter((l): l is LegClv & { rawClvPct: number } => l.rawClvPct != null)
    .map((l) => ({ clv: l.rawClvPct, weight: l.weight }));
  if (rawItems.length === 0) return null; // zero usable legs → null CLV
  const trueItems = legClvs
    .filter((l): l is LegClv & { trueClvPct: number } => l.trueClvPct != null)
    .map((l) => ({ clv: l.trueClvPct, weight: l.weight }));
  return {
    rawClvPct: weightedMean(rawItems),
    trueClvPct: weightedMean(trueItems),
    usableLegs: rawItems.length,
    trueLegs: trueItems.length,
  };
}
