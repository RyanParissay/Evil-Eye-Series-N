/**
 * THE scheduler tick — the ONLY place in server/src allowed to own a
 * wall-clock timer (a single self-rescheduling setTimeout chain). It reads
 * settings, asks the pure `plan` what to do next, and executes exactly one
 * action per tick: run a scan, run a score poll, or sleep. The clock and the
 * timer are injected, so no test ever sleeps.
 *
 * Everything credit-spending flows through here, and `plan`'s global gates
 * make the whole thing budget-, cap-, and quiet-hours-aware by construction.
 * An unrecoverable provider error (spent quota / rejected key) self-disables
 * the scheduler persistently — the same self-protecting behavior the retired
 * client auto-scan had.
 */
import type { OpsSettings } from '@shared/types';
import { ProviderError } from '../providers/OddsProvider';
import { plan, type SchedulerAction } from './plan';

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
  /** One grading poll (fetchScores for whatever is due). */
  pollGrading: () => Promise<void>;
  /** Epoch ms of the most recent scan on disk (manual or scheduled); null
   *  if none — so a manual scan also resets the scheduler's cadence. */
  lastScanAtMs: () => Promise<number | null>;
  /** The provider's month-to-date credit counter; null when unknown. */
  usedTotal: () => Promise<number | null>;
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
      const [historyLastScan, usedTotal] = await Promise.all([
        this.deps.lastScanAtMs(),
        this.deps.usedTotal(),
      ]);
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
      });
      await this.execute(action, now);
    } catch (err) {
      this.log('Scheduler tick failed', err);
      this.arm(this.deps.maxSleepMs);
    } finally {
      this.ticking = false;
    }
  }

  private async execute(action: SchedulerAction, now: Date): Promise<void> {
    switch (action.kind) {
      case 'scan':
        this.lastScanAttemptAtMs = now.getTime();
        await this.runScan(action.params);
        this.arm(0); // re-plan; the advanced cadence anchor makes plan sleep
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
