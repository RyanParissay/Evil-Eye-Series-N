/**
 * Ops settings persistence (scan windows, cadences, credit budget, and the
 * Phase-16 scheduler) — standard JsonStore.
 *
 * The legacy weekday/weekend windows + inWindowMins/outWindowMins are kept
 * for back-compat but no longer drive anything: all wall-clock scan/score-
 * poll timing now lives in the scheduler (server/src/scheduler/), configured
 * by `scheduler.blocks`. See CLAUDE.md's scheduler invariant.
 */
import type { ScanMeta, OpsSettings, SchedulerBlock, SchedulerSettings } from '@shared/types';
import { regionTabByKey } from '@shared/regionTabs';
import { JsonStore } from '../lib/jsonStore';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Seed schedule (America/Vancouver local), revised per the 2026-07-11
 * research pass in the Phase-16 design doc. Quiet hours (01:00–08:00) are
 * NOT a block — they're a hard guard in the scheduler. The 23:00–01:00
 * moderate stretch is expressed as two within-day blocks so every block
 * stays inside one local day. `intervalMins` (moderate 30 / dense 15) is a
 * sane week-one default; the weekly optimizer (WP3) tunes it from measured
 * density. Every seed block covers all 7 days — day-of-week specialization
 * is the optimizer's job, not the seed's.
 */
export const SEED_SCHEDULER_BLOCKS: SchedulerBlock[] = [
  { days: ALL_DAYS, startMin: 8 * 60, endMin: 14 * 60, intervalMins: 30 }, // 08:00–14:00 moderate
  { days: ALL_DAYS, startMin: 14 * 60, endMin: 19 * 60, intervalMins: 15 }, // 14:00–19:00 dense
  { days: ALL_DAYS, startMin: 19 * 60, endMin: 23 * 60, intervalMins: 15 }, // 19:00–23:00 dense
  { days: ALL_DAYS, startMin: 23 * 60, endMin: 24 * 60, intervalMins: 30 }, // 23:00–24:00 moderate
  { days: ALL_DAYS, startMin: 0, endMin: 1 * 60, intervalMins: 30 }, // 00:00–01:00 moderate
];

/**
 * DEFAULT FALSE is load-bearing: the dev server hot-reloads against the
 * real Odds API key, so a scheduler that woke up enabled on restart would
 * burn real credits. Never seed it true; never let a migration flip it.
 */
export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  enabled: false,
  blocks: SEED_SCHEDULER_BLOCKS,
  scanParams: { regionTab: 'ca_us', topN: 5 },
  disabledReason: null,
};

export const DEFAULT_OPS_SETTINGS: OpsSettings = {
  weekday: { startMinutes: 18 * 60 + 30, endMinutes: 22 * 60 + 30 }, // 18:30–22:30 (legacy)
  weekend: { startMinutes: 12 * 60, endMinutes: 22 * 60 + 30 }, // 12:00–22:30 (legacy)
  inWindowMins: 5, // legacy — scheduler ignores it
  outWindowMins: null, // legacy
  monthlyCreditBudget: 20_000,
  autoStopPct: 95,
  // Extra markets multiply every odds call's credits — the operator
  // flips these deliberately, with the budget to match (Phase 12).
  markets: { totals: false, spreads: false },
  confirmSecondSighting: false,
  scheduler: DEFAULT_SCHEDULER_SETTINGS,
};

/**
 * Scan scope for the scheduler: last scan's meta if it's usable, else the
 * ca_us / topN-5 default (Phase-16 design). Pure — the caller supplies the
 * meta so nothing here reads disk.
 */
export function seedScanParams(meta: Pick<ScanMeta, 'regionTab' | 'topN'> | null): {
  regionTab: string;
  topN: number;
} {
  if (
    meta &&
    typeof meta.regionTab === 'string' &&
    regionTabByKey(meta.regionTab) &&
    Number.isInteger(meta.topN) &&
    meta.topN >= 1
  ) {
    return { regionTab: meta.regionTab, topN: meta.topN };
  }
  return { ...DEFAULT_SCHEDULER_SETTINGS.scanParams };
}

/** Structural interface so tests can substitute an in-memory store. */
export interface OpsSettingsStore {
  read(): Promise<OpsSettings>;
  update<T>(
    mutate: (data: OpsSettings) => { data: OpsSettings; result: T } | Promise<{ data: OpsSettings; result: T }>,
  ): Promise<T>;
}

/** Deep-normalize the scheduler sub-object so a legacy or partial ops.json
 *  migrates in cleanly (JsonStore normalize pattern — same as strategy
 *  fields). Existing files with no `scheduler` key get the seed, disabled. */
function normalizeScheduler(raw: Partial<SchedulerSettings> | undefined): SchedulerSettings {
  return {
    ...DEFAULT_SCHEDULER_SETTINGS,
    ...(raw ?? {}),
    scanParams: { ...DEFAULT_SCHEDULER_SETTINGS.scanParams, ...(raw?.scanParams ?? {}) },
  };
}

export class OpsStore extends JsonStore<OpsSettings> implements OpsSettingsStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ ...DEFAULT_OPS_SETTINGS }),
      (parsed) => {
        const raw = (parsed ?? {}) as Partial<OpsSettings>;
        return {
          ...DEFAULT_OPS_SETTINGS,
          ...raw,
          scheduler: normalizeScheduler(raw.scheduler),
        };
      },
    );
  }
}
