import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { findArbitrageOpportunities, priceLegs } from './arbitrage';

describe('priceLegs', () => {
  it('prices a leg set: arb index, profit, per-$100 stake split', () => {
    const { arbIndex, profitPct, stakes } = priceLegs([2.1, 2.12]);
    expect(arbIndex).toBeCloseTo(1 / 2.1 + 1 / 2.12, 6);
    expect(profitPct).toBeCloseTo((1 / arbIndex - 1) * 100, 6);
    expect(stakes[0]).toBeCloseTo((100 * (1 / 2.1)) / arbIndex, 1);
    expect(stakes[0] + stakes[1]).toBeCloseTo(100, 1);
  });

  it('still reports the math when the arb is gone (S ≥ 1)', () => {
    const { arbIndex, profitPct } = priceLegs([1.9, 1.9]);
    expect(arbIndex).toBeGreaterThan(1);
    expect(profitPct).toBeLessThan(0);
  });
});

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

describe('point-based markets (totals / spreads)', () => {
  /** Build an event with one market of arbitrary key and pointed outcomes. */
  function pointEvent(
    id: string,
    marketKey: string,
    books: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }>,
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
        markets: [{ key: marketKey, outcomes: b.outcomes }],
      })),
    };
  }

  it('detects a totals arb when both legs sit on the same line', () => {
    const events = [
      pointEvent('ev-totals', 'totals', [
        {
          key: 'fanduel',
          outcomes: [
            { name: 'Over', price: 2.1, point: 220.5 },
            { name: 'Under', price: 1.8, point: 220.5 },
          ],
        },
        {
          key: 'draftkings',
          outcomes: [
            { name: 'Over', price: 1.85, point: 220.5 },
            { name: 'Under', price: 2.12, point: 220.5 },
          ],
        },
      ]),
    ];

    const arbs = findArbitrageOpportunities(events, { now: NOW, marketKeys: ['totals'] });
    expect(arbs).toHaveLength(1);
    expect(arbs[0].marketKey).toBe('totals');
    const over = arbs[0].legs.find((l) => l.outcome === 'Over')!;
    const under = arbs[0].legs.find((l) => l.outcome === 'Under')!;
    expect(over.bookmakerKey).toBe('fanduel');
    expect(under.bookmakerKey).toBe('draftkings');
    // Legs carry their line so the UI can render "Over 220.5".
    expect(over.point).toBe(220.5);
    expect(under.point).toBe(220.5);
  });

  it('never combines outcomes from different lines into one "arb"', () => {
    // Over 219.5 @ 2.10 + Under 221.5 @ 2.12 gives S < 1 numerically, but if
    // the total lands on 220 or 221 BOTH bets lose — it is not an arbitrage.
    const events = [
      pointEvent('ev-totals-mixed', 'totals', [
        { key: 'fanduel', outcomes: [{ name: 'Over', price: 2.1, point: 219.5 }] },
        { key: 'draftkings', outcomes: [{ name: 'Under', price: 2.12, point: 221.5 }] },
      ]),
    ];
    expect(
      findArbitrageOpportunities(events, { now: NOW, marketKeys: ['totals'] }),
    ).toHaveLength(0);
  });

  it('matches spread legs by mirrored points (−3.5 pairs with +3.5)', () => {
    const events = [
      pointEvent('ev-spreads', 'spreads', [
        {
          key: 'fanduel',
          outcomes: [
            { name: 'Los Angeles Lakers', price: 2.1, point: -3.5 },
            { name: 'Boston Celtics', price: 1.8, point: 3.5 },
          ],
        },
        {
          key: 'draftkings',
          outcomes: [
            { name: 'Los Angeles Lakers', price: 1.85, point: -3.5 },
            { name: 'Boston Celtics', price: 2.12, point: 3.5 },
          ],
        },
      ]),
    ];

    const arbs = findArbitrageOpportunities(events, { now: NOW, marketKeys: ['spreads'] });
    expect(arbs).toHaveLength(1);
    const lakers = arbs[0].legs.find((l) => l.outcome === 'Los Angeles Lakers')!;
    expect(lakers.point).toBe(-3.5);
    expect(lakers.odds).toBe(2.1);
  });

  it('does not pair spread legs across different lines (−3.5 vs +4.5)', () => {
    const events = [
      pointEvent('ev-spreads-mixed', 'spreads', [
        { key: 'fanduel', outcomes: [{ name: 'Los Angeles Lakers', price: 2.1, point: -3.5 }] },
        { key: 'draftkings', outcomes: [{ name: 'Boston Celtics', price: 2.12, point: 4.5 }] },
      ]),
    ];
    expect(
      findArbitrageOpportunities(events, { now: NOW, marketKeys: ['spreads'] }),
    ).toHaveLength(0);
  });

  it('evaluates each line independently and can find arbs on two lines at once', () => {
    const arbBooks = (point: number) => [
      {
        key: 'fanduel',
        outcomes: [
          { name: 'Over', price: 2.1, point },
          { name: 'Under', price: 1.8, point },
        ],
      },
      {
        key: 'draftkings',
        outcomes: [
          { name: 'Over', price: 1.85, point },
          { name: 'Under', price: 2.12, point },
        ],
      },
    ];
    // One event whose totals market quotes two lines, both arbitrageable.
    const both = pointEvent('ev-two-lines', 'totals', [
      { key: 'fanduel', outcomes: [...arbBooks(219.5)[0].outcomes, ...arbBooks(221.5)[0].outcomes] },
      { key: 'draftkings', outcomes: [...arbBooks(219.5)[1].outcomes, ...arbBooks(221.5)[1].outcomes] },
    ]);
    const arbs = findArbitrageOpportunities([both], { now: NOW, marketKeys: ['totals'] });
    expect(arbs).toHaveLength(2);
    const lines = arbs.flatMap((a) => a.legs.map((l) => Math.abs(l.point!))).sort();
    expect(new Set(lines)).toEqual(new Set([219.5, 221.5]));
  });

  it('keeps scanning h2h and totals side by side when both are requested', () => {
    const h2h = event('ev-h2h', [
      { key: 'fanduel', prices: { 'Los Angeles Lakers': 2.1, 'Boston Celtics': 1.8 } },
      { key: 'draftkings', prices: { 'Los Angeles Lakers': 1.85, 'Boston Celtics': 2.12 } },
    ]);
    const totals = pointEvent('ev-totals', 'totals', [
      {
        key: 'fanduel',
        outcomes: [
          { name: 'Over', price: 2.1, point: 220.5 },
          { name: 'Under', price: 1.8, point: 220.5 },
        ],
      },
      {
        key: 'draftkings',
        outcomes: [
          { name: 'Over', price: 1.85, point: 220.5 },
          { name: 'Under', price: 2.12, point: 220.5 },
        ],
      },
    ]);
    const arbs = findArbitrageOpportunities([h2h, totals], {
      now: NOW,
      marketKeys: ['h2h', 'totals'],
    });
    expect(arbs.map((a) => a.marketKey).sort()).toEqual(['h2h', 'totals']);
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
