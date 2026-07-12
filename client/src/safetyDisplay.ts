/**
 * Safety Score (Phase 17) — pure client-side display helpers. No money math
 * lives here: every number is copied verbatim from RecordSafety (server-
 * computed at the confirmation transition). These functions only choose
 * WHICH already-computed number/label to show, mirroring the server's own
 * rules (engine/safety.ts's passesSafetyGate) so the UI never invents a
 * second definition of "filtered".
 */
import type { RecordSafety, SafetySettings } from '../../shared/types';

/** "NN/100", or "REJECTED" for a hard-rejected (score 0) record — 0 is
 *  never rendered as a plain "0/100": the design contract requires the
 *  word so a filtered record reads as declined, not merely low-scoring. */
export function scoreLabel(score: number): string {
  return score === 0 ? 'REJECTED' : `${score}/100`;
}

/**
 * Mirrors server engine/safety.ts's passesSafetyGate exactly, inverted:
 * true when the CURRENT settings would filter this record. `settings` is
 * `null` while the settings fetch is still in flight — never claims
 * FILTERED on a guess. A record with no safety field was never scored
 * (pre-Phase-17 or a scoring failure) and is therefore never filtered.
 */
export function isSafetyFiltered(
  safety: RecordSafety | undefined,
  settings: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'> | null,
): boolean {
  if (!safety || !settings) return false;
  if (!settings.safeMode) return false;
  return safety.score < settings.safetyThreshold;
}

const REASON_LABELS: Record<string, string> = {
  suspicious_edge: 'edge above the safe cap',
  off_consensus: 'a leg is too far off consensus',
  book_exposure: 'a book is over its exposure budget',
  book_cooldown: 'a book is resting after a hot streak',
  rounding_kills_edge: '$5 rounding would erase the edge',
  below_threshold: 'score below the safety threshold',
};

/** Human label for a hard-reject reason code; unknown codes pass through
 *  verbatim so a future reason never renders as blank. */
export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/**
 * Deliverable: rounded stakes (safety.roundedStakes) are the PRIMARY
 * displayed dollar amount when present and aligned with the legs; the
 * exact-optimal planStakes dollar stays the fallback/secondary value. Pure
 * selection — no arithmetic beyond an array lookup.
 */
export function primaryStake(index: number, exactStake: number, safety?: RecordSafety): number {
  const rounded = safety?.roundedStakes;
  if (!rounded || rounded.length <= index) return exactStake;
  const value = rounded[index];
  return Number.isFinite(value) ? value : exactStake;
}

/** Whether safety.roundedStakes is a usable, leg-aligned array — the guard
 *  callers use to decide whether to render the "exact" secondary line. */
export function hasUsableRoundedStakes(legCount: number, safety?: RecordSafety): boolean {
  const rounded = safety?.roundedStakes;
  return !!rounded && rounded.length === legCount && rounded.every((s) => Number.isFinite(s));
}
