/**
 * Fair-probability engine (Speculative Mode phase 9). Pure — no I/O, no
 * provider, no Express. De-vigs a sharp benchmark's quoted odds into fair
 * probabilities; Phase 10's EV detection consumes it.
 *
 * The arb line-group invariant extends here unchanged: fair probabilities
 * are only ever computed within one |point| line group, and a benchmark
 * that doesn't quote EVERY side of the group at the SAME line is a typed
 * rejection, never an approximation.
 */

/** Multiplicative today; enum seam so power/Shin can land without churn. */
export type DevigMethod = 'multiplicative';

export interface FairLine {
  method: DevigMethod;
  /** M = Σ 1/oᵢ — the bookmaker's margin lives in M − 1. */
  overround: number;
  /** pᵢ = (1/oᵢ)/M, aligned with the input order. Sums to 1. */
  probabilities: number[];
}

export type DevigResult =
  | { ok: true; fair: FairLine }
  | { ok: false; reason: 'missing_outcome' | 'line_mismatch' | 'invalid_odds' };

export function devig(odds: number[], method: DevigMethod = 'multiplicative'): DevigResult {
  if (odds.length < 2) return { ok: false, reason: 'missing_outcome' };
  if (odds.some((o) => !Number.isFinite(o) || o <= 1)) {
    return { ok: false, reason: 'invalid_odds' };
  }
  const implied = odds.map((o) => 1 / o);
  const overround = implied.reduce((sum, q) => sum + q, 0);
  return {
    ok: true,
    fair: { method, overround, probabilities: implied.map((q) => q / overround) },
  };
}

/**
 * Fair probabilities for one line group, from a benchmark bookmaker's
 * outcomes. Result probabilities align with `groupSides` order. Signed
 * points are matched exactly per side (−3.5 with −3.5); the mirrored
 * pairing across sides is the group's own construction, as in the engine.
 */
export function fairForLineGroup(
  benchmarkOutcomes: Array<{ name: string; point?: number; price: number }>,
  groupSides: Array<{ name: string; point?: number }>,
  method: DevigMethod = 'multiplicative',
): DevigResult {
  const odds: number[] = [];
  for (const side of groupSides) {
    const nameMatches = benchmarkOutcomes.filter((o) => o.name === side.name);
    if (nameMatches.length === 0) return { ok: false, reason: 'missing_outcome' };
    const exact = nameMatches.find((o) => (o.point ?? null) === (side.point ?? null));
    if (!exact) {
      // The benchmark quotes this outcome, but on a different line.
      return { ok: false, reason: 'line_mismatch' };
    }
    odds.push(exact.price);
  }
  return devig(odds, method);
}
