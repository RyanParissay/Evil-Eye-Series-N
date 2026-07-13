/**
 * CLV summary (Phase 18) — the server-computed read model behind GET
 * /api/clv/summary. Zero credits, no provider: pure aggregation over the
 * persisted records (active + archived) and the current safety settings.
 *
 * Honesty header — COVERAGE — sits above everything: how many records even
 * have a closing, and (for FROZEN closings only) the median minutes-to-
 * commence of that approximation. Records without a closing are surfaced HERE
 * and then EXCLUDED from every cell below — never zeroed in.
 *
 * SIGNAL cells (basis = confirmation.confirmedLegOdds — what a bettor acting
 * on the alert got) are keyed by strategy × gate outcome, the gates' selection
 * quality being exactly what CLV must measure:
 *   - alerted        : record.alerted === true (we told the user to bet it).
 *   - filtered       : safety present AND fails the gate at CURRENT settings
 *                      (the one passesSafetyGate — Cost of Safety in CLV terms).
 *   - single_sighting: confirmation.status === 'single_sighting' (the
 *                      confirmation gate declined it).
 * Priority alerted → filtered → single_sighting; a confirmed record that
 * passed the gate but never actually alerted is not a measured gate outcome
 * and is excluded. Records lacking confirmedLegOdds are excluded (no basis).
 *
 * EXECUTION cells (basis = execution.filledLegs odds) cover completed records
 * with fills, keyed by strategy — the CLV of the money actually staked.
 *
 * BY BOOK attributes each LEG's own CLV to its own book (signal basis —
 * confirmedLegOdds, the broad always-present population); a book cell's
 * observations are legs, not records.
 */
import type {
  ClvCell,
  ClvSummary,
  OpportunityRecord,
  OpportunityStrategy,
  SafetySettings,
} from '@shared/types';
import { recordClv, recordLegClvs } from '../engine/clv';
import { passesSafetyGate } from '../engine/safety';

export interface ClvSummaryInput {
  /** Full record stream, active + archived (ledgerService.allRecordsList). */
  records: OpportunityRecord[];
  /** The one SafetySettings object — the 'filtered' gate is evaluated LIVE. */
  safetySettings: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'>;
  now: Date;
}

type GateOutcome = 'alerted' | 'filtered' | 'single_sighting';

const STRATEGY_ORDER: OpportunityStrategy[] = ['arb', 'ev', 'middle'];
const GATE_ORDER: GateOutcome[] = ['alerted', 'filtered', 'single_sighting'];

/** Which gate outcome this record is a measurement of, or null (not measured). */
function gateOutcomeOf(
  record: OpportunityRecord,
  settings: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'>,
): GateOutcome | null {
  if (record.alerted) return 'alerted';
  if (record.safety && !passesSafetyGate(record, settings)) return 'filtered';
  if (record.confirmation?.status === 'single_sighting') return 'single_sighting';
  return null;
}

interface Acc {
  raws: number[];
  trues: number[];
}

function newAcc(): Acc {
  return { raws: [], trues: [] };
}

function pushRecord(acc: Acc, raw: number, trueClv: number | null): void {
  acc.raws.push(raw);
  if (trueClv != null) acc.trues.push(trueClv);
}

export function computeClvSummary(input: ClvSummaryInput): ClvSummary {
  const { records, safetySettings, now } = input;
  const nowMs = now.getTime();

  // ── Coverage (the honesty header) ───────────────────────────────────────
  const withClosing = records.filter((r) => r.closing);
  const frozenMins = withClosing
    .filter((r) => Date.parse(r.commenceTime) <= nowMs) // frozen = commence passed
    .map((r) => r.closing!.minutesToCommence);

  // ── Signal cells: strategy × gate outcome ───────────────────────────────
  const signalAccs = new Map<string, Acc>();
  for (const record of records) {
    const clv = recordClv(record, 'signal');
    if (!clv || clv.rawClvPct == null) continue; // no basis / no usable closing leg
    const outcome = gateOutcomeOf(record, safetySettings);
    if (!outcome) continue;
    const key = `${record.strategy}|${outcome}`;
    const acc = signalAccs.get(key) ?? newAcc();
    pushRecord(acc, clv.rawClvPct, clv.trueClvPct);
    signalAccs.set(key, acc);
  }
  const signal: ClvSummary['signal'] = [];
  for (const strategy of STRATEGY_ORDER) {
    for (const gateOutcome of GATE_ORDER) {
      const acc = signalAccs.get(`${strategy}|${gateOutcome}`);
      if (acc) signal.push({ strategy, gateOutcome, cell: finalize(acc) });
    }
  }

  // ── Execution cells: completed + filled, by strategy ────────────────────
  const execAccs = new Map<OpportunityStrategy, Acc>();
  for (const record of records) {
    if (record.status !== 'completed' || !record.execution?.filledLegs) continue;
    const clv = recordClv(record, 'execution');
    if (!clv || clv.rawClvPct == null) continue;
    const acc = execAccs.get(record.strategy) ?? newAcc();
    pushRecord(acc, clv.rawClvPct, clv.trueClvPct);
    execAccs.set(record.strategy, acc);
  }
  const execution: ClvSummary['execution'] = [];
  for (const strategy of STRATEGY_ORDER) {
    const acc = execAccs.get(strategy);
    if (acc) execution.push({ strategy, cell: finalize(acc) });
  }

  // ── By book: each leg's own CLV → its own book (signal basis) ────────────
  const bookAccs = new Map<string, { title: string; acc: Acc }>();
  for (const record of records) {
    const legClvs = recordLegClvs(record, 'signal');
    if (!legClvs) continue;
    record.legs.forEach((leg, i) => {
      const legClv = legClvs[i];
      const entry = bookAccs.get(leg.bookmakerKey) ?? { title: leg.bookmakerTitle, acc: newAcc() };
      if (legClv.rawClvPct != null) entry.acc.raws.push(legClv.rawClvPct);
      if (legClv.trueClvPct != null) entry.acc.trues.push(legClv.trueClvPct);
      bookAccs.set(leg.bookmakerKey, entry);
    });
  }
  const byBook: ClvSummary['byBook'] = [...bookAccs.entries()]
    .filter(([, e]) => e.acc.raws.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bookmakerKey, e]) => ({ bookmakerKey, title: e.title, cell: finalize(e.acc) }));

  return {
    coverage: {
      recordsWithClosing: withClosing.length,
      recordsTotal: records.length,
      medianCaptureMins: frozenMins.length ? median(frozenMins) : null,
    },
    signal,
    execution,
    byBook,
  };
}

/** An accumulator → cell. raws is guaranteed non-empty by the callers. */
function finalize(acc: Acc): ClvCell {
  const cell: ClvCell = {
    records: acc.raws.length,
    meanClvPct: round2(mean(acc.raws)),
    medianClvPct: round2(median(acc.raws)),
    beatClosePct: round4(share(acc.raws)),
  };
  if (acc.trues.length > 0) {
    cell.trueClv = {
      records: acc.trues.length,
      meanPct: round2(mean(acc.trues)),
      beatPct: round4(share(acc.trues)),
    };
  }
  return cell;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Share (0..1) of values strictly above 0 — the "beat the close" fraction. */
function share(values: number[]): number {
  return values.filter((v) => v > 0).length / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
