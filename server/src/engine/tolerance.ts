// Line-move tolerance gate. Edges are fractions (0.01 = 1% edge); tolerance is a percent.

/**
 * True when the rechecked edge is still within tolerance of the initial edge:
 * `recheckEdge ≥ initialEdge / (1 + tolerancePct/100)` (locked rule per DECISIONS.md).
 * At 0% no weakening is allowed; at 100% the edge may halve, not more.
 */
export function passesToleranceGate(initialEdge: number, recheckEdge: number, tolerancePct: number): boolean {
  return recheckEdge >= initialEdge / (1 + tolerancePct / 100);
}
