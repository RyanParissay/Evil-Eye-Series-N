// Brain heat model (Plan 3, Design §1–5): a deterministic, explainable score in
// [0, 100] recomputed from scratch — a decayed incident ledger (weights are the
// MODEL CONTROLS copy) plus a capped exposure term. No I/O, no randomness, no
// LLM: every number is reproducible by pointing at rows.
import type { Settings } from '../shared/defaults.js';

export type HeatEventKind = 'limit' | 'reject' | 'cut' | 'withdrawal';
export interface HeatEvent { kind: HeatEventKind; ts: number }
export interface SentBet { verifiedAt: number; market: string | null }
export type Health = 'green' | 'yellow' | 'red';

const DAY_MS = 86_400_000;
/** Exposure (volume + breadth) can never exceed this — background pressure, never a siren. */
const EXPOSURE_CAP = 15;
const VOLUME_WEIGHT = 1;
const BREADTH_WEIGHT = 2;
const BREADTH_WINDOW_MS = 7 * DAY_MS;  // mirrors MARKET_BREADTH_CAP's rolling week
const INCIDENT_WINDOW_MS = 7 * DAY_MS; // a fresh limit/reject/cut keeps a book amber even at low heat
/** Prior belief about a soft book's max bet before any report exists. */
export const DEFAULT_BELIEF_CENTS = 50_000;

/** Exponential decay: 0.5^(age / halfLife). */
export function decayFactor(ageMs: number, halfLifeDays: number): number {
  return Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
}

/** heat = clamp(0, 100, round(decayed incident signal + capped exposure)). */
export function computeHeat(events: HeatEvent[], sent: SentBet[], now: number, s: Settings): number {
  const weight: Record<HeatEventKind, number> = {
    limit: s.heatWeightLimit, reject: s.heatWeightReject,
    cut: s.heatWeightCut, withdrawal: s.heatWeightWithdrawal,
  };
  let signal = 0;
  for (const e of events) signal += weight[e.kind] * decayFactor(now - e.ts, s.heatHalfLifeDays);

  let volume = 0;
  const recentMarkets = new Set<string>();
  for (const b of sent) {
    volume += VOLUME_WEIGHT * decayFactor(now - b.verifiedAt, s.heatHalfLifeDays);
    if (now - b.verifiedAt <= BREADTH_WINDOW_MS) recentMarkets.add(b.market ?? 'ML');
  }
  const breadth = BREADTH_WEIGHT * Math.max(0, recentMarkets.size - 1);
  const exposure = Math.min(EXPOSURE_CAP, volume + breadth);

  return Math.max(0, Math.min(100, Math.round(signal + exposure)));
}

/** red ⇔ heat ≥ stopHeat; amber ⇔ heat ≥ goGentleHeat OR an incident in the last 7 days. */
export function deriveHealth(heat: number, events: HeatEvent[], now: number, s: Settings): Health {
  if (heat >= s.stopHeat) return 'red';
  const freshIncident = events.some(
    (e) => e.kind !== 'withdrawal' && now - e.ts <= INCIDENT_WINDOW_MS,
  );
  if (heat >= s.goGentleHeat || freshIncident) return 'yellow';
  return 'green';
}

/** Detail-panel SUSPICION LEVEL n/5 — mapping fixed by design-inventory §3.5. */
export function suspicionLevel(heat: number): 1 | 2 | 3 | 4 | 5 {
  if (heat >= 60) return 5;
  if (heat >= 45) return 4;
  if (heat >= 30) return 3;
  if (heat >= 15) return 2;
  return 1;
}

export interface Belief { maxBetCents: number | null; wasCents: number | null }

/**
 * MY MAX BET HERE: the latest report is the belief; the prior is $500. "▼ WAS"
 * renders only when the latest report LOWERED the belief. Sharp books: NO LIMIT.
 * `reportAmountsCents` must be in sentAt order (oldest first).
 */
export function deriveBelief(reportAmountsCents: number[], sharpExempt: boolean): Belief {
  if (sharpExempt) return { maxBetCents: null, wasCents: null };
  const n = reportAmountsCents.length;
  if (n === 0) return { maxBetCents: DEFAULT_BELIEF_CENTS, wasCents: null };
  const current = reportAmountsCents[n - 1]!;
  const previous = n >= 2 ? reportAmountsCents[n - 2]! : DEFAULT_BELIEF_CENTS;
  return { maxBetCents: current, wasCents: current < previous ? previous : null };
}
