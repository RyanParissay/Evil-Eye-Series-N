/**
 * HTTP boundary for the paper fund. Every payload carries simulated: true
 * — the client and any export must never present this as real money.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PaperSettings } from '@shared/types';
import type { PaperService } from '../paper/paperService';
import { errorBody } from './api';

export function createPaperRouter(service: PaperService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.book());
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseSettingsPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      res.json(await service.patchSettings(parsed.patch));
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.reset());
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseSettingsPatch(
  body: unknown,
): { ok: true; patch: Partial<PaperSettings> } | { ok: false; message: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<PaperSettings> = {};

  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') return { ok: false, message: 'enabled must be boolean' };
    patch.enabled = raw.enabled;
  }
  if ('startingBankroll' in raw) {
    if (!isPositive(raw.startingBankroll) || (raw.startingBankroll as number) > 10_000_000) {
      return { ok: false, message: 'startingBankroll must be a positive dollar amount' };
    }
    patch.startingBankroll = raw.startingBankroll as number;
  }
  if ('stakeRule' in raw) {
    const rule = raw.stakeRule as { kind?: unknown; value?: unknown };
    const kind = rule?.kind;
    if (kind !== 'flat' && kind !== 'percent') {
      return { ok: false, message: "stakeRule.kind must be 'flat' or 'percent'" };
    }
    if (!isPositive(rule.value) || (kind === 'percent' && (rule.value as number) > 100)) {
      return { ok: false, message: 'stakeRule.value must be positive (≤100 for percent)' };
    }
    patch.stakeRule = { kind, value: rule.value as number };
  }
  if ('haircutPercent' in raw) {
    if (!isPercent(raw.haircutPercent)) {
      return { ok: false, message: 'haircutPercent must be 0–100' };
    }
    patch.haircutPercent = raw.haircutPercent as number;
  }
  if ('thresholdPercent' in raw) {
    if (!isPercent(raw.thresholdPercent)) {
      return { ok: false, message: 'thresholdPercent must be 0–100' };
    }
    patch.thresholdPercent = raw.thresholdPercent as number;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: 'Empty settings patch' };
  return { ok: true, patch };
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPercent(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
