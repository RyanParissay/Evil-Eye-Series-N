/**
 * HTTP boundary for the evidence layer: cadence settings, coverage,
 * survival, telemetry, and the proving-month scoreboard. NO provider in
 * the dependency graph — every number derives from persisted data, so
 * this router cannot spend a credit (structural, like advanced mode).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  BookmakerConfig,
  LedgerSummary,
  OpportunityRecord,
  OpsSettings,
  ScanLogEntry,
  ScanWindow,
  Scoreboard,
} from '@shared/types';
import { regionTabByKey, type RegionTabConfig } from '@shared/regionTabs';
import { BENCHMARK_BOOKS } from '../config/constants';
import { computeCoverage } from '../ops/coverageService';
import { buildScanBrowser } from '../ops/scanBrowser';
import { computeSurvival } from '../ops/survivalService';
import { computeTelemetry } from '../ops/telemetryService';
import type { OpsSettingsStore } from '../ops/opsStore';
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
      const updated = await deps.settings.update((data) => {
        const next = { ...data, ...parsed.patch };
        return { data: next, result: next };
      });
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
      const [settings, plan] = await Promise.all([
        deps.settings.read(),
        deps.fetchPlan(tab),
      ]);
      const regionEquivalents = plan.bookmakersParam
        ? Math.ceil(plan.bookmakersParam.length / 10)
        : tab.apiRegions.length;
      const marketCount = 1 + Number(settings.markets.totals) + Number(settings.markets.spreads);
      res.json({
        regionTab: tab.key,
        topN,
        marketCount,
        regionEquivalents,
        creditsPerSport: marketCount * regionEquivalents,
        creditsPerScan: marketCount * regionEquivalents * topN,
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
): { ok: true; patch: Partial<OpsSettings> } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<OpsSettings> = {};

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
  if ('confirmSecondSighting' in raw) {
    if (typeof raw.confirmSecondSighting !== 'boolean') {
      return { ok: false, message: 'confirmSecondSighting must be boolean' };
    }
    patch.confirmSecondSighting = raw.confirmSecondSighting;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
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
