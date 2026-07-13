/**
 * CLV read model HTTP boundary (Phase 18): GET /api/clv/summary. Read-only,
 * zero credits — the summary is a pure aggregation over persisted records and
 * the current safety settings (no provider anywhere in its dependency graph).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { OpportunityRecord, SafetySettings } from '@shared/types';
import { computeClvSummary } from '../clv/clvSummary';

export interface ClvRouterDeps {
  /** Full record stream, active + archived (ledgerService.allRecordsList). */
  records: () => Promise<OpportunityRecord[]>;
  /** The one SafetySettings object — the 'filtered' gate is evaluated LIVE. */
  safetySettings: () => Promise<SafetySettings>;
  now?: () => Date;
}

export function createClvRouter(deps: ClvRouterDeps): Router {
  const now = deps.now ?? (() => new Date());
  const router = Router();

  router.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, safetySettings] = await Promise.all([deps.records(), deps.safetySettings()]);
      res.json(computeClvSummary({ records, safetySettings, now: now() }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
