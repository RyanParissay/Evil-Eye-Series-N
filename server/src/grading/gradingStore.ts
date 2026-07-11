/**
 * Score-polling ledger (Phase 13). Two things live here, both driven by
 * GRADING_RULES.md §4: today's scores-endpoint credit spend (the 500/day
 * cap) and per-event poll state (attempts, last poll, give-up stamp) that
 * drives the 45-min retry spacing and the 24h give-up. Standard JsonStore —
 * crash-safe writes, serialized read-modify-write like every other store.
 */
import { JsonStore } from '../lib/jsonStore';

export interface GradingEventState {
  attempts: number;
  lastPollAt: string | null;
  /** Stamped when the event crosses the 24h give-up (§4 → ungraded_stale). */
  staleAt: string | null;
}

export interface GradingData {
  daily: { date: string; credits: number };
  events: Record<string, GradingEventState>;
}

/** Structural interface so tests can substitute an in-memory store. */
export interface GradingDataStore {
  read(): Promise<GradingData>;
  update<T>(
    mutate: (data: GradingData) => { data: GradingData; result: T } | Promise<{ data: GradingData; result: T }>,
  ): Promise<T>;
}

export class GradingStore extends JsonStore<GradingData> implements GradingDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ daily: { date: '', credits: 0 }, events: {} }),
      (parsed) => {
        const data = (parsed ?? {}) as Partial<GradingData>;
        return {
          daily: data.daily ?? { date: '', credits: 0 },
          events: data.events ?? {},
        };
      },
    );
  }
}
