/**
 * HTTP boundary for persisted opportunities. Read-only in Phase 2; the
 * Phase-3 cockpit adds re-verify and leg-tracking mutations.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { OpportunityStatus } from '@shared/types';
import type { OpportunityService } from '../opportunities/opportunityService';
import { errorBody } from './api';

const STATUSES: readonly OpportunityStatus[] = ['active', 'degraded', 'dead', 'completed'];

export function createOpportunitiesRouter(service: OpportunityService): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.query.status;
      let status: OpportunityStatus | undefined;
      if (raw !== undefined) {
        if (typeof raw !== 'string' || !STATUSES.includes(raw as OpportunityStatus)) {
          res
            .status(400)
            .json(errorBody('bad_request', `status must be one of: ${STATUSES.join(', ')}`));
          return;
        }
        status = raw as OpportunityStatus;
      }
      res.json({ opportunities: await service.list(status) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await service.get(req.params.id);
      if (!record) {
        res.status(404).json(errorBody('bad_request', `Unknown opportunity: ${req.params.id}`));
        return;
      }
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
