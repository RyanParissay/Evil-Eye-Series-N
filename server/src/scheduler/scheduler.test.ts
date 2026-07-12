import { describe, expect, it } from 'vitest';
import type { OpsSettings } from '@shared/types';
import { ProviderError } from '../providers/OddsProvider';
import { DEFAULT_OPS_SETTINGS } from '../ops/opsStore';
import { denseWeekSpend } from './denseWeek';
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
  confirms: number[]; // …at each confirmation scan B
  resolves: number[]; // …at each lapsed-pair resolution
  polls: number[];
  /** The store-derived pending-pair summary plan reads. Tests (and the
   *  default runScan/runConfirmScan fakes) mutate it like recordScan would. */
  pending: { count: number; latestSeenAtMs: number | null };
  lastScanAt: number | null;
  deps: SchedulerDeps;
  settings: OpsSettings;
  disabledReason: string | null;
}

function wire(
  h: Harness,
  opts: {
    settings?: OpsSettings;
    runScan?: (params: { regionTab: string; topN: number }) => Promise<void>;
    runConfirmScan?: (params: { regionTab: string; topN: number }) => Promise<void>;
    usedTotal?: number | null;
  } = {},
): Recorder {
  const rec: Recorder = {
    scans: [],
    confirms: [],
    resolves: [],
    polls: [],
    pending: { count: 0, latestSeenAtMs: null },
    lastScanAt: null,
    disabledReason: null,
    settings: opts.settings ?? opsSettings(),
    deps: null as unknown as SchedulerDeps,
  };
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
        rec.lastScanAt = h.current;
      }),
    runConfirmScan:
      opts.runConfirmScan ??
      (async () => {
        rec.confirms.push(h.current);
        rec.lastScanAt = h.current;
        rec.pending = { count: 0, latestSeenAtMs: null }; // pair evaluated
      }),
    resolveConfirmations: async () => {
      rec.resolves.push(h.current);
      rec.pending = { count: 0, latestSeenAtMs: null };
    },
    pendingConfirmation: async () => rec.pending,
    lastScanParams: async () => null,
    pollGrading: async () => {
      rec.polls.push(h.current);
    },
    lastScanAtMs: async () => rec.lastScanAt,
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

describe('Scheduler — confirmation pairs (Phase 16 Part A; injectable timer, no test sleeps)', () => {
  it('a scan that leaves candidates gets its scan B exactly 60s later; the pair then closes', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h);
    // Every scheduled scan A leaves one candidate pending, like recordScan would.
    rec.deps.runScan = async () => {
      rec.scans.push(h.current);
      rec.lastScanAt = h.current;
      rec.pending = { count: 1, latestSeenAtMs: h.current };
    };
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 40 * 60_000);
    s.stop();

    expect(rec.scans.length).toBeGreaterThanOrEqual(2);
    expect(rec.confirms.length).toBe(rec.scans.length); // one B per A, no more
    rec.confirms.forEach((confirmAt, i) => {
      expect(confirmAt - rec.scans[i]).toBe(60_000);
    });
    expect(rec.resolves).toEqual([]);
  });

  it('no candidates → no scan B, ever', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h); // default runScan leaves pending at {0, null}
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 60 * 60_000);
    s.stop();
    expect(rec.scans.length).toBeGreaterThan(0);
    expect(rec.confirms).toEqual([]);
    expect(rec.resolves).toEqual([]);
  });

  it('a MANUAL scan’s pair completes with the scheduler toggle OFF — B fires server-side at +60s', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 15 * 60));
    const rec = wire(h, { settings: opsSettings({ enabled: false }) });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current); // settle the dormant tick
    // A manual scan lands via the route: history + pending move, then the
    // notifier wakes the scheduler (index.ts wiring).
    const scanAt = h.current;
    rec.lastScanAt = scanAt;
    rec.pending = { count: 1, latestSeenAtMs: scanAt };
    s.wake();
    await h.advanceTo(scanAt + 5 * 60_000);
    s.stop();
    expect(rec.scans).toEqual([]); // disabled: the scheduler ran no scan A of its own
    expect(rec.confirms).toEqual([scanAt + 60_000]);
  });

  it('quiet hours: a pair due at 01:00 never scans; it resolves to single_sighting at expiry (5× past due)', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 59)); // 00:59, one minute before quiet
    const rec = wire(h, { settings: opsSettings({ enabled: false }) });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current);
    const scanAt = h.current;
    rec.lastScanAt = scanAt;
    rec.pending = { count: 1, latestSeenAtMs: scanAt };
    s.wake();
    await h.advanceTo(scanAt + 30 * 60_000); // deep into quiet hours
    s.stop();
    expect(rec.confirms).toEqual([]); // zero provider calls in quiet hours
    // Resolution is bookkeeping (zero credits): scanA + interval + 5×interval.
    expect(rec.resolves).toEqual([scanAt + 6 * 60_000]);
  });

  it('a scan B hitting spent quota self-disables, retries stay bounded, and the pair resolves honestly', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    let attempts = 0;
    const rec = wire(h, {
      runConfirmScan: async () => {
        attempts += 1;
        throw new ProviderError('out of credits', 'quota_exhausted', 401);
      },
    });
    rec.deps.runScan = async () => {
      rec.scans.push(h.current);
      rec.lastScanAt = h.current;
      rec.pending = { count: 1, latestSeenAtMs: h.current };
    };
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 60 * 60_000);
    s.stop();
    expect(rec.disabledReason).toMatch(/credits are spent/i);
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThanOrEqual(6); // due slides per attempt; expiry is fixed
    expect(rec.resolves.length).toBe(1); // the pair resolved, never confirmed
    expect(rec.confirms).toEqual([]);
  });
});

describe('Scheduler — dense data-gathering week (Phase 16 Part C.3; injectable clock, no sleeps)', () => {
  /** A dense week starting now; denseWeekInputs returns fixed spend + cost. */
  function wireDense(
    h: Harness,
    inputs: { dayCreditsUsed: number; weekCreditsUsed: number; perPairCost: number },
    schedulerEnabled = false,
  ): Recorder {
    const startedAt = new Date(h.current).toISOString();
    const rec = wire(h, {
      settings: opsSettings({
        enabled: schedulerEnabled,
        denseWeek: { startedAt },
      }),
    });
    rec.deps.denseWeekInputs = async () => inputs;
    let cleared = 0;
    rec.deps.clearDenseWeek = async () => {
      cleared += 1;
    };
    (rec as Recorder & { cleared: () => number }).cleared = () => cleared;
    return rec;
  }

  it('scans at the derived interval even with the scheduler DISABLED (user-authorized)', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    // perPairCost 39 → interval 9 min. Under both caps → scans every 9 min.
    const rec = wireDense(h, { dayCreditsUsed: 100, weekCreditsUsed: 100, perPairCost: 39 });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 40 * 60_000); // 40 min
    s.stop();
    expect(rec.scans.length).toBeGreaterThanOrEqual(4); // ~40/9
    for (let i = 1; i < rec.scans.length; i++) {
      expect(rec.scans[i] - rec.scans[i - 1]).toBeGreaterThanOrEqual(9 * 60_000 - 1);
    }
  });

  it('the daily cap halts scheduled scanning for the local day', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wireDense(h, { dayCreditsUsed: 4_500, weekCreditsUsed: 4_500, perPairCost: 39 });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 6 * 3_600_000); // rest of the day (still before midnight)
    s.stop();
    expect(rec.scans).toEqual([]); // capped: zero scheduled scans
  });

  it('the weekly cap halts scheduled scanning for the week', async () => {
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wireDense(h, { dayCreditsUsed: 100, weekCreditsUsed: 30_000, perPairCost: 39 });
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current + 20 * 3_600_000);
    s.stop();
    expect(rec.scans).toEqual([]);
  });

  it('acceptance: pairs accumulate to the 4,500/day cap → scanning stops that day, resumes next local day', async () => {
    // Faithful end-to-end: each scheduled scan appends a real scan-history
    // line, denseWeekInputs measures the day/week spend from it (no injected
    // cap), and the derived interval lets ~9 scans/day reach 4,500 credits.
    const startVan = vancouverEpochOf(2026, 1, 15, 8 * 60); // 08:00 Thu — day starts
    const h = new Harness(startVan);
    const scanLog: { scannedAt: string; creditsComputed: number }[] = [];
    const startedAtMs = h.current;
    const CREDITS_PER_SCAN = 500; // 9 scans → exactly 4,500
    const rec = wire(h, {
      settings: opsSettings({ enabled: false, denseWeek: { startedAt: new Date(startedAtMs).toISOString() } }),
    });
    rec.deps.runScan = async () => {
      rec.scans.push(h.current);
      rec.lastScanAt = h.current;
      scanLog.push({ scannedAt: new Date(h.current).toISOString(), creditsComputed: CREDITS_PER_SCAN });
    };
    // perPairCost = 500 → interval = ceil(1020×500/4500) = 114 min.
    rec.deps.denseWeekInputs = async (startMs, at) => ({
      ...denseWeekSpend(startMs, at, scanLog),
      perPairCost: CREDITS_PER_SCAN,
    });
    rec.deps.clearDenseWeek = async () => {};
    const s = new Scheduler(rec.deps);
    s.start();

    // Run to the end of the local day (08:00 → 24:00).
    await h.advanceTo(startVan + 16 * 3_600_000);
    const day1Scans = rec.scans.length;
    expect(day1Scans * CREDITS_PER_SCAN).toBeLessThanOrEqual(4_500); // cap never exceeded
    expect(day1Scans).toBeGreaterThanOrEqual(8); // and the cap actually binds

    // Advance into the next local day — the day counter resets and it scans again.
    await h.advanceTo(vancouverEpochOf(2026, 1, 16, 10 * 60));
    expect(rec.scans.length).toBeGreaterThan(day1Scans);
  });

  it('an expired dense week clears itself and falls back to normal blocks', async () => {
    // Start the clock 8 days after the dense week began → expired.
    const startedAt = vancouverEpochOf(2026, 1, 7, 14 * 60);
    const h = new Harness(vancouverEpochOf(2026, 1, 15, 14 * 60));
    const rec = wire(h, {
      settings: opsSettings({
        enabled: false,
        denseWeek: { startedAt: new Date(startedAt).toISOString() },
      }),
    });
    let cleared = 0;
    rec.deps.denseWeekInputs = async () => ({ dayCreditsUsed: 0, weekCreditsUsed: 0, perPairCost: 39 });
    rec.deps.clearDenseWeek = async () => {
      cleared += 1;
    };
    const s = new Scheduler(rec.deps);
    s.start();
    await h.advanceTo(h.current); // one tick
    s.stop();
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect(rec.scans).toEqual([]); // disabled + no dense week → dormant
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
