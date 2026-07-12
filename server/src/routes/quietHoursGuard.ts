/**
 * Route-level quiet-hours guard. Phase-16 rule: zero Odds API calls of ANY
 * kind 01:00–08:00 America/Vancouver — including MANUAL scans and cockpit
 * re-verify (the scheduler's own scans/polls are blocked upstream in
 * plan.ts). index.ts mounts this in front of exactly those provider-spending
 * POST routes so it stays out of every other router's unit tests; the clock
 * is injectable so the guard's own test is deterministic.
 */
import type { NextFunction, Request, Response } from 'express';
import { QUIET_HOURS_MESSAGE, isQuietHours } from '../scheduler/vancouverTime';
import { errorBody } from './api';

export function quietHoursGuard(
  now: () => Date = () => new Date(),
): (req: Request, res: Response, next: NextFunction) => void {
  return (_req, res, next) => {
    if (isQuietHours(now())) {
      res.status(503).json(errorBody('quiet_hours', QUIET_HOURS_MESSAGE));
      return;
    }
    next();
  };
}
