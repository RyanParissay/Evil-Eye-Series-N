import { describe, expect, it } from 'vitest';
import type { OpsSettings } from '@shared/types';
import { ProviderError } from '../providers/OddsProvider';
import { DEFAULT_OPS_SETTINGS } from '../ops/opsStore';
import { Scheduler, type SchedulerDeps } from './scheduler';
import { QUIET_END_MIN, QUIET_START_MIN, vancouverEpochOf, vancouverLocal } from './vancouverTime';

const SCORE_POLL_MS = 5 * 60_000;

/** A hand-driven clock + timer wheel. No real time passes: advanceTo fires
 *  every due timer in order, letting each async tick settle in between. */
class Harness {
  current: number;
  private seq = 0;
  private timers = new Map<number, { fireAt: number; fn: () => void }>();

  constructor(startMs: number) {
    this.current = startMs;
  }

  now = (): Date => new Date(this.current);
  setTimer = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.timers.set(id, { fireAt: this.current + ms, fn });
    return id;
  };
  clearTimer = (h: unknown): void => {
    this.timers.delete(h as number);
  };

  private earliestDue(upTo: number): { id: number; fireAt: number; fn: () => void } | null {
    let best: { id: number; fireAt: number; fn: () => void } | null = null;
    for (const [id, t] of this.timers) {
      if (t.fireAt <= upTo && (best === null || t.fireAt < best.fireAt)) best = { id, ...t };
    }
    return best;
  }

  async advanceTo(target: number): Promise<void> {
    let guard = 0;
    while (guard++ < 100_000) {
      const next = this.earliestDue(target);
      if (!next) break;
      this.timers.delete(next.id);
      this.current = next.fireAt;
      next.fn();
      await new Promise((r) => setImmediate(r)); // let the async tick settle + re-arm
    }
    this.current = target;
  }
}

function opsSettings(over: Partial<OpsSettings['scheduler']> = {}, top?: Partial<OpsSettings>): OpsSettings {
  return {
    ...DEFAULT_OPS_SETTINGS,
    ...top,
    scheduler: { ...DEFAULT_OPS_SETTINGS.scheduler, enabled: true, ...over },
  };
}

interface Recorder {
  scans: number[]; // fake-now epoch ms at each scan
  polls: number[];
  deps: SchedulerDeps;
  settings: OpsSettings;
  disabledReason: string | null;
}

function wire(
  h: Harness,
  opts: {
    settings?: OpsSettings;
    runScan?: (params: { regionTab: string; topN: number }) => Promise<void>;
    usedTotal?: number | null;
  } = {},
): Recorder {
  const rec: Recorder = {
    scans: [],
    polls: [],
    disabledReason: null,
    settings: opts.settings ?? opsSettings(),
    deps: null as unknown as SchedulerDeps,
  };
  let lastScan: number | null = null;
  rec.deps = {
    now: h.now,
    setTimer: h.setTimer,
    clearTimer: h.clearTimer,
    readSettings: async () => rec.settings,
    disable: async (reason) => {
      rec.disabledReason = reason;
      rec.settings = {
        ...rec.settings,
        scheduler: { ...rec.settings.scheduler, enabled: false, disabledReason: reason },
      };
    },
    runScan:
      opts.runScan ??
      (async () => {
        rec.scans.push(h.current);
        lastScan = h.current;
      }),
    pollGrading: async () => {
      rec.polls.push(h.current);
    },
    lastScanAtMs: async () => lastScan,
    usedTotal: async () => opts.usedTotal ?? 0,
    scorePollIntervalMs: SCORE_POLL_MS,
    maxSleepMs: 26 * 3_600_000, // large: precise sleeps, few iterations
    log: () => {},
  };
  return rec;
}

function inQuietWindow(ms: number): boolean {
  const m = vancouverLocal(new Date(ms)).minutesOfDay;
  return m >= QUIET_START_MIN && m < QUIET_END_MIN;
}

describe('Scheduler — self-rescheduling tick', () => {
  it('does nothing while disabled, however long it runs', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 15 * 60));
    const rec = wire(h, { settings: opsSettings({ enabled: false }) });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 12 * 3_600_000);
    s.stop();
    expect(rec.scans).toEqual([]);
    expect(rec.polls).toEqual([]);
  });

  it('scans on the block cadence and never scans faster than the interval', async () => {
    // 14:00–19:00 dense, interval 15. Run one hour → ~4–5 scans, none closer
    // than 15 min apart.
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h);
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(vancouverEpochOf(2026, 1, 15, 15 * 60)); // one hour
    s.stop();
    expect(rec.scans.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < rec.scans.length; i++) {
      expect(rec.scans[i] - rec.scans[i - 1]).toBeGreaterThanOrEqual(15 * 60_000 - 1);
    }
  });

  it('holds the budget auto-stop — no scans at ≥95% of budget', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h, { usedTotal: 19_000 }); // 95% of 20,000
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 3 * 3_600_000);
    s.stop();
    expect(rec.scans).toEqual([]);
  });

  it('self-disables on a spent-quota provider error and goes dormant', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h, {
      runScan: async () => {
        throw new ProviderError('out of credits', 'quota_exhausted', 401);
      },
    });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 2 * 3_600_000);
    s.stop();
    expect(rec.disabledReason).toMatch(/credits are spent/i);
    expect(rec.settings.scheduler.enabled).toBe(false);
    expect(rec.scans).toEqual([]); // the throwing runScan recorded nothing
    expect(rec.polls).toEqual([]); // dormant after self-disable
  });

  it('wake() re-plans immediately when enabled mid-sleep', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h, { settings: opsSettings({ enabled: false }) });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current); // settle the initial dormant tick
    expect(rec.scans).toEqual([]);
    // Operator flips it on, then wakes the scheduler.
    rec.settings = opsSettings();
    s.wake();
    await h.advanceTo(h.current); // no time passes; the wake tick scans now
    s.stop();
    expect(rec.scans.length).toBe(1);
  });
});

describe('Scheduler — DST-safe quiet hours over a simulated 24h', () => {
  for (const [label, date] of [
    ['PST (winter, UTC-8)', [2026, 1, 15] as const],
    ['PDT (summer, UTC-7)', [2026, 7, 15] as const],
  ] as const) {
    it(`${label}: zero provider calls 01:00–08:00, some outside it`, async () => {
      const start = vancouverEpochOf(date[0], date[1], date[2], 0); // local midnight
      const h = new Harness(start);
      const rec = wire(h);
      const s = new Scheduler(rec.deps);
      s.start();
      // A full local day. (Neither date straddles a DST switch, so +24h lands
      // on the next local midnight.)
      await h.advanceTo(start + 24 * 3_600_000);
      s.stop();

      const inQuiet = [...rec.scans, ...rec.polls].filter(inQuietWindow);
      expect(inQuiet).toEqual([]); // the whole point: silent 01:00–08:00
      expect(rec.scans.length).toBeGreaterThan(0); // it did work outside quiet
      expect(rec.polls.length).toBeGreaterThan(0);
      // And every scan sat inside a real block (never in the 01:00–08:00 gap).
      for (const t of rec.scans) {
        const m = vancouverLocal(new Date(t)).minutesOfDay;
        expect(m >= QUIET_END_MIN || m < QUIET_START_MIN).toBe(true);
      }
    });
  }
});
