import { describe, expect, it } from 'vitest';
import type { BookmakerConfig, FundSettings } from '@shared/types';
import { FundService } from './fundService';
import type { FundDataStore } from './fundStore';

const NOW = new Date('2026-07-10T12:00:00Z');

class MemStore implements FundDataStore {
  constructor(public data: FundSettings) {}
  async read(): Promise<FundSettings> {
    return this.data;
  }
  async update<T>(
    mutate: (data: FundSettings) => { data: FundSettings; result: T } | Promise<{ data: FundSettings; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function book(key: string, overrides: Partial<BookmakerConfig> = {}): BookmakerConfig {
  return {
    key,
    title: key,
    enabled: true,
    balance: null,
    status: 'active',
    notes: '',
    firstSeenAt: '2026-07-01T00:00:00Z',
    lastSeenAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('FundService.position', () => {
  it('sums the float and fires exactly the right warnings', async () => {
    const service = new FundService(
      new MemStore({ totalBankroll: 3000, defaultStake: 400, unallocatedCash: 250 }),
      () => NOW,
    );
    const books = [
      // Healthy: funded above default stake, touched recently.
      book('bet365', { balance: 900, balanceUpdatedAt: '2026-07-01T00:00:00Z' }),
      // Low: enabled with balance below the $400 default stake.
      book('pinnacle', { balance: 150, balanceUpdatedAt: NOW.toISOString() }),
      // Stale: last touched 20 days ago (and healthy otherwise).
      book('coolbet', { balance: 800, balanceUpdatedAt: '2026-06-20T00:00:00Z' }),
      // Disabled books never warn — but their cash still counts in the float.
      book('fanduel', { enabled: false, balance: 5 }),
      // Untracked balance: no float contribution, no warnings.
      book('betmgm'),
    ];

    const position = await service.position(books, 12.5, {
      bankrollIdeal: 5010,
      bankrollHaircut: 5008,
    });
    expect(position.totalFloat).toBeCloseTo(1855, 2);
    expect(position.settings.unallocatedCash).toBe(250);
    expect(position.realProfit).toBeCloseTo(12.5, 2);
    expect(position.paper).toMatchObject({ simulated: true, bankrollIdeal: 5010 });
    expect(position.warnings.lowBalance).toEqual(['pinnacle']);
    // bet365 was touched 9 days ago — inside the 14-day window, no nudge.
    expect(position.warnings.staleBalance).toEqual(['coolbet']);
  });
});
