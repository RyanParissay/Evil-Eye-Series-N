/**
 * HTTP boundary for the adaptive scheduler's user-facing controls (Phase 16
 * Part C): the dense data-gathering week and the weekly deterministic
 * proposal. NO provider in the dependency graph — dense-week spend derives
 * from persisted scan-history creditsComputed, the proposal from persisted
 * history + confirmed records, so this router cannot spend a credit
 * (structural, like /api/ops and advanced mode). The one credit-spending
 * consequence — a dense week actually scanning — happens inside the scheduler
 * tick, gated by its plan; this router only flips the persisted `denseWeek`.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DenseWeekStatus, ScanLogEntry } from '@shared/types';
import { DEFAULT_PER_SCAN_COST } from '../config/constants';
import { denseWeekStatus, isDenseWeekActive } from '../scheduler/denseWeek';
import type { OpsSettingsStore } from '../ops/opsStore';
import { confirmationHitRate } from './ops';
import { errorBody } from './api';

export interface SchedulerRouterDeps {
  settings: OpsSettingsStore;
  scanHistory: { entries(): AsyncGenerator<ScanLogEntry> };
  /** Wake the running scheduler so a start/cancel takes effect at once. */
  onSchedulerChange?: () => void;
  now?: () => Date;
}

export function createSchedulerRouter(deps: SchedulerRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  /** Current dense-week status, computed fresh from scan history. Lazily
   *  clears an expired dense week (it already falls back to normal blocks in
   *  the plan; this tidies the persisted state). */
  router.get('/dense-week', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await readDenseWeekStatus(deps, now()));
    } catch (err) {
      next(err);
    }
  });

  /** Start a dense week (sets denseWeek.startedAt = now). 409 if one is
   *  already active. */
  router.post('/dense-week', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const at = now();
      const startedMs = startedAtMsOf(await deps.settings.read());
      if (startedMs != null && isDenseWeekActive(startedMs, at.getTime())) {
        res.status(409).json(errorBody('conflict', 'A dense week is already running.'));
        return;
      }
      await deps.settings.update((data) => ({
        data: {
          ...data,
          scheduler: { ...data.scheduler, denseWeek: { startedAt: at.toISOString() } },
        },
        result: undefined,
      }));
      deps.onSchedulerChange?.();
      res.json(await readDenseWeekStatus(deps, at));
    } catch (err) {
      next(err);
    }
  });

  /** Cancel a dense week early (clears denseWeek). Idempotent. */
  router.delete('/dense-week', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await clearDenseWeek(deps);
      deps.onSchedulerChange?.();
      res.json(await readDenseWeekStatus(deps, now()));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Read settings + scan history and assemble the dense-week status; clears an
 *  expired dense week as a side effect. */
async function readDenseWeekStatus(deps: SchedulerRouterDeps, at: Date): Promise<DenseWeekStatus> {
  const settings = await deps.settings.read();
  const startedMs = startedAtMsOf(settings);
  const scans = await allScans(deps);
  if (startedMs != null && !isDenseWeekActive(startedMs, at.getTime())) {
    await clearDenseWeek(deps); // expired: tidy the persisted state
    return denseWeekStatus(null, at, scans, measurePerPairCost(scans, at));
  }
  return denseWeekStatus(startedMs, at, scans, measurePerPairCost(scans, at));
}

async function clearDenseWeek(deps: SchedulerRouterDeps): Promise<void> {
  await deps.settings.update((data) => ({
    data: { ...data, scheduler: { ...data.scheduler, denseWeek: null } },
    result: undefined,
  }));
}

function startedAtMsOf(settings: { scheduler: { denseWeek?: { startedAt: string } | null } }): number | null {
  const raw = settings.scheduler.denseWeek?.startedAt;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export async function allScans(deps: { scanHistory: { entries(): AsyncGenerator<ScanLogEntry> } }): Promise<ScanLogEntry[]> {
  const scans: ScanLogEntry[] = [];
  for await (const entry of deps.scanHistory.entries()) scans.push(entry);
  return scans;
}

/**
 * The measured per-pair credit cost the dense-week interval derives from and
 * the status displays: the most recent scan's actual creditsComputed × (1 +
 * measured confirmation hit rate). Falls back to a conservative default when
 * no history exists yet — the hard caps stop scanning regardless, so an
 * over-eager interval can never overspend.
 */
export function measurePerPairCost(scans: ScanLogEntry[], at: Date): number {
  const { hitRate } = confirmationHitRate(scans, at);
  return latestCreditsPerScan(scans) * (1 + hitRate);
}

function latestCreditsPerScan(scans: ScanLogEntry[]): number {
  for (let i = scans.length - 1; i >= 0; i--) {
    const c = scans[i].creditsComputed;
    if (Number.isFinite(c) && c > 0) return c;
  }
  return DEFAULT_PER_SCAN_COST;
}
