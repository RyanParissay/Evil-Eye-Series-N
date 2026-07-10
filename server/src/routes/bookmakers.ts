/**
 * HTTP boundary for the bookmaker registry. GET lists what the feed has
 * surfaced; PATCH edits the manual fields (enabled/balance/status/notes).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BookmakerService } from '../bookmakers/bookmakerService';
import { parseBookmakerPatch } from '../bookmakers/bookmakerRequests';
import { errorBody } from './api';

export function createBookmakersRouter(service: BookmakerService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ bookmakers: await service.list() });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseBookmakerPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const updated = await service.patch(req.params.key, parsed.patch);
      if (!updated) {
        res
          .status(404)
          .json(errorBody('bad_request', `Unknown bookmaker: ${req.params.key} (run a scan first)`));
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
