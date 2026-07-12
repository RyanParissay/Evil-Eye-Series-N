import { describe, expect, it } from 'vitest';
import type { OpsSettings } from '../../shared/types';
import { budgetState, windowState } from './cadence';

// July 2026: the 20th is a Monday, the 25th a Saturday. Local-time Dates.
const MON = (h: number, m = 0) => new Date(2026, 6, 20, h, m);
const SAT = (h: number, m = 0) => new Date(2026, 6, 25, h, m);

function settings(overrides: Partial<OpsSettings> = {}): OpsSettings {
  return {
    weekday: { startMinutes: 18 * 60 + 30, endMinutes: 22 * 60 + 30 },
    weekend: { startMinutes: 12 * 60, endMinutes: 22 * 60 + 30 },
    inWindowMins: 5,
    outWindowMins: null,
    monthlyCreditBudget: 20_000,
    autoStopPct: 95,
    markets: { totals: false, spreads: false },
    confirmSecondSighting: false,
    ...overrides,
  };
}

describe('windowState', () => {
  it('boundary behavior: start inclusive, end exclusive', () => {
    expect(windowState(settings(), MON(18, 29)).inWindow).toBe(false);
    expect(windowState(settings(), MON(18, 30)).inWindow).toBe(true);
    expect(windowState(settings(), MON(22, 29)).inWindow).toBe(true);
    expect(windowState(settings(), MON(22, 30)).inWindow).toBe(false);
  });

  it('picks the weekend window on weekends', () => {
    expect(windowState(settings(), MON(13, 0)).inWindow).toBe(false); // weekday: not yet
    expect(windowState(settings(), SAT(13, 0)).inWindow).toBe(true); // weekend: 12:00 start
  });

  it('cadence switches between in-window, out-of-window, and sleeping', () => {
    expect(windowState(settings(), MON(19, 0)).cadenceMins).toBe(5);
    expect(windowState(settings(), MON(10, 0)).cadenceMins).toBeNull(); // out, default off
    expect(windowState(settings({ outWindowMins: 30 }), MON(10, 0)).cadenceMins).toBe(30);
  });

  it('midnight-spanning windows work on both sides of midnight', () => {
    const night = settings({ weekday: { startMinutes: 23 * 60, endMinutes: 60 } }); // 23:00–01:00
    expect(windowState(night, MON(23, 30)).inWindow).toBe(true);
    expect(windowState(night, MON(0, 30)).inWindow).toBe(true);
    expect(windowState(night, MON(12, 0)).inWindow).toBe(false);
    expect(windowState(night, MON(1, 0)).inWindow).toBe(false); // end exclusive
  });

  it('labels the mode for the scan page', () => {
    expect(windowState(settings(), MON(19, 0)).label).toBe('IN WINDOW');
    expect(windowState(settings(), MON(10, 0)).label).toBe('OUT OF WINDOW');
  });
});

describe('budgetState', () => {
  // Mid-month noon: exactly half the month elapsed on a 30-day July? July
  // has 31 days — use the function's own projection, assert relations.
  it('projects month-end burn and warns when it exceeds budget', () => {
    const mid = new Date(2026, 6, 16, 12, 0); // just past halfway
    const calm = budgetState(settings(), 8_000, mid);
    expect(calm.projectedMonthEnd).toBeGreaterThan(8_000);
    expect(calm.warning).toBe(false);

    const hot = budgetState(settings(), 12_000, mid);
    expect(hot.projectedMonthEnd).toBeGreaterThan(20_000);
    expect(hot.warning).toBe(true);
    expect(hot.stopped).toBe(false); // 12k < 95% of 20k
  });

  it('hard stop engages at the ceiling and releases on rollover or budget raise', () => {
    const now = new Date(2026, 6, 20, 12, 0);
    expect(budgetState(settings(), 19_000, now).stopped).toBe(true); // 95% of 20k
    expect(budgetState(settings(), 18_999, now).stopped).toBe(false);
    // Month rollover: the provider counter resets → usedTotal drops → released.
    expect(budgetState(settings(), 40, new Date(2026, 7, 1, 0, 5)).stopped).toBe(false);
    // Budget raise moves the ceiling → released.
    expect(budgetState(settings({ monthlyCreditBudget: 40_000 }), 19_000, now).stopped).toBe(false);
  });

  it('no usage data → no projection, no stop', () => {
    const state = budgetState(settings(), null, new Date(2026, 6, 20));
    expect(state).toEqual({ projectedMonthEnd: null, warning: false, stopped: false });
  });
});
