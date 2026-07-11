/**
 * Paper-fund persistence — its OWN store, fully isolated from bookmaker
 * balances, opportunity records, and WhatsApp state by construction.
 */
import type { PaperData } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export const DEFAULT_PAPER_SETTINGS: PaperData['settings'] = {
  enabled: false,
  startingBankroll: 5000,
  stakeRule: { kind: 'flat', value: 400 },
  haircutPercent: 20,
  haircutSource: 'manual',
  thresholdPercent: 2,
};

/** Structural interface so tests can substitute an in-memory store. */
export interface PaperDataStore {
  read(): Promise<PaperData>;
  update<T>(
    mutate: (data: PaperData) => { data: PaperData; result: T } | Promise<{ data: PaperData; result: T }>,
  ): Promise<T>;
}

export class PaperStore extends JsonStore<PaperData> implements PaperDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ settings: { ...DEFAULT_PAPER_SETTINGS }, entries: [] }),
      (parsed) => {
        const data = (parsed ?? {}) as Partial<PaperData>;
        return {
          settings: { ...DEFAULT_PAPER_SETTINGS, ...data.settings },
          entries: data.entries ?? [],
        };
      },
    );
  }
}
