/**
 * Persistence for the Analytics Hub (Phase 16 Part B, all SIMULATED) — the
 * standard JsonStore pattern (crash-safe write-then-rename, serialized
 * updates). Holds three fact tables: the profiles (premades + customs) and
 * the two immutable event logs a profile accrues — purchases and skipped
 * (insufficient-bankroll) events. Every event is stamped with its profileId
 * so one flat store fans out to per-profile reports.
 */
import type { HubProfile, HubPurchase, OpportunityStrategy } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

/** A purchase event with its owning profile (HubPurchase is the per-profile
 *  wire shape; the store keys every event by profileId). Immutable once written. */
export interface StoredPurchase extends HubPurchase {
  profileId: string;
}

/** A skipped_insufficient_bankroll event (Phase 14 §5 shape) with its owner. */
export interface StoredSkip {
  profileId: string;
  at: string;
  recordId: string;
}

export interface HubData {
  /** True once premades have been seeded — premades are undeletable, so this
   *  guards against reseeding even if the profiles array were emptied. */
  seeded: boolean;
  profiles: HubProfile[];
  purchases: StoredPurchase[];
  skipped: StoredSkip[];
}

/** Structural interface so tests can substitute an in-memory store. */
export interface HubDataStore {
  read(): Promise<HubData>;
  update<T>(
    mutate: (data: HubData) => { data: HubData; result: T } | Promise<{ data: HubData; result: T }>,
  ): Promise<T>;
}

export class HubProfileStore extends JsonStore<HubData> implements HubDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ seeded: false, profiles: [], purchases: [], skipped: [] }),
      (parsed) => {
        const data = (parsed ?? {}) as Partial<HubData>;
        return {
          seeded: data.seeded ?? false,
          profiles: (data.profiles ?? []).map(normalizeProfile),
          purchases: data.purchases ?? [],
          skipped: data.skipped ?? [],
        };
      },
    );
  }
}

function normalizeProfile(profile: HubProfile): HubProfile {
  return {
    ...profile,
    strategies: (profile.strategies ?? []) as OpportunityStrategy[],
  };
}
