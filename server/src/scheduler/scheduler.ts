/**
 * THE scheduler tick — the ONLY place in server/src allowed to own a
 * wall-clock timer (a single self-rescheduling setTimeout chain). It reads
 * settings, asks the pure `plan` what to do next, and executes exactly one
 * action per tick: run a scan, run the confirmation scan B or resolve a
 * lapsed pair (Phase 16 Part A), run a score poll, or sleep. The clock and
 * the timer are injected, so no test ever sleeps.
 *
 * Everything credit-spending flows through here, and `plan`'s global gates
 * make the whole thing budget-, cap-, and quiet-hours-aware by construction.
 * An unrecoverable provider error (spent quota / rejected key) self-disables
 * the scheduler persistently — the same self-protecting behavior the retired
 * client auto-scan had.
 */
import type { OpsSettings } from '@shared/types';
import { ProviderError } from '../providers/OddsProvider';
import {
  denseWeekEndMs,
  denseWeekIntervalMins,
  isDenseWeekActive,
} from './denseWeek';
import { plan, type PlanInput, type SchedulerAction } from './plan';

export type TimerHandle = unknown;

export interface SchedulerDeps {
  now: () => Date;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  readSettings: () => Promise<OpsSettings>;
  /** Persist a self-disable: scheduler.enabled=false + a stored reason. */
  disable: (reason: string) => Promise<void>;
  /** Run one scan through the full notifier/alerts/backup pipeline; rejects
   *  with the provider error on total failure. */
  runScan: (params: { regionTab: string; topN: number }) => Promise<void>;
  /** Phase 16 Part A: run scan B (same pipeline as runScan) and evaluate
   *  the pending pair against it — index.ts owns the composition. */
  runConfirmScan: (params: { regionTab: string; topN: number }) => Promise<void>;
  /** Resolve every pending confirmation to single_sighting: the pair's B
   *  window lapsed (quiet hours / stop / restart). Zero provider calls. */
  resolveConfirmations: () => Promise<void>;
  /** Store-derived pending-pair summary: eligible-candidate count + the
   *  latest sighting among them (the expiry anchor); {0, null} when none. */
  pendingConfirmation: () => Promise<{ count: number; latestSeenAtMs: number | null }>;
  /** Fetch scope of the last completed scan — scan B reuses it; null falls
   *  back to the scheduler's own scanParams. */
  lastScanParams: () => Promise<{ regionTab: string; topN: number } | null>;
  /** One grading poll (fetchScores for whatever is due). */
  pollGrading: () => Promise<void>;
  /** Epoch ms of the most recent scan on disk (manual or scheduled); null
   *  if none — so a manual scan also resets the scheduler's cadence. */
  lastScanAtMs: () => Promise<number | null>;
  /** The provider's month-to-date credit counter; null when unknown. */
  usedTotal: () => Promise<number | null>;
  /**
   * Phase 16 Part C.3: dense-week spend + measured per-pair cost, from scan
   * history. Called only while a dense week is active. Absent (existing tests
   * / dense week off) ⇒ plan runs the normal block cadence. */
  denseWeekInputs?: (
    startedAtMs: number,
    now: Date,
  ) => Promise<{ dayCreditsUsed: number; weekCreditsUsed: number; perPairCost: number }>;
  /** Clear an expired dense week so it falls back to normal blocks (Part C.3). */
  clearDenseWeek?: () => Promise<void>;
  scorePollIntervalMs: number;
  /** Upper bound on any single sleep, so a settings/budget change is picked
   *  up within this bound even absent an explicit wake(). */
  maxSleepMs: number;
  log?: (message: string, err?: unknown) => void;
}

export class Scheduler {
  private handle: TimerHandle | null = null;
  private running = false;
  private ticking = false;
  private lastScorePollAtMs: number | null = null;
  /** Anchors scan cadence on the last ATTEMPT (success or failure), so a
   *  failing scan can never become a tight retry loop — the same guarantee
   *  the old client's finally-stamped lastScanAt gave. */
  private lastScanAttemptAtMs: number | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.arm(0);
  }

  stop(): void {
    this.running = false;
    if (this.handle != null) this.deps.clearTimer(this.handle);
    this.handle = null;
  }

  /** Re-plan now. Call after a settings change (e.g. the enable toggle) so
   *  it takes effect immediately rather than after the current sleep. */
  wake(): void {
    if (this.running && !this.ticking) this.arm(0);
  }

  private arm(ms: number): void {
    if (!this.running) return;
    if (this.handle != null) this.deps.clearTimer(this.handle);
    const delay = Math.max(0, Math.min(ms, this.deps.maxSleepMs));
    this.handle = this.deps.setTimer(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      const settings = await this.deps.readSettings();
      const now = this.deps.now();
      const [historyLastScan, usedTotal, pending, lastScanParams] = await Promise.all([
        this.deps.lastScanAtMs(),
        this.deps.usedTotal(),
        this.deps.pendingConfirmation(),
        this.deps.lastScanParams(),
      ]);
      const denseWeek = await this.resolveDenseWeek(settings, now);
      const action = plan({
        settings: settings.scheduler,
        now,
        lastScanAtMs: maxOrNull(historyLastScan, this.lastScanAttemptAtMs),
        lastScorePollAtMs: this.lastScorePollAtMs,
        scorePollIntervalMs: this.deps.scorePollIntervalMs,
        budget: {
          monthlyCreditBudget: settings.monthlyCreditBudget,
          autoStopPct: settings.autoStopPct,
          usedTotal,
        },
        confirmation: {
          pendingCount: pending.count,
          latestSeenAtMs: pending.latestSeenAtMs,
          lastScanParams,
        },
        denseWeek,
      });
      await this.execute(action, now);
    } catch (err) {
      this.log('Scheduler tick failed', err);
      this.arm(this.deps.maxSleepMs);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Resolve the dense-week plan input (Part C.3): when `denseWeek.startedAt`
   * is set and still inside its 7-day window, measure spend + per-pair cost
   * from scan history and derive the elevated interval; when the window has
   * lapsed, clear it (falls back to normal blocks automatically). Absent deps
   * or no dense week ⇒ null, i.e. the normal block cadence.
   */
  private async resolveDenseWeek(
    settings: OpsSettings,
    now: Date,
  ): Promise<PlanInput['denseWeek']> {
    const raw = settings.scheduler.denseWeek?.startedAt;
    if (typeof raw !== 'string' || !this.deps.denseWeekInputs) return null;
    const startedAtMs = Date.parse(raw);
    if (!Number.isFinite(startedAtMs)) return null;
    if (!isDenseWeekActive(startedAtMs, now.getTime())) {
      await this.deps.clearDenseWeek?.();
      return null;
    }
    const { dayCreditsUsed, weekCreditsUsed, perPairCost } = await this.deps.denseWeekInputs(
      startedAtMs,
      now,
    );
    return {
      active: true,
      endsAtMs: denseWeekEndMs(startedAtMs),
      intervalMins: denseWeekIntervalMins(perPairCost),
      dayCreditsUsed,
      weekCreditsUsed,
    };
  }

  private async execute(action: SchedulerAction, now: Date): Promise<void> {
    switch (action.kind) {
      case 'scan':
        this.lastScanAttemptAtMs = now.getTime();
        await this.runScan(action.params);
        this.arm(0); // re-plan; the advanced cadence anchor makes plan sleep
        return;
      case 'confirmScan':
        // Scan B: the attempt stamp gives failed Bs the pair cadence as
        // their retry spacing (never a tight loop); plan's expiry anchor
        // (last real sighting) bounds the retries, then resolves the pair.
        this.lastScanAttemptAtMs = now.getTime();
        await this.runConfirm(action.params);
        this.arm(0);
        return;
      case 'resolveConfirmations':
        // Bookkeeping, zero credits. A throwing resolve falls to the tick's
        // catch (max-sleep re-arm) — never a hot loop.
        await this.deps.resolveConfirmations();
        this.arm(0);
        return;
      case 'scorePoll':
        this.lastScorePollAtMs = now.getTime();
        await this.runPoll();
        this.arm(0);
        return;
      case 'sleep':
        this.arm(action.untilMs - now.getTime());
        return;
    }
  }

  private async runScan(params: { regionTab: string; topN: number }): Promise<void> {
    try {
      await this.deps.runScan(params);
    } catch (err) {
      await this.handleProviderFailure(err, 'Scheduled scan failed');
    }
  }

  private async runConfirm(params: { regionTab: string; topN: number }): Promise<void> {
    try {
      await this.deps.runConfirmScan(params);
    } catch (err) {
      await this.handleProviderFailure(err, 'Confirmation scan (B) failed');
    }
  }

  private async runPoll(): Promise<void> {
    try {
      await this.deps.pollGrading();
    } catch (err) {
      await this.handleProviderFailure(err, 'Scheduled grading poll failed');
    }
  }

  private async handleProviderFailure(err: unknown, context: string): Promise<void> {
    if (
      err instanceof ProviderError &&
      (err.code === 'quota_exhausted' || err.code === 'invalid_api_key')
    ) {
      const reason =
        err.code === 'quota_exhausted'
          ? 'Odds API credits are spent — the scheduler stopped itself. Re-enable once they reset or the budget is raised.'
          : 'The Odds API rejected the key — the scheduler stopped itself. Fix ODDS_API_KEY, then re-enable.';
      try {
        await this.deps.disable(reason);
      } catch (persistErr) {
        this.log('Failed to persist scheduler self-disable', persistErr);
      }
      this.log(`${context} — scheduler self-disabled`, err);
      return;
    }
    this.log(context, err);
  }

  private log(message: string, err?: unknown): void {
    this.deps.log?.(message, err);
  }
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
