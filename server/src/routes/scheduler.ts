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
import type {
  DenseWeekStatus,
  OpportunityRecord,
  OpsSettings,
  ScanLogEntry,
  SchedulerBlock,
} from '@shared/types';
import { DEFAULT_PER_SCAN_COST, PROPOSAL_MIN_HISTORY_DAYS } from '../config/constants';
import { SCORES_DAILY_CREDIT_CAP } from '../config/gradingRules';
import { denseWeekStatus, isDenseWeekActive } from '../scheduler/denseWeek';
import { computeProposal, historyDaysSpan } from '../scheduler/optimizer';
import type { OpsSettingsStore } from '../ops/opsStore';
import { confirmationHitRate } from './ops';
import { errorBody } from './api';

export interface SchedulerRouterDeps {
  settings: OpsSettingsStore;
  scanHistory: { entries(): AsyncGenerator<ScanLogEntry> };
  /** Every opportunity record (active + archived) — the proposal's density
   *  counts the confirmation-'confirmed' subset. */
  records: () => Promise<OpportunityRecord[]>;
  /** Wake the running scheduler so a start/cancel/apply takes effect at once. */
  onSchedulerChange?: () => void;
  now?: () => Date;
}

/**
 * Conservative MODEL reserve for score-poll spend in the projection: score
 * polls run at a 5-minute cadence but only spend when games finish, hard-
 * bounded by the daily scores cap (§4). Reserving ~10% of that daily cap over
 * a month keeps the projection honest without crowding out scanning — the
 * proposal's own 10% budget reserve is the real safety margin.
 */
const SCORE_POLL_CREDITS_PER_MONTH = Math.round(SCORES_DAILY_CREDIT_CAP * 0.1 * 30);

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

  /**
   * The weekly deterministic proposal (MODEL, propose-only), computed fresh
   * from current history. 409 (conflict) until ≥7 days of scan history exist —
   * the optimizer needs a week of paired-scan data to beat the seed.
   */
  router.get('/proposal', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const at = now();
      const [settings, scans, records] = await Promise.all([
        deps.settings.read(),
        allScans(deps),
        deps.records(),
      ]);
      const historyDays = historyDaysSpan(scans);
      if (historyDays < PROPOSAL_MIN_HISTORY_DAYS) {
        res.status(409).json(
          errorBody(
            'conflict',
            `The weekly optimizer needs at least ${PROPOSAL_MIN_HISTORY_DAYS} days of scan history — it has ${historyDays.toFixed(1)}. Keep scanning and check back.`,
          ),
        );
        return;
      }
      const { hitRate } = confirmationHitRate(scans, at);
      res.json(
        computeProposal({
          now: at,
          confirmedRecords: records.filter((r) => r.confirmation?.status === 'confirmed'),
          scanHistory: scans,
          monthlyBudget: settings.monthlyCreditBudget,
          hitRate,
          creditsPerScan: latestCreditsPerScan(scans),
          scorePollCreditsPerMonth: SCORE_POLL_CREDITS_PER_MONTH,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * Apply a proposal's blocks — the ONLY path that writes scheduler.blocks,
   * and never auto-applied (explicit user confirmation only). Stamps
   * proposalAppliedAt and wakes the scheduler. Returns the updated settings.
   */
  router.post('/proposal/apply', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseBlocks((req.body as { blocks?: unknown } | undefined)?.blocks);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const at = now();
      const updated = await deps.settings.update((data) => {
        const next: OpsSettings = {
          ...data,
          scheduler: {
            ...data.scheduler,
            blocks: parsed.blocks,
            proposalAppliedAt: at.toISOString(),
          },
        };
        return { data: next, result: next };
      });
      deps.onSchedulerChange?.();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Validate an apply body's blocks — this router is the sole writer of
 *  scheduler.blocks, so it validates strictly. */
function parseBlocks(
  raw: unknown,
): { ok: true; blocks: SchedulerBlock[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: 'blocks must be a non-empty array' };
  }
  const blocks: SchedulerBlock[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, message: 'each block must be an object' };
    }
    const b = entry as Record<string, unknown>;
    const days = b.days;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    ) {
      return { ok: false, message: 'block.days must be a non-empty array of weekdays 0–6' };
    }
    if (
      !isIntIn(b.startMin, 0, 1440) ||
      !isIntIn(b.endMin, 0, 1440) ||
      (b.startMin as number) >= (b.endMin as number)
    ) {
      return { ok: false, message: 'block needs startMin < endMin, both 0–1440' };
    }
    if (!isIntIn(b.intervalMins, 1, 1440)) {
      return { ok: false, message: 'block.intervalMins must be 1–1440' };
    }
    blocks.push({
      days: [...new Set(days as number[])].sort((x, y) => x - y),
      startMin: b.startMin as number,
      endMin: b.endMin as number,
      intervalMins: b.intervalMins as number,
    });
  }
  return { ok: true, blocks };
}

function isIntIn(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
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
