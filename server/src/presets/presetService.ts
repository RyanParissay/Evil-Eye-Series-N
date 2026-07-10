/**
 * Book presets for advanced mode. The two dynamic seeds resolve their rule
 * against the live bookmaker registry at evaluation time; user-saved
 * presets are always static key lists.
 */
import { randomUUID } from 'node:crypto';
import type { BookPreset, BookmakerConfig } from '@shared/types';
import type { PresetDataStore } from './presetStore';

const SEEDS: Array<Pick<BookPreset, 'id' | 'name' | 'rule'>> = [
  { id: 'seed-all-enabled', name: 'All enabled', rule: 'all_enabled' },
  { id: 'seed-funded', name: 'Funded only', rule: 'funded' },
];

export class PresetService {
  constructor(
    private readonly store: PresetDataStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => randomUUID(),
  ) {}

  /** Seeds the dynamic presets the first time the (empty) file is read. */
  async list(): Promise<BookPreset[]> {
    return this.store.update((data) => {
      if (data.presets.length === 0) {
        const at = this.now().toISOString();
        data.presets = SEEDS.map((seed) => ({
          ...seed,
          kind: 'dynamic' as const,
          bookmakerKeys: [],
          createdAt: at,
          lastUsedAt: null,
        }));
      }
      return { data, result: data.presets };
    });
  }

  async get(id: string): Promise<BookPreset | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }

  async create(name: string, bookmakerKeys: string[]): Promise<BookPreset> {
    const preset: BookPreset = {
      id: this.newId(),
      name,
      kind: 'static',
      bookmakerKeys: [...bookmakerKeys],
      createdAt: this.now().toISOString(),
      lastUsedAt: null,
    };
    await this.store.update((data) => {
      data.presets.push(preset);
      return { data, result: undefined };
    });
    return preset;
  }

  async rename(id: string, name: string): Promise<BookPreset | null> {
    return this.store.update((data) => {
      const preset = data.presets.find((p) => p.id === id) ?? null;
      if (preset) preset.name = name;
      return { data, result: preset };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.store.update((data) => {
      const before = data.presets.length;
      data.presets = data.presets.filter((p) => p.id !== id);
      return { data, result: data.presets.length < before };
    });
  }

  async touch(id: string): Promise<void> {
    const at = this.now().toISOString();
    await this.store.update((data) => {
      const preset = data.presets.find((p) => p.id === id);
      if (preset) preset.lastUsedAt = at;
      return { data, result: undefined };
    });
  }
}

/**
 * The keys a preset stands for right now. Pure. `funded` requires enabled
 * too — a disabled book can't be staked no matter its balance.
 */
export function resolvePresetKeys(preset: BookPreset, books: BookmakerConfig[]): string[] {
  if (preset.kind === 'static') return [...preset.bookmakerKeys];
  const eligible =
    preset.rule === 'funded'
      ? books.filter((b) => b.enabled && (b.balance ?? 0) > 0)
      : books.filter((b) => b.enabled);
  return eligible.map((b) => b.key);
}
