/**
 * Ops settings persistence (scan windows, cadences, credit budget) —
 * standard JsonStore. Timers themselves live in the CLIENT, always.
 */
import type { OpsSettings } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export const DEFAULT_OPS_SETTINGS: OpsSettings = {
  weekday: { startMinutes: 18 * 60 + 30, endMinutes: 22 * 60 + 30 }, // 18:30–22:30
  weekend: { startMinutes: 12 * 60, endMinutes: 22 * 60 + 30 }, // 12:00–22:30
  inWindowMins: 5,
  outWindowMins: null,
  monthlyCreditBudget: 20_000,
  autoStopPct: 95,
};

/** Structural interface so tests can substitute an in-memory store. */
export interface OpsSettingsStore {
  read(): Promise<OpsSettings>;
  update<T>(
    mutate: (data: OpsSettings) => { data: OpsSettings; result: T } | Promise<{ data: OpsSettings; result: T }>,
  ): Promise<T>;
}

export class OpsStore extends JsonStore<OpsSettings> implements OpsSettingsStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ ...DEFAULT_OPS_SETTINGS }),
      (parsed) => ({ ...DEFAULT_OPS_SETTINGS, ...((parsed ?? {}) as Partial<OpsSettings>) }),
    );
  }
}
