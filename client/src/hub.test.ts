import { describe, expect, it } from 'vitest';
import type { HubPosition } from '../../shared/types';
import { describeStake, equityToProfitCurve, filterPositions, resultLabel } from './hub';

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
