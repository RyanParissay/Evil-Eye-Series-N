/**
 * HTTP boundary for Phase 14 paper portfolios: 13 parallel scenario series
 * replayed from the FULL opportunity stream (LedgerService.allRecordsList
 * — active + archived) plus the deterministic combo optimizer. Zero
 * provider deps — every number derives from persisted data (structural
 * zero-credit, same shape as routes/ops.ts and routes/advanced.ts).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { OpportunityRecord, OpsSettings, ScanLogEntry } from '@shared/types';
import { detectScanGaps } from '../ops/gapDetector';
import { evaluateWeights, optimizeWeights } from '../portfolios/optimizer';
import {
  perSignalReturns,
  runScenarios,
  type PortfolioGroup,
  type PortfolioSeries,
  type ScenarioReport,
} from '../portfolios/scenarioEngine';
import { errorBody } from './api';

/**
 * One representative series per strategy group feeds the optimizer — a
 * lead decision (docs/prompts/phase-14.md): the arb group is the 2%-edge
 * arb series, the EV group is the med-risk 5%-edge series, middles is its
 * one series. Both the data-sufficiency gate and the optimizer's input
 * return stream are read off these three series, so what's gated is
 * exactly what's optimized.
 */
const GROUP_REPRESENTATIVES: Record<PortfolioGroup, string> = {
  arb: 'arb_2',
  ev: 'ev_e5_med',
  middle: 'middle',
};

const MIN_GRADED_RECORDS = 30;
const MIN_SPAN_DAYS = 14;

export interface PortfolioRouterDeps {
  /** Every record, active + archived (LedgerService.allRecordsList). */
  records: () => Promise<OpportunityRecord[]>;
  scanHistory: { entries(): AsyncGenerator<ScanLogEntry> };
  opsSettings: { read(): Promise<OpsSettings> };
  now?: () => Date;
}

export interface GroupGate {
  records: { have: number; need: number };
  days: { have: number; need: number };
  met: boolean;
}

export interface OptimizerGates {
  arb: GroupGate;
  ev: GroupGate;
  middle: GroupGate;
  met: boolean;
}

export function createPortfolioRouter(deps: PortfolioRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await buildReport(deps, now());
      res.json({ ...report, optimizerGates: gatesFor(report.series) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/optimize', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await buildReport(deps, now());
      const gates = gatesFor(report.series);
      if (!gates.met) {
        res
          .status(400)
          .json(
            errorBody(
              'bad_request',
              'Optimizer gated: every group needs ≥30 graded records and 14 days of history.',
            ),
          );
        return;
      }

      const byKey = new Map(report.series.map((s) => [s.key, s]));
      const groups: PortfolioGroup[] = ['arb', 'ev', 'middle'];
      const seriesReturns = groups.map((group) =>
        perSignalReturns(byKey.get(GROUP_REPRESENTATIVES[group])!),
      );

      const rawWeights = (req.body as { weights?: unknown } | undefined)?.weights;
      if (rawWeights !== undefined) {
        const parsed = parseWeights(rawWeights);
        if (!parsed.ok) {
          res.status(400).json(errorBody('bad_request', parsed.message));
          return;
        }
        const evaluated = evaluateWeights(seriesReturns, parsed.weights);
        res.json({ weights: parsed.weights, ...evaluated, model: true });
        return;
      }

      const optimized = optimizeWeights(seriesReturns, 70);
      res.json({ ...optimized, model: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function buildReport(deps: PortfolioRouterDeps, now: Date): Promise<ScenarioReport> {
  const [records, scans, opsSettings] = await Promise.all([
    deps.records(),
    collectScans(deps.scanHistory),
    deps.opsSettings.read(),
  ]);
  const gaps = detectScanGaps(scans, opsSettings, now);
  return runScenarios(records, gaps);
}

async function collectScans(scanHistory: {
  entries(): AsyncGenerator<ScanLogEntry>;
}): Promise<ScanLogEntry[]> {
  const scans: ScanLogEntry[] = [];
  for await (const entry of scanHistory.entries()) scans.push(entry);
  return scans;
}

function gatesFor(series: PortfolioSeries[]): OptimizerGates {
  const byKey = new Map(series.map((s) => [s.key, s]));
  const arb = gateFor(byKey.get(GROUP_REPRESENTATIVES.arb)!);
  const ev = gateFor(byKey.get(GROUP_REPRESENTATIVES.ev)!);
  const middle = gateFor(byKey.get(GROUP_REPRESENTATIVES.middle)!);
  return { arb, ev, middle, met: arb.met && ev.met && middle.met };
}

/** Sample gate first (records), then the date-span gate — mirrors the
 *  phase-14.md ordering ("sample gate first"). */
function gateFor(series: PortfolioSeries): GroupGate {
  const have = series.records;
  const days =
    series.equity.length >= 2
      ? (Date.parse(series.equity[series.equity.length - 1].at) - Date.parse(series.equity[0].at)) /
        86_400_000
      : 0;
  const met = have >= MIN_GRADED_RECORDS && days >= MIN_SPAN_DAYS;
  return {
    records: { have, need: MIN_GRADED_RECORDS },
    days: { have: Math.round(days * 10) / 10, need: MIN_SPAN_DAYS },
    met,
  };
}

function parseWeights(raw: unknown): { ok: true; weights: number[] } | { ok: false; message: string } {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    !raw.every((w) => typeof w === 'number' && Number.isFinite(w) && w >= 0)
  ) {
    return { ok: false, message: 'weights must be [arbPct, evPct, middlePct], each a number ≥ 0' };
  }
  const sum = (raw as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.5) {
    return { ok: false, message: 'weights must sum to 100' };
  }
  return { ok: true, weights: (raw as number[]).map((w) => w / 100) };
}
