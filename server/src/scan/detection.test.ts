import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { detectOpportunities } from './detection';

const NOW = new Date('2026-07-08T12:00:00Z');
const FUTURE = '2026-07-08T14:00:00Z';

interface BookSpec {
  key: string;
  prices: Record<string, number>;
  link?: string;
}

function event(id: string, books: BookSpec[]): OddsEvent {
  return {
    id,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: FUTURE,
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    bookmakers: books.map((b) => ({
      key: b.key,
      title: b.key.toUpperCase(),
      lastUpdate: NOW.toISOString(),
      link: b.link,
      markets: [
        {
          key: 'h2h',
          outcomes: Object.entries(b.prices).map(([name, price]) => ({ name, price })),
        },
      ],
    })),
  };
}

const ARB_EVENT = event('ev1', [
  { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 } },
  { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
]);

const OPTIONS = { topN: 5, now: NOW, marketKeys: ['h2h'] };

describe('detectOpportunities', () => {
  it('runs the scan detection slice: allowlist filter → engine → link fallbacks', () => {
    const arbs = detectOpportunities([ARB_EVENT], ['fanduel', 'draftkings'], OPTIONS);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].profitPct).toBeGreaterThan(5);
    // No API link on either leg — the homepage fallback must fill in.
    for (const leg of arbs[0].legs) {
      expect(leg.link).toEqual(expect.stringContaining('https://'));
    }
  });

  it('never prices an arb through a book outside the allowlist', () => {
    const arbs = detectOpportunities([ARB_EVENT], ['fanduel'], OPTIONS);
    expect(arbs).toHaveLength(0);
  });
});
