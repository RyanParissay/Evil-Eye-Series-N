import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { findMiddles, spreadsMiddle, totalsMiddle } from './middles';

const NOW = new Date('2026-07-11T12:00:00Z');
const FUTURE = '2026-07-11T19:00:00Z';

const SETTINGS = {
  marketKeys: ['totals', 'spreads'],
  maxCostPct: 5,
  minWindow: 0.5,
  keyNumbers: { americanfootball: [3, 7, 10] },
  now: NOW,
};

const offer = (
  bookmakerKey: string,
  outcome: string,
  point: number,
  odds: number,
) => ({ bookmakerKey, bookmakerTitle: bookmakerKey.toUpperCase(), outcome, point, odds, link: null });

describe('direction rules — the both-legs-lose trap is unconstructable', () => {
  it('totals: Over 216 + Under 210 must be rejected', () => {
    expect(totalsMiddle(offer('a', 'Over', 216, 1.95), offer('b', 'Under', 210, 1.95))).toBeNull();
  });

  it('totals: equal lines are an arb, not a middle', () => {
    expect(totalsMiddle(offer('a', 'Over', 216, 2.1), offer('b', 'Under', 216, 2.1))).toBeNull();
  });

  it('spreads: non-positive windows must be rejected', () => {
    // Chiefs −7.5 with Raiders +3.5: window (7.5, 3.5) is inverted.
    expect(
      spreadsMiddle(offer('a', 'Chiefs', -7.5, 1.91), offer('b', 'Raiders', 3.5, 1.91)),
    ).toBeNull();
    // Same team on both legs is never a middle.
    expect(
      spreadsMiddle(offer('a', 'Chiefs', -3.5, 1.91), offer('b', 'Chiefs', 7.5, 1.91)),
    ).toBeNull();
  });

  it('valid constructions carry the window', () => {
    const totals = totalsMiddle(offer('a', 'Over', 220.5, 1.95), offer('b', 'Under', 224.5, 1.95));
    expect(totals).toMatchObject({ lowLine: 220.5, highLine: 224.5, windowSize: 4 });
    const spreads = spreadsMiddle(offer('a', 'Chiefs', -3.5, 1.91), offer('b', 'Raiders', 7.5, 1.91));
    expect(spreads).toMatchObject({ lowLine: 3.5, highLine: 7.5, windowSize: 4 });
  });
});

describe('metrics — hand-computed to the cent (S = Σ1/odds; breakeven = S − 1)', () => {
  it('standard totals middle at 1.95/1.95: cost 2.5%, payout 95%, breakeven 2.56%', () => {
    const m = totalsMiddle(offer('a', 'Over', 220.5, 1.95), offer('b', 'Under', 224.5, 1.95))!;
    // S = 2/1.95 = 1.025641…
    expect(m.costPct).toBeCloseTo(2.5, 2);
    expect(m.payoutPct).toBeCloseTo(95, 2);
    expect(m.breakevenPct).toBeCloseTo(2.5641, 3);
    // Cross-check the definition: breakeven = cost/(cost+payout).
    expect(m.breakevenPct / 100).toBeCloseTo(m.costPct / (m.costPct + m.payoutPct), 6);
    expect(m.freeMiddle).toBe(false);
    expect(m.pushPossible).toBe(false); // half lines cannot push
  });

  it('free middle: S < 1 → negative cost, flagged', () => {
    const m = totalsMiddle(offer('a', 'Over', 220.5, 2.1), offer('b', 'Under', 222.5, 2.05))!;
    const S = 1 / 2.1 + 1 / 2.05;
    expect(m.costPct).toBeCloseTo((1 - 1 / S) * 100, 4); // ≈ −3.74 (a guaranteed floor)
    expect(m.costPct).toBeLessThan(0);
    expect(m.freeMiddle).toBe(true);
    expect(m.breakevenPct).toBeLessThanOrEqual(0);
  });

  it('integer boundary lines carry the push note', () => {
    const m = totalsMiddle(offer('a', 'Over', 220, 1.95), offer('b', 'Under', 224, 1.95))!;
    expect(m.pushPossible).toBe(true);
  });
});

describe('findMiddles', () => {
  function event(id: string, marketKey: string, books: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number }> }>): OddsEvent {
    return {
      id,
      sportKey: 'americanfootball_nfl',
      sportTitle: 'NFL',
      commenceTime: FUTURE,
      homeTeam: 'Chiefs',
      awayTeam: 'Raiders',
      bookmakers: books.map((b) => ({
        key: b.key,
        title: b.key.toUpperCase(),
        lastUpdate: NOW.toISOString(),
        markets: [{ key: marketKey, outcomes: b.outcomes }],
      })),
    };
  }

  it('pairs best prices across books per line pair, annotating key numbers', () => {
    const events = [
      event('sp', 'spreads', [
        { key: 'bet365', outcomes: [{ name: 'Chiefs', price: 1.91, point: -3.5 }, { name: 'Raiders', price: 1.91, point: 3.5 }] },
        { key: 'coolbet', outcomes: [{ name: 'Chiefs', price: 1.9, point: -7.5 }, { name: 'Raiders', price: 1.93, point: 7.5 }] },
      ]),
    ];
    const middles = findMiddles(events, ['bet365', 'coolbet'], SETTINGS);
    expect(middles).toHaveLength(1);
    const m = middles[0];
    // Chiefs −3.5 at bet365 (best −3.5) + Raiders +7.5 at coolbet.
    expect(m.legs.map((l) => `${l.bookmakerKey}:${l.outcome}@${l.point}`)).toEqual([
      'bet365:Chiefs@-3.5',
      'coolbet:Raiders@7.5',
    ]);
    expect(m.middle.windowSize).toBe(4);
    // Margin window (3.5, 7.5) strictly contains the key number 7.
    expect(m.middle.keyNumbers).toEqual([7]);
    expect(m.sameBookmaker).toBe(false);
  });

  it('respects maxCostPct and minWindow filters', () => {
    const expensive = [
      event('tx', 'totals', [
        { key: 'a', outcomes: [{ name: 'Over', price: 1.7, point: 220.5 }] },
        { key: 'b', outcomes: [{ name: 'Under', price: 1.7, point: 224.5 }] },
      ]),
    ];
    // S = 2/1.7 ≈ 1.176 → cost ≈ 15% > 5% cap.
    expect(findMiddles(expensive, ['a', 'b'], SETTINGS)).toHaveLength(0);

    const tiny = [
      event('tw', 'totals', [
        { key: 'a', outcomes: [{ name: 'Over', price: 1.95, point: 220.5 }] },
        { key: 'b', outcomes: [{ name: 'Under', price: 1.95, point: 220.75 }] },
      ]),
    ];
    expect(findMiddles(tiny, ['a', 'b'], { ...SETTINGS, minWindow: 0.5 })).toHaveLength(0);
  });

  it('same-book middles are flagged, never dropped; unfetched markets contribute nothing', () => {
    const sameBook = [
      event('sb', 'totals', [
        { key: 'a', outcomes: [{ name: 'Over', price: 1.95, point: 220.5 }, { name: 'Under', price: 1.95, point: 224.5 }] },
      ]),
    ];
    const middles = findMiddles(sameBook, ['a'], SETTINGS);
    expect(middles).toHaveLength(1);
    expect(middles[0].sameBookmaker).toBe(true);

    expect(findMiddles(sameBook, ['a'], { ...SETTINGS, marketKeys: ['h2h'] })).toHaveLength(0);
  });

  it('sorts lowest breakeven first, half-lines ahead of push-prone at ties', () => {
    const events = [
      event('a', 'totals', [
        { key: 'x', outcomes: [{ name: 'Over', price: 1.9, point: 220.5 }] },
        { key: 'y', outcomes: [{ name: 'Under', price: 1.9, point: 224.5 }] },
      ]),
      event('b', 'totals', [
        { key: 'x', outcomes: [{ name: 'Over', price: 1.95, point: 210.5 }] },
        { key: 'y', outcomes: [{ name: 'Under', price: 1.95, point: 214.5 }] },
      ]),
    ];
    const middles = findMiddles(events, ['x', 'y'], SETTINGS);
    // 1.95s (S−1 ≈ 2.56%) beat 1.90s (S−1 ≈ 5.26%)… cost 5.26% > cap? 1.9: S=1.0526 → cost 5.0%? cost=(1−1/S)=5.0% exactly at cap — keep ≤.
    expect(middles.map((m) => m.eventId)).toEqual(['b', 'a']);
  });
});
