import { describe, expect, it } from 'vitest';
import type { SchedulerSettings } from '@shared/types';
import { SEED_SCHEDULER_BLOCKS } from '../ops/opsStore';
import { plan, type PlanInput } from './plan';
import { denseWeekEndMs } from './denseWeek';
import {
  isQuietHours,
  nextQuietEndMs,
  nextVancouverMidnightMs,
  vancouverEpochOf,
} from './vancouverTime';

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
    confirmation: { pendingCount: 0, latestSeenAtMs: null, lastScanParams: null },
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

describe('plan — confirmation pairs (Phase 16 Part A)', () => {
  const INTERVAL_MS = 60_000; // default confirmationIntervalSecs = 60

  /** A pair whose scan A ran `agoMs` before `now`. */
  function pairInput(agoMs: number, over: Partial<PlanInput> = {}): PlanInput {
    const now = at(15 * 60);
    const scanAt = now.getTime() - agoMs;
    return input({
      now,
      lastScanAtMs: scanAt,
      confirmation: {
        pendingCount: 2,
        latestSeenAtMs: scanAt,
        lastScanParams: { regionTab: 'ca', topN: 3 },
      },
      ...over,
    });
  }

  it('scan B fires once the interval has elapsed, with the LAST scan’s fetch scope', () => {
    const action = plan(pairInput(INTERVAL_MS));
    expect(action).toEqual({ kind: 'confirmScan', params: { regionTab: 'ca', topN: 3 } });
  });

  it('falls back to the scheduler’s own scanParams when no last-scan scope exists', () => {
    const base = pairInput(INTERVAL_MS);
    const action = plan({
      ...base,
      confirmation: { ...base.confirmation, lastScanParams: null },
    });
    expect(action).toEqual({ kind: 'confirmScan', params: { regionTab: 'ca_us', topN: 5 } });
  });

  it('before the interval it sleeps exactly to the due time — never past a pending pair', () => {
    const in20s = pairInput(INTERVAL_MS - 20_000);
    const action = plan(in20s);
    expect(action).toEqual({ kind: 'sleep', untilMs: in20s.now.getTime() + 20_000 });
  });

  it('honors a custom confirmationIntervalSecs', () => {
    const action = plan(
      pairInput(90_000, { settings: settings({ confirmationIntervalSecs: 120 }) }),
    );
    expect(action).toEqual({ kind: 'sleep', untilMs: at(15 * 60).getTime() + 30_000 });
  });

  it('scan B fires even while the scheduler is DISABLED — a manual pair completes with the toggle off', () => {
    const action = plan(pairInput(INTERVAL_MS, { settings: settings({ enabled: false }) }));
    expect(action.kind).toBe('confirmScan');
  });

  it('while disabled and not yet due, the sleep still wakes at the due time', () => {
    const in20s = pairInput(INTERVAL_MS - 20_000, { settings: settings({ enabled: false }) });
    expect(plan(in20s)).toEqual({ kind: 'sleep', untilMs: in20s.now.getTime() + 20_000 });
  });

  it('scan B rides scan A’s authorization past the budget stop (manual scans are never budget-gated)', () => {
    const action = plan(
      pairInput(INTERVAL_MS, {
        budget: { monthlyCreditBudget: 20_000, autoStopPct: 95, usedTotal: 19_500 },
      }),
    );
    expect(action.kind).toBe('confirmScan');
  });

  it('quiet hours block scan B; the sleep wakes at the pair’s expiry so it resolves promptly', () => {
    const now = at(60 + 30); // 01:30, inside quiet hours
    const scanAt = now.getTime() - INTERVAL_MS; // due mid-quiet
    const action = plan(
      pairInput(0, {
        now,
        lastScanAtMs: scanAt,
        confirmation: { pendingCount: 1, latestSeenAtMs: scanAt, lastScanParams: null },
      }),
    );
    // Expiry (scanA + 6× interval) is hours before 08:00 — wake there.
    expect(action).toEqual({ kind: 'sleep', untilMs: scanAt + 6 * INTERVAL_MS });
  });

  it('past 5× the interval after its due time, the pair resolves to single_sighting — even disabled, even in quiet hours', () => {
    // In quiet hours, disabled, and long past expiry: resolving is
    // bookkeeping (zero credits), so nothing may block it.
    const now = at(60 + 30); // 01:30
    const scanAt = now.getTime() - 7 * INTERVAL_MS;
    const action = plan(
      pairInput(0, {
        now,
        settings: settings({ enabled: false }),
        lastScanAtMs: scanAt,
        confirmation: { pendingCount: 1, latestSeenAtMs: scanAt, lastScanParams: null },
      }),
    );
    expect(action).toEqual({ kind: 'resolveConfirmations' });
  });

  it('failed scan-B attempts slide the due time (no tight retry loop) but never the expiry', () => {
    const now = at(15 * 60);
    const scanAt = now.getTime() - 5 * INTERVAL_MS; // sightings anchor
    // A failed attempt 30s ago pushes the next try to +30s from now…
    const retry = plan(
      pairInput(0, {
        now,
        lastScanAtMs: now.getTime() - 30_000,
        confirmation: { pendingCount: 1, latestSeenAtMs: scanAt, lastScanParams: null },
      }),
    );
    expect(retry).toEqual({ kind: 'sleep', untilMs: now.getTime() + 30_000 });
    // …but once past sightings + 6× interval, attempts stop mattering.
    const expired = plan(
      pairInput(0, {
        now,
        lastScanAtMs: now.getTime() - 30_000,
        confirmation: {
          pendingCount: 1,
          latestSeenAtMs: now.getTime() - 7 * INTERVAL_MS,
          lastScanParams: null,
        },
      }),
    );
    expect(expired).toEqual({ kind: 'resolveConfirmations' });
  });

  it('a pending pair with no sighting anchor resolves rather than hanging or guessing', () => {
    const action = plan(
      pairInput(0, {
        confirmation: { pendingCount: 1, latestSeenAtMs: null, lastScanParams: null },
      }),
    );
    expect(action).toEqual({ kind: 'resolveConfirmations' });
  });
});

describe('plan — dense data-gathering week (Phase 16 Part C.3)', () => {
  const startedAtMs = at(8 * 60).getTime(); // 08:00 Jan 15
  const endsAtMs = denseWeekEndMs(startedAtMs);

  /** Dense-week input, active by default, at 15:00 (inside a normal block). */
  function denseInput(over: Partial<PlanInput> = {}, dense: Partial<NonNullable<PlanInput['denseWeek']>> = {}): PlanInput {
    const now = at(15 * 60);
    return input({
      now,
      lastScanAtMs: null,
      lastScorePollAtMs: now.getTime(),
      denseWeek: {
        active: true,
        endsAtMs,
        intervalMins: 9,
        dayCreditsUsed: 0,
        weekCreditsUsed: 0,
        ...dense,
      },
      ...over,
    });
  }

  it('scans at the derived interval, overriding the normal block cadence', () => {
    const action = plan(denseInput());
    expect(action).toEqual({ kind: 'scan', params: { regionTab: 'ca_us', topN: 5 } });
  });

  it('overrides the enabled gate — runs even while the scheduler is DISABLED', () => {
    const action = plan(denseInput({ settings: settings({ enabled: false }) }));
    expect(action.kind).toBe('scan');
  });

  it('sleeps to exactly the derived interval when a scan is not yet due', () => {
    const now = at(15 * 60);
    const action = plan(
      denseInput({ now, lastScanAtMs: now.getTime() - 4 * 60_000 }), // due in 5 min (interval 9)
    );
    expect(action).toEqual({ kind: 'sleep', untilMs: now.getTime() - 4 * 60_000 + 9 * 60_000 });
  });

  it('daily hard cap (≥4,500/day) → stops, sleeping to the next local midnight', () => {
    const now = at(15 * 60);
    const action = plan(denseInput({ now }, { dayCreditsUsed: 4_500 }));
    expect(action).toEqual({ kind: 'sleep', untilMs: nextVancouverMidnightMs(now) });
  });

  it('resumes the next local day — a fresh day’s zero spend scans again', () => {
    // Same fixture, but now it is the next local day and the day counter reset.
    const nextDay = at(9 * 60, [2026, 1, 16]);
    const action = plan(denseInput({ now: nextDay }, { dayCreditsUsed: 0, weekCreditsUsed: 4_500 }));
    expect(action.kind).toBe('scan');
  });

  it('weekly hard cap (≥30,000/week) → stops for the week, sleeping to the dense-week end', () => {
    const action = plan(denseInput({}, { weekCreditsUsed: 30_000, dayCreditsUsed: 100 }));
    expect(action).toEqual({ kind: 'sleep', untilMs: endsAtMs });
  });

  it('the 95% monthly auto-stop still applies on top of the dense caps', () => {
    const action = plan(
      denseInput({
        budget: { monthlyCreditBudget: 20_000, autoStopPct: 95, usedTotal: 19_500 },
      }),
    );
    expect(action.kind).toBe('sleep');
  });

  it('quiet hours stay absolute during a dense week', () => {
    const now = at(3 * 60); // 03:00, inside quiet hours
    const action = plan(denseInput({ now, lastScorePollAtMs: null }));
    expect(action).toEqual({ kind: 'sleep', untilMs: nextQuietEndMs(now) });
  });

  it('an expired/absent dense week falls back to normal block cadence', () => {
    const inactive = plan(denseInput({}, { active: false }));
    expect(inactive.kind).toBe('scan'); // 15:00 is inside a normal block, so it still scans
    // but a normal-mode DISABLED scheduler with no dense week stays dormant:
    const dormant = plan(
      denseInput({ settings: settings({ enabled: false }) }, { active: false }),
    );
    expect(dormant.kind).toBe('sleep');
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
