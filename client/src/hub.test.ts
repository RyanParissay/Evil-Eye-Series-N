import { describe, expect, it } from 'vitest';
import type { HubPosition, HubProfileReport } from '../../shared/types';
import {
  describeStake,
  equityToProfitCurve,
  filterPositions,
  openBets,
  openBetStatus,
  openStakeTotal,
  placedLabel,
  resultLabel,
  timeUntilLabel,
} from './hub';

function position(overrides: Partial<HubPosition> = {}): HubPosition {
  return {
    purchase: { at: '2026-07-01T00:00:00.000Z', recordId: 'r1', strategy: 'arb', stake: 50 },
    eventName: 'Away @ Home',
    sportTitle: 'NBA',
    commenceTime: '2026-07-01T02:00:00.000Z',
    ...overrides,
  };
}

describe('filterPositions', () => {
  const arbWin = position({
    purchase: { at: '1', recordId: 'a', strategy: 'arb', stake: 50 },
    result: 'win',
    pnl: 4.2,
  });
  const evLoss = position({
    purchase: { at: '2', recordId: 'b', strategy: 'ev', stake: 50 },
    result: 'loss',
    pnl: -50,
  });
  const middlePending = position({
    purchase: { at: '3', recordId: 'c', strategy: 'middle', stake: 25 },
  });
  const arbPush = position({
    purchase: { at: '4', recordId: 'd', strategy: 'arb', stake: 50 },
    result: 'push',
    pnl: 0,
  });
  const all = [arbWin, evLoss, middlePending, arbPush];

  it('returns everything when both filters are "all"', () => {
    expect(filterPositions(all, { strategy: 'all', result: 'all' })).toEqual(all);
  });

  it('narrows by strategy', () => {
    expect(filterPositions(all, { strategy: 'arb', result: 'all' })).toEqual([arbWin, arbPush]);
    expect(filterPositions(all, { strategy: 'ev', result: 'all' })).toEqual([evLoss]);
    expect(filterPositions(all, { strategy: 'middle', result: 'all' })).toEqual([middlePending]);
  });

  it('narrows by graded result', () => {
    expect(filterPositions(all, { strategy: 'all', result: 'win' })).toEqual([arbWin]);
    expect(filterPositions(all, { strategy: 'all', result: 'loss' })).toEqual([evLoss]);
    expect(filterPositions(all, { strategy: 'all', result: 'push' })).toEqual([arbPush]);
  });

  it('treats "pending" as ungraded (no result field)', () => {
    expect(filterPositions(all, { strategy: 'all', result: 'pending' })).toEqual([middlePending]);
  });

  it('combines strategy and result filters', () => {
    expect(filterPositions(all, { strategy: 'arb', result: 'win' })).toEqual([arbWin]);
    expect(filterPositions(all, { strategy: 'arb', result: 'pending' })).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterPositions(all, { strategy: 'middle', result: 'win' })).toEqual([]);
  });
});

describe('equityToProfitCurve', () => {
  it('rebases bankroll points to cumulative profit against the starting bankroll', () => {
    const equity = [
      { at: '2026-07-01T00:00:00.000Z', bankroll: 1050 },
      { at: '2026-07-02T00:00:00.000Z', bankroll: 1005 },
    ];
    expect(equityToProfitCurve(equity, 1000)).toEqual([
      { at: '2026-07-01T00:00:00.000Z', cumulativeProfit: 50 },
      { at: '2026-07-02T00:00:00.000Z', cumulativeProfit: 5 },
    ]);
  });

  it('rounds to cents', () => {
    const equity = [{ at: 't', bankroll: 1000.006 }];
    expect(equityToProfitCurve(equity, 1000)).toEqual([{ at: 't', cumulativeProfit: 0.01 }]);
  });

  it('returns an empty array for an empty curve', () => {
    expect(equityToProfitCurve([], 1000)).toEqual([]);
  });
});

describe('describeStake', () => {
  it('describes a flat stake', () => {
    expect(describeStake({ type: 'flat', value: 50 })).toBe('$50 flat');
  });

  it('describes a percent-of-start stake', () => {
    expect(describeStake({ type: 'pctOfStart', value: 5 })).toBe('5% of start');
  });
});

describe('resultLabel', () => {
  it('labels every grade result', () => {
    expect(resultLabel('win')).toBe('Win');
    expect(resultLabel('loss')).toBe('Loss');
    expect(resultLabel('push')).toBe('Push');
    expect(resultLabel('void')).toBe('Void');
  });

  it('labels an ungraded position as Pending', () => {
    expect(resultLabel(undefined)).toBe('Pending');
  });
});

/* ————— Open Bets (the fourth Hub segment) ————— */

function report(
  id: string,
  name: string,
  positions: HubPosition[],
): HubProfileReport {
  return {
    profile: {
      id,
      name,
      premade: true,
      startingBankroll: 1000,
      stake: { type: 'flat', value: 50 },
      strategies: ['arb'],
      minEdgePct: 0,
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    simulated: true,
    bankroll: 1000,
    pnl: 0,
    roiPct: 0,
    betCount: positions.length,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    pending: positions.filter((p) => p.result === undefined).length,
    exposure: 0,
    maxDrawdown: 0,
    skipped: { count: 0, events: [] },
    equity: [],
    positions,
  };
}

describe('timeUntilLabel', () => {
  it('reads "<1m" under a minute', () => {
    expect(timeUntilLabel(0)).toBe('<1m');
    expect(timeUntilLabel(59_000)).toBe('<1m');
  });

  it('reads minutes under an hour', () => {
    expect(timeUntilLabel(12 * 60_000)).toBe('12m');
    expect(timeUntilLabel(59 * 60_000)).toBe('59m');
  });

  it('reads hours + minutes under a day, dropping a zero-minute remainder', () => {
    expect(timeUntilLabel((3 * 60 + 12) * 60_000)).toBe('3h 12m');
    expect(timeUntilLabel(3 * 60 * 60_000)).toBe('3h');
  });

  it('reads days + hours from 24h up, dropping a zero-hour remainder', () => {
    expect(timeUntilLabel(26 * 60 * 60_000)).toBe('1d 2h');
    expect(timeUntilLabel(48 * 60 * 60_000)).toBe('2d');
  });

  it('floors, never rounds up (an honest countdown)', () => {
    expect(timeUntilLabel(12 * 60_000 + 59_000)).toBe('12m');
  });
});

describe('openBetStatus', () => {
  const now = new Date('2026-07-10T18:00:00.000Z');

  it('is upcoming with a countdown before commence', () => {
    expect(openBetStatus('2026-07-10T21:12:00.000Z', now)).toEqual({
      kind: 'upcoming',
      countdown: '3h 12m',
    });
  });

  it('is in_play once commence has passed (including exactly at commence)', () => {
    expect(openBetStatus('2026-07-10T17:00:00.000Z', now)).toEqual({ kind: 'in_play' });
    expect(openBetStatus('2026-07-10T18:00:00.000Z', now)).toEqual({ kind: 'in_play' });
  });

  it('is unknown for a missing or unparseable commence time', () => {
    expect(openBetStatus('', now)).toEqual({ kind: 'unknown' });
    expect(openBetStatus('not-a-date', now)).toEqual({ kind: 'unknown' });
  });
});

describe('placedLabel', () => {
  // Local-time constructions keep these assertions timezone-independent.
  const now = new Date(2026, 6, 10, 18, 30);

  it('shows a clock time for a bet placed today', () => {
    expect(placedLabel(new Date(2026, 6, 10, 14, 14).toISOString(), now)).toBe('2:14 PM');
    expect(placedLabel(new Date(2026, 6, 10, 9, 5).toISOString(), now)).toBe('9:05 AM');
  });

  it('handles midnight and noon in 12-hour terms', () => {
    expect(placedLabel(new Date(2026, 6, 10, 0, 0).toISOString(), now)).toBe('12:00 AM');
    expect(placedLabel(new Date(2026, 6, 10, 12, 0).toISOString(), now)).toBe('12:00 PM');
  });

  it('says "yesterday" for the previous calendar day', () => {
    expect(placedLabel(new Date(2026, 6, 9, 23, 59).toISOString(), now)).toBe('yesterday');
    expect(placedLabel(new Date(2026, 6, 9, 0, 1).toISOString(), now)).toBe('yesterday');
  });

  it('shows month + day for anything older this year', () => {
    expect(placedLabel(new Date(2026, 6, 8, 12, 0).toISOString(), now)).toBe('Jul 8');
    expect(placedLabel(new Date(2026, 0, 2, 12, 0).toISOString(), now)).toBe('Jan 2');
  });

  it('appends the year across a year boundary', () => {
    expect(placedLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe('Dec 31, 2025');
  });

  it('falls back to a dash for an unparseable timestamp', () => {
    expect(placedLabel('not-a-date', now)).toBe('—');
  });
});

describe('openBets', () => {
  const inPlay = position({
    purchase: { at: '2026-07-10T14:00:00.000Z', recordId: 'in-play', strategy: 'middle', stake: 25 },
    eventName: 'Jays @ Yankees',
    commenceTime: '2026-07-10T17:00:00.000Z',
  });
  const soon = position({
    purchase: { at: '2026-07-10T12:00:00.000Z', recordId: 'soon', strategy: 'arb', stake: 50 },
    eventName: 'Aces @ Liberty',
    commenceTime: '2026-07-10T20:00:00.000Z',
  });
  const tomorrow = position({
    purchase: { at: '2026-07-10T15:00:00.000Z', recordId: 'tomorrow', strategy: 'ev', stake: 40 },
    eventName: 'Union @ Fire',
    commenceTime: '2026-07-11T20:00:00.000Z',
  });
  const graded = position({
    purchase: { at: '2026-07-09T15:00:00.000Z', recordId: 'graded', strategy: 'arb', stake: 50 },
    commenceTime: '2026-07-09T20:00:00.000Z',
    result: 'win',
    pnl: 4.2,
  });
  const noCommence = position({
    purchase: { at: '2026-07-10T16:00:00.000Z', recordId: 'no-commence', strategy: 'ev', stake: 30 },
    commenceTime: '',
  });

  it('flattens pending positions across profiles, tagged with their profile', () => {
    const bets = openBets([report('p1', 'Arb', [inPlay, graded]), report('p2', 'EV', [soon])]);
    expect(bets.map((b) => b.position.purchase.recordId)).toEqual(['in-play', 'soon']);
    expect(bets.map((b) => b.profileName)).toEqual(['Arb', 'EV']);
    expect(bets.map((b) => b.profileId)).toEqual(['p1', 'p2']);
  });

  it('sorts soonest-to-resolve first: in-play, then ascending commence, unknown last', () => {
    const bets = openBets([
      report('p1', 'Arb', [tomorrow, noCommence]),
      report('p2', 'EV', [soon, inPlay]),
    ]);
    expect(bets.map((b) => b.position.purchase.recordId)).toEqual([
      'in-play',
      'soon',
      'tomorrow',
      'no-commence',
    ]);
  });

  it('breaks commence ties by newest purchase first', () => {
    const early = position({
      purchase: { at: '2026-07-10T10:00:00.000Z', recordId: 'early', strategy: 'arb', stake: 50 },
      commenceTime: '2026-07-10T20:00:00.000Z',
    });
    const late = position({
      purchase: { at: '2026-07-10T11:00:00.000Z', recordId: 'late', strategy: 'arb', stake: 50 },
      commenceTime: '2026-07-10T20:00:00.000Z',
    });
    const bets = openBets([report('p1', 'Arb', [early, late])]);
    expect(bets.map((b) => b.position.purchase.recordId)).toEqual(['late', 'early']);
  });

  it('returns an empty list when every position is graded', () => {
    expect(openBets([report('p1', 'Arb', [graded])])).toEqual([]);
  });

  it('keeps the same record held by two profiles as two distinct bets', () => {
    const bets = openBets([report('p1', 'Arb', [soon]), report('p2', 'Custom', [soon])]);
    expect(bets).toHaveLength(2);
    expect(new Set(bets.map((b) => b.profileId)).size).toBe(2);
  });
});

describe('openStakeTotal', () => {
  it('sums the server-provided stakes, rounded to cents', () => {
    const bets = openBets([
      report('p1', 'Arb', [
        position({ purchase: { at: '1', recordId: 'a', strategy: 'arb', stake: 50.1 } }),
        position({ purchase: { at: '2', recordId: 'b', strategy: 'ev', stake: 25.55 } }),
        position({ purchase: { at: '3', recordId: 'c', strategy: 'middle', stake: 24.45 } }),
      ]),
    ]);
    expect(openStakeTotal(bets)).toBe(100.1);
  });

  it('is zero for no bets', () => {
    expect(openStakeTotal([])).toBe(0);
  });
});
