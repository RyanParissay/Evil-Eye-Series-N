/**
 * Middles HTTP boundary: settings + the board. Provider-free by
 * construction — the board reads persisted records.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { FundSettings, MiddlesSettings, OpportunityRecord } from '@shared/types';
import { errorBody } from './api';

export interface MiddlesSettingsStore {
  read(): Promise<MiddlesSettings>;
  update<T>(
    mutate: (data: MiddlesSettings) => { data: MiddlesSettings; result: T } | Promise<{ data: MiddlesSettings; result: T }>,
  ): Promise<T>;
}

export interface MiddlesRouterDeps {
  settings: MiddlesSettingsStore;
  opportunities: { list(status?: 'active'): Promise<OpportunityRecord[]> };
  fund: { settings(): Promise<FundSettings> };
}

export function createMiddlesRouter(deps: MiddlesRouterDeps): Router {
  const router = Router();

  router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.settings.read());
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseMiddlesPatch(req.body);
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

  /** Live middle records, lowest breakeven first. */
  router.get('/board', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, settings, fund] = await Promise.all([
        deps.opportunities.list('active'),
        deps.settings.read(),
        deps.fund.settings(),
      ]);
      const bets = records
        .filter((r) => r.status === 'active' && r.strategy === 'middle' && r.middle)
        .sort((a, b) => (a.middle?.breakevenPct ?? 99) - (b.middle?.breakevenPct ?? 99));
      res.json({ bets, settings, defaultStake: fund.defaultStake });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseMiddlesPatch(
  body: unknown,
): { ok: true; patch: Partial<MiddlesSettings> } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<MiddlesSettings> = {};
  if ('maxCostPct' in raw) {
    if (!isNumberIn(raw.maxCostPct, 0, 50)) return { ok: false, message: 'maxCostPct must be 0–50' };
    patch.maxCostPct = raw.maxCostPct as number;
  }
  if ('minWindow' in raw) {
    if (!isNumberIn(raw.minWindow, 0, 50)) return { ok: false, message: 'minWindow must be 0–50' };
    patch.minWindow = raw.minWindow as number;
  }
  if ('alertMaxBreakevenPct' in raw) {
    if (!isNumberIn(raw.alertMaxBreakevenPct, 0, 50)) {
      return { ok: false, message: 'alertMaxBreakevenPct must be 0–50' };
    }
    patch.alertMaxBreakevenPct = raw.alertMaxBreakevenPct as number;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
  return { ok: true, patch };
}

function isNumberIn(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
}
