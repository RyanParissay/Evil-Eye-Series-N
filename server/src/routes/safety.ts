/**
 * Safety Score HTTP boundary (Phase 17): the settings config object +
 * rotation telemetry + the Cost of Safety readout. Provider-free by
 * construction — settings are a store read/write, rotation and cost are
 * pure computations over persisted records (zero credits structurally).
 *
 *   GET   /api/safety/settings  → the SafetySettings object
 *   PATCH /api/safety/settings  → validate shapes, reject bad → 'bad_request'
 *   GET   /api/safety/rotation  → the advisory RotationReport
 *   GET   /api/safety/cost      → SafetyCostReport (simulated: true) — what
 *                                 the gate declined at CURRENT settings,
 *                                 priced at the fund default stake
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { OpportunityRecord, SafetySettings } from '@shared/types';
import type { SafetySettingsStore } from '../ops/safetyStore';
import { computeSafetyCost } from '../safety/cost';
import { computeRotation } from '../safety/rotation';
import { errorBody } from './api';

export interface SafetyRouterDeps {
  settings: SafetySettingsStore;
  /** Full record stream (active + archived) — rotation's + cost's population. */
  records: () => Promise<OpportunityRecord[]>;
  /** Record ids with ≥1 Hub purchase (acted-on = alerted OR Hub-purchased). */
  hubPurchasedRecordIds: () => Promise<ReadonlySet<string>>;
  /** Fund default stake in dollars — the Cost of Safety pricing basis. */
  defaultStake: () => Promise<number>;
  now?: () => Date;
}

export function createSafetyRouter(deps: SafetyRouterDeps): Router {
  const now = deps.now ?? (() => new Date());
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
      const parsed = parseSafetyPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const updated = await deps.settings.update((data) => {
        const nextSettings = applyPatch(data, parsed.patch);
        return { data: nextSettings, result: nextSettings };
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.get('/cost', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [history, settings, defaultStake] = await Promise.all([
        deps.records(),
        deps.settings.read(),
        deps.defaultStake(),
      ]);
      res.json(computeSafetyCost({ history, settings, defaultStake, now: now() }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/rotation', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [records, hubPurchasedIds, settings] = await Promise.all([
        deps.records(),
        deps.hubPurchasedRecordIds(),
        deps.settings.read(),
      ]);
      res.json(
        computeRotation({
          history: records,
          hubPurchasedIds,
          neverLimitBooks: settings.neverLimitBooks,
          now: now(),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** A validated deep-partial patch — nested objects are partial too. */
type SafetyPatch = {
  safeMode?: boolean;
  safetyThreshold?: number;
  maxSafeEdge?: number;
  roundTo?: number;
  neverLimitBooks?: string[];
  consensus?: Partial<SafetySettings['consensus']>;
  sharpAnchor?: Partial<SafetySettings['sharpAnchor']>;
  budgets?: Partial<SafetySettings['budgets']>;
  marketTiers?: Partial<SafetySettings['marketTiers']>;
};

function applyPatch(data: SafetySettings, patch: SafetyPatch): SafetySettings {
  return {
    ...data,
    ...(patch.safeMode !== undefined && { safeMode: patch.safeMode }),
    ...(patch.safetyThreshold !== undefined && { safetyThreshold: patch.safetyThreshold }),
    ...(patch.maxSafeEdge !== undefined && { maxSafeEdge: patch.maxSafeEdge }),
    ...(patch.roundTo !== undefined && { roundTo: patch.roundTo }),
    ...(patch.neverLimitBooks !== undefined && { neverLimitBooks: patch.neverLimitBooks }),
    consensus: patch.consensus ? { ...data.consensus, ...patch.consensus } : data.consensus,
    sharpAnchor: patch.sharpAnchor ? { ...data.sharpAnchor, ...patch.sharpAnchor } : data.sharpAnchor,
    budgets: patch.budgets ? { ...data.budgets, ...patch.budgets } : data.budgets,
    marketTiers: patch.marketTiers ? { ...data.marketTiers, ...patch.marketTiers } : data.marketTiers,
  };
}

type ParseResult = { ok: true; patch: SafetyPatch } | { ok: false; message: string };

export function parseSafetyPatch(body: unknown): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: SafetyPatch = {};

  if ('safeMode' in b) {
    if (typeof b.safeMode !== 'boolean') return bad('safeMode must be a boolean');
    patch.safeMode = b.safeMode;
  }
  if ('safetyThreshold' in b) {
    if (!numIn(b.safetyThreshold, 0, 100)) return bad('safetyThreshold must be 0–100');
    patch.safetyThreshold = b.safetyThreshold as number;
  }
  if ('maxSafeEdge' in b) {
    if (!numIn(b.maxSafeEdge, 0, 100, true)) return bad('maxSafeEdge must be > 0 and ≤ 100');
    patch.maxSafeEdge = b.maxSafeEdge as number;
  }
  if ('roundTo' in b) {
    if (!numIn(b.roundTo, 0, 1000, true)) return bad('roundTo must be > 0 and ≤ 1000');
    patch.roundTo = b.roundTo as number;
  }
  if ('neverLimitBooks' in b) {
    if (!Array.isArray(b.neverLimitBooks) || !b.neverLimitBooks.every((x) => typeof x === 'string')) {
      return bad('neverLimitBooks must be an array of strings');
    }
    patch.neverLimitBooks = b.neverLimitBooks as string[];
  }
  if ('consensus' in b) {
    const c = objOf(b.consensus);
    if (!c) return bad('consensus must be an object');
    const out: Partial<SafetySettings['consensus']> = {};
    for (const f of ['noPenaltyMaxPct', 'minorPenaltyMaxPct', 'majorPenaltyMaxPct'] as const) {
      if (f in c) {
        if (!numIn(c[f], 0, 100)) return bad(`consensus.${f} must be 0–100`);
        out[f] = c[f] as number;
      }
    }
    for (const f of ['minorPenalty', 'majorPenalty', 'thinPenalty'] as const) {
      if (f in c) {
        if (!numIn(c[f], -100, 0)) return bad(`consensus.${f} must be −100–0 (a penalty)`);
        out[f] = c[f] as number;
      }
    }
    if ('minBooks' in c) {
      if (!intIn(c.minBooks, 1, 100)) return bad('consensus.minBooks must be an integer 1–100');
      out.minBooks = c.minBooks as number;
    }
    if (Object.keys(out).length === 0) return bad('consensus patch is empty');
    patch.consensus = out;
  }
  if ('sharpAnchor' in b) {
    const s = objOf(b.sharpAnchor);
    if (!s) return bad('sharpAnchor must be an object');
    const out: Partial<SafetySettings['sharpAnchor']> = {};
    for (const f of ['oneLeg', 'bothLegs'] as const) {
      if (f in s) {
        if (!numIn(s[f], 0, 100)) return bad(`sharpAnchor.${f} must be 0–100`);
        out[f] = s[f] as number;
      }
    }
    if (Object.keys(out).length === 0) return bad('sharpAnchor patch is empty');
    patch.sharpAnchor = out;
  }
  if ('budgets' in b) {
    const g = objOf(b.budgets);
    if (!g) return bad('budgets must be an object');
    const out: Partial<SafetySettings['budgets']> = {};
    for (const f of ['maxArbsPerDay', 'maxArbsPerWeek', 'hotStreakCount', 'cooldownDays'] as const) {
      if (f in g) {
        if (!intIn(g[f], 1, 100000)) return bad(`budgets.${f} must be a positive integer`);
        out[f] = g[f] as number;
      }
    }
    if (Object.keys(out).length === 0) return bad('budgets patch is empty');
    patch.budgets = out;
  }
  if ('marketTiers' in b) {
    const m = objOf(b.marketTiers);
    if (!m) return bad('marketTiers must be an object');
    const out: Partial<SafetySettings['marketTiers']> = {};
    for (const f of ['tier1', 'tier3'] as const) {
      if (f in m) {
        const tiers = validateTierList(m[f]);
        if (!tiers.ok) return bad(`marketTiers.${f}: ${tiers.message}`);
        out[f] = tiers.value;
      }
    }
    if ('tier1Bonus' in m) {
      if (!numIn(m.tier1Bonus, 0, 100)) return bad('marketTiers.tier1Bonus must be 0–100');
      out.tier1Bonus = m.tier1Bonus as number;
    }
    if ('tier3Penalty' in m) {
      if (!numIn(m.tier3Penalty, -100, 0)) return bad('marketTiers.tier3Penalty must be −100–0');
      out.tier3Penalty = m.tier3Penalty as number;
    }
    if (Object.keys(out).length === 0) return bad('marketTiers patch is empty');
    patch.marketTiers = out;
  }

  if (Object.keys(patch).length === 0) return bad('empty settings patch');
  return { ok: true, patch };
}

function validateTierList(
  raw: unknown,
): { ok: true; value: Array<{ sportPrefix: string; marketKey?: string }> } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'must be an array' };
  const value: Array<{ sportPrefix: string; marketKey?: string }> = [];
  for (const entry of raw) {
    const e = objOf(entry);
    if (!e || typeof e.sportPrefix !== 'string' || e.sportPrefix.length === 0) {
      return { ok: false, message: 'each entry needs a non-empty sportPrefix' };
    }
    if ('marketKey' in e && e.marketKey !== undefined && typeof e.marketKey !== 'string') {
      return { ok: false, message: 'marketKey must be a string when present' };
    }
    value.push(
      typeof e.marketKey === 'string'
        ? { sportPrefix: e.sportPrefix, marketKey: e.marketKey }
        : { sportPrefix: e.sportPrefix },
    );
  }
  return { ok: true, value };
}

function objOf(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numIn(v: unknown, lo: number, hi: number, exclusiveLo = false): boolean {
  return typeof v === 'number' && Number.isFinite(v) && (exclusiveLo ? v > lo : v >= lo) && v <= hi;
}

function intIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

function bad(message: string): { ok: false; message: string } {
  return { ok: false, message };
}
