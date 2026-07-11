import { describe, expect, it } from 'vitest';
import type { BookmakerConfig } from '@shared/types';
import type { RegionTabConfig } from '@shared/regionTabs';
import {
  isBookAlertable,
  planFetch,
  upsertSeenBookmakers,
} from './effectiveBookmakers';

const NOW = new Date('2026-07-09T12:00:00Z');
const EARLIER = '2026-07-01T00:00:00Z';

function makeConfig(overrides: Partial<BookmakerConfig> = {}): BookmakerConfig {
  return {
    key: 'bet365',
    title: 'Bet365',
    enabled: true,
    balance: null,
    status: 'active',
    notes: '',
    firstSeenAt: EARLIER,
    lastSeenAt: EARLIER,
    ...overrides,
  };
}

function makeTab(overrides: Partial<RegionTabConfig> = {}): RegionTabConfig {
  return {
    key: 'ca',
    label: 'Canada',
    description: '',
    apiRegions: ['eu', 'uk'],
    allowedBookmakers: ['bet365', 'pinnacle', 'coolbet'],
    ...overrides,
  };
}

describe('upsertSeenBookmakers', () => {
  it('adds unknown books as enabled + active with seen timestamps', () => {
    const merged = upsertSeenBookmakers([], [{ key: 'betway', title: 'Betway' }], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      key: 'betway',
      title: 'Betway',
      enabled: true,
      status: 'active',
      balance: null,
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
    });
  });

  it('refreshes title and lastSeenAt on known books without touching manual fields', () => {
    const existing = makeConfig({
      enabled: false,
      balance: 250,
      status: 'limited',
      notes: 'stake capped at $50',
    });
    const merged = upsertSeenBookmakers(
      [existing],
      [{ key: 'bet365', title: 'bet365 (new title)' }],
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      title: 'bet365 (new title)',
      lastSeenAt: NOW.toISOString(),
      firstSeenAt: EARLIER,
      enabled: false,
      balance: 250,
      status: 'limited',
      notes: 'stake capped at $50',
    });
  });
});

describe('planFetch', () => {
  it('uses the bookmakers param when strictly cheaper than regions', () => {
    // 3 allowed books → 1 region-equivalent < 2 tab regions.
    const plan = planFetch([], makeTab());
    expect(plan.bookmakersParam).toEqual(['bet365', 'pinnacle', 'coolbet']);
    expect(plan.allowedKeys).toEqual(['bet365', 'pinnacle', 'coolbet']);
  });

  it('falls back to regions when the param would cost the same or more', () => {
    // 11 books → 2 region-equivalents = 2 tab regions → not strictly cheaper.
    const tab = makeTab({
      allowedBookmakers: Array.from({ length: 11 }, (_, i) => `book${i}`),
    });
    const plan = planFetch([], tab);
    expect(plan.bookmakersParam).toBeUndefined();
    expect(plan.allowedKeys).toHaveLength(11);
  });

  it('excludes disabled books from both the param and the detection filter', () => {
    const configs = [makeConfig({ key: 'pinnacle', title: 'Pinnacle', enabled: false })];
    const plan = planFetch(configs, makeTab());
    expect(plan.bookmakersParam).toEqual(['bet365', 'coolbet']);
    expect(plan.allowedKeys).toEqual(['bet365', 'coolbet']);
  });

  it('treats books not in the registry as enabled (discovery)', () => {
    const configs = [makeConfig({ key: 'unrelated', enabled: false })];
    const plan = planFetch(configs, makeTab());
    expect(plan.allowedKeys).toEqual(['bet365', 'pinnacle', 'coolbet']);
  });

  it('never sends an empty bookmakers param (everything disabled → regions)', () => {
    const configs = makeTab().allowedBookmakers.map((key) =>
      makeConfig({ key, enabled: false }),
    );
    const plan = planFetch(configs, makeTab());
    expect(plan.bookmakersParam).toBeUndefined();
    expect(plan.allowedKeys).toEqual([]);
  });
});

describe('planFetch — benchmark union (dual-role, Speculative phase 9)', () => {
  it('a benchmark key already enabled is a no-op: identical plan, identical cost', () => {
    const withBenchmark = planFetch([], makeTab(), ['pinnacle']);
    const without = planFetch([], makeTab());
    expect(withBenchmark).toEqual(without);
  });

  it('keeps a DISABLED benchmark book in the fetch but never in detection', () => {
    const configs = [makeConfig({ key: 'pinnacle', title: 'Pinnacle', enabled: false })];
    const plan = planFetch(configs, makeTab(), ['pinnacle']);
    expect(plan.bookmakersParam).toEqual(['bet365', 'coolbet', 'pinnacle']);
    expect(plan.allowedKeys).toEqual(['bet365', 'coolbet']);
  });

  it('zero marginal credits while the union stays ≤ 10 books', () => {
    // 9 enabled + 1 benchmark = 10 → still 1 region-equivalent < 2 regions.
    const tab = makeTab({
      allowedBookmakers: Array.from({ length: 9 }, (_, i) => `book${i}`),
    });
    const plan = planFetch([], tab, ['pinnacle']);
    expect(plan.bookmakersParam).toHaveLength(10);
    expect(plan.bookmakersParam).toContain('pinnacle');
  });

  it('a union past 10 books is no longer strictly cheaper → regions fallback, never silent extra cost', () => {
    // 10 enabled + 1 benchmark = 11 → 2 region-equivalents = 2 regions.
    const tab = makeTab({
      allowedBookmakers: Array.from({ length: 10 }, (_, i) => `book${i}`),
    });
    const plan = planFetch([], tab, ['pinnacle']);
    expect(plan.bookmakersParam).toBeUndefined();
    expect(plan.allowedKeys).toHaveLength(10);
  });

  it('everything disabled still falls back to regions — never a benchmark-only fetch', () => {
    const configs = makeTab().allowedBookmakers.map((key) => makeConfig({ key, enabled: false }));
    const plan = planFetch(configs, makeTab(), ['pinnacle']);
    expect(plan.bookmakersParam).toBeUndefined();
    expect(plan.allowedKeys).toEqual([]);
  });
});

describe('isBookAlertable', () => {
  it('active + enabled books and unknown books are alertable', () => {
    expect(isBookAlertable([makeConfig()], 'bet365')).toBe(true);
    expect(isBookAlertable([], 'never-seen')).toBe(true);
  });

  it('limited, dead, and disabled books are not', () => {
    expect(isBookAlertable([makeConfig({ status: 'limited' })], 'bet365')).toBe(false);
    expect(isBookAlertable([makeConfig({ status: 'dead' })], 'bet365')).toBe(false);
    expect(isBookAlertable([makeConfig({ enabled: false })], 'bet365')).toBe(false);
  });
});
