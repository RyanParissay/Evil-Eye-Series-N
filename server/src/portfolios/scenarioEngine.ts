/**
 * Phase 14 — the scenario engine: replays the ENTIRE opportunity stream
 * (active + archived, via LedgerService.allRecordsList) through 13
 * parallel paper series, one $10,000 bankroll each, flat staking, no
 * compounding — GRADING_RULES.md §5 is binding. Pure: no I/O, no clock;
 * the caller supplies the record stream and the (already-computed)
 * scan-gap list.
 *
 * Series definitions:
 *   Arb ×3     — strategy 'arb', profitPctAtDetection ≥ {1, 2, 3}%.
 *   EV ×9      — strategy 'ev', ev.edgePct ≥ {3, 5, 7}% crossed with risk
 *                tier {high: 3%, med: 2%, low: 1%} of the $10,000 start.
 *   Middles ×1 — strategy 'middle'.
 *
 * Staking (GRADING_RULES.md §5, no compounding): every series' stake is a
 * FLAT dollar figure off the $10,000 start, never off the current
 * (fluctuating) bankroll. EV tiers stake $300 / $200 / $100. Arb and
 * middle series have no risk tier of their own — a lead decision (see
 * docs/prompts/phase-14.md) stakes them flat $200 (2% of start, the same
 * dollar figure as the EV med tier), noted here rather than silently
 * assumed.
 *
 * Only records carrying `grading` (Phase 13 auto/manual settlement) ever
 * move a series' bankroll. Everything else is counted, never dropped:
 *   - same-book / suspicious records would never have been bet at all,
 *     graded or not → 'excluded' (CLAUDE.md: "flagged, never hidden").
 *   - pre-v13 records (no schemaVersion, no grading) → 'preV13'.
 *   - flagged needs_rules / ungraded_stale → their own buckets.
 *   - still open (no grading, no flag) → 'open'.
 *   - graded, but the series can't afford the stake at its CURRENT
 *     bankroll → a skipped event (GRADING_RULES.md §5); bankroll,
 *     buckets, and the equity curve are all untouched by a skip.
 */
import type { OpportunityRecord } from '@shared/types';
import type { ScanGap } from '../ops/gapDetector';

export const SERIES_STARTING_BANKROLL = 10_000;

export type PortfolioGroup = 'arb' | 'ev' | 'middle';

export interface PortfolioBuckets {
  /** No schemaVersion and no grading — GRADING_RULES.md §6. */
  preV13: number;
  needsRules: number;
  stale: number;
  open: number;
  /** Same-book or suspicious — would never have been bet. */
  excluded: number;
}

export interface SkippedEvent {
  at: string;
  recordId: string;
}

export interface PortfolioSeries {
  key: string;
  label: string;
  group: PortfolioGroup;
  startingBankroll: number;
  bankroll: number;
  pnl: number;
  roiPct: number;
  /** Graded records that actually moved the bankroll (placed, not skipped). */
  records: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  skipped: { count: number; events: SkippedEvent[] };
  buckets: PortfolioBuckets;
  /** Peak-to-trough on the running bankroll, in dollars (≥ 0). */
  maxDrawdown: number;
  equity: Array<{ at: string; bankroll: number }>;
}

export interface ScenarioReport {
  series: PortfolioSeries[];
  /** Phase-13 scan gaps — shared across every series, not per-series. */
  gaps: ScanGap[];
}

interface SeriesDef {
  key: string;
  label: string;
  group: PortfolioGroup;
  stake: number;
  matches: (record: OpportunityRecord) => boolean;
}

const ARB_EDGES = [1, 2, 3] as const;
const EV_EDGES = [3, 5, 7] as const;
const EV_TIERS: ReadonlyArray<{ key: string; label: string; pct: number }> = [
  { key: 'high', label: 'High risk (3%)', pct: 3 },
  { key: 'med', label: 'Med risk (2%)', pct: 2 },
  { key: 'low', label: 'Low risk (1%)', pct: 1 },
];

/** Arb/middle stake — no risk tier of their own (lead decision, see the
 *  module comment): flat 2% of the $10,000 start. */
const FLAT_NO_TIER_STAKE = (SERIES_STARTING_BANKROLL * 2) / 100;

function buildSeriesDefs(): SeriesDef[] {
  const defs: SeriesDef[] = ARB_EDGES.map((edge) => ({
    key: `arb_${edge}`,
    label: `Arb ≥${edge}%`,
    group: 'arb' as const,
    stake: FLAT_NO_TIER_STAKE,
    matches: (r: OpportunityRecord) => r.strategy === 'arb' && r.profitPctAtDetection >= edge,
  }));

  for (const edge of EV_EDGES) {
    for (const tier of EV_TIERS) {
      defs.push({
        key: `ev_e${edge}_${tier.key}`,
        label: `EV ≥${edge}% / ${tier.label}`,
        group: 'ev',
        stake: (SERIES_STARTING_BANKROLL * tier.pct) / 100,
        matches: (r) => r.strategy === 'ev' && (r.ev?.edgePct ?? -Infinity) >= edge,
      });
    }
  }

  defs.push({
    key: 'middle',
    label: 'Middles',
    group: 'middle',
    stake: FLAT_NO_TIER_STAKE,
    matches: (r) => r.strategy === 'middle',
  });

  return defs;
}

export const SERIES_DEFS: readonly SeriesDef[] = buildSeriesDefs();

/** Deterministic replay of every series over the full record stream.
 *  Records are sorted by detectedAt then id before replay — the caller's
 *  array order (and the array itself) is never mutated or depended on. */
export function runScenarios(records: OpportunityRecord[], scanGaps: ScanGap[]): ScenarioReport {
  const sorted = [...records].sort(
    (a, b) => a.detectedAt.localeCompare(b.detectedAt) || a.id.localeCompare(b.id),
  );

  return { series: SERIES_DEFS.map((def) => runOneSeries(def, sorted)), gaps: scanGaps };
}

function runOneSeries(def: SeriesDef, sorted: OpportunityRecord[]): PortfolioSeries {
  let bankroll = SERIES_STARTING_BANKROLL;
  let peak = SERIES_STARTING_BANKROLL;
  let maxDrawdown = 0;
  let placed = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  const equity: Array<{ at: string; bankroll: number }> = [];
  const skippedEvents: SkippedEvent[] = [];
  const buckets: PortfolioBuckets = { preV13: 0, needsRules: 0, stale: 0, open: 0, excluded: 0 };

  for (const record of sorted) {
    if (!def.matches(record)) continue;

    // Would never have been bet, graded or not (CLAUDE.md: flagged, never
    // hidden) — checked ahead of the grading gate on purpose.
    if (record.sameBookmaker || record.suspicious) {
      buckets.excluded += 1;
      continue;
    }

    if (!record.grading) {
      if (record.schemaVersion == null) {
        buckets.preV13 += 1;
      } else if (record.gradingFlags?.includes('ungraded_stale')) {
        buckets.stale += 1;
      } else if (record.gradingFlags?.includes('needs_rules')) {
        buckets.needsRules += 1;
      } else {
        buckets.open += 1;
      }
      continue;
    }

    // Affordability is checked against the CURRENT bankroll — you don't
    // know a bet is a push before placing it (GRADING_RULES.md §5).
    if (bankroll < def.stake) {
      skippedEvents.push({ at: record.detectedAt, recordId: record.id });
      continue;
    }

    const pnl = round2((def.stake * record.grading.pnlPer100) / 100);
    bankroll = round2(bankroll + pnl);
    placed += 1;
    if (record.grading.result === 'win') wins += 1;
    else if (record.grading.result === 'loss') losses += 1;
    else if (record.grading.result === 'push') pushes += 1;
    else voids += 1;

    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, round2(peak - bankroll));
    equity.push({ at: record.detectedAt, bankroll });
  }

  return {
    key: def.key,
    label: def.label,
    group: def.group,
    startingBankroll: SERIES_STARTING_BANKROLL,
    bankroll,
    pnl: round2(bankroll - SERIES_STARTING_BANKROLL),
    roiPct: round2(((bankroll - SERIES_STARTING_BANKROLL) / SERIES_STARTING_BANKROLL) * 100),
    records: placed,
    wins,
    losses,
    pushes,
    voids,
    skipped: { count: skippedEvents.length, events: skippedEvents },
    buckets,
    maxDrawdown,
    equity,
  };
}

/**
 * Chronological per-signal return fraction (pnl ÷ starting bankroll),
 * derived from the equity curve — the optimizer's input. Placed (i.e.
 * non-skipped, non-bucketed) signals only, since that's the return stream
 * a series actually experienced.
 */
export function perSignalReturns(series: PortfolioSeries): number[] {
  const bankrolls = [series.startingBankroll, ...series.equity.map((e) => e.bankroll)];
  const returns: number[] = [];
  for (let i = 1; i < bankrolls.length; i++) {
    returns.push(round6((bankrolls[i] - bankrolls[i - 1]) / series.startingBankroll));
  }
  return returns;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
