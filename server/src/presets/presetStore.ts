/**
 * Persistence for advanced-mode book presets — the standard JsonStore
 * pattern (crash-safe write-then-rename, serialized updates).
 */
import type { BookPreset } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export interface PresetData {
  presets: BookPreset[];
}

/** Structural interface so tests can substitute an in-memory store. */
export interface PresetDataStore {
  read(): Promise<PresetData>;
  update<T>(
    mutate: (
      data: PresetData,
    ) => { data: PresetData; result: T } | Promise<{ data: PresetData; result: T }>,
  ): Promise<T>;
}

export class PresetStore extends JsonStore<PresetData> implements PresetDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ presets: [] }),
      (parsed) => ({
        presets: ((parsed ?? {}) as Partial<PresetData>).presets ?? [],
      }),
    );
  }
}
