/**
 * Fund settings persistence — manual-entry dollars, standard JsonStore.
 */
import type { FundSettings } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export const DEFAULT_FUND_SETTINGS: FundSettings = {
  totalBankroll: 0,
  defaultStake: 100,
  unallocatedCash: 0,
};

/** Structural interface so tests can substitute an in-memory store. */
export interface FundDataStore {
  read(): Promise<FundSettings>;
  update<T>(
    mutate: (data: FundSettings) => { data: FundSettings; result: T } | Promise<{ data: FundSettings; result: T }>,
  ): Promise<T>;
}

export class FundStore extends JsonStore<FundSettings> implements FundDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ ...DEFAULT_FUND_SETTINGS }),
      (parsed) => ({ ...DEFAULT_FUND_SETTINGS, ...((parsed ?? {}) as Partial<FundSettings>) }),
    );
  }
}
