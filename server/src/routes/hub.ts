/**
 * Analytics Hub HTTP boundary (Phase 16 Part B — SIMULATED). Profile CRUD +
 * per-profile reports + the three strategy leaderboards. Zero provider deps:
 * every number derives from persisted records + accrued leaderboard counts
 * (structural zero-credit, same shape as routes/portfolios.ts). Premades are
 * editable but 409 on delete.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { HubLeaderboards } from '@shared/types';
import { HubService, parseProfileInput, parseProfilePatch } from '../hub/hubService';
import { errorBody } from './api';

export interface HubRouterDeps {
  hub: HubService;
  leaderboards: () => Promise<HubLeaderboards>;
}

export function createHubRouter(deps: HubRouterDeps): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ reports: await deps.hub.reports() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/profiles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseProfileInput(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      res.status(201).json(await deps.hub.createProfile(parsed.value));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/profiles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseProfilePatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const updated = await deps.hub.updateProfile(req.params.id, parsed.value);
      if (!updated) {
        res.status(404).json(errorBody('not_found', `Unknown profile: ${req.params.id}`));
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/profiles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.hub.deleteProfile(req.params.id);
      if (result === 'premade') {
        res.status(409).json(errorBody('conflict', 'Premade profiles cannot be deleted'));
        return;
      }
      if (result === 'not_found') {
        res.status(404).json(errorBody('not_found', `Unknown profile: ${req.params.id}`));
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/leaderboards', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.leaderboards());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
