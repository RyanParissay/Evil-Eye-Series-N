/**
 * Cost of Safety (Phase 17) — what the gate declined, priced hypothetically.
 * The evidence for tuning safetyThreshold: the report carries
 * `simulated: true` because every dollar in it is hypothetical — bets that
 * were deliberately NOT taken.
 *
 * Population: records that reached 'confirmed', carry a safety score, and
 * FAIL the gate at the CURRENT settings — judged by the one passesSafetyGate
 * function, never a restatement. Consequences of that choice, both honest:
 *   - safeMode OFF → the gate filters nothing, so the report is zero;
 *   - unscored confirmed records (scoring failures, pre-Phase-17) are
 *     ungated and therefore never counted.
 *
 * Dollars at the fund default stake (≤ $0 stake → counts stand, dollars $0 —
 * never estimate money):
 *   arb    → profitPct × stake/100 (the guaranteed edge it carried)
 *   ev     → edgePct × stake/100 — EXPECTED (a model, not money; the
 *            byStrategy split exists so the UI can label it)
 *   middle → $0 unless freeMiddle (a costed middle's worst case is a LOSS —
 *            payout-weighted "forgone profit" would be dishonest); a free
 *            middle forgoes its locked floor, −costPct × stake/100.
 * Forgone edge (pp) follows the same rules. byReason buckets each record
 * once: its FIRST hard-reject reason (components run a→f, deterministic),
 * else 'below_threshold'.
 *
 * Pure and provider-free: zero credits structurally. The week window is the
 * trailing 7 days of safety.scoredAt (the confirmation instant).
 */
import type {
  OpportunityRecord,
  OpportunityStrategy,
  SafetyCostReport,
  SafetyCostWindow,
  SafetySettings,
} from '@shared/types';
import { passesSafetyGate } from '../engine/safety';

const DAY_MS = 24 * 3_600_000;
const STRATEGY_ORDER: readonly OpportunityStrategy[] = ['arb', 'ev', 'middle'];

export interface SafetyCostInputs {
  /** Full record history, active + archived (ledgerService.allRecordsList). */
  history: OpportunityRecord[];
  /** CURRENT settings — the report re-prices whenever the knobs move. */
  settings: SafetySettings;
  /** Fund default stake in dollars. */
  defaultStake: number;
  now: Date;
}

export function computeSafetyCost(inputs: SafetyCostInputs): SafetyCostReport {
  const { history, settings, now } = inputs;
  const stake = inputs.defaultStake > 0 ? inputs.defaultStake : 0;
  const filtered = history.filter(
    (r) =>
      r.confirmation?.status === 'confirmed' &&
      r.safety != null &&
      !passesSafetyGate(r, settings),
  );
  const weekCutoffMs = now.getTime() - 7 * DAY_MS;
  const week = filtered.filter((r) => Date.parse(r.safety!.scoredAt) >= weekCutoffMs);
  return {
    simulated: true,
    week: windowOf(week, stake),
    lifetime: windowOf(filtered, stake),
  };
}

function windowOf(records: OpportunityRecord[], stake: number): SafetyCostWindow {
  let forgoneProfit = 0;
  let forgoneEdgePp = 0;
  const byReason = new Map<string, { count: number; forgoneProfit: number }>();
  const byStrategy = new Map<OpportunityStrategy, { count: number; forgoneProfit: number }>();

  for (const record of records) {
    const profit = forgoneProfitOf(record, stake);
    forgoneProfit += profit;
    forgoneEdgePp += forgoneEdgeOf(record);

    const reason = record.safety!.reasons[0] ?? 'below_threshold';
    const reasonBucket = byReason.get(reason) ?? { count: 0, forgoneProfit: 0 };
    reasonBucket.count += 1;
    reasonBucket.forgoneProfit = round2(reasonBucket.forgoneProfit + profit);
    byReason.set(reason, reasonBucket);

    const strategyBucket = byStrategy.get(record.strategy) ?? { count: 0, forgoneProfit: 0 };
    strategyBucket.count += 1;
    strategyBucket.forgoneProfit = round2(strategyBucket.forgoneProfit + profit);
    byStrategy.set(record.strategy, strategyBucket);
  }

  return {
    filteredCount: records.length,
    forgoneProfit: round2(forgoneProfit),
    forgoneEdgePp: round2(forgoneEdgePp),
    // Deterministic order: biggest bucket first, ties alphabetical.
    byReason: [...byReason.entries()]
      .map(([reason, bucket]) => ({ reason, ...bucket }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    byStrategy: STRATEGY_ORDER.filter((s) => byStrategy.has(s)).map((strategy) => ({
      strategy,
      ...byStrategy.get(strategy)!,
    })),
  };
}

/** Hypothetical dollars at the default stake — see the honesty rules above. */
function forgoneProfitOf(record: OpportunityRecord, stake: number): number {
  return round2((forgoneEdgeOf(record) * stake) / 100);
}

/** The forgone headline edge in pp under the same honesty rules. */
function forgoneEdgeOf(record: OpportunityRecord): number {
  if (record.strategy === 'ev') return record.ev?.edgePct ?? 0;
  if (record.strategy === 'middle') {
    const middle = record.middle;
    return middle?.freeMiddle ? -middle.costPct : 0;
  }
  return record.profitPct;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
