/**
 * Middles settings persistence — standard JsonStore.
 */
import type { MiddlesSettings } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export const DEFAULT_MIDDLES_SETTINGS: MiddlesSettings = {
  maxCostPct: 5,
  minWindow: 0.5,
  alertMaxBreakevenPct: 4,
};

export class MiddlesStore extends JsonStore<MiddlesSettings> {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ ...DEFAULT_MIDDLES_SETTINGS }),
      (parsed) => ({ ...DEFAULT_MIDDLES_SETTINGS, ...((parsed ?? {}) as Partial<MiddlesSettings>) }),
    );
  }
}
