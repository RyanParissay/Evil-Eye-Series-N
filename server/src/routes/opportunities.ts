/**
 * HTTP boundary for persisted opportunities: list/detail reads plus the
 * cockpit's status mutations (degraded/completed — scans own active/dead).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { OpportunityStatus } from '@shared/types';
import type { CockpitStatus } from '../opportunities/opportunityLifecycle';
import type { OpportunityService } from '../opportunities/opportunityService';
import type { VerifyOutcome } from '../opportunities/verifyService';
import { errorBody } from './api';

const STATUSES: readonly OpportunityStatus[] = ['active', 'degraded', 'dead', 'completed'];
const COCKPIT_STATUSES: readonly CockpitStatus[] = ['degraded', 'completed'];

/** verifyOpportunity with its deps already bound (wired in index.ts). */
export type VerifyRunner = (id: string) => Promise<VerifyOutcome>;

export function createOpportunitiesRouter(service: OpportunityService, verify: VerifyRunner): Router {
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
        res.status(404).json(errorBody('not_found', `Unknown opportunity: ${req.params.id}`));
        return;
      }
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outcome = await verify(req.params.id);
      if (!outcome.ok) {
        const httpStatus =
          outcome.reason === 'not_found' ? 404 : outcome.reason === 'conflict' ? 409 : 400;
        res.status(httpStatus).json(errorBody(outcome.reason, outcome.message));
        return;
      }
      const { record, legOdds, creditsCharged } = outcome;
      res.json({ record, legOdds, creditsCharged });
    } catch (err) {
      next(err); // ProviderError maps in apiErrorHandler, same as /api/scan
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, filledLegs } = (req.body ?? {}) as { status?: unknown; filledLegs?: unknown };
      if (!COCKPIT_STATUSES.includes(status as CockpitStatus)) {
        res
          .status(400)
          .json(errorBody('bad_request', `status must be one of: ${COCKPIT_STATUSES.join(', ')}`));
        return;
      }
      if (filledLegs !== undefined && !isFilledLegs(filledLegs)) {
        res
          .status(400)
          .json(errorBody('bad_request', 'filledLegs must be [{ odds > 1, stake ≥ 0 }, …]'));
        return;
      }
      const outcome = await service.updateStatus(
        req.params.id,
        status as CockpitStatus,
        filledLegs,
      );
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

  return router;
}

function isFilledLegs(value: unknown): value is Array<{ odds: number; stake: number }> {
  return (
    Array.isArray(value) &&
    value.every(
      (leg) =>
        leg != null &&
        typeof leg === 'object' &&
        typeof (leg as { odds?: unknown }).odds === 'number' &&
        (leg as { odds: number }).odds > 1 &&
        typeof (leg as { stake?: unknown }).stake === 'number' &&
        (leg as { stake: number }).stake >= 0 &&
        Number.isFinite((leg as { stake: number }).stake),
    )
  );
}
