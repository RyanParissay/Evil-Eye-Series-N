/**
 * Store-backed façade over opportunity persistence — what scanService, the
 * routes, and the alert notifier composition talk to.
 */
import type { ArbOpportunity, OpportunityRecord, OpportunityStatus, RecordGrading } from '@shared/types';
import {
  applyExecution,
  applyScanToRecords,
  applyStatusChange,
  applyVerification,
  partitionForArchive,
  type CockpitStatus,
  type ScanScope,
} from './opportunityLifecycle';
import type { OpportunityArchiveWriter, OpportunityDataStore } from './opportunityStore';

export type UpdateStatusOutcome =
  | { ok: true; record: OpportunityRecord }
  | { ok: false; reason: 'not_found' | 'conflict' | 'bad_request'; message: string };

export class OpportunityService {
  constructor(
    private readonly store: OpportunityDataStore,
    private readonly archive: OpportunityArchiveWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Upsert a scan's detections, apply lifecycle, age settled records out.
   * Reports the confirmation-candidate count (Phase 16 Part A): ≥1 means
   * this scan is a scan A whose scan B the scheduler must fire.
   */
  async recordScan(
    opportunities: ArbOpportunity[],
    scope: ScanScope,
  ): Promise<{ pendingCandidates: number }> {
    const at = this.now();
    return this.store.update(async (data) => {
      const { records, pendingCandidates } = applyScanToRecords(data.records, opportunities, scope, at);
      const { keep, archive } = partitionForArchive(records, at);
      if (archive.length > 0) {
        try {
          await this.archive.append(archive, at);
        } catch (err) {
          // Archive failure must not lose history — keep them active instead.
          console.warn('Opportunity archive append failed; keeping records in active file:', err);
          return { data: { records }, result: { pendingCandidates } };
        }
      }
      return { data: { records: keep }, result: { pendingCandidates } };
    });
  }

  /** Flag records whose fingerprints were actually sent as WhatsApp alerts. */
  async markAlerted(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return;
    const at = this.now().toISOString();
    const wanted = new Set(fingerprints);
    await this.store.update((data) => {
      for (const record of data.records) {
        if (wanted.has(record.fingerprint) && !record.alerted) {
          record.alerted = true;
          record.alertedAt = at;
        }
      }
      return { data, result: undefined };
    });
  }

  /**
   * Cockpit-driven transition (degraded/completed) on one record.
   * Completing may carry the actual filled legs; they must align with the
   * record's legs and are booked as the execution (realized P&L source).
   */
  async updateStatus(
    id: string,
    target: CockpitStatus,
    filledLegs?: Array<{ odds: number; stake: number }>,
  ): Promise<UpdateStatusOutcome> {
    const at = this.now();
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else if (filledLegs && (target !== 'completed' || filledLegs.length !== record.legs.length)) {
        result = {
          ok: false,
          reason: 'bad_request',
          message: `filledLegs must accompany completion and align with the record's ${record.legs.length} legs`,
        };
      } else {
        const change = applyStatusChange(record, target, at);
        if (change.ok) {
          if (filledLegs) applyExecution(record, filledLegs, at);
          result = { ok: true, record };
        } else {
          result = { ok: false, reason: 'conflict', message: change.message };
        }
      }
      return { data, result };
    });
  }

  /**
   * Fold freshly fetched leg odds into one record (see applyVerification).
   * Completed records are history and never re-verify.
   */
  async applyVerification(
    id: string,
    legOdds: Array<number | null>,
  ): Promise<UpdateStatusOutcome> {
    const at = this.now();
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else if (record.status === 'completed') {
        result = { ok: false, reason: 'conflict', message: 'Cannot verify a completed opportunity' };
      } else {
        const outcome = applyVerification(record, legOdds, at);
        // Reaction telemetry: first verify stamps the funnel; every verify
        // logs its outcome (the ideal-vs-reality bridge).
        record.funnel = { verifyPressedAt: at.toISOString(), ...record.funnel };
        record.verifies = [
          ...(record.verifies ?? []),
          { at: at.toISOString(), outcome, profitPct: record.profitPct },
        ];
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /** First-write-wins reaction-funnel timestamp from the cockpit. */
  async recordFunnelStep(
    id: string,
    step: 'cockpitOpenedAt' | 'fillsOpenedAt',
  ): Promise<UpdateStatusOutcome> {
    const at = this.now().toISOString();
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else {
        record.funnel = { [step]: at, ...record.funnel };
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /**
   * Grade an EV completion: the graded outcome IS its realized money
   * (won → +stake×(odds−1), lost → −stake, void → 0). Arbs never grade —
   * their profit is outcome-independent. Regrade is allowed until the
   * execution has been applied to balances.
   */
  async grade(id: string, grade: 'won' | 'lost' | 'void'): Promise<UpdateStatusOutcome> {
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else if (record.strategy !== 'ev') {
        result = { ok: false, reason: 'conflict', message: 'Only EV records grade — arb profit is outcome-independent' };
      } else if (record.status !== 'completed' || !record.execution) {
        result = { ok: false, reason: 'conflict', message: 'Grade after completing with filled numbers' };
      } else if (record.execution.balancesAppliedAt) {
        result = { ok: false, reason: 'conflict', message: 'Balances applied — revert before regrading' };
      } else {
        const execution = record.execution;
        const [leg] = execution.filledLegs;
        execution.grade = grade;
        execution.lockedProfit =
          grade === 'won'
            ? Math.round(leg.stake * (leg.odds - 1) * 100) / 100
            : grade === 'lost'
              ? -Math.round(leg.stake * 100) / 100
              : 0;
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /**
   * Per-leg grading for middles: realized P&L = Σ per-leg from actual
   * fills (won → +stake×(odds−1), lost → −stake, void/push → 0). Both
   * won = the middle hit. Regrade allowed until balances applied.
   */
  async gradeLegs(
    id: string,
    legGrades: Array<'won' | 'lost' | 'void'>,
  ): Promise<UpdateStatusOutcome> {
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else if (record.strategy !== 'middle') {
        result = { ok: false, reason: 'conflict', message: 'Per-leg grading is for middles only' };
      } else if (record.status !== 'completed' || !record.execution) {
        result = { ok: false, reason: 'conflict', message: 'Grade after completing with filled numbers' };
      } else if (record.execution.balancesAppliedAt) {
        result = { ok: false, reason: 'conflict', message: 'Balances applied — revert before regrading' };
      } else if (legGrades.length !== record.execution.filledLegs.length) {
        result = { ok: false, reason: 'bad_request', message: 'legGrades must align with the filled legs' };
      } else {
        const execution = record.execution;
        execution.legGrades = [...legGrades];
        execution.lockedProfit =
          Math.round(
            execution.filledLegs.reduce((sum, leg, i) => {
              const grade = legGrades[i];
              if (grade === 'won') return sum + leg.stake * (leg.odds - 1);
              if (grade === 'lost') return sum - leg.stake;
              return sum;
            }, 0) * 100,
          ) / 100;
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /** Marks (or clears, with null) the applied-to-balances state. */
  async markBalancesApplied(
    id: string,
    winningLegIndex: number | null,
  ): Promise<UpdateStatusOutcome> {
    const at = this.now().toISOString();
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record || !record.execution) {
        result = { ok: false, reason: 'not_found', message: `No priced execution: ${id}` };
      } else {
        record.execution.balancesAppliedAt = winningLegIndex == null ? null : at;
        record.execution.winningLegIndex = winningLegIndex;
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /**
   * Phase 13 signal grading (GRADING_RULES.md, distinct from execution.grade
   * above — this is the arb/EV/middle SIGNAL settlement, not the realized-
   * money grade). Writes record.grading and clears gradingFlags. Refuses to
   * let an AUTO grading (source 'auto') overwrite an existing manually_graded
   * record — manual always wins (§3); a manual call re-grading its own prior
   * manual grade is allowed (that's how a correction works).
   */
  async applyGrading(id: string, grading: RecordGrading): Promise<UpdateStatusOutcome> {
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else if (grading.source === 'auto' && record.grading?.flags.includes('manually_graded')) {
        result = {
          ok: false,
          reason: 'conflict',
          message: 'Manually graded — auto-grading refuses to overwrite it',
        };
      } else {
        record.grading = grading;
        record.gradingFlags = [];
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /** Pending-state flag for score polling (needs_rules / ungraded_stale). */
  async setGradingFlag(id: string, flag: string): Promise<UpdateStatusOutcome> {
    return this.store.update((data) => {
      const record = data.records.find((r) => r.id === id);
      let result: UpdateStatusOutcome;
      if (!record) {
        result = { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
      } else {
        const flags = new Set(record.gradingFlags ?? []);
        flags.add(flag);
        record.gradingFlags = [...flags];
        result = { ok: true, record };
      }
      return { data, result };
    });
  }

  /**
   * Records awaiting their confirmation scan B (Phase 16 Part A). Returns
   * DEEP COPIES: the pair matcher snapshots these BEFORE scan B and judges
   * presence/drift against the post-B store, so the snapshot must never
   * alias live record objects a store may hand out and mutate in place.
   */
  async pendingConfirmations(): Promise<OpportunityRecord[]> {
    const { records } = await this.store.read();
    return records
      .filter((r) => r.confirmation?.status === 'pending')
      .map((r) => structuredClone(r));
  }

  /**
   * Write pair-matcher verdicts (opportunities/confirmation.ts). Only
   * still-pending records move — confirmed and single_sighting are terminal,
   * so a racing scan or double evaluation is a no-op. Returns the records
   * that reached 'confirmed' (the onConfirmed fan-out's payload).
   */
  async applyConfirmations(
    outcomes: Array<{
      fingerprint: string;
      status: 'confirmed' | 'single_sighting';
      scanBAt: string;
      edgeDeltaPp?: number;
    }>,
  ): Promise<OpportunityRecord[]> {
    if (outcomes.length === 0) return [];
    return this.store.update((data) => {
      const byFingerprint = new Map(data.records.map((r) => [r.fingerprint, r]));
      const confirmed: OpportunityRecord[] = [];
      for (const outcome of outcomes) {
        const record = byFingerprint.get(outcome.fingerprint);
        if (!record || record.confirmation?.status !== 'pending') continue;
        record.confirmation = {
          ...record.confirmation,
          status: outcome.status,
          scanBAt: outcome.scanBAt,
          ...(outcome.edgeDeltaPp != null && { edgeDeltaPp: outcome.edgeDeltaPp }),
        };
        if (outcome.status === 'confirmed') confirmed.push(record);
      }
      return { data, result: confirmed };
    });
  }

  /**
   * Resolve EVERY pending confirmation to the terminal single_sighting —
   * the honest outcome when scan B could not fire within its grace window
   * (quiet hours, scheduler stop, restart). Bookkeeping only: zero provider
   * calls, zero credits. Returns how many records it resolved.
   */
  async expirePendingConfirmations(): Promise<number> {
    const at = this.now().toISOString();
    return this.store.update((data) => {
      let expired = 0;
      for (const record of data.records) {
        if (record.confirmation?.status !== 'pending') continue;
        record.confirmation = { ...record.confirmation, status: 'single_sighting', scanBAt: at };
        expired += 1;
      }
      return { data, result: expired };
    });
  }

  async get(id: string): Promise<OpportunityRecord | null> {
    const { records } = await this.store.read();
    return records.find((r) => r.id === id) ?? null;
  }

  /** Newest first; optionally filtered by status. */
  async list(status?: OpportunityStatus): Promise<OpportunityRecord[]> {
    const { records } = await this.store.read();
    return records
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }
}
