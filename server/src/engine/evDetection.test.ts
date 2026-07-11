import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { findEvBets } from './evDetection';

const NOW = new Date('2026-07-20T12:00:00Z');
const FRESH = '2026-07-20T11:55:00Z'; // 5 min old
const STALE = '2026-07-20T11:30:00Z'; // 30 min old
const FUTURE = '2026-07-20T19:00:00Z';

const SETTINGS = { showMinEdgePct: 1, maxOdds: 4, maxBenchmarkAgeMins: 15 };

interface BookSpec {
  key: string;
  lastUpdate?: string;
  outcomes: Array<{ name: string; price: number; point?: number }>;
  marketKey?: string;
}

function event(id: string, books: BookSpec[], commenceTime = FUTURE): OddsEvent {
  return {
    id,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime,
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    bookmakers: books.map((b) => ({
      key: b.key,
      title: b.key.toUpperCase(),
      lastUpdate: b.lastUpdate ?? FRESH,
      markets: [{ key: b.marketKey ?? 'h2h', outcomes: b.outcomes }],
    })),
  };
}

const BENCH_EVEN = {
  key: 'pinnacle',
  outcomes: [
    { name: 'Los Angeles Lakers', price: 1.95 },
    { name: 'Boston Celtics', price: 1.95 },
  ],
};

describe('findEvBets', () => {
  it('hand fixture: fair 0.5 × offered 2.15 → 7.5% edge, exact', () => {
    const events = [
      event('ev1', [
        BENCH_EVEN,
        { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 2.15 }] },
      ]),
    ];
    const bets = findEvBets(events, ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW });
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({
      eventId: 'ev1',
      marketKey: 'h2h',
      outcome: 'Los Angeles Lakers',
      bookmakerKey: 'bet365',
      odds: 2.15,
    });
    expect(bets[0].ev.fairProbability).toBeCloseTo(0.5, 9);
    expect(bets[0].ev.edgePct).toBeCloseTo(7.5, 6);
    expect(bets[0].ev.benchmarkOdds).toBe(1.95);
  });

  it('3-way with draw: edges computed against skewed fair probabilities', () => {
    const events = [
      event('ev3', [
        {
          key: 'pinnacle',
          outcomes: [
            { name: 'Arsenal', price: 2.5 },
            { name: 'Draw', price: 3.3 },
            { name: 'Chelsea', price: 3.1 },
          ],
        },
        { key: 'bet365', outcomes: [{ name: 'Draw', price: 3.7 }] },
      ]),
    ];
    const bets = findEvBets(events, ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW });
    expect(bets).toHaveLength(1);
    const M = 1 / 2.5 + 1 / 3.3 + 1 / 3.1;
    const pDraw = 1 / 3.3 / M;
    expect(bets[0].ev.fairProbability).toBeCloseTo(pDraw, 9);
    expect(bets[0].ev.edgePct).toBeCloseTo((pDraw * 3.7 - 1) * 100, 2); // stored at 2dp
  });

  it('guards: below-threshold edge, longshot odds, stale benchmark, commenced events', () => {
    const base = [
      BENCH_EVEN,
      { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 2.01 }] }, // 0.5% edge
    ];
    expect(findEvBets([event('low', base)], ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW })).toHaveLength(0);

    const longshot = [
      { key: 'pinnacle', outcomes: [{ name: 'Los Angeles Lakers', price: 8 }, { name: 'Boston Celtics', price: 1.08 }] },
      { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 10 }] }, // huge edge, odds > 4
    ];
    expect(findEvBets([event('long', longshot)], ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW })).toHaveLength(0);

    const stale = [
      { ...BENCH_EVEN, lastUpdate: STALE },
      { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 2.15 }] },
    ];
    expect(findEvBets([event('stale', stale)], ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW })).toHaveLength(0);

    const commenced = event('gone', [
      BENCH_EVEN,
      { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 2.15 }] },
    ], '2026-07-20T11:00:00Z');
    expect(findEvBets([commenced], ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW })).toHaveLength(0);
  });

  it('line-group discipline: benchmark on a different line contributes nothing', () => {
    const events = [
      event('lines', [
        {
          key: 'pinnacle',
          marketKey: 'totals',
          outcomes: [
            { name: 'Over', price: 1.95, point: 221.5 },
            { name: 'Under', price: 1.95, point: 221.5 },
          ],
        },
        {
          key: 'bet365',
          marketKey: 'totals',
          outcomes: [{ name: 'Over', price: 2.15, point: 220.5 }],
        },
      ]),
    ];
    expect(findEvBets(events, ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW })).toHaveLength(0);
  });

  it('only allowlisted books produce bets; the benchmark itself never does', () => {
    const events = [
      event('who', [
        BENCH_EVEN,
        { key: 'bet365', outcomes: [{ name: 'Los Angeles Lakers', price: 2.15 }] },
        { key: 'shadybook', outcomes: [{ name: 'Los Angeles Lakers', price: 2.5 }] },
      ]),
    ];
    const bets = findEvBets(events, ['bet365'], ['pinnacle'], { ...SETTINGS, now: NOW });
    expect(bets.map((b) => b.bookmakerKey)).toEqual(['bet365']);
  });
});
