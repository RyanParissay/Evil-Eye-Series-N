// Scheduler runner (Task 13): a single self-rescheduling timeout chain around
// the pure planner (plan.ts). The runner owns lastScanAt, derives the rest of
// PlanState through PlanDeps, and executes whatever planNext returns. Timer and
// clock are INJECTED — the only real setTimeout in the codebase is the one
// index.ts passes in — so tests drive time with a fake clock and tick().
import type { PipeDeps } from '../pipeline/scan.js';
import { runScan } from '../pipeline/scan.js';
import { runVerifyDue } from '../pipeline/verify.js';
import { runSimSettlement } from '../pipeline/actions.js';
import { planNext, type PlanState } from './plan.js';
import { dayKey, isQuietHours, nextQuietEnd } from './vancouverTime.js';
import { brainPassIfDue } from '../brain/pass.js';
import { captureCloses } from '../brain/closes.js';

export interface Timer {
  setTimeout(fn: () => void, ms: number): unknown;
}

/** A live-mode cadence riding the ONE timer chain (Plan 6, HARD GATE 5).
 *  nextAt: when this hook next wants to run at `now` (null = not scheduled —
 *  e.g. sim mode, quiet hours). run: the work; MUST resolve — the runner also
 *  guards, but hooks own their own error logging. */
export interface HookTask {
  name: string;
  nextAt(now: number): number | null;
  run(now: number): Promise<void>;
}

/** The db/market-derived halves of PlanState; the runner supplies lastScanAt itself. */
export interface PlanDeps {
  pendingVerifyDueAts(): number[];
  anyEventWithinHotWindow(now: number): boolean;
}

export interface ScanSummary {
  scan: { created: number; killed: number };
  verify: { promoted: number; killed: number; expired: number };
  settlement: { settled: number; won: number; lost: number };
}

export interface SchedulerHandle {
  /** Test/manual hook: run every due action at clock() now. Never schedules — the timer chain stays single. */
  tick(): void;
  /** The timer callback's body: provider refresh → due hooks → due actions.
   *  Exposed for tests and manual driving; the chain calls it on every wake. */
  pump(): Promise<void>;
  /** Manual scan (POST /api/scan): the full scan bundle immediately, bypassing the cadence, then re-arms the chain so the +75s verify recheck is honored. */
  scanNow(now: number): ScanSummary;
  /** When the next scan will run — the dashboard's countdown. */
  nextScanAt(now: number): number;
  stop(): void;
}

/** Default PlanDeps: due rechecks from PENDING trades; hot window from the last snapshot's event starts. */
export function defaultPlanDeps(deps: PipeDeps): PlanDeps {
  return {
    pendingVerifyDueAts(): number[] {
      return deps.repos.trades.byStatus('PENDING').map((t) => t.verifyDueAt);
    },
    anyEventWithinHotWindow(now: number): boolean {
      const windowMs = deps.s().hotWindowHours * 3_600_000;
      return (deps.lastQuotes ?? []).some((q) => q.eventStartsAt > now && q.eventStartsAt - now <= windowMs);
    },
  };
}

const RETRY_MS = 60_000; // a failed tick must never end the chain — retry in a minute

export function startScheduler(
  deps: PipeDeps, planDeps: PlanDeps, timer: Timer, clock: () => number, hooks: HookTask[] = [],
): SchedulerHandle {
  let lastScanAt: number | null = null;
  let plannedScanAt: number | null = null; // set whenever a tick computes when the next scan lands
  let stopped = false;
  // Which arming of the chain is live. scanNow bumps this and arms a fresh
  // wake; a timeout armed under an older generation is stale and returns
  // without executing or rescheduling. The Timer seam has no clearTimeout, so
  // superseded wakes die by this check — exactly one LIVE chain ever runs.
  let generation = 0;

  const state = (now: number): PlanState => ({
    lastScanAt,
    pendingVerifyDueAts: planDeps.pendingVerifyDueAts(),
    anyEventWithinHotWindow: planDeps.anyEventWithinHotWindow(now),
  });

  /** Cadence-only plan (no pending rechecks): where the next scan falls. Quiet hours → the wake instant. */
  function planScanAt(now: number): number {
    const a = planNext({ ...state(now), pendingVerifyDueAts: [] }, now, deps.s(), deps.rng);
    return Math.max(a.at, now); // 'scan' → its at; 'sleepUntil' → the scan runs right at wake
  }

  /** One scheduled scan: snapshot → kill battery → due rechecks → sim settlement
   *  → brain hooks (close capture + cadence-gated consolidation pass) → daily snapshot. */
  function doScan(now: number): ScanSummary {
    const scan = runScan(deps, now);
    const verify = runVerifyDue(deps, now);
    const settlement = runSimSettlement(deps, now);
    captureCloses(deps, now);   // pre-start closes from the freshest snapshot (verify refetch)
    brainPassIfDue(deps, now);  // 6h consolidation cadence rides this tick — the one-timer invariant holds
    writeDailySnapshot(now);
    lastScanAt = now;
    return { scan, verify, settlement };
  }

  function writeDailySnapshot(now: number): void {
    const profile = deps.repos.profiles.all()[0]!; // seeded default profile
    const settledCents = deps.repos.trades.byStatus('SETTLED').reduce((sum, t) => sum + (t.resultCents ?? 0), 0);
    deps.repos.snapshots.writeDaily(profile.id, dayKey(now), profile.startingCashCents + settledCents);
  }

  /**
   * Execute every action already due, then return the wake time of the next
   * future one. Terminates: a scan pushes scanAt a positive cadence ahead, a
   * verify drains every due PENDING, and sleepUntil is always strictly future.
   */
  function runDue(): number {
    for (;;) {
      const now = clock();
      const action = planNext(state(now), now, deps.s(), deps.rng);
      if (action.at > now) {
        plannedScanAt = action.kind === 'scan' ? action.at : planScanAt(now);
        return action.at;
      }
      if (action.kind === 'scan') doScan(now);
      else runVerifyDue(deps, now); // 'verify' — a past 'sleepUntil' cannot occur (nextQuietEnd is strictly future)
    }
  }

  async function runDueHooks(): Promise<void> {
    for (const h of hooks) {
      const now = clock();
      const at = h.nextAt(now);
      if (at === null || at > now) continue;
      try {
        await h.run(now);
      } catch (err) {
        // Hooks own their logging; this guard is why the chain cannot die (Design §11).
        console.error(`[scheduler] hook ${h.name} failed`, err);
      }
    }
  }

  /** Soonest future hook wake, or +∞ when no hook wants one. */
  function nextHookWake(now: number): number {
    let min = Number.POSITIVE_INFINITY;
    for (const h of hooks) {
      const at = h.nextAt(now);
      if (at !== null) min = Math.min(min, Math.max(at, now));
    }
    return min;
  }

  /** One wake of the chain: live snapshot → due hooks → due plan actions. */
  async function pumpHooks(): Promise<void> {
    try {
      if (deps.provider.refresh) await deps.provider.refresh(clock());
    } catch {
      /* refresh never throws by contract; belt-and-suspenders */
    }
    await runDueHooks();
  }

  /** Arm the chain's next wake under the current generation. */
  function arm(delayMs: number): void {
    const gen = generation;
    timer.setTimeout(() => { onTimer(gen); }, delayMs);
  }

  /** Run the due plan actions and re-arm — the synchronous tail shared by both onTimer paths. */
  function finishTick(): void {
    let delayMs = RETRY_MS;
    try {
      const nextPlanAt = runDue();
      delayMs = Math.max(0, Math.min(nextPlanAt, nextHookWake(clock())) - clock());
    } catch (err) {
      console.error('[scheduler] tick failed — retrying in 60s', err);
    }
    arm(delayMs);
  }

  function onTimer(gen: number): void {
    if (stopped || gen !== generation) return; // stale wake: drop it
    // Stay fully synchronous when there is genuinely no async work THIS wake:
    // no live refresh, and no hook currently due. This preserves the sim
    // scheduler tests (fake timer, fire-and-assert) even after createApp
    // registers hooks (Plan 6 T7) whose nextAt returns null in sim/no-key.
    // Only detour through a microtask when a refresh or a due hook must be awaited.
    const now = clock();
    const anyHookDue = hooks.some((h) => {
      const at = h.nextAt(now);
      return at !== null && at <= now;
    });
    if (!deps.provider.refresh && !anyHookDue) {
      finishTick();
      return;
    }
    void (async () => {
      await pumpHooks();
      finishTick();
    })();
  }

  arm(0); // seed the chain; with lastScanAt null the first tick scans immediately

  return {
    tick(): void {
      runDue();
    },
    async pump(): Promise<void> {
      await pumpHooks();
      runDue();
    },
    scanNow(now: number): ScanSummary {
      const summary = doScan(now);
      plannedScanAt = planScanAt(now); // the manual scan resets the cadence the countdown shows
      // Re-arm the chain NOW: the previously scheduled wake may be a cadence
      // sleep minutes out, but this scan's pendings are due at +75s. Bump the
      // generation (the superseded wake will no-op) and arm one fresh wake for
      // the next due action — after a fresh scan, planNext's verify recheck.
      generation += 1;
      const next = planNext(state(now), now, deps.s(), deps.rng);
      arm(Math.max(0, next.at - now));
      return summary;
    },
    nextScanAt(now: number): number {
      if (plannedScanAt !== null && plannedScanAt > now) return plannedScanAt;
      // Before the first tick (or once the planned instant passes): the chain
      // scans as soon as it wakes — immediately, or when quiet hours end.
      const s = deps.s();
      return isQuietHours(now, s) ? nextQuietEnd(now, s) : now;
    },
    stop(): void {
      stopped = true;
    },
  };
}
