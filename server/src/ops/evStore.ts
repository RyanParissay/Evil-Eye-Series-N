/**
 * Risk Mode settings persistence — standard JsonStore.
 */
import type { EvSettings } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export const DEFAULT_EV_SETTINGS: EvSettings = {
  showMinEdgePct: 1,
  alertMinEdgePct: 3,
  maxOdds: 4,
  maxBenchmarkAgeMins: 15,
};

export class EvStore extends JsonStore<EvSettings> {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ ...DEFAULT_EV_SETTINGS }),
      (parsed) => ({ ...DEFAULT_EV_SETTINGS, ...((parsed ?? {}) as Partial<EvSettings>) }),
    );
  }
}
