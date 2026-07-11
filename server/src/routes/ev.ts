/**
 * Risk Mode HTTP boundary: EV settings + the board (best upcoming EV
 * bets). Provider-free by construction — the board reads persisted
 * records; detection happens on the scan path.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { EvSettings, FundSettings, OpportunityRecord } from '@shared/types';
import { errorBody } from './api';

export interface EvSettingsStore {
  read(): Promise<EvSettings>;
  update<T>(
    mutate: (data: EvSettings) => { data: EvSettings; result: T } | Promise<{ data: EvSettings; result: T }>,
  ): Promise<T>;
}

export interface EvRouterDeps {
  settings: EvSettingsStore;
  opportunities: { list(status?: 'active'): Promise<OpportunityRecord[]> };
  fund: { settings(): Promise<FundSettings> };
}

export function createEvRouter(deps: EvRouterDeps): Router {
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
      const parsed = parseEvPatch(req.body);
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

  /** The best upcoming EV bets — live ev-strategy records, edge-first. */
  router.get('/board', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, settings, fund] = await Promise.all([
        deps.opportunities.list('active'),
        deps.settings.read(),
        deps.fund.settings(),
      ]);
      const bets = records
        .filter((r) => r.status === 'active' && r.strategy === 'ev' && r.ev)
        .sort((a, b) => (b.ev?.edgePct ?? 0) - (a.ev?.edgePct ?? 0));
      res.json({ bets, settings, defaultStake: fund.defaultStake });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseEvPatch(
  body: unknown,
): { ok: true; patch: Partial<EvSettings> } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<EvSettings> = {};

  for (const field of ['showMinEdgePct', 'alertMinEdgePct'] as const) {
    if (!(field in raw)) continue;
    if (!isNumberIn(raw[field], 0, 50)) return { ok: false, message: `${field} must be 0–50` };
    patch[field] = raw[field] as number;
  }
  if ('maxOdds' in raw) {
    if (!isNumberIn(raw.maxOdds, 1.1, 100)) return { ok: false, message: 'maxOdds must be 1.1–100' };
    patch.maxOdds = raw.maxOdds as number;
  }
  if ('maxBenchmarkAgeMins' in raw) {
    if (!isNumberIn(raw.maxBenchmarkAgeMins, 1, 240)) {
      return { ok: false, message: 'maxBenchmarkAgeMins must be 1–240' };
    }
    patch.maxBenchmarkAgeMins = raw.maxBenchmarkAgeMins as number;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
  return { ok: true, patch };
}

function isNumberIn(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
}
