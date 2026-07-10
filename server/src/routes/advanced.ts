/**
 * Advanced mode HTTP boundary: preset CRUD + snapshot recompute.
 * Recompute's dependency set deliberately contains NO odds provider —
 * zero credits is structural, not a code path to get wrong.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BookmakerConfig, OpportunityRecord } from '@shared/types';
import type { OddsSnapshot } from '../scan/snapshotStore';
import { detectOpportunities } from '../scan/detection';
import { PresetService, resolvePresetKeys } from '../presets/presetService';
import { errorBody } from './api';

export interface AdvancedDeps {
  presets: PresetService;
  snapshots: { read(): Promise<OddsSnapshot | null> };
  opportunities: { list(): Promise<OpportunityRecord[]> };
  books: { list(): Promise<BookmakerConfig[]> };
  now?: () => Date;
}

const MAX_NAME_LENGTH = 60;

export function createAdvancedRouter(deps: AdvancedDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/presets', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ presets: await deps.presets.list() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/presets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, bookmakerKeys } = (req.body ?? {}) as {
        name?: unknown;
        bookmakerKeys?: unknown;
      };
      if (!isValidName(name) || !isKeyList(bookmakerKeys) || bookmakerKeys.length === 0) {
        res
          .status(400)
          .json(errorBody('bad_request', 'name (≤60 chars) and a non-empty bookmakerKeys list required'));
        return;
      }
      res.json(await deps.presets.create(name.trim(), bookmakerKeys));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/presets/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = (req.body ?? {}) as { name?: unknown };
      if (!isValidName(name)) {
        res.status(400).json(errorBody('bad_request', 'name (≤60 chars) required'));
        return;
      }
      const renamed = await deps.presets.rename(req.params.id, name.trim());
      if (!renamed) {
        res.status(404).json(errorBody('not_found', `Unknown preset: ${req.params.id}`));
        return;
      }
      res.json(renamed);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/presets/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await deps.presets.delete(req.params.id))) {
        res.status(404).json(errorBody('not_found', `Unknown preset: ${req.params.id}`));
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/advanced/recompute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { presetId, bookmakerKeys } = (req.body ?? {}) as {
        presetId?: unknown;
        bookmakerKeys?: unknown;
      };
      const byPreset = typeof presetId === 'string';
      const byKeys = isKeyList(bookmakerKeys);
      if (byPreset === byKeys) {
        res
          .status(400)
          .json(errorBody('bad_request', 'Provide exactly one of presetId or bookmakerKeys[]'));
        return;
      }

      let keys: string[];
      if (byPreset) {
        const preset = await deps.presets.get(presetId as string);
        if (!preset) {
          res.status(404).json(errorBody('not_found', `Unknown preset: ${presetId}`));
          return;
        }
        keys = resolvePresetKeys(preset, await deps.books.list());
        await deps.presets.touch(preset.id);
      } else {
        keys = bookmakerKeys as string[];
      }

      const snapshot = await deps.snapshots.read();
      if (!snapshot) {
        // Nothing scanned yet is a normal state, not an error.
        res.json({ snapshot: null, opportunities: [], knownRecordIds: [], bookmakerKeys: keys });
        return;
      }

      const opportunities = detectOpportunities(snapshot.events, keys, {
        now: now(),
        marketKeys: snapshot.markets,
        topN: Number.MAX_SAFE_INTEGER, // recompute shows everything; the scan slider doesn't apply
      });

      // The cockpit only exists for persisted records; tell the client which
      // of these ids are real so it never renders a dead deep link.
      const records = await deps.opportunities.list();
      const recordIds = new Set(records.map((r) => r.id));
      const knownRecordIds = opportunities
        .map((o) => o.id)
        .filter((id): id is string => id != null && recordIds.has(id));

      res.json({
        snapshot: {
          fetchedAt: snapshot.fetchedAt,
          regionTab: snapshot.regionTab,
          sportsScanned: snapshot.sportsScanned,
        },
        opportunities,
        knownRecordIds,
        bookmakerKeys: keys,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_NAME_LENGTH;
}

function isKeyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((k) => typeof k === 'string');
}
