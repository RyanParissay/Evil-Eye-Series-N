import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_SETTINGS, OpsStore, seedScanParams } from './opsStore';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ops-store-'));
  file = join(dir, 'ops.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('OpsStore scheduler migration', () => {
  it('defaults the scheduler DISABLED on a fresh store (live-ops critical)', async () => {
    const settings = await new OpsStore(file).read();
    expect(settings.scheduler.enabled).toBe(false);
    expect(settings.scheduler.disabledReason).toBeNull();
    expect(settings.scheduler.blocks.length).toBeGreaterThan(0);
  });

  it('migrates a legacy ops.json (no scheduler key) to the seed, disabled', async () => {
    await writeFile(
      file,
      JSON.stringify({
        weekday: { startMinutes: 540, endMinutes: 1380 },
        weekend: { startMinutes: 540, endMinutes: 1380 },
        inWindowMins: 5,
        outWindowMins: null,
        monthlyCreditBudget: 20_000,
        autoStopPct: 95,
        markets: { totals: false, spreads: false },
        confirmSecondSighting: false,
      }),
      'utf8',
    );
    const settings = await new OpsStore(file).read();
    expect(settings.scheduler).toEqual(DEFAULT_SCHEDULER_SETTINGS);
    // Legacy fields survive untouched (back-compat).
    expect(settings.inWindowMins).toBe(5);
  });

  it('deep-merges a partial persisted scheduler', async () => {
    await writeFile(
      file,
      JSON.stringify({ scheduler: { enabled: true, disabledReason: 'was spent' } }),
      'utf8',
    );
    const { scheduler } = await new OpsStore(file).read();
    expect(scheduler.enabled).toBe(true);
    expect(scheduler.disabledReason).toBe('was spent');
    expect(scheduler.blocks).toEqual(DEFAULT_SCHEDULER_SETTINGS.blocks); // filled from default
    expect(scheduler.scanParams).toEqual(DEFAULT_SCHEDULER_SETTINGS.scanParams);
  });

  it('preserves persisted blocks and scanParams', async () => {
    const blocks = [{ days: [1], startMin: 600, endMin: 660, intervalMins: 10 }];
    await writeFile(
      file,
      JSON.stringify({ scheduler: { enabled: true, blocks, scanParams: { regionTab: 'ca', topN: 3 } } }),
      'utf8',
    );
    const { scheduler } = await new OpsStore(file).read();
    expect(scheduler.blocks).toEqual(blocks);
    expect(scheduler.scanParams).toEqual({ regionTab: 'ca', topN: 3 });
  });

  it('normalizes confirmationIntervalSecs to 60 when absent or invalid, keeps a valid one (Phase 16 Part A)', async () => {
    await writeFile(file, JSON.stringify({ scheduler: { enabled: false } }), 'utf8');
    expect((await new OpsStore(file).read()).scheduler.confirmationIntervalSecs).toBe(60);

    await writeFile(
      file,
      JSON.stringify({ scheduler: { confirmationIntervalSecs: 'soon' } }),
      'utf8',
    );
    expect((await new OpsStore(file).read()).scheduler.confirmationIntervalSecs).toBe(60);

    await writeFile(file, JSON.stringify({ scheduler: { confirmationIntervalSecs: 120 } }), 'utf8');
    expect((await new OpsStore(file).read()).scheduler.confirmationIntervalSecs).toBe(120);
  });

  it('drops the superseded confirmSecondSighting key from legacy files (converted, not carried)', async () => {
    await writeFile(file, JSON.stringify({ confirmSecondSighting: true }), 'utf8');
    const settings = await new OpsStore(file).read();
    expect('confirmSecondSighting' in settings).toBe(false);
  });
});

describe('seedScanParams', () => {
  it('uses the last-scan meta when present and valid', () => {
    expect(seedScanParams({ regionTab: 'ca', topN: 8 })).toEqual({ regionTab: 'ca', topN: 8 });
  });

  it('falls back to ca_us / topN 5 when meta is missing or unusable', () => {
    expect(seedScanParams(null)).toEqual({ regionTab: 'ca_us', topN: 5 });
    expect(seedScanParams({ regionTab: 'nonsense', topN: 5 })).toEqual({ regionTab: 'ca_us', topN: 5 });
    expect(seedScanParams({ regionTab: 'ca', topN: 0 })).toEqual({ regionTab: 'ca_us', topN: 5 });
  });
});
