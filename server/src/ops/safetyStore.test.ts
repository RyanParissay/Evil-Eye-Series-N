import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SAFETY_SETTINGS, SafetyStore } from './safetyStore';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'safety-store-'));
  file = join(dir, 'safety.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SafetyStore defaults', () => {
  it('a fresh store carries the spec defaults EXACTLY', async () => {
    const s = await new SafetyStore(file).read();
    expect(s.safeMode).toBe(true);
    expect(s.safetyThreshold).toBe(55);
    expect(s.maxSafeEdge).toBe(4.5);
    expect(s.consensus).toEqual({
      noPenaltyMaxPct: 2,
      minorPenaltyMaxPct: 4,
      majorPenaltyMaxPct: 6,
      minorPenalty: -15,
      majorPenalty: -30,
      minBooks: 5,
      thinPenalty: -15,
    });
    expect(s.neverLimitBooks).toEqual([
      'pinnacle',
      'betfair_ex_uk',
      'betfair_ex_eu',
      'betfair_ex_au',
      'matchbook',
      'smarkets',
    ]);
    expect(s.sharpAnchor).toEqual({ oneLeg: 20, bothLegs: 25 });
    expect(s.marketTiers.tier1Bonus).toBe(10);
    expect(s.marketTiers.tier3Penalty).toBe(-20);
    // NBA h2h is a seeded tier-1 entry; NBA spreads is not.
    expect(s.marketTiers.tier1).toContainEqual({ sportPrefix: 'basketball_nba', marketKey: 'h2h' });
    expect(s.marketTiers.tier3).toContainEqual({ sportPrefix: 'soccer_china_superleague' });
    expect(s.budgets).toEqual({ maxArbsPerDay: 3, maxArbsPerWeek: 12, hotStreakCount: 5, cooldownDays: 3 });
    expect(s.roundTo).toBe(5);
  });
});

describe('SafetyStore normalize (deep-merge)', () => {
  it('fills missing knobs from defaults for a partial/legacy file', async () => {
    await writeFile(file, JSON.stringify({ safetyThreshold: 70, consensus: { minBooks: 8 } }), 'utf8');
    const s = await new SafetyStore(file).read();
    expect(s.safetyThreshold).toBe(70);
    expect(s.consensus.minBooks).toBe(8);
    // Everything else keeps the defaults.
    expect(s.consensus.majorPenalty).toBe(-30);
    expect(s.budgets).toEqual(DEFAULT_SAFETY_SETTINGS.budgets);
    expect(s.roundTo).toBe(5);
  });

  it('replaces neverLimitBooks wholesale when present', async () => {
    await writeFile(file, JSON.stringify({ neverLimitBooks: ['pinnacle'] }), 'utf8');
    expect((await new SafetyStore(file).read()).neverLimitBooks).toEqual(['pinnacle']);
  });
});
