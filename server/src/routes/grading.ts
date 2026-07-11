/**
 * HTTP boundary for score polling + grading (Phase 13). GRADING_RULES.md is
 * binding. Manual override lives here too (id in the body) rather than
 * under /api/opportunities, so this router stays self-contained with only
 * GradingService as its write path.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GradeResult, OpportunityRecord, OpsSettings, ScanLogEntry } from '@shared/types';
import { SCORES_DAILY_CREDIT_CAP } from '../config/gradingRules';
import { gradingBuckets, type GradingOutcome, type PollSummary } from '../grading/gradingService';
import type { GradingData } from '../grading/gradingStore';
import { detectScanGaps } from '../ops/gapDetector';
import { errorBody } from './api';

const RESULTS: readonly GradeResult[] = ['win', 'loss', 'push', 'void'];

export interface GradingRouterDeps {
  service: {
    poll(): Promise<PollSummary>;
    manualGrade(id: string, result: GradeResult, note?: string): Promise<GradingOutcome>;
  };
  /** Every active-file record — buckets classify across all of them. */
  records: () => Promise<OpportunityRecord[]>;
  gradingStore: { read(): Promise<GradingData> };
  scanHistory: { entries(): AsyncGenerator<ScanLogEntry> };
  opsSettings: { read(): Promise<OpsSettings> };
  now?: () => Date;
}

export function createGradingRouter(deps: GradingRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.post('/poll', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await deps.service.poll();
      const scoresSpendToday = await todaySpend(deps.gradingStore, now());
      res.json({ ...summary, scoresSpendToday, cap: SCORES_DAILY_CREDIT_CAP });
    } catch (err) {
      next(err);
    }
  });

  router.post('/manual-grade', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, result, note } = (req.body ?? {}) as { id?: unknown; result?: unknown; note?: unknown };
      if (typeof id !== 'string' || id.length === 0) {
        res.status(400).json(errorBody('bad_request', 'id (string) required'));
        return;
      }
      if (!RESULTS.includes(result as GradeResult)) {
        res.status(400).json(errorBody('bad_request', `result must be one of: ${RESULTS.join(', ')}`));
        return;
      }
      if (note !== undefined && typeof note !== 'string') {
        res.status(400).json(errorBody('bad_request', 'note must be a string'));
        return;
      }
      const outcome = await deps.service.manualGrade(id, result as GradeResult, note as string | undefined);
      if (!outcome.ok) {
        const httpStatus =
          outcome.reason === 'not_found' ? 404 : outcome.reason === 'conflict' ? 409 : 400;
        res.status(httpStatus).json(errorBody(outcome.reason, outcome.message));
        return;
      }
      res.json(outcome.record);
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, scoresSpendToday, opsSettings, scans] = await Promise.all([
        deps.records(),
        todaySpend(deps.gradingStore, now()),
        deps.opsSettings.read(),
        collectScans(deps.scanHistory),
      ]);
      res.json({
        buckets: gradingBuckets(records),
        scoresSpendToday,
        cap: SCORES_DAILY_CREDIT_CAP,
        capped: scoresSpendToday >= SCORES_DAILY_CREDIT_CAP,
        gaps: detectScanGaps(scans, opsSettings, now()),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function todaySpend(store: { read(): Promise<GradingData> }, now: Date): Promise<number> {
  const { daily } = await store.read();
  const today = now.toISOString().slice(0, 10);
  return daily.date === today ? daily.credits : 0;
}

async function collectScans(scanHistory: { entries(): AsyncGenerator<ScanLogEntry> }): Promise<ScanLogEntry[]> {
  const scans: ScanLogEntry[] = [];
  for await (const entry of scanHistory.entries()) scans.push(entry);
  return scans;
}
