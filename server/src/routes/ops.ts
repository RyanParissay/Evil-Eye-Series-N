/**
 * HTTP boundary for the evidence layer: cadence settings, coverage,
 * survival, telemetry, and the proving-month scoreboard. NO provider in
 * the dependency graph — every number derives from persisted data, so
 * this router cannot spend a credit (structural, like advanced mode).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  BookmakerConfig,
  Leaderboard,
  LedgerSummary,
  OpportunityRecord,
  OpsSettings,
  ScanLogEntry,
  ScanMeta,
  ScanWindow,
  SchedulerSettings,
  Scoreboard,
} from '@shared/types';
import { regionTabByKey, type RegionTabConfig } from '@shared/regionTabs';
import {
  BENCHMARK_BOOKS,
  CONFIRMATION_ASSUMED_HIT_RATE,
  CONFIRMATION_HIT_RATE_MIN_SAMPLES,
  CONFIRMATION_HIT_RATE_WINDOW_MS,
  DEFAULT_CONFIRMATION_INTERVAL_SECS,
  MAX_TOP_N,
} from '../config/constants';
import { computeCoverage } from '../ops/coverageService';
import { buildScanBrowser } from '../ops/scanBrowser';
import { computeSurvival } from '../ops/survivalService';
import { computeTelemetry } from '../ops/telemetryService';
import {
  CONFIRMATION_INTERVAL_MAX_SECS,
  CONFIRMATION_INTERVAL_MIN_SECS,
  seedScanParams,
  type OpsSettingsStore,
} from '../ops/opsStore';

/** The PATCH body shape: any top-level setting, plus a PARTIAL scheduler
 *  (the client sends just `enabled` / `scanParams`, deep-merged in). */
type OpsPatch = Partial<Omit<OpsSettings, 'scheduler'>> & { scheduler?: Partial<SchedulerSettings> };
import type { OddsSnapshot } from '../scan/snapshotStore';
import { errorBody } from './api';

export interface OpsRouterDeps {
  settings: OpsSettingsStore;
  scanHistory: {
    lastN(n: number): Promise<ScanLogEntry[]>;
    entries(): AsyncGenerator<ScanLogEntry>;
  };
  books: { list(): Promise<BookmakerConfig[]> };
  /** Live fetch plan for the cost estimate. */
  fetchPlan: (tab: RegionTabConfig) => Promise<{ bookmakersParam: string[] | undefined }>;
  /** Latest raw snapshot — per-sport benchmark reach derives from it. */
  snapshots: { read(): Promise<OddsSnapshot | null> };
  /** Every record, active + archived (survival and telemetry need history). */
  records: () => Promise<OpportunityRecord[]>;
  ledger: () => Promise<Pick<LedgerSummary, 'realized' | 'captureRate'>>;
  paper: () => Promise<Scoreboard['paper']>;
  lastUsage: () => Promise<{ requestsUsedTotal: number | null }>;
  /** Book leaderboard (ops/leaderboardStore.ts) — zero credits, structural. */
  leaderboard: { read(): Promise<Leaderboard> };
  /** Called after a settings PATCH that touched `scheduler`, so the running
   *  scheduler re-plans immediately (e.g. the enable toggle). */
  onSchedulerChange?: () => void;
  /** Latest scan's meta — used to seed scheduler.scanParams when the
   *  scheduler is enabled without explicit params (Phase-16 design). */
  latestScanMeta?: () => Promise<Pick<ScanMeta, 'regionTab' | 'topN'> | null>;
  now?: () => Date;
}

const DEFAULT_COVERAGE_N = 50;
const DEFAULT_SCANS_N = 20;

export function createOpsRouter(deps: OpsRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.settings.read());
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseOpsPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const { scheduler: schedPatch, ...rest } = parsed.patch;
      const updated = await deps.settings.update(async (data) => {
        const next: OpsSettings = { ...data, ...rest };
        if (schedPatch) {
          const merged: SchedulerSettings = { ...data.scheduler, ...schedPatch };
          // Re-enabling clears the self-disable reason (unless one is given).
          if (schedPatch.enabled === true && !('disabledReason' in schedPatch)) {
            merged.disabledReason = null;
          }
          // Enable without explicit params → seed scope from the last scan.
          if (schedPatch.enabled === true && !('scanParams' in schedPatch)) {
            const meta = deps.latestScanMeta ? await deps.latestScanMeta() : null;
            merged.scanParams = seedScanParams(meta);
          }
          next.scheduler = merged;
        }
        return { data: next, result: next };
      });
      if (schedPatch) deps.onSchedulerChange?.();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Pre-scan cost, computed from the LIVE fetch plan and enabled markets —
   * "never silently" made concrete: the number moves when a toggle does.
   */
  router.get('/cost-estimate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tab = regionTabByKey(String(req.query.regionTab ?? ''));
      const topN = clampInt(Number(req.query.topN), 1, 10) ?? 5;
      if (!tab) {
        res.status(400).json(errorBody('bad_request', 'regionTab required'));
        return;
      }
      const [settings, plan, scans] = await Promise.all([
        deps.settings.read(),
        deps.fetchPlan(tab),
        allScans(deps),
      ]);
      const regionEquivalents = plan.bookmakersParam
        ? Math.ceil(plan.bookmakersParam.length / 10)
        : tab.apiRegions.length;
      const marketCount = 1 + Number(settings.markets.totals) + Number(settings.markets.spreads);
      const creditsPerScan = marketCount * regionEquivalents * topN;
      // Phase 16 Part A: the conditional pair. Scan B costs the same as A
      // and fires only when A left candidates, so the honest per-window
      // number is cost(A) + hitRate × cost(B). The plain per-scan number
      // stays visible alongside it.
      const { hitRate, source, samples } = confirmationHitRate(scans, now());
      res.json({
        regionTab: tab.key,
        topN,
        marketCount,
        regionEquivalents,
        creditsPerSport: marketCount * regionEquivalents,
        creditsPerScan,
        confirmation: {
          intervalSecs:
            settings.scheduler.confirmationIntervalSecs ?? DEFAULT_CONFIRMATION_INTERVAL_SECS,
          hitRate,
          hitRateSource: source,
          samples,
          creditsPerPairWindow: Math.round(creditsPerScan * (1 + hitRate) * 100) / 100,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Phase 15 #2: past scans newest-first, each carrying its opportunities
   * (drill-down, matched by detection/sighting slot — see scanBrowser.ts)
   * and its Phase-13 gap indicator. Zero credits, like every /api/ops route.
   */
  router.get('/scans', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lastN = clampInt(Number(req.query.lastN), 1, 200) ?? DEFAULT_SCANS_N;
      const [scans, records, settings] = await Promise.all([
        allScans(deps),
        deps.records(),
        deps.settings.read(),
      ]);
      res.json({ scans: buildScanBrowser(scans, lastN, records, settings, now()) });
    } catch (err) {
      next(err);
    }
  });

  /** Phase 15 #1: per-book appearances + opportunity-leg counts by strategy,
   *  accrued per scan. Zero credits — no provider in this route's deps. */
  router.get('/leaderboard', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.leaderboard.read());
    } catch (err) {
      next(err);
    }
  });

  router.get('/coverage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lastN = clampInt(Number(req.query.lastN), 1, 500) ?? DEFAULT_COVERAGE_N;
      const [scans, books, snapshot] = await Promise.all([
        deps.scanHistory.lastN(lastN),
        deps.books.list(),
        deps.snapshots.read(),
      ]);
      res.json(computeCoverage(scans, books, lastN, { keys: BENCHMARK_BOOKS, snapshot }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/survival', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, scans] = await Promise.all([deps.records(), allScans(deps)]);
      res.json(computeSurvival(records, scans, now()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/telemetry', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(computeTelemetry(await deps.records()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/scoreboard', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [settings, records, scans, ledger, paper, usage] = await Promise.all([
        deps.settings.read(),
        deps.records(),
        allScans(deps),
        deps.ledger(),
        deps.paper(),
        deps.lastUsage(),
      ]);
      const survival = computeSurvival(records, scans, now());
      const telemetry = computeTelemetry(records);
      res.json({
        paper,
        realProfit: ledger.realized.totalLockedProfit,
        captureRate: ledger.captureRate,
        medianArbLifetimeMs: survival.lifetime.medianMs,
        medianAlertToVerifyMs: telemetry.alertToVerify.medianMs,
        credits: creditsState(settings, usage.requestsUsedTotal, now()),
      } satisfies Scoreboard);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function allScans(deps: OpsRouterDeps): Promise<ScanLogEntry[]> {
  const scans: ScanLogEntry[] = [];
  for await (const entry of deps.scanHistory.entries()) scans.push(entry);
  return scans;
}

/**
 * Share of the last 14 days' scans that left ≥1 confirmation candidate
 * (i.e. bought a scan B). MEASURED once ≥50 in-window lines carry the
 * candidates field; pre-Phase-16 lines never count. Below the bar it is
 * the ASSUMED 30% — the same measured-vs-assumed honesty idiom as the
 * paper haircut.
 */
export function confirmationHitRate(
  scans: ScanLogEntry[],
  now: Date,
): { hitRate: number; source: 'measured' | 'assumed'; samples: number } {
  const cutoff = now.getTime() - CONFIRMATION_HIT_RATE_WINDOW_MS;
  const window = scans.filter(
    (s) => s.confirmationCandidates != null && Date.parse(s.scannedAt) >= cutoff,
  );
  if (window.length >= CONFIRMATION_HIT_RATE_MIN_SAMPLES) {
    const hits = window.filter((s) => (s.confirmationCandidates ?? 0) > 0).length;
    return {
      hitRate: Math.round((hits / window.length) * 10_000) / 10_000,
      source: 'measured',
      samples: window.length,
    };
  }
  return { hitRate: CONFIRMATION_ASSUMED_HIT_RATE, source: 'assumed', samples: window.length };
}

/** Month-to-date burn → naive calendar-month projection + stop state. */
export function creditsState(
  settings: OpsSettings,
  usedTotal: number | null,
  now: Date,
): Scoreboard['credits'] {
  let projectedMonthEnd: number | null = null;
  if (usedTotal != null) {
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const elapsed = (now.getTime() - monthStart) / (monthEnd - monthStart);
    projectedMonthEnd = elapsed > 0 ? Math.round(usedTotal / elapsed) : usedTotal;
  }
  return {
    usedTotal,
    budget: settings.monthlyCreditBudget,
    projectedMonthEnd,
    autoStopEngaged:
      usedTotal != null &&
      usedTotal >= (settings.autoStopPct / 100) * settings.monthlyCreditBudget,
  };
}

function parseOpsPatch(
  body: unknown,
): { ok: true; patch: OpsPatch } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: OpsPatch = {};

  for (const key of ['weekday', 'weekend'] as const) {
    if (!(key in raw)) continue;
    const window = raw[key] as Partial<ScanWindow>;
    if (
      !isMinutes(window?.startMinutes) ||
      !isMinutes(window?.endMinutes) ||
      window.startMinutes === window.endMinutes
    ) {
      return { ok: false, message: `${key} window needs distinct start/end minutes in 0–1440` };
    }
    patch[key] = { startMinutes: window.startMinutes!, endMinutes: window.endMinutes! };
  }
  if ('inWindowMins' in raw) {
    if (!isIntIn(raw.inWindowMins, 1, 240)) {
      return { ok: false, message: 'inWindowMins must be 1–240' };
    }
    patch.inWindowMins = raw.inWindowMins as number;
  }
  if ('outWindowMins' in raw) {
    if (raw.outWindowMins !== null && !isIntIn(raw.outWindowMins, 5, 720)) {
      return { ok: false, message: 'outWindowMins must be null (off) or 5–720' };
    }
    patch.outWindowMins = raw.outWindowMins as number | null;
  }
  if ('monthlyCreditBudget' in raw) {
    if (!isIntIn(raw.monthlyCreditBudget, 100, 10_000_000)) {
      return { ok: false, message: 'monthlyCreditBudget must be a positive credit count' };
    }
    patch.monthlyCreditBudget = raw.monthlyCreditBudget as number;
  }
  if ('autoStopPct' in raw) {
    if (!isIntIn(raw.autoStopPct, 10, 100)) {
      return { ok: false, message: 'autoStopPct must be 10–100' };
    }
    patch.autoStopPct = raw.autoStopPct as number;
  }
  if ('markets' in raw) {
    const markets = raw.markets as { totals?: unknown; spreads?: unknown };
    if (typeof markets?.totals !== 'boolean' || typeof markets?.spreads !== 'boolean') {
      return { ok: false, message: 'markets must be { totals: boolean, spreads: boolean }' };
    }
    patch.markets = { totals: markets.totals, spreads: markets.spreads };
  }
  if ('scheduler' in raw) {
    const parsed = parseSchedulerPatch(raw.scheduler);
    if (!parsed.ok) return parsed;
    patch.scheduler = parsed.patch;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
  return { ok: true, patch };
}

/** The scanner-page toggle (Phase 16) PATCHes scheduler.enabled here, and may
 *  carry the current scan scope. Blocks are edited by WP3's optimizer route,
 *  not this validator. */
function parseSchedulerPatch(
  raw: unknown,
): { ok: true; patch: Partial<SchedulerSettings> } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'scheduler must be an object' };
  }
  const sched = raw as Record<string, unknown>;
  const patch: Partial<SchedulerSettings> = {};
  if ('enabled' in sched) {
    if (typeof sched.enabled !== 'boolean') {
      return { ok: false, message: 'scheduler.enabled must be boolean' };
    }
    patch.enabled = sched.enabled;
  }
  if ('scanParams' in sched) {
    const sp = sched.scanParams as { regionTab?: unknown; topN?: unknown } | null;
    if (
      typeof sp !== 'object' ||
      sp === null ||
      typeof sp.regionTab !== 'string' ||
      !regionTabByKey(sp.regionTab) ||
      !isIntIn(sp.topN, 1, MAX_TOP_N)
    ) {
      return {
        ok: false,
        message: `scheduler.scanParams needs a valid regionTab and topN 1–${MAX_TOP_N}`,
      };
    }
    patch.scanParams = { regionTab: sp.regionTab, topN: sp.topN as number };
  }
  if ('disabledReason' in sched) {
    if (sched.disabledReason !== null && typeof sched.disabledReason !== 'string') {
      return { ok: false, message: 'scheduler.disabledReason must be a string or null' };
    }
    patch.disabledReason = sched.disabledReason as string | null;
  }
  if ('confirmationIntervalSecs' in sched) {
    if (
      !isIntIn(
        sched.confirmationIntervalSecs,
        CONFIRMATION_INTERVAL_MIN_SECS,
        CONFIRMATION_INTERVAL_MAX_SECS,
      )
    ) {
      return {
        ok: false,
        message: `scheduler.confirmationIntervalSecs must be ${CONFIRMATION_INTERVAL_MIN_SECS}–${CONFIRMATION_INTERVAL_MAX_SECS} seconds`,
      };
    }
    patch.confirmationIntervalSecs = sched.confirmationIntervalSecs as number;
  }
  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      message:
        'scheduler patch must set enabled, scanParams, disabledReason, or confirmationIntervalSecs',
    };
  }
  return { ok: true, patch };
}

function isMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1440;
}

function isIntIn(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
}

function clampInt(value: number, lo: number, hi: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(lo, Math.min(hi, Math.round(value)));
}
