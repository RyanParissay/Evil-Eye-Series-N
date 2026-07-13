/**
 * Phase 17 acceptance fixtures (binding, from the phase spec) — the safety
 * gate driven through the REAL confirmation pipeline, composed the way
 * index.ts composes it (mirroring WP2's confirmationPair.test.ts): real
 * runScan, real OpportunityService, real Scheduler tick, real WhatsApp
 * dispatch with a mock sender, the REAL HubService on an in-memory store,
 * and score-at-confirmation via safety/scoring.ts.
 *
 *  1. Gate parity: a confirmed record below the threshold (and a hard
 *     reject) is neither alerted nor Hub-purchased — but IS persisted with
 *     its score + reasons; the sibling above the threshold is both.
 *  2. safeMode OFF parity: everything flows (alerted + purchased), scores
 *     are still computed and persisted.
 *  3. Scoring-failure fallback: no snapshot on disk → records confirm
 *     UNGATED (no safety, console.warn) — scoring never blocks confirmation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OddsEvent,
  OpportunityRecord,
  OpsSettings,
  SafetySettings,
  ScanLogEntry,
  ScanMeta,
} from '@shared/types';
import { regionTabByKey } from '@shared/regionTabs';
import { planStakes } from '@shared/stakePlanning';
import { passesSafetyGate } from '../engine/safety';
import { HubService } from '../hub/hubService';
import type { HubData, HubDataStore } from '../hub/profileStore';
import { notifyNewOpportunities } from '../notifications/alertService';
import type { WhatsAppData, WhatsAppDataStore } from '../notifications/subscriptionStore';
import type { WhatsAppSender } from '../notifications/whatsappSender';
import { DEFAULT_OPS_SETTINGS, seedScanParams } from '../ops/opsStore';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import {
  isPendingCandidate,
  matchConfirmationPair,
  recordToOpportunity,
} from '../opportunities/confirmation';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import type {
  FetchOddsParams,
  OddsProvider,
  OddsResult,
  SportsResult,
} from '../providers/OddsProvider';
import { runScan, type ScanDeps } from '../scan/scanService';
import type { ScanStore } from '../scan/scanStore';
import type { OddsSnapshot } from '../scan/snapshotStore';
import { Scheduler } from '../scheduler/scheduler';
import { vancouverEpochOf } from '../scheduler/vancouverTime';
import { scoreConfirmedRecords, type ConfirmationScoringDeps } from './scoring';

const CA_TAB = regionTabByKey('ca')!;
const FUND_STAKE = 500;

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
      await settle();
    }
    this.current = target;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

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

class MemHubStore implements HubDataStore {
  data: HubData = { seeded: false, profiles: [], purchases: [], skipped: [] };
  async read(): Promise<HubData> {
    return this.data;
  }
  async update<T>(
    mutate: (data: HubData) => { data: HubData; result: T } | Promise<{ data: HubData; result: T }>,
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

/**
 * One NBA h2h event priced by the two leg books (bet365/pinnacle — both
 * CA-allowlisted) plus four consensus-only books ('sharpN' — NOT on any
 * allowlist, so they feed the raw-snapshot consensus without ever entering
 * arb detection). legOdds prices Celtics@bet365 and Lakers@pinnacle;
 * consensusOdds prices both outcomes at every sharp book.
 */
function makeEvent(h: Harness, id: string, legOdds: number, consensusOdds: number): OddsEvent {
  const at = new Date(h.current).toISOString();
  const consensusBook = (key: string) => ({
    key,
    title: key,
    lastUpdate: at,
    markets: [
      {
        key: 'h2h',
        outcomes: [
          { name: 'Celtics', price: consensusOdds },
          { name: 'Lakers', price: consensusOdds },
        ],
      },
    ],
  });
  return {
    id,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
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
              { name: 'Celtics', price: legOdds },
              { name: 'Lakers', price: 1.7 },
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
              { name: 'Celtics', price: 1.7 },
              { name: 'Lakers', price: legOdds },
            ],
          },
        ],
      },
      consensusBook('sharp1'),
      consensusBook('sharp2'),
      consensusBook('sharp3'),
      consensusBook('sharp4'),
    ],
  };
}

interface World {
  h: Harness;
  events: OddsEvent[];
  sender: MemSender;
  hubStore: MemHubStore;
  safetySettings: SafetySettings;
  records: () => OpportunityRecord[];
  recordByEvent: (eventId: string) => OpportunityRecord;
  scanA: () => Promise<void>;
  stop: () => void;
}

/** Compose the world exactly the way index.ts composes it (Phase 17 shape). */
function makeWorld(options: { brokenSnapshots?: boolean; safeMode?: boolean } = {}): World {
  const h = new Harness(vancouverEpochOf(2026, 1, 15, 15 * 60)); // 15:00 PST
  const events: OddsEvent[] = [];
  const scanLog: ScanLogEntry[] = [];
  let lastMeta: ScanMeta | null = null;

  const provider = {
    mode: 'mock' as const,
    async listSports(): Promise<SportsResult> {
      return {
        sports: [
          { key: 'basketball_nba', title: 'NBA', group: 'b', active: true, hasOutrights: false },
        ],
        usage: { requestsUsedTotal: 100, requestsRemainingTotal: 900, creditsCharged: 0 },
      };
    },
    async fetchOdds(_sport: string, params: FetchOddsParams): Promise<OddsResult> {
      const credits = params.markets.length * params.regions.length;
      return {
        events: [...events],
        usage: { requestsUsedTotal: 100, requestsRemainingTotal: 900, creditsCharged: credits },
      };
    },
    async fetchScores(): Promise<never> {
      throw new Error('the gate pipeline never fetches scores');
    },
  } satisfies OddsProvider;

  const memStore = new MemOpportunityStore();
  const opportunityService = new OpportunityService(memStore, { append: async () => {} }, h.now);

  // The latest raw snapshot — the consensus source. brokenSnapshots models
  // the scoring-failure fixture: nothing on disk, ever.
  let snapshotData: OddsSnapshot | null = null;
  const snapshotStore = {
    save: async (snapshot: OddsSnapshot) => {
      if (!options.brokenSnapshots) snapshotData = snapshot;
    },
    read: async () => snapshotData,
  };

  const safetySettings: SafetySettings = {
    ...structuredClone(DEFAULT_SAFETY_SETTINGS),
    safeMode: options.safeMode ?? true,
  };
  const safetyStore = { read: async () => safetySettings };

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
  const balances = new Map<string, number | null>();

  const hubStore = new MemHubStore();
  const hubService = new HubService({
    store: hubStore,
    records: async () => memStore.data.records,
    now: h.now,
  });

  // index.ts's score-at-confirmation deps (safety/scoring.ts).
  const scoringDeps: ConfirmationScoringDeps = {
    snapshots: snapshotStore,
    settings: safetyStore,
    history: async () => memStore.data.records,
    hubPurchasedIds: async () => new Set(hubStore.data.purchases.map((p) => p.recordId)),
    fundSettings: async () => ({
      totalBankroll: 5000,
      defaultStake: FUND_STAKE,
      unallocatedCash: 0,
    }),
    bookBalances: async () => balances,
    arbMinEdgePct: async () =>
      Math.min(...waStore.data.subscriptions.map((s) => s.thresholdPercent)),
  };

  // Consumer #1 — WhatsApp dispatch, gated (verbatim index.ts composition).
  async function dispatchConfirmedAlerts(records: OpportunityRecord[]): Promise<void> {
    const settings = await safetyStore.read();
    const passed = records.filter((r) => passesSafetyGate(r, settings));
    if (passed.length === 0) return;
    const opportunities = passed.map(recordToOpportunity).filter((o) => !o.ev && !o.middle);
    const { sentFingerprints } = await notifyNewOpportunities(
      {
        store: waStore,
        sender,
        now: h.now,
        planStakes: (arb) => planStakes(arb.legs, FUND_STAKE, balances),
      },
      opportunities,
    );
    await opportunityService.markAlerted(sentFingerprints);
  }

  // Consumer #2 — Hub purchases, the SAME gate (verbatim index.ts).
  async function purchaseConfirmed(records: OpportunityRecord[]): Promise<void> {
    const settings = await safetyStore.read();
    await hubService.onConfirmed(records.filter((r) => passesSafetyGate(r, settings)));
  }

  async function onConfirmed(records: OpportunityRecord[]): Promise<void> {
    if (records.length === 0) return;
    await dispatchConfirmedAlerts(records);
    await purchaseConfirmed(records);
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
    snapshots: snapshotStore,
    scanLog: {
      async append(entry) {
        scanLog.push(entry);
      },
    },
    notifier: async () => {
      scheduler.wake();
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
    // Verbatim index.ts composition of scan B, Phase 17 shape: score every
    // newly-confirming record, persist safety with the verdicts, THEN fan out.
    runConfirmScan: async (params) => {
      const before = await opportunityService.pendingConfirmations();
      if (before.length === 0) return;
      const tab = regionTabByKey(params.regionTab)!;
      const { meta } = await runScan(scanDeps, { topN: params.topN, tab });
      // Coverage: only sports scan B SUCCESSFULLY fetched may judge
      // candidates (attempted minus failed) — index.ts verbatim.
      const failedSports = new Set(meta.sportsFailed);
      const coveredSports = new Set(meta.sportsScanned.filter((s) => !failedSports.has(s)));
      const after = await opportunityService.list();
      const confirmedAt = h.now();
      const outcomes = matchConfirmationPair(before, after, confirmedAt, coveredSports);
      const afterByFingerprint = new Map(after.map((r) => [r.fingerprint, r]));
      const confirming = outcomes
        .filter((o) => o.status === 'confirmed')
        .map((o) => afterByFingerprint.get(o.fingerprint))
        .filter((r): r is OpportunityRecord => r != null);
      const safetyByFingerprint = await scoreConfirmedRecords(scoringDeps, confirming, confirmedAt);
      const confirmed = await opportunityService.applyConfirmations(
        outcomes.map((o) => ({ ...o, safety: safetyByFingerprint.get(o.fingerprint) })),
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
    events,
    sender,
    hubStore,
    safetySettings,
    records: () => memStore.data.records,
    recordByEvent: (eventId: string) => {
      const record = memStore.data.records.find((r) => r.eventId === eventId);
      if (!record) throw new Error(`no record for ${eventId}`);
      return record;
    },
    scanA: async () => {
      await runScan(scanDeps, { topN: 5, tab: CA_TAB });
      await settle();
    },
    stop: () => scheduler.stop(),
  };
}

/**
 * The three-sibling fixture, hand-computed against the default settings
 * (base 50, tier-1 NBA h2h +10, one pinnacle leg +20):
 *  - evt-safe   legs 2.06 vs consensus 2.04 (0.97% off → 0)      → score 80 ✓ gate
 *  - evt-below  legs 2.06 vs consensus 2.12 (2.9% off → −15 ×2)  → score 50 ✗ gate
 *  - evt-reject legs 2.10 (5.0% arb > maxSafeEdge 4.5)           → score 0, suspicious_edge
 */
function seedSiblings(w: World): void {
  w.events.push(makeEvent(w.h, 'evt-safe', 2.06, 2.04));
  w.events.push(makeEvent(w.h, 'evt-below', 2.06, 2.12));
  w.events.push(makeEvent(w.h, 'evt-reject', 2.1, 2.0));
}

async function runPair(w: World): Promise<void> {
  const scanAAt = w.h.current;
  await w.scanA();
  await w.h.advanceTo(scanAAt + 30 * 60_000); // scan B fires at +60s inside
  w.stop();
}

describe('safety gate parity — acceptance fixtures (Phase 17)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('below threshold / hard reject → neither alerted nor purchased, persisted with score + reasons; above → both', async () => {
    const w = makeWorld();
    seedSiblings(w);
    await runPair(w);

    // All three confirmed — the gate never touches confirmation itself.
    for (const eventId of ['evt-safe', 'evt-below', 'evt-reject']) {
      expect(w.recordByEvent(eventId).confirmation?.status).toBe('confirmed');
    }

    // Above threshold: alerted AND purchased (premade-arb, flat $50).
    const safe = w.recordByEvent('evt-safe');
    expect(safe.safety?.score).toBe(80);
    expect(safe.safety?.reasons).toEqual([]);
    expect(safe.alerted).toBe(true);
    expect(w.sender.sent).toHaveLength(1);
    expect(w.sender.sent[0].body).toContain('Bet365');
    // The rendered alert carries the Phase 17 amendments end-to-end: the
    // rounded (primary) stakes and exactly one Safety line between the
    // Profit line and "odds as of".
    expect(w.sender.sent[0].body).toContain('$250.00'); // fund $500, $5-rounded
    const lines = w.sender.sent[0].body.split('\n');
    expect(lines[lines.indexOf('Safety 80/100') - 1]).toMatch(/^Profit: /);
    expect(lines[lines.indexOf('Safety 80/100') + 1]).toMatch(/^odds as of /);
    const purchases = w.hubStore.data.purchases;
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ profileId: 'premade-arb', recordId: safe.id, stake: 50 });

    // Below threshold (soft penalties, no hard reject): persisted with its
    // itemized score, never acted on.
    const below = w.recordByEvent('evt-below');
    expect(below.safety?.score).toBe(50);
    expect(below.safety?.reasons).toEqual([]);
    expect(below.safety?.components.length).toBeGreaterThan(0);
    expect(below.alerted).toBe(false);

    // Hard reject: score 0 with the reason, persisted, never acted on.
    const reject = w.recordByEvent('evt-reject');
    expect(reject.safety?.score).toBe(0);
    expect(reject.safety?.reasons).toEqual(['suspicious_edge']);
    expect(reject.alerted).toBe(false);

    // Still fully persisted records — filtered ≠ hidden.
    expect(w.records()).toHaveLength(3);
    expect(w.hubStore.data.skipped).toEqual([]);
  });

  it('safeMode OFF → everything flows (alerted + purchased), scores still computed and persisted', async () => {
    const w = makeWorld({ safeMode: false });
    seedSiblings(w);
    await runPair(w);

    // Scores persist regardless of the gate being off.
    expect(w.recordByEvent('evt-safe').safety?.score).toBe(80);
    expect(w.recordByEvent('evt-below').safety?.score).toBe(50);
    expect(w.recordByEvent('evt-reject').safety?.score).toBe(0);

    // Everything alerted and purchased — pre-Phase-17 flow.
    expect(w.sender.sent).toHaveLength(3);
    for (const eventId of ['evt-safe', 'evt-below', 'evt-reject']) {
      const record = w.recordByEvent(eventId);
      expect(record.alerted).toBe(true);
      expect(w.hubStore.data.purchases.some((p) => p.recordId === record.id)).toBe(true);
    }
  });

  it('scoring failure (no snapshot) → records confirm UNGATED with console.warn — never blocked', async () => {
    const w = makeWorld({ brokenSnapshots: true });
    seedSiblings(w);
    await runPair(w);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Safety scoring skipped'));
    for (const eventId of ['evt-safe', 'evt-below', 'evt-reject']) {
      const record = w.recordByEvent(eventId);
      expect(record.confirmation?.status).toBe('confirmed');
      expect(record.safety).toBeUndefined();
      // Ungated = pre-Phase-17 semantics: alerted and purchased.
      expect(record.alerted).toBe(true);
      expect(w.hubStore.data.purchases.some((p) => p.recordId === record.id)).toBe(true);
    }
  });
});
