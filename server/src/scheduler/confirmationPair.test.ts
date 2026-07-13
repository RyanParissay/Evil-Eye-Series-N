/**
 * Phase 16 Part A acceptance fixtures (binding, from the phase spec) — the
 * full pair pipeline composed the way index.ts composes it: real runScan,
 * real OpportunityService, real Scheduler tick, real WhatsApp dispatch, a
 * counting fake provider and a hand-driven clock/timer (no test sleeps).
 *
 *  1. Scan A with no eligible candidates → no scan B; the provider call
 *     counter (the credit counter) proves it.
 *  2. Scan A with candidates → scan B fires at exactly +60s, server-side,
 *     with the scheduler toggle OFF (the manual-scan/browser-closed case);
 *     the confirmed record alerts exactly once.
 *  3. The ±0.5 pp rule rejects a drifted pair → single_sighting, never
 *     alerted — and survival telemetry is blind to all of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OddsEvent,
  OpportunityRecord,
  OpsSettings,
  ScanLogEntry,
  ScanMeta,
} from '@shared/types';
import { regionTabByKey } from '@shared/regionTabs';
import { DEFAULT_OPS_SETTINGS } from '../ops/opsStore';
import { seedScanParams } from '../ops/opsStore';
import { computeSurvival } from '../ops/survivalService';
import {
  isPendingCandidate,
  matchConfirmationPair,
  recordToOpportunity,
} from '../opportunities/confirmation';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import { notifyNewOpportunities } from '../notifications/alertService';
import type { WhatsAppData, WhatsAppDataStore } from '../notifications/subscriptionStore';
import type { WhatsAppSender } from '../notifications/whatsappSender';
import type {
  FetchOddsParams,
  OddsProvider,
  OddsResult,
  SportsResult,
} from '../providers/OddsProvider';
import { runScan, type ScanDeps } from '../scan/scanService';
import type { ScanStore } from '../scan/scanStore';
import { Scheduler } from './scheduler';
import { vancouverEpochOf } from './vancouverTime';

const CA_TAB = regionTabByKey('ca')!;

/** Hand-driven clock + timer wheel (the scheduler.test harness). */
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
      await settle(); // let the async tick (scan B included) fully land
    }
    this.current = target;
  }
}

/** Drain the microtask/immediate queues so fire-and-forget work lands. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** In-memory OpportunityStore. */
class MemOpportunityStore implements OpportunityDataStore {
  constructor(public data: OpportunityData = { records: [] }) {}
  async read(): Promise<OpportunityData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: OpportunityData,
    ) => { data: OpportunityData; result: T } | Promise<{ data: OpportunityData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class MemWhatsAppStore implements WhatsAppDataStore {
  constructor(public data: WhatsAppData) {}
  async read(): Promise<WhatsAppData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: WhatsAppData,
    ) => { data: WhatsAppData; result: T } | Promise<{ data: WhatsAppData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class MemSender implements WhatsAppSender {
  readonly mode = 'console' as const;
  sent: Array<{ to: string; body: string }> = [];
  async send(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

/** One h2h event priced by two CA-accessible books; odds are mutable so
 *  a test can drift the edge between scans A and B. */
function makeEvent(
  h: Harness,
  homeOdds: number,
  awayOdds: number,
  sport: { key: string; title: string; eventId: string } = {
    key: 'basketball_nba',
    title: 'NBA',
    eventId: 'evt-1',
  },
): OddsEvent {
  const at = new Date(h.current).toISOString();
  return {
    id: sport.eventId,
    sportKey: sport.key,
    sportTitle: sport.title,
    commenceTime: new Date(h.current + 8 * 3_600_000).toISOString(),
    homeTeam: 'Celtics',
    awayTeam: 'Lakers',
    bookmakers: [
      {
        key: 'bet365',
        title: 'Bet365',
        lastUpdate: at,
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Celtics', price: homeOdds },
              { name: 'Lakers', price: 1.5 },
            ],
          },
        ],
      },
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        lastUpdate: at,
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Celtics', price: 1.5 },
              { name: 'Lakers', price: awayOdds },
            ],
          },
        ],
      },
    ],
  };
}

interface World {
  h: Harness;
  provider: { fetchCalls: number };
  events: OddsEvent[]; // mutable between scans
  /** Sports whose odds fetch fails (rate limit / outage) — mutable per scan. */
  failSports: Set<string>;
  scanLog: ScanLogEntry[];
  sender: MemSender;
  opportunityService: OpportunityService;
  records: () => OpportunityRecord[];
  scheduler: Scheduler;
  scanA: () => Promise<void>; // a manual scan, like POST /api/scan
  stop: () => void;
}

/** Compose the world exactly the way index.ts composes it. */
function makeWorld(opts: { sports?: Array<{ key: string; title: string }> } = {}): World {
  const h = new Harness(vancouverEpochOf(2026, 1, 15, 15 * 60)); // 15:00 PST
  const sports = opts.sports ?? [{ key: 'basketball_nba', title: 'NBA' }];
  const events: OddsEvent[] = [];
  const failSports = new Set<string>();
  const scanLog: ScanLogEntry[] = [];
  let lastMeta: ScanMeta | null = null;

  const provider = {
    fetchCalls: 0,
    mode: 'mock' as const,
    async listSports(): Promise<SportsResult> {
      return {
        sports: sports.map((s) => ({
          key: s.key,
          title: s.title,
          group: 'b',
          active: true,
          hasOutrights: false,
        })),
        usage: { requestsUsedTotal: 100, requestsRemainingTotal: 900, creditsCharged: 0 },
      };
    },
    async fetchOdds(sport: string, params: FetchOddsParams): Promise<OddsResult> {
      provider.fetchCalls += 1;
      if (failSports.has(sport)) throw new Error(`rate limited: ${sport}`);
      const credits = params.markets.length * params.regions.length;
      return {
        events: events.filter((e) => e.sportKey === sport),
        usage: { requestsUsedTotal: 100, requestsRemainingTotal: 900, creditsCharged: credits },
      };
    },
    async fetchScores(): Promise<never> {
      throw new Error('the pair pipeline never fetches scores');
    },
  } satisfies OddsProvider & { fetchCalls: number };

  const memStore = new MemOpportunityStore();
  const opportunityService = new OpportunityService(
    memStore,
    { append: async () => {} },
    h.now,
  );

  const waStore = new MemWhatsAppStore({
    subscriptions: [
      {
        phoneE164: '+14165551234',
        thresholdPercent: 2,
        verified: true,
        active: true,
        failedSendCount: 0,
        verification: null,
        sendTimestamps: [],
        createdAt: h.now().toISOString(),
        updatedAt: h.now().toISOString(),
      },
    ],
    sentAlerts: [],
    lastDeliveryFailure: null,
  });
  const sender = new MemSender();

  // index.ts's onConfirmed fan-out, consumer #1 (arb dispatch is enough here).
  async function onConfirmed(records: OpportunityRecord[]): Promise<void> {
    if (records.length === 0) return;
    const opportunities = records.map(recordToOpportunity).filter((o) => !o.ev && !o.middle);
    const { sentFingerprints } = await notifyNewOpportunities(
      { store: waStore, sender, now: h.now },
      opportunities,
    );
    await opportunityService.markAlerted(sentFingerprints);
  }

  const scanDeps: ScanDeps = {
    provider,
    store: {
      async read() {
        return lastMeta;
      },
      async write(meta: ScanMeta) {
        lastMeta = meta;
      },
    } as unknown as ScanStore,
    now: h.now,
    opportunityLog: opportunityService,
    scanLog: {
      async append(entry) {
        scanLog.push(entry);
      },
    },
    notifier: async () => {
      scheduler.wake(); // index.ts's notifier wake — arms the pending pair
    },
  };

  const settings: OpsSettings = { ...DEFAULT_OPS_SETTINGS }; // scheduler DISABLED — the live config
  const scheduler = new Scheduler({
    now: h.now,
    setTimer: h.setTimer,
    clearTimer: h.clearTimer,
    readSettings: async () => settings,
    disable: async () => {},
    runScan: async () => {
      throw new Error('a disabled scheduler must never run its own scan A');
    },
    // Verbatim index.ts composition of scan B:
    runConfirmScan: async (params) => {
      const before = await opportunityService.pendingConfirmations();
      if (before.length === 0) return;
      const tab = regionTabByKey(params.regionTab)!;
      const { meta } = await runScan(scanDeps, { topN: params.topN, tab });
      // Coverage: only sports scan B SUCCESSFULLY fetched may judge
      // candidates — meta.sportsScanned is every ATTEMPTED sport, so
      // subtract the failures.
      const failed = new Set(meta.sportsFailed);
      const covered = new Set(meta.sportsScanned.filter((s) => !failed.has(s)));
      const after = await opportunityService.list();
      const confirmed = await opportunityService.applyConfirmations(
        matchConfirmationPair(before, after, h.now(), covered),
      );
      await onConfirmed(confirmed);
    },
    resolveConfirmations: async () => {
      await opportunityService.expirePendingConfirmations();
    },
    pendingConfirmation: async () => {
      const candidates = (await opportunityService.pendingConfirmations()).filter(
        isPendingCandidate,
      );
      return {
        count: candidates.length,
        latestSeenAtMs:
          candidates.length > 0
            ? Math.max(...candidates.map((r) => Date.parse(r.lastSeenAt)))
            : null,
      };
    },
    lastScanParams: async () =>
      lastMeta ? seedScanParams({ regionTab: lastMeta.regionTab, topN: lastMeta.topN }) : null,
    pollGrading: async () => {},
    lastScanAtMs: async () =>
      scanLog.length > 0 ? Date.parse(scanLog[scanLog.length - 1].scannedAt) : null,
    usedTotal: async () => null,
    scorePollIntervalMs: 5 * 60_000,
    maxSleepMs: 26 * 3_600_000,
    log: () => {},
  });
  scheduler.start();

  return {
    h,
    provider,
    events,
    failSports,
    scanLog,
    sender,
    opportunityService,
    records: () => memStore.data.records,
    scheduler,
    scanA: async () => {
      await runScan(scanDeps, { topN: 5, tab: CA_TAB });
      await settle(); // the fire-and-forget notifier (wake) lands
    },
    stop: () => scheduler.stop(),
  };
}

describe('confirmation pair — acceptance fixtures (Phase 16 Part A)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('scan A with NO eligible candidates → no scan B; the credit counter proves it', async () => {
    const w = makeWorld();
    // A 50%-profit "arb" (odds 3.0/3.0) is flagged suspicious — visible,
    // never acted on, and therefore NOT a candidate.
    w.events.push(makeEvent(w.h, 3.0, 3.0));
    await w.scanA();
    expect(w.provider.fetchCalls).toBe(1);
    expect(w.scanLog).toHaveLength(1);
    expect(w.scanLog[0].confirmationCandidates).toBe(0);
    expect(w.records()[0].suspicious).toBe(true);
    expect(w.records()[0].confirmation).toBeUndefined();

    await w.h.advanceTo(w.h.current + 30 * 60_000);
    w.stop();
    // Zero extra credits: no scan B ran, no history line, no alert.
    expect(w.provider.fetchCalls).toBe(1);
    expect(w.scanLog).toHaveLength(1);
    expect(w.sender.sent).toEqual([]);
  });

  it('scan A with candidates → B fires at exactly +60s (scheduler OFF, browser closed); confirmed → exactly one alert', async () => {
    const w = makeWorld();
    w.events.push(makeEvent(w.h, 2.1, 2.1)); // ~5% arb, stable across A and B
    const scanAAt = w.h.current;
    await w.scanA();

    // Scan A returned: candidate pending, NOT alerted.
    expect(w.scanLog[0].confirmationCandidates).toBe(1);
    expect(w.records()[0].confirmation).toMatchObject({ status: 'pending' });
    expect(w.sender.sent).toHaveLength(0);

    // Just before the interval: still no scan B.
    await w.h.advanceTo(scanAAt + 59_000);
    expect(w.provider.fetchCalls).toBe(1);

    await w.h.advanceTo(scanAAt + 30 * 60_000);
    w.stop();

    // Scan B ran exactly once, at scanA + 60s (the second history line).
    expect(w.provider.fetchCalls).toBe(2);
    expect(w.scanLog).toHaveLength(2);
    expect(Date.parse(w.scanLog[1].scannedAt)).toBe(scanAAt + 60_000);

    // Confirmed with zero drift, alerted exactly once, dedup holds after.
    const [record] = w.records();
    expect(record.confirmation).toMatchObject({ status: 'confirmed', edgeDeltaPp: 0 });
    expect(record.confirmation?.scanBAt).toBe(new Date(scanAAt + 60_000).toISOString());
    // Phase 18: scan B's fresh per-leg odds are stamped as the signal-CLV
    // basis, aligned with the record's legs (real pair pipeline).
    expect(record.confirmation?.confirmedLegOdds).toEqual(record.legs.map((l) => l.odds));
    expect(record.alerted).toBe(true);
    expect(w.sender.sent).toHaveLength(1);
    expect(w.sender.sent[0].body).toContain('Bet365');
  });

  it('edge drift beyond ±0.5 pp → single_sighting, NEVER alerted; survival telemetry is blind to it all', async () => {
    const w = makeWorld();
    w.events.push(makeEvent(w.h, 2.1, 2.1)); // 5.0% at scan A
    const scanAAt = w.h.current;
    await w.scanA();

    // The market moves before scan B: 2.02/2.02 → ~1.0% (drift ≈ −4 pp).
    w.events.length = 0;
    w.events.push(makeEvent(w.h, 2.02, 2.02));

    await w.h.advanceTo(scanAAt + 30 * 60_000);
    w.stop();

    expect(w.provider.fetchCalls).toBe(2); // B ran and judged — one B, no retries
    const [record] = w.records();
    expect(record.confirmation?.status).toBe('single_sighting');
    expect(record.confirmation?.edgeDeltaPp).toBeLessThan(-0.5);
    // Phase 18: a DRIFTED single_sighting was still re-sighted, so scan B's
    // fresh odds are stamped (the "gate declined this" signal-CLV telemetry).
    expect(record.confirmation?.confirmedLegOdds).toEqual(record.legs.map((l) => l.odds));
    expect(record.alerted).toBe(false);
    expect(w.sender.sent).toEqual([]); // single-sighting records are never acted on

    // Survival telemetry: byte-identical with the confirmation fields
    // stripped — Part A changed what ACTS, never what is measured.
    const now = w.h.now();
    const withConfirmation = computeSurvival(w.records(), w.scanLog, now);
    const stripped = w.records().map((r) => {
      const { confirmation: _confirmation, ...rest } = r;
      return rest as OpportunityRecord;
    });
    expect(computeSurvival(stripped, w.scanLog, now)).toEqual(withConfirmation);
  });

  it('a sport scan B fails to fetch leaves its candidate PENDING (never single_sighting) — a later B judges it fairly', async () => {
    const NHL = { key: 'icehockey_nhl', title: 'NHL', eventId: 'evt-2' };
    const w = makeWorld({
      sports: [
        { key: 'basketball_nba', title: 'NBA' },
        { key: 'icehockey_nhl', title: 'NHL' },
      ],
    });
    w.events.push(makeEvent(w.h, 2.1, 2.1)); // NBA ~5% arb
    w.events.push(makeEvent(w.h, 2.1, 2.1, NHL)); // NHL ~5% arb
    const scanAAt = w.h.current;
    await w.scanA();
    expect(w.scanLog[0].confirmationCandidates).toBe(2);

    // Scan B's NHL fetch is rate-limited away — B under-covers.
    w.failSports.add('icehockey_nhl');
    await w.h.advanceTo(scanAAt + 61_000);

    const byId = () => ({
      nba: w.records().find((r) => r.sportKey === 'basketball_nba')!,
      nhl: w.records().find((r) => r.sportKey === 'icehockey_nhl')!,
    });
    // B judged only what it covered: NBA confirmed + alerted; the NHL
    // candidate was NOT judged absent — still pending, still active.
    expect(byId().nba.confirmation).toMatchObject({ status: 'confirmed', edgeDeltaPp: 0 });
    expect(byId().nhl.confirmation).toMatchObject({ status: 'pending' });
    expect(byId().nhl.status).toBe('active'); // the kill pass may not touch an unfetched sport
    expect(w.sender.sent).toHaveLength(1);

    // The sport recovers; the still-due pair re-fires B on the next tick
    // and the candidate gets its fair judgment.
    w.failSports.clear();
    await w.h.advanceTo(scanAAt + 30 * 60_000);
    w.stop();
    expect(byId().nhl.confirmation).toMatchObject({ status: 'confirmed', edgeDeltaPp: 0 });
    expect(byId().nhl.alerted).toBe(true);
    expect(w.sender.sent).toHaveLength(2); // each confirmed exactly once
  });

  it('an uncovered candidate that stays pending past the lapse window still expires to single_sighting — bounded retries, honest terminal', async () => {
    const NHL = { key: 'icehockey_nhl', title: 'NHL', eventId: 'evt-2' };
    const w = makeWorld({
      sports: [
        { key: 'basketball_nba', title: 'NBA' },
        { key: 'icehockey_nhl', title: 'NHL' },
      ],
    });
    w.events.push(makeEvent(w.h, 2.1, 2.1, NHL)); // the only candidate is NHL
    const scanAAt = w.h.current;
    await w.scanA();
    expect(w.scanLog[0].confirmationCandidates).toBe(1);

    // NHL stays unfetchable for good — every B under-covers it.
    w.failSports.add('icehockey_nhl');
    await w.h.advanceTo(scanAAt + 30 * 60_000);
    w.stop();

    const nhl = w.records().find((r) => r.sportKey === 'icehockey_nhl')!;
    // The 5×-interval lapse rule resolved it (honestly, zero credits) —
    // never a B's absent-verdict: the stamp sits at/after the expiry, not
    // at the first B.
    expect(nhl.confirmation?.status).toBe('single_sighting');
    expect(Date.parse(nhl.confirmation!.scanBAt!)).toBeGreaterThanOrEqual(scanAAt + 6 * 60_000);
    expect(nhl.status).toBe('active'); // failed fetches never killed it
    expect(nhl.alerted).toBe(false);
    expect(w.sender.sent).toEqual([]);
    // Retries stayed bounded: scan A + one B per interval inside the grace
    // window (B due at +2..+5 min after the first B at +1 min), then stop.
    expect(w.scanLog).toHaveLength(6);
  });
});
