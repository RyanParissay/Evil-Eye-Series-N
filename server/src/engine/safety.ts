/**
 * The Safety Score engine (Phase 17) — a deterministic, account-longevity
 * filter. PURE like the rest of engine/: no fs/env/Express/provider imports.
 * The caller (WP-B, at the confirmation transition) assembles the snapshot
 * consensus prices, the planned stakes, and the ExposureView; this module
 * only does arithmetic on them.
 *
 * Score = 50 (base) + Σ component deltas, clamped 0–100. ANY hard reject →
 * score 0 with its reason(s). Every component emits an itemized
 * SafetyComponent with a human detail string ("−30: leg 2 is 5.1% off
 * consensus"), so the whole score is explainable. Same inputs → byte-
 * identical output (no clocks, no randomness — scoredAt is passed in).
 *
 * Components (a–f), weights/thresholds all from the one SafetySettings object:
 *   a) edge_cap     — arb edge > maxSafeEdge → hard reject `suspicious_edge`.
 *   b) consensus    — per leg, deviation of implied prob from the snapshot
 *                     median: ≤2% 0 / 2–4% −15 / 4–6% −30 / >6% hard reject
 *                     `off_consensus`; <minBooks priced → −15 thin penalty.
 *   c) sharp_anchor — one neverLimit leg +20, both +25, none 0.
 *   d) market_tier  — tier 1 +10, tier 3 −20, else tier 2 (0).
 *   e) exposure     — per soft book: over day/week budget → `book_exposure`;
 *                     hot-streak cooldown active → `book_cooldown`. neverLimit
 *                     books are exempt.
 *   f) stake_rounding — round planned stakes to $roundTo; for arbs, if the
 *                     recomputed guaranteed edge < minEdgePct → hard reject
 *                     `rounding_kills_edge`. EV/middle: display-only, 0.
 */
import type {
  OpportunityRecord,
  RecordSafety,
  SafetyComponent,
  SafetySettings,
} from '@shared/types';
import { lockedProfit } from './arbitrage';

/** The minimal record view the engine scores — WP-B passes the real record. */
export type SafetyScoreRecord = Pick<
  OpportunityRecord,
  'strategy' | 'sportKey' | 'marketKey' | 'profitPct' | 'legs'
>;

/** Per-soft-book exposure, DERIVED FROM RECORDS by safety/exposure.ts. */
export interface BookExposure {
  /** Acted-on records touching this book in the current Vancouver-local day. */
  dayCount: number;
  /** Acted-on records touching this book in the trailing 7 days. */
  weekCount: number;
  /** Winning-side acted-on records in the trailing 7 days (hot-streak size). */
  winningStreak: number;
  /** Cooldown end (epoch ms) = most-recent winning-side time + cooldownDays,
   *  or null when the book is not resting. */
  cooldownUntilMs: number | null;
}

/** Caller-assembled exposure snapshot, keyed by bookmaker key. */
export interface ExposureView {
  books: Record<string, BookExposure>;
}

export interface SafetyInput {
  record: SafetyScoreRecord;
  /**
   * Per-leg consensus samples: decimal odds across ALL books in the current
   * snapshot for THAT leg's outcome + line, assembled by the caller. Aligned
   * with record.legs. The leg's own book is included, exactly as it sits in
   * the snapshot.
   */
  legConsensus: number[][];
  /**
   * Exact-optimal planned leg stakes in dollars (the same planStakes dollars
   * alerts already carry), aligned with record.legs. The engine rounds these
   * to $roundTo for the camouflage check + the primary displayed amounts.
   */
  plannedStakes: number[];
  /** The alert/profile min headline edge (pp) the $-rounding must preserve. */
  minEdgePct: number;
  settings: SafetySettings;
  exposure: ExposureView;
  /** Scoring instant — passed in so the result is deterministic. */
  scoredAt: Date;
}

/** Signed delta, using the U+2212 minus the spec's detail strings use. */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return Math.round(value * 100) / 100;
  return Math.round(value / increment) * increment;
}

export function scoreSafety(input: SafetyInput): RecordSafety {
  const { record, settings, scoredAt } = input;
  const components: SafetyComponent[] = [];
  const reasons: string[] = [];
  const addReason = (r: string): void => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  // ── a) Edge cap (arb-only hard reject) ──────────────────────────────────
  if (record.strategy === 'arb') {
    if (record.profitPct > settings.maxSafeEdge) {
      addReason('suspicious_edge');
      components.push({
        key: 'edge_cap',
        delta: 0,
        detail: `reject: arb edge ${record.profitPct.toFixed(1)}% exceeds max safe ${settings.maxSafeEdge}%`,
      });
    } else {
      components.push({
        key: 'edge_cap',
        delta: 0,
        detail: `0: arb edge ${record.profitPct.toFixed(1)}% within max safe ${settings.maxSafeEdge}%`,
      });
    }
  } else {
    components.push({
      key: 'edge_cap',
      delta: 0,
      detail: `0: edge cap applies to arbs only (strategy ${record.strategy})`,
    });
  }

  // ── b) Consensus outlier (per leg, heaviest weight) ─────────────────────
  const c = settings.consensus;
  record.legs.forEach((leg, i) => {
    const sample = input.legConsensus[i] ?? [];
    if (sample.length < c.minBooks) {
      components.push({
        key: 'consensus',
        delta: c.thinPenalty,
        detail: `${signed(c.thinPenalty)}: leg ${i + 1} has only ${sample.length} priced book${
          sample.length === 1 ? '' : 's'
        } (<${c.minBooks}) — consensus unknowable`,
      });
      return;
    }
    const med = median(sample.map((o) => 1 / o));
    const legProb = 1 / leg.odds;
    const devPct = med > 0 ? (Math.abs(legProb - med) / med) * 100 : 0;
    const devStr = devPct.toFixed(1);
    if (devPct <= c.noPenaltyMaxPct) {
      components.push({
        key: 'consensus',
        delta: 0,
        detail: `0: leg ${i + 1} is ${devStr}% off consensus (within ${c.noPenaltyMaxPct}%)`,
      });
    } else if (devPct <= c.minorPenaltyMaxPct) {
      components.push({
        key: 'consensus',
        delta: c.minorPenalty,
        detail: `${signed(c.minorPenalty)}: leg ${i + 1} is ${devStr}% off consensus`,
      });
    } else if (devPct <= c.majorPenaltyMaxPct) {
      components.push({
        key: 'consensus',
        delta: c.majorPenalty,
        detail: `${signed(c.majorPenalty)}: leg ${i + 1} is ${devStr}% off consensus`,
      });
    } else {
      addReason('off_consensus');
      components.push({
        key: 'consensus',
        delta: 0,
        detail: `reject: leg ${i + 1} is ${devStr}% off consensus (>${c.majorPenaltyMaxPct}%)`,
      });
    }
  });

  // ── c) Sharp anchor ─────────────────────────────────────────────────────
  const onList = record.legs.filter((l) => settings.neverLimitBooks.includes(l.bookmakerKey));
  if (onList.length >= 2) {
    components.push({
      key: 'sharp_anchor',
      delta: settings.sharpAnchor.bothLegs,
      detail: `${signed(settings.sharpAnchor.bothLegs)}: both legs on sharp/exchange books (${onList
        .map((l) => l.bookmakerKey)
        .join(', ')})`,
    });
  } else if (onList.length === 1) {
    components.push({
      key: 'sharp_anchor',
      delta: settings.sharpAnchor.oneLeg,
      detail: `${signed(settings.sharpAnchor.oneLeg)}: one leg on a sharp/exchange book (${onList[0].bookmakerKey})`,
    });
  } else {
    components.push({ key: 'sharp_anchor', delta: 0, detail: '0: no sharp/exchange anchor' });
  }

  // ── d) Market tier ──────────────────────────────────────────────────────
  const t = settings.marketTiers;
  const matches = (entries: Array<{ sportPrefix: string; marketKey?: string }>): boolean =>
    entries.some(
      (e) =>
        record.sportKey.startsWith(e.sportPrefix) &&
        (e.marketKey === undefined || e.marketKey === record.marketKey),
    );
  if (matches(t.tier1)) {
    components.push({
      key: 'market_tier',
      delta: t.tier1Bonus,
      detail: `${signed(t.tier1Bonus)}: ${record.sportKey}/${record.marketKey} is a tier-1 market`,
    });
  } else if (matches(t.tier3)) {
    components.push({
      key: 'market_tier',
      delta: t.tier3Penalty,
      detail: `${signed(t.tier3Penalty)}: ${record.sportKey}/${record.marketKey} is a tier-3 (obscure) market`,
    });
  } else {
    components.push({
      key: 'market_tier',
      delta: 0,
      detail: `0: ${record.sportKey}/${record.marketKey} is a tier-2 market`,
    });
  }

  // ── e) Exposure budgets + cooldown (per soft book) ──────────────────────
  const { maxArbsPerDay, maxArbsPerWeek } = settings.budgets;
  const seenBooks = new Set<string>();
  for (const leg of record.legs) {
    if (seenBooks.has(leg.bookmakerKey)) continue;
    seenBooks.add(leg.bookmakerKey);
    if (settings.neverLimitBooks.includes(leg.bookmakerKey)) continue; // exempt
    const b: BookExposure = input.exposure.books[leg.bookmakerKey] ?? {
      dayCount: 0,
      weekCount: 0,
      winningStreak: 0,
      cooldownUntilMs: null,
    };
    let rejected = false;
    if (b.dayCount >= maxArbsPerDay) {
      addReason('book_exposure');
      components.push({
        key: 'exposure',
        delta: 0,
        detail: `reject: ${leg.bookmakerKey} at daily cap (${b.dayCount}/${maxArbsPerDay} acted-on today)`,
      });
      rejected = true;
    }
    if (b.weekCount >= maxArbsPerWeek) {
      addReason('book_exposure');
      components.push({
        key: 'exposure',
        delta: 0,
        detail: `reject: ${leg.bookmakerKey} at weekly cap (${b.weekCount}/${maxArbsPerWeek} acted-on this week)`,
      });
      rejected = true;
    }
    if (b.cooldownUntilMs != null && scoredAt.getTime() < b.cooldownUntilMs) {
      addReason('book_cooldown');
      components.push({
        key: 'exposure',
        delta: 0,
        detail: `reject: ${leg.bookmakerKey} resting after ${b.winningStreak} winning arbs — cooldown until ${new Date(
          b.cooldownUntilMs,
        ).toISOString()}`,
      });
      rejected = true;
    }
    if (!rejected) {
      components.push({
        key: 'exposure',
        delta: 0,
        detail: `0: ${leg.bookmakerKey} within budget (${b.dayCount}/${maxArbsPerDay} day, ${b.weekCount}/${maxArbsPerWeek} week)`,
      });
    }
  }

  // ── f) Camouflage stake rounding ────────────────────────────────────────
  const roundTo = settings.roundTo;
  const roundedStakes = input.plannedStakes.map((s) => roundToIncrement(s, roundTo));
  const isArb = record.strategy === 'arb' && record.legs.length >= 2;
  if (isArb) {
    const roundedLegs = record.legs.map((l, i) => ({ odds: l.odds, stake: roundedStakes[i] ?? 0 }));
    const profit = lockedProfit(roundedLegs);
    const totalStaked = roundedStakes.reduce((sum, v) => sum + (v ?? 0), 0);
    const edgePct = totalStaked > 0 ? (profit / totalStaked) * 100 : Number.NEGATIVE_INFINITY;
    const edgeStr = Number.isFinite(edgePct) ? edgePct.toFixed(2) : '−∞';
    if (edgePct < input.minEdgePct) {
      addReason('rounding_kills_edge');
      components.push({
        key: 'stake_rounding',
        delta: 0,
        detail: `reject: $${roundTo} rounding cuts guaranteed edge to ${edgeStr}% (< ${input.minEdgePct}% min) — rounded stakes [${roundedStakes.join(
          ', ',
        )}]`,
      });
    } else {
      components.push({
        key: 'stake_rounding',
        delta: 0,
        detail: `0: $${roundTo}-rounded stakes hold guaranteed edge at ${edgeStr}% (≥ ${input.minEdgePct}% min)`,
      });
    }
  } else {
    components.push({
      key: 'stake_rounding',
      delta: 0,
      detail: `0: stakes rounded to $${roundTo} for display — ${record.strategy} edge is not rounding-sensitive`,
    });
  }

  // ── Assemble ────────────────────────────────────────────────────────────
  const total = components.reduce((sum, comp) => sum + comp.delta, 0);
  const clamped = Math.max(0, Math.min(100, 50 + total));
  const score = reasons.length > 0 ? 0 : clamped;
  return { score, components, reasons, roundedStakes, scoredAt: scoredAt.toISOString() };
}

/**
 * The single safety gate, applied in exactly the two consumers WP-B wires
 * (WhatsApp alerts + Hub purchases). Three cases, all here so neither
 * consumer restates them:
 *   - safeMode OFF  → always true (scores are still computed + persisted).
 *   - safeMode ON, record has NO safety field (pre-Phase-17) → true. Old
 *     records are NEVER retro-gated (mirror of the never-retro-alert rule).
 *   - safeMode ON, record scored → score ≥ safetyThreshold.
 */
export function passesSafetyGate(
  record: Pick<OpportunityRecord, 'safety'>,
  settings: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'>,
): boolean {
  if (!settings.safeMode) return true;
  if (!record.safety) return true;
  return record.safety.score >= settings.safetyThreshold;
}
