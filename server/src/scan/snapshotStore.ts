/**
 * The latest raw odds snapshot — pre-allowlist, exactly as fetched — so
 * later features (Advanced Mode presets) can recompute opportunities
 * against arbitrary book subsets without another paid API call. Latest
 * only, deliberately: history would grow without bound and nothing needs it.
 */
import type { OddsEvent } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export interface OddsSnapshot {
  fetchedAt: string;
  regionTab: string;
  markets: string[];
  sportsScanned: string[];
  /** Raw events before bookmaker filtering. */
  events: OddsEvent[];
}

export class SnapshotStore extends JsonStore<OddsSnapshot | null> {
  constructor(filePath: string) {
    super(
      filePath,
      () => null,
      (parsed) => (parsed as OddsSnapshot | null) ?? null,
    );
  }

  async save(snapshot: OddsSnapshot): Promise<void> {
    await this.update(() => ({ data: snapshot, result: undefined }));
  }
}
