import { describe, expect, it } from 'vitest';
import type { PaperEntry, PaperSettings } from '@shared/types';
import { settlePaperBook } from './paperMath';

const NOW = new Date('2026-07-10T12:00:00Z');

function entry(overrides: Partial<PaperEntry>): PaperEntry {
  return {
    id: Math.random().toString(16).slice(2, 18),
    fingerprint: 'f'.repeat(64),
    eventId: 'evt',
    eventName: 'A @ B',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    marketKey: 'h2h',
    profitPct: 2.5,
    arbIndex: 0.9756,
    legs: [],
    enteredAt: '2026-07-08T10:00:00Z',
    commenceTime: '2026-07-08T20:00:00Z',
    ...overrides,
  };
}

function settings(overrides: Partial<PaperSettings> = {}): PaperSettings {
  return {
    enabled: true,
    startingBankroll: 5000,
    stakeRule: { kind: 'flat', value: 400 },
    haircutPercent: 20,
    thresholdPercent: 2,
    ...overrides,
  };
}

describe('settlePaperBook', () => {
  it('flat staking: settles commenced entries to the cent, holds future ones open', () => {
    const book = settlePaperBook(
      [
        entry({ profitPct: 2.5 }), // commenced → +400×2.5% = +10
        entry({ id: 'open1', enteredAt: '2026-07-10T11:00:00Z', commenceTime: '2026-07-11T00:00:00Z' }),
      ],
      settings(),
      NOW,
    );
    expect(book.entries[0]).toMatchObject({ stake: 400, idealProfit: 10, settled: true });
    expect(book.entries[0].haircutProfit).toBeCloseTo(8, 2); // 20% haircut
    expect(book.entries[1]).toMatchObject({ settled: false });
    expect(book.bankrollIdeal).toBeCloseTo(5010, 2);
    expect(book.bankrollHaircut).toBeCloseTo(5008, 2);
    expect(book.openStake).toBeCloseTo(400, 2);
    expect(book.equityIdeal).toHaveLength(1);
    expect(book.equityIdeal[0].cumulativeProfit).toBeCloseTo(10, 2);
  });

  it('percent staking compounds: the second entry stakes off the settled bankroll', () => {
    const book = settlePaperBook(
      [
        // Entered day 1, commenced day 1 evening: stake 10% of 5000 = 500 → +12.50.
        entry({ id: 'e1', profitPct: 2.5, enteredAt: '2026-07-08T10:00:00Z', commenceTime: '2026-07-08T20:00:00Z' }),
        // Entered day 2 (after e1 commenced): stake 10% of 5012.50 = 501.25 → +10.03.
        entry({ id: 'e2', profitPct: 2, enteredAt: '2026-07-09T10:00:00Z', commenceTime: '2026-07-09T20:00:00Z' }),
        // Entered BEFORE e2 commenced: bankroll still 5012.50 for this one.
        entry({ id: 'e3', profitPct: 1, enteredAt: '2026-07-09T12:00:00Z', commenceTime: '2026-07-09T22:00:00Z' }),
      ],
      settings({ stakeRule: { kind: 'percent', value: 10 } }),
      NOW,
    );
    expect(book.entries[0].stake).toBeCloseTo(500, 2);
    expect(book.entries[0].idealProfit).toBeCloseTo(12.5, 2);
    expect(book.entries[1].stake).toBeCloseTo(501.25, 2);
    expect(book.entries[1].idealProfit).toBeCloseTo(10.03, 2);
    expect(book.entries[2].stake).toBeCloseTo(501.25, 2);
    expect(book.bankrollIdeal).toBeCloseTo(5000 + 12.5 + 10.03 + 5.01, 2);
  });

  it('haircut is independent of ideal and configurable', () => {
    const book = settlePaperBook(
      [entry({ profitPct: 4 })],
      settings({ haircutPercent: 50 }),
      NOW,
    );
    expect(book.entries[0].idealProfit).toBeCloseTo(16, 2);
    expect(book.entries[0].haircutProfit).toBeCloseTo(8, 2);
    expect(book.equityHaircut[0].cumulativeProfit).toBeCloseTo(8, 2);
  });

  it('monthly buckets split ideal and haircut by commence month', () => {
    const book = settlePaperBook(
      [
        entry({ id: 'jun', enteredAt: '2026-06-01T10:00:00Z', commenceTime: '2026-06-01T20:00:00Z', profitPct: 5 }),
        entry({ id: 'jul', enteredAt: '2026-07-01T10:00:00Z', commenceTime: '2026-07-01T20:00:00Z', profitPct: 2.5 }),
      ],
      settings(),
      NOW,
    );
    expect(book.monthly).toEqual([
      { month: '2026-06', ideal: 20, haircut: 16 },
      { month: '2026-07', ideal: 10, haircut: 8 },
    ]);
  });
});
