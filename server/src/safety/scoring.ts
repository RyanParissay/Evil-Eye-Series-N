/**
 * Score-at-confirmation assembly (Phase 17 WP-B). Records are scored exactly
 * ONCE, at the instant WP2's resolver flips them to 'confirmed' — this module
 * assembles the pure engine's inputs from the stores and hands back a
 * fingerprint → RecordSafety map the caller persists BEFORE the onConfirmed
 * fan-out runs (gate-filtered records keep their score too).
 *
 * Inputs assembled here (engine/safety.ts stays pure — it never reads fs):
 *   - legConsensus: decimal odds for each leg's EXACT outcome + line across
 *     every book in the latest raw snapshot (pre-filter — that's why it
 *     exists). Zero credits: the snapshot is already on disk.
 *   - plannedStakes: the SAME dollars alerts carry — arb/middle through the
 *     shared planStakes (fund default stake + recorded balances), EV the flat
 *     default the EV alert quotes; no fund stake or a collapsed plan falls
 *     back to the engine's $100-basis split, exactly like the alert fallback.
 *   - minEdgePct: the arb alert min-profit threshold (the edge $-rounding
 *     must preserve); 0 for EV + middles — WP-A's arb-only rounding rule.
 *   - exposure: assembleExposureView over the full record history + Hub
 *     purchases (derived from records — deterministic, replayable).
 *
 * FAILURE MODE (documented, binding): scoring must NEVER fail the scan or
 * block confirmation. This function never throws — any store/assembly failure
 * is a console.warn and the affected record(s) confirm WITHOUT safety, i.e.
 * ungated, pre-Phase-17 semantics (passesSafetyGate passes score-less
 * records, the mirror of the never-retro-gate rule).
 */
import { planStakes } from '@shared/stakePlanning';
import type { FundSettings, OpportunityRecord, RecordSafety, SafetySettings } from '@shared/types';
import { scoreSafety } from '../engine/safety';
import type { OddsSnapshot } from '../scan/snapshotStore';
import { assembleExposureView } from './exposure';

export interface ConfirmationScoringDeps {
  /** Latest raw snapshot (scan/snapshotStore.ts) — the consensus source. */
  snapshots: { read(): Promise<OddsSnapshot | null> };
  /** The one SafetySettings config object (ops/safetyStore.ts). */
  settings: { read(): Promise<SafetySettings> };
  /** Full record history, active + archived (ledgerService.allRecordsList). */
  history: () => Promise<OpportunityRecord[]>;
  /** Record ids with ≥1 Hub purchase (acted-on = alerted OR purchased). */
  hubPurchasedIds: () => Promise<ReadonlySet<string>>;
  fundSettings: () => Promise<FundSettings>;
  /** Recorded balances by bookmaker key (the alert planStakes input). */
  bookBalances: () => Promise<Map<string, number | null>>;
  /** The arb alert min-profit threshold (pp) $-rounding must preserve. */
  arbMinEdgePct: () => Promise<number>;
  /** Injectable for tests; defaults to console.warn. */
  warn?: (message: string, err?: unknown) => void;
}

/**
 * Score every newly-confirming record. Returns fingerprint → RecordSafety;
 * a record absent from the map failed to score (already warned) and must
 * confirm without safety. Never throws.
 */
export async function scoreConfirmedRecords(
  deps: ConfirmationScoringDeps,
  records: OpportunityRecord[],
  scoredAt: Date,
): Promise<Map<string, RecordSafety>> {
  const scores = new Map<string, RecordSafety>();
  if (records.length === 0) return scores;
  const warn =
    deps.warn ??
    ((message: string, err?: unknown) =>
      err === undefined ? console.warn(message) : console.warn(message, err));

  let snapshot: OddsSnapshot;
  let settings: SafetySettings;
  let fund: FundSettings;
  let balances: Map<string, number | null>;
  let history: OpportunityRecord[];
  let hubPurchasedIds: ReadonlySet<string>;
  let arbMinEdge: number;
  try {
    let maybeSnapshot: OddsSnapshot | null;
    [maybeSnapshot, settings, fund, balances, history, hubPurchasedIds, arbMinEdge] =
      await Promise.all([
        deps.snapshots.read(),
        deps.settings.read(),
        deps.fundSettings(),
        deps.bookBalances(),
        deps.history(),
        deps.hubPurchasedIds(),
        deps.arbMinEdgePct(),
      ]);
    if (!maybeSnapshot) {
      warn(
        `Safety scoring skipped — no raw snapshot on disk; ${records.length} record(s) confirm ungated (pre-Phase-17 semantics)`,
      );
      return scores;
    }
    snapshot = maybeSnapshot;
  } catch (err) {
    warn(
      `Safety scoring failed — ${records.length} record(s) confirm ungated (pre-Phase-17 semantics):`,
      err,
    );
    return scores;
  }

  for (const record of records) {
    try {
      scores.set(
        record.fingerprint,
        scoreSafety({
          record,
          legConsensus: legConsensusFor(snapshot, record),
          plannedStakes: plannedStakesFor(record, fund, balances),
          minEdgePct: record.strategy === 'arb' ? arbMinEdge : 0,
          settings,
          exposure: assembleExposureView({
            target: record,
            history,
            hubPurchasedIds,
            settings,
            now: scoredAt,
          }),
          scoredAt,
        }),
      );
    } catch (err) {
      // One record failing must never starve the rest of the batch.
      warn(`Safety scoring failed for ${record.id} — it confirms ungated:`, err);
    }
  }
  return scores;
}

/**
 * Per-leg consensus samples: decimal odds for the leg's EXACT outcome + line
 * across every book in the raw snapshot, the leg's own book included, exactly
 * as they sit in the feed. The line-group invariant extends here: a book
 * quoting the same outcome on a DIFFERENT point is never a sample. An event
 * absent from the snapshot yields empty samples — the engine's thin-consensus
 * penalty handles that honestly.
 */
export function legConsensusFor(
  snapshot: OddsSnapshot,
  record: Pick<OpportunityRecord, 'eventId' | 'marketKey' | 'legs'>,
): number[][] {
  const event = snapshot.events.find((e) => e.id === record.eventId);
  return record.legs.map((leg) => {
    if (!event) return [];
    const samples: number[] = [];
    for (const book of event.bookmakers) {
      for (const market of book.markets) {
        if (market.key !== record.marketKey) continue;
        for (const outcome of market.outcomes) {
          if (outcome.name !== leg.outcome) continue;
          if ((outcome.point ?? null) !== (leg.point ?? null)) continue;
          samples.push(outcome.price);
        }
      }
    }
    return samples;
  });
}

/**
 * The SAME dollars the alerts carry, per leg:
 *   arb/middle → shared planStakes at the fund default stake under recorded
 *                balances (alert dollars and cockpit display share this);
 *   ev         → the flat default stake the EV alert quotes.
 * No fund stake, or a plan a zero balance collapsed to $0 → the engine's own
 * $100-basis split (the legs' stored stakes), exactly like the alert fallback
 * — never $0 nonsense.
 */
export function plannedStakesFor(
  record: Pick<OpportunityRecord, 'strategy' | 'legs'>,
  fund: FundSettings,
  balances: Map<string, number | null>,
): number[] {
  const engineBasis = record.legs.map((l) => l.stake);
  if (!(fund.defaultStake > 0)) return engineBasis;
  if (record.strategy === 'ev') return record.legs.map(() => fund.defaultStake);
  const plan = planStakes(record.legs, fund.defaultStake, balances);
  return plan.totalStaked > 0 ? plan.stakes : engineBasis;
}
