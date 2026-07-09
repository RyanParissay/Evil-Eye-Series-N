import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '../../../shared/types';
import { findArbitrageOpportunities } from './arbitrage';

/** Reference "now" for all tests; events default to 2h in the future. */
const NOW = new Date('2026-07-08T12:00:00Z');
const FUTURE = '2026-07-08T14:00:00Z';
const PAST = '2026-07-08T10:00:00Z';

interface BookSpec {
  key: string;
  prices: Record<string, number>;
  link?: string;
  outcomeLinks?: Record<string, string>;
}

/** Build an event with h2h markets from a compact spec. */
function event(
  id: string,
  books: BookSpec[],
  overrides: Partial<OddsEvent> = {},
): OddsEvent {
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
          outcomes: Object.entries(b.prices).map(([name, price]) => ({
            name,
            price,
            link: b.outcomeLinks?.[name],
          })),
        },
      ],
    })),
    ...overrides,
  };
}

describe('findArbitrageOpportunities — 2-way markets', () => {
  it('detects a 2-way arb and computes index, profit, and stakes', () => {
    const events = [
      event('ev1', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
      ]),
    ];

    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);

    const arb = arbs[0];
    // S = 1/2.10 + 1/2.12 = 0.947889...
    expect(arb.arbIndex).toBeCloseTo(1 / 2.1 + 1 / 2.12, 6);
    expect(arb.profitPct).toBeCloseTo((1 / arb.arbIndex - 1) * 100, 6);
    expect(arb.profitPct).toBeGreaterThan(5.4);
    expect(arb.profitPct).toBeLessThan(5.6);
    expect(arb.sameBookmaker).toBe(false);
    expect(arb.suspicious).toBe(false);
    expect(arb.marketKey).toBe('h2h');

    // Each leg carries the best book for that outcome.
    const home = arb.legs.find((l) => l.outcome === 'Los Angeles Lakers')!;
    const away = arb.legs.find((l) => l.outcome === 'Boston Celtics')!;
    expect(home.bookmakerKey).toBe('fanduel');
    expect(home.odds).toBe(2.1);
    expect(away.bookmakerKey).toBe('draftkings');
    expect(away.odds).toBe(2.12);

    // Stake split: stake_i = 100 × (1/odds_i) / S — sums to ~$100 and
    // pays out the same amount whichever leg wins.
    expect(home.stake + away.stake).toBeCloseTo(100, 1);
    expect(home.stake * home.odds).toBeCloseTo(away.stake * away.odds, 0.5);
    expect(home.stake).toBeCloseTo(100 * (1 / 2.1) / arb.arbIndex, 1);
  });

  it('returns nothing when the market is efficient (S >= 1)', () => {
    const events = [
      event('ev1', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 1.91, 'Boston Celtics': 1.91 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.87, 'Boston Celtics': 1.95 } },
      ]),
    ];
    expect(findArbitrageOpportunities(events, { now: NOW })).toHaveLength(0);
  });
});

describe('findArbitrageOpportunities — 3-way markets', () => {
  it('detects a 3-way (soccer with draw) arb across three books', () => {
    const events = [
      event(
        'ev-soccer',
        [
          { key: 'bet365', prices: { Arsenal: 3.0, Draw: 3.2, Chelsea: 2.5 } },
          { key: 'pinnacle', prices: { Arsenal: 2.7, Draw: 3.45, Chelsea: 2.6 } },
          { key: 'betfair_ex_uk', prices: { Arsenal: 2.8, Draw: 3.3, Chelsea: 2.9 } },
        ],
        {
          sportKey: 'soccer_epl',
          sportTitle: 'EPL',
          homeTeam: 'Arsenal',
          awayTeam: 'Chelsea',
        },
      ),
    ];

    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);

    const arb = arbs[0];
    const expectedS = 1 / 3.0 + 1 / 3.45 + 1 / 2.9;
    expect(arb.arbIndex).toBeCloseTo(expectedS, 6);
    expect(expectedS).toBeLessThan(1);
    expect(arb.legs).toHaveLength(3);
    expect(arb.legs.map((l) => l.bookmakerKey).sort()).toEqual([
      'bet365',
      'betfair_ex_uk',
      'pinnacle',
    ]);
    // Stakes still sum to $100 across three legs.
    const total = arb.legs.reduce((sum, l) => sum + l.stake, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('returns nothing for an efficient 3-way market', () => {
    const events = [
      event(
        'ev-soccer',
        [
          { key: 'bet365', prices: { Arsenal: 2.5, Draw: 3.2, Chelsea: 2.7 } },
          { key: 'pinnacle', prices: { Arsenal: 2.55, Draw: 3.25, Chelsea: 2.75 } },
        ],
        { sportKey: 'soccer_epl', homeTeam: 'Arsenal', awayTeam: 'Chelsea' },
      ),
    ];
    expect(findArbitrageOpportunities(events, { now: NOW })).toHaveLength(0);
  });
});

describe('edge cases', () => {
  it('flags arbs where multiple legs come from the same bookmaker', () => {
    const events = [
      event('ev1', [
        { key: 'pinnacle', prices: { 'Los Angeles Lakers': 2.15, 'Boston Celtics': 2.05 } },
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 1.8, 'Boston Celtics': 1.9 } },
      ]),
    ];
    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);
    expect(arbs[0].sameBookmaker).toBe(true);
    expect(arbs[0].legs.every((l) => l.bookmakerKey === 'pinnacle')).toBe(true);
  });

  it('prefers distinct bookmakers when best prices tie', () => {
    // Both books offer the same best price on both sides. A naive "first
    // wins" pick would use one book twice; the engine should spread legs
    // across books so the arb is actually executable.
    const events = [
      event('ev1', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 2.1 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 2.1 } },
      ]),
    ];
    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);
    expect(arbs[0].sameBookmaker).toBe(false);
    const keys = arbs[0].legs.map((l) => l.bookmakerKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('ignores events that have already commenced (stale)', () => {
    const events = [
      event(
        'ev-live',
        [
          { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 } },
          { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
        ],
        { commenceTime: PAST },
      ),
    ];
    expect(findArbitrageOpportunities(events, { now: NOW })).toHaveLength(0);
  });

  it('skips markets with fewer than two distinct outcomes', () => {
    // A degenerate market (one book listing a single side) must not produce
    // a fake "arb" from S = 1/odds < 1.
    const events = [
      event('ev1', [{ key: 'fanduel', prices: { 'Los Angeles Lakers': 5.0 } }]),
    ];
    expect(findArbitrageOpportunities(events, { now: NOW })).toHaveLength(0);
  });

  it('still finds the arb when one book is missing an outcome', () => {
    const events = [
      event('ev1', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
      ]),
    ];
    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);
    expect(arbs[0].legs).toHaveLength(2);
  });

  it('handles events with no bookmakers or empty markets', () => {
    const bare = event('ev-bare', []);
    expect(findArbitrageOpportunities([bare], { now: NOW })).toHaveLength(0);
  });
});

describe('filtering, flagging, sorting', () => {
  it('applies the minimum profit threshold', () => {
    const events = [
      // ~1.2% arb: S = 1/2.02 + 1/2.02 = 0.990...
      event('ev-small', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.02, 'Boston Celtics': 1.8 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.8, 'Boston Celtics': 2.02 } },
      ]),
    ];
    expect(findArbitrageOpportunities(events, { now: NOW, minProfitPct: 2 })).toHaveLength(0);
    expect(findArbitrageOpportunities(events, { now: NOW, minProfitPct: 1 })).toHaveLength(1);
  });

  it('flags arbs above the suspicious threshold instead of hiding them', () => {
    const events = [
      // S = 1/2.30 + 1/2.55 ≈ 0.827 → ~20.9% profit. Too good to be true.
      event('ev-sus', [
        { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.3, 'Boston Celtics': 1.5 } },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.5, 'Boston Celtics': 2.55 } },
      ]),
    ];
    const arbs = findArbitrageOpportunities(events, { now: NOW });
    expect(arbs).toHaveLength(1);
    expect(arbs[0].suspicious).toBe(true);
  });

  it('sorts by profit descending and slices to topN', () => {
    const small = event('ev-small', [
      { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.02, 'Boston Celtics': 1.8 } },
      { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.8, 'Boston Celtics': 2.02 } },
    ]);
    const big = event('ev-big', [
      { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 } },
      { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
    ]);

    const all = findArbitrageOpportunities([small, big], { now: NOW });
    expect(all.map((a) => a.eventId)).toEqual(['ev-big', 'ev-small']);

    const top1 = findArbitrageOpportunities([small, big], { now: NOW, topN: 1 });
    expect(top1.map((a) => a.eventId)).toEqual(['ev-big']);
  });
});

describe('links', () => {
  it('prefers outcome link, then bookmaker link, then null', () => {
    const events = [
      event('ev1', [
        {
          key: 'fanduel',
          prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 },
          link: 'https://fanduel.example/event',
          outcomeLinks: { 'Los Angeles Lakers': 'https://fanduel.example/bet/lakers' },
        },
        { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
      ]),
    ];
    const [arb] = findArbitrageOpportunities(events, { now: NOW });
    const home = arb.legs.find((l) => l.outcome === 'Los Angeles Lakers')!;
    const away = arb.legs.find((l) => l.outcome === 'Boston Celtics')!;
    expect(home.link).toBe('https://fanduel.example/bet/lakers');
    expect(away.link).toBeNull(); // draftkings gave no link; fallback happens upstream
  });
});
