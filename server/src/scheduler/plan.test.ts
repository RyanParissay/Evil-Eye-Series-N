import { describe, expect, it } from 'vitest';
import type { SchedulerSettings } from '@shared/types';
import { SEED_SCHEDULER_BLOCKS } from '../ops/opsStore';
import { plan, type PlanInput } from './plan';
import { isQuietHours, nextQuietEndMs, vancouverEpochOf } from './vancouverTime';

const SCORE_POLL_MS = 5 * 60_000;

/** 2026-01-15 is a Thursday (PST); 15:00 sits in the 14:00–19:00 dense
 *  block (interval 15). */
function at(min: number, date: [number, number, number] = [2026, 1, 15]): Date {
  return new Date(vancouverEpochOf(date[0], date[1], date[2], min));
}

function settings(over: Partial<SchedulerSettings> = {}): SchedulerSettings {
  return {
    enabled: true,
    blocks: SEED_SCHEDULER_BLOCKS,
    scanParams: { regionTab: 'ca_us', topN: 5 },
    disabledReason: null,
    ...over,
  };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    settings: settings(),
    now: at(15 * 60),
    lastScanAtMs: null,
    lastScorePollAtMs: at(15 * 60).getTime(), // recently polled unless overridden
    scorePollIntervalMs: SCORE_POLL_MS,
    budget: { monthlyCreditBudget: 20_000, autoStopPct: 95, usedTotal: 0 },
    ...over,
  };
}

describe('plan — global gates', () => {
  it('disabled → sleeps, never scans or polls', () => {
    const action = plan(input({ settings: settings({ enabled: false }) }));
    expect(action.kind).toBe('sleep');
  });

  it('quiet hours → sleeps until the next 08:00, no provider action', () => {
    const now = at(3 * 60); // 03:00, inside quiet hours
    expect(isQuietHours(now)).toBe(true);
    const action = plan(input({ now, lastScanAtMs: null, lastScorePollAtMs: null }));
    expect(action).toEqual({ kind: 'sleep', untilMs: nextQuietEndMs(now) });
  });

  it('budget auto-stop (≥95%) → sleeps even mid-block, no scan or poll', () => {
    const action = plan(
      input({
        lastScanAtMs: null, // would otherwise scan immediately
        lastScorePollAtMs: null, // would otherwise poll
        budget: { monthlyCreditBudget: 20_000, autoStopPct: 95, usedTotal: 19_000 },
      }),
    );
    expect(action.kind).toBe('sleep');
  });

  it('just under the auto-stop threshold still runs', () => {
    const action = plan(
      input({
        lastScanAtMs: null,
        budget: { monthlyCreditBudget: 20_000, autoStopPct: 95, usedTotal: 18_999 },
      }),
    );
    expect(action.kind).toBe('scan');
  });
});

describe('plan — in an active block', () => {
  it('scans immediately when nothing has scanned yet', () => {
    const action = plan(input({ lastScanAtMs: null }));
    expect(action).toEqual({ kind: 'scan', params: { regionTab: 'ca_us', topN: 5 } });
  });

  it('scans when the last scan is older than the block interval', () => {
    const now = at(15 * 60);
    const action = plan(input({ now, lastScanAtMs: now.getTime() - 20 * 60_000 }));
    expect(action.kind).toBe('scan');
  });

  it('sleeps until the next scan is due when it is the nearest event', () => {
    const now = at(15 * 60);
    const lastScanAtMs = now.getTime() - 13 * 60_000; // scan due in 2 min (interval 15)
    // Poll last ran now → next poll in 5 min, so the scan is nearest.
    const action = plan(input({ now, lastScanAtMs, lastScorePollAtMs: now.getTime() }));
    expect(action).toEqual({ kind: 'sleep', untilMs: lastScanAtMs + 15 * 60_000 });
  });

  it('a due score poll fires while waiting for the next scan', () => {
    const now = at(15 * 60);
    const action = plan(
      input({
        now,
        lastScanAtMs: now.getTime() - 5 * 60_000, // scan not due
        lastScorePollAtMs: now.getTime() - 6 * 60_000, // poll due (>5min)
      }),
    );
    expect(action).toEqual({ kind: 'scorePoll' });
  });

  it('scan wins when both a scan and a score poll are due', () => {
    const now = at(15 * 60);
    const action = plan(
      input({
        now,
        lastScanAtMs: now.getTime() - 20 * 60_000,
        lastScorePollAtMs: now.getTime() - 20 * 60_000,
      }),
    );
    expect(action.kind).toBe('scan');
  });
});

describe('plan — outside any block (non-quiet gap)', () => {
  // A block-less schedule: only 09:00–10:00 Mondays. At 15:00 Thursday we
  // are non-quiet but in no block.
  const gapSettings = settings({
    blocks: [{ days: [1], startMin: 9 * 60, endMin: 10 * 60, intervalMins: 15 }],
  });

  it('score-polls if due, even between blocks', () => {
    const now = at(15 * 60);
    const action = plan(
      input({ settings: gapSettings, now, lastScorePollAtMs: null }),
    );
    expect(action).toEqual({ kind: 'scorePoll' });
  });

  it('sleeps toward the next block start when no poll is due', () => {
    const now = at(15 * 60);
    const action = plan(
      input({ settings: gapSettings, now, lastScorePollAtMs: now.getTime() }),
    );
    expect(action.kind).toBe('sleep');
    if (action.kind === 'sleep') expect(action.untilMs).toBeGreaterThan(now.getTime());
  });
});
