import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookmakerConfig } from '@shared/types';
import { PresetService, resolvePresetKeys } from './presetService';
import { PresetStore } from './presetStore';

const NOW = new Date('2026-07-10T12:00:00Z');

function book(key: string, overrides: Partial<BookmakerConfig> = {}): BookmakerConfig {
  return {
    key,
    title: key.toUpperCase(),
    enabled: true,
    balance: null,
    status: 'active',
    notes: '',
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('PresetService', () => {
  let dir: string;
  let service: PresetService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'presets-'));
    service = new PresetService(new PresetStore(join(dir, 'presets.json')), () => NOW);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('seeds the two dynamic presets on first read', async () => {
    const presets = await service.list();
    expect(presets.map((p) => [p.name, p.kind, p.rule])).toEqual([
      ['All enabled', 'dynamic', 'all_enabled'],
      ['Funded only', 'dynamic', 'funded'],
    ]);
  });

  it('creates static presets that survive a restart, and touches lastUsedAt', async () => {
    const created = await service.create('My books', ['bet365', 'pinnacle']);
    expect(created).toMatchObject({ kind: 'static', bookmakerKeys: ['bet365', 'pinnacle'] });
    await service.touch(created.id);

    // "Restart": a fresh service over the same file.
    const rebooted = new PresetService(new PresetStore(join(dir, 'presets.json')), () => NOW);
    const found = (await rebooted.list()).find((p) => p.id === created.id);
    expect(found).toMatchObject({ name: 'My books', lastUsedAt: NOW.toISOString() });
  });

  it('renames and deletes; unknown ids report cleanly', async () => {
    const created = await service.create('Temp', ['bet365']);
    expect(await service.rename(created.id, 'Kept')).toMatchObject({ name: 'Kept' });
    expect(await service.rename('nope', 'X')).toBeNull();
    expect(await service.delete(created.id)).toBe(true);
    expect(await service.delete(created.id)).toBe(false);
    expect((await service.list()).some((p) => p.id === created.id)).toBe(false);
  });
});

describe('resolvePresetKeys', () => {
  const books = [
    book('bet365', { balance: 200 }),
    book('pinnacle'),
    book('coolbet', { enabled: false, balance: 500 }),
    book('fanduel', { balance: 0 }),
  ];

  it('all_enabled = every enabled book', () => {
    const preset = { id: 'x', name: '', kind: 'dynamic' as const, rule: 'all_enabled' as const, bookmakerKeys: [], createdAt: '', lastUsedAt: null };
    expect(resolvePresetKeys(preset, books).sort()).toEqual(['bet365', 'fanduel', 'pinnacle']);
  });

  it('funded = enabled AND balance > 0 (a disabled funded book cannot be staked)', () => {
    const preset = { id: 'x', name: '', kind: 'dynamic' as const, rule: 'funded' as const, bookmakerKeys: [], createdAt: '', lastUsedAt: null };
    expect(resolvePresetKeys(preset, books)).toEqual(['bet365']);
  });

  it('static presets return their keys verbatim', () => {
    const preset = { id: 'x', name: '', kind: 'static' as const, bookmakerKeys: ['pinnacle'], createdAt: '', lastUsedAt: null };
    expect(resolvePresetKeys(preset, books)).toEqual(['pinnacle']);
  });
});
