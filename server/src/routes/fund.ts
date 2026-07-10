/**
 * HTTP boundary for fund settings and the position panel.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { FundPosition, FundSettings } from '@shared/types';
import type { FundService } from '../fund/fundService';
import { errorBody } from './api';

export interface FundRouterDeps {
  fund: FundService;
  assemblePosition: () => Promise<FundPosition>;
}

export function createFundRouter(deps: FundRouterDeps): Router {
  const router = Router();

  router.get('/position', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.assemblePosition());
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseFundPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      await deps.fund.patchSettings(parsed.patch);
      res.json(await deps.assemblePosition());
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseFundPatch(
  body: unknown,
): { ok: true; patch: Partial<FundSettings> } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<FundSettings> = {};
  for (const field of ['totalBankroll', 'defaultStake', 'unallocatedCash'] as const) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${field} must be a non-negative dollar amount` };
    }
    patch[field] = value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
  return { ok: true, patch };
}
