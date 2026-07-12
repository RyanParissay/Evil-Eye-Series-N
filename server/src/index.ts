/**
 * Server entry point. Holds the API key (server-side only), picks the
 * provider, and wires the Express app.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { OpportunityRecord } from '@shared/types';
import { BookmakerService } from './bookmakers/bookmakerService';
import { BookmakerStore } from './bookmakers/bookmakerStore';
import {
  BOOKMAKERS_FILE,
  DATA_DIR,
  DEFAULT_BACKUP_DIR,
  DEFAULT_PORT,
  GRADING_FILE,
  HUB_FILE,
  LAST_SCAN_FILE,
  LAST_SNAPSHOT_FILE,
  LEADERBOARD_FILE,
  EV_FILE,
  FUND_FILE,
  MIDDLES_FILE,
  OPPORTUNITIES_FILE,
  OPPORTUNITY_ARCHIVE_DIR,
  OPS_FILE,
  PAPER_FILE,
  PRESETS_FILE,
  SAFETY_FILE,
  SCAN_HISTORY_DIR,
  SCHEDULER_MAX_SLEEP_MS,
  SCHEDULER_SCORE_POLL_INTERVAL_MS,
  WHATSAPP_DATA_FILE,
} from './config/constants';
import { BackupService } from './ops/backupService';
import { LeaderboardStore } from './ops/leaderboardStore';
import { HubService } from './hub/hubService';
import { HubProfileStore } from './hub/profileStore';
import { createHubRouter } from './routes/hub';
import { SafetyStore } from './ops/safetyStore';
import { createSafetyRouter } from './routes/safety';
import { scoreConfirmedRecords, type ConfirmationScoringDeps } from './safety/scoring';
import { GradingService } from './grading/gradingService';
import { GradingStore } from './grading/gradingStore';
import { createGradingRouter } from './routes/grading';
import { notifyNewOpportunities } from './notifications/alertService';
import { WhatsAppStore } from './notifications/subscriptionStore';
import { senderFromEnv } from './notifications/whatsappSender';
import {
  isPendingCandidate,
  matchConfirmationPair,
  recordToOpportunity,
} from './opportunities/confirmation';
import { OpportunityService } from './opportunities/opportunityService';
import { OpportunityArchive, OpportunityStore } from './opportunities/opportunityStore';
import { verifyOpportunity } from './opportunities/verifyService';
import { applyToBalances, revertBalances } from './opportunities/reconcileBalances';
import { LedgerService } from './ledger/ledgerService';
import { FundService } from './fund/fundService';
import { FundStore } from './fund/fundStore';
import { PaperService } from './paper/paperService';
import { PaperStore } from './paper/paperStore';
import { planStakes } from '@shared/stakePlanning';
import { EvStore } from './ops/evStore';
import { MiddlesStore } from './ops/middlesStore';
import { OpsStore, seedScanParams } from './ops/opsStore';
import { ScanHistoryStore } from './ops/scanHistoryStore';
import { notifyEvBets, notifyMiddleBets } from './notifications/alertService';
import { createEvRouter } from './routes/ev';
import { createMiddlesRouter } from './routes/middles';
import { computeSurvival } from './ops/survivalService';
import { createFundRouter } from './routes/fund';
import { createOpsRouter } from './routes/ops';
import { createSchedulerRouter, measurePerPairCost } from './routes/scheduler';
import { denseWeekSpend } from './scheduler/denseWeek';
import { createPaperRouter } from './routes/paper';
import { PresetService } from './presets/presetService';
import { PresetStore } from './presets/presetStore';
import { createAdvancedRouter } from './routes/advanced';
import { createLedgerRouter } from './routes/ledger';
import { createPortfolioRouter } from './routes/portfolios';
import { MockOddsProvider } from './providers/MockOddsProvider';
import type { OddsProvider } from './providers/OddsProvider';
import { TheOddsApiProvider } from './providers/TheOddsApiProvider';
import { apiErrorHandler, createApiRouter } from './routes/api';
import { quietHoursGuard } from './routes/quietHoursGuard';
import { createBookmakersRouter } from './routes/bookmakers';
import { createOpportunitiesRouter } from './routes/opportunities';
import { createWhatsAppRouter } from './routes/whatsapp';
import { parseScanRequest } from './scan/scanRequest';
import { runScan, type ScanDeps } from './scan/scanService';
import { ScanStore } from './scan/scanStore';
import { SnapshotStore } from './scan/snapshotStore';
import { Scheduler } from './scheduler/scheduler';
import { realTimer } from './scheduler/realTimer';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The .env lives at the repo root (shared by both workspaces); load it by
// absolute path so the server finds it regardless of the launch directory.
dotenv.config({ path: path.resolve(serverRoot, '../.env') });

// DEV_MODE=true is the umbrella switch: mock odds + console WhatsApp,
// regardless of what else is configured. See .env.example.
const devMode = process.env.DEV_MODE?.trim().toLowerCase() === 'true';

const apiKey = process.env.ODDS_API_KEY?.trim();
const provider: OddsProvider =
  !devMode && apiKey && apiKey.toLowerCase() !== 'mock'
    ? new TheOddsApiProvider(apiKey)
    : new MockOddsProvider();

const store = new ScanStore(path.join(serverRoot, LAST_SCAN_FILE));

const whatsappStore = new WhatsAppStore(path.join(serverRoot, WHATSAPP_DATA_FILE));
const whatsappSender = senderFromEnv();

const bookmakerService = new BookmakerService(
  new BookmakerStore(path.join(serverRoot, BOOKMAKERS_FILE)),
);

const opportunityStore = new OpportunityStore(path.join(serverRoot, OPPORTUNITIES_FILE));
const opportunityService = new OpportunityService(
  opportunityStore,
  new OpportunityArchive(path.join(serverRoot, OPPORTUNITY_ARCHIVE_DIR)),
);
const ledgerService = new LedgerService(
  opportunityStore,
  path.join(serverRoot, OPPORTUNITY_ARCHIVE_DIR),
);

const gradingStore = new GradingStore(path.join(serverRoot, GRADING_FILE));
const gradingService = new GradingService(provider, opportunityService, gradingStore);

const snapshotStore = new SnapshotStore(path.join(serverRoot, LAST_SNAPSHOT_FILE));

// Phase 17: the one SafetySettings config object. Constructed early because
// the confirmation fan-out consumers below gate on it (passesSafetyGate);
// its routes mount further down with the rest of the safety surface.
const safetyStore = new SafetyStore(path.join(serverRoot, SAFETY_FILE));

// Where WhatsApp deep links point. Default matches the Vite dev client;
// set APP_URL when the client lives anywhere else.
const appUrl = process.env.APP_URL?.trim() || 'http://localhost:5173';

const app = express();
app.use(express.json());
app.use('/api/whatsapp', createWhatsAppRouter({ store: whatsappStore, sender: whatsappSender }));
app.use('/api/bookmakers', createBookmakersRouter(bookmakerService));
app.use('/api/ledger', createLedgerRouter(ledgerService));
const scanHistoryStore = new ScanHistoryStore(path.join(serverRoot, SCAN_HISTORY_DIR));
const opsStore = new OpsStore(path.join(serverRoot, OPS_FILE));
// Phase 15 #1: book leaderboards accrue per scan, zero credits (no
// provider anywhere in leaderboardStore.ts's dependency graph).
const leaderboardStore = new LeaderboardStore(path.join(serverRoot, LEADERBOARD_FILE));

// Phase 15 #6: daily backup of server/data/ (everything except the backups
// dir itself), pruned to the newest 14. No server-side timers — triggered
// here at startup and again fire-and-forget after each scan below; both
// no-op if today's dated dir already exists. A backup failure must never
// break startup or a scan.
const backupDir = process.env.BACKUP_DIR?.trim() || path.join(serverRoot, DEFAULT_BACKUP_DIR);
const backupService = new BackupService(path.join(serverRoot, DATA_DIR), backupDir);
void backupService.runIfNeeded().catch((err) => console.warn('Startup backup failed:', err));

// The paper haircut can be MEASURED from survival once enough history exists.
const paperService = new PaperService(
  new PaperStore(path.join(serverRoot, PAPER_FILE)),
  undefined,
  async () => {
    const [records, scans] = await Promise.all([
      ledgerService.allRecordsList(),
      collectScanHistory(),
    ]);
    return computeSurvival(records, scans, new Date()).haircut;
  },
  () => gradedActuals(),
);
app.use('/api/paper', createPaperRouter(paperService));

async function collectScanHistory() {
  const scans = [];
  for await (const entry of scanHistoryStore.entries()) scans.push(entry);
  return scans;
}

// The one wall-clock scheduler (assigned once its scan pipeline exists,
// below). Declared here so the ops router can wake() it on a settings PATCH.
let scheduler: Scheduler | undefined;

app.use(
  '/api/ops',
  createOpsRouter({
    settings: opsStore,
    scanHistory: scanHistoryStore,
    books: bookmakerService,
    fetchPlan: (tab) => bookmakerService.fetchPlan(tab),
    snapshots: snapshotStore,
    records: () => ledgerService.allRecordsList(),
    ledger: async () => {
      const summary = await ledgerService.summarize();
      return { realized: summary.realized, captureRate: summary.captureRate };
    },
    paper: async () => {
      const view = await paperService.book();
      if (!view.settings.enabled && view.book.entries.length === 0) return null;
      return {
        simulated: true,
        idealProfit: Math.round((view.book.bankrollIdeal - view.settings.startingBankroll) * 100) / 100,
        haircutProfit:
          Math.round((view.book.bankrollHaircut - view.settings.startingBankroll) * 100) / 100,
        haircutSource: view.haircut.source,
        haircutPct: view.haircut.pct,
      };
    },
    lastUsage: async () => ({
      requestsUsedTotal: (await store.read())?.usage.requestsUsedTotal ?? null,
    }),
    leaderboard: leaderboardStore,
    // Phase 16: the scanner-page toggle PATCHes scheduler.enabled here; wake
    // the running scheduler so the change takes effect at once, and seed the
    // scan scope from the last scan when enabling without explicit params.
    onSchedulerChange: () => scheduler?.wake(),
    latestScanMeta: async () => {
      const meta = await store.read();
      return meta ? { regionTab: meta.regionTab, topN: meta.topN } : null;
    },
  }),
);

// Phase 16 Part C: the dense data-gathering week + weekly deterministic
// proposal. Zero credits structurally (dense-week spend derives from
// scan-history creditsComputed, the proposal from persisted history) — the
// only credit-spending consequence is the scheduler tick actually scanning,
// gated by plan.ts. A start/cancel wakes the running scheduler.
app.use(
  '/api/scheduler',
  createSchedulerRouter({
    settings: opsStore,
    scanHistory: scanHistoryStore,
    records: () => ledgerService.allRecordsList(),
    onSchedulerChange: () => scheduler?.wake(),
  }),
);

// Phase 14 paper portfolios — zero provider deps, same evidence inputs
// as /api/ops (records, scan history, ops settings for gap detection).
app.use(
  '/api/portfolios',
  createPortfolioRouter({
    records: () => ledgerService.allRecordsList(),
    scanHistory: scanHistoryStore,
    opsSettings: opsStore,
  }),
);

app.use(
  '/api/grading',
  createGradingRouter({
    service: gradingService,
    records: () => opportunityService.list(),
    gradingStore,
    scanHistory: scanHistoryStore,
    opsSettings: opsStore,
  }),
);

const fundService = new FundService(new FundStore(path.join(serverRoot, FUND_FILE)));
const evStore = new EvStore(path.join(serverRoot, EV_FILE));
app.use(
  '/api/ev',
  createEvRouter({ settings: evStore, opportunities: opportunityService, fund: fundService }),
);

const middlesStore = new MiddlesStore(path.join(serverRoot, MIDDLES_FILE));
app.use(
  '/api/middles',
  createMiddlesRouter({
    settings: middlesStore,
    opportunities: opportunityService,
    fund: fundService,
  }),
);

/** Realized profit per $1 staked for every graded record — the paper
 *  fund's middle entries adopt these actuals by fingerprint. */
async function gradedActuals(): Promise<Map<string, number>> {
  const actuals = new Map<string, number>();
  for (const record of await ledgerService.allRecordsList()) {
    const execution = record.execution;
    if (!execution || execution.totalStaked <= 0) continue;
    if (execution.grade == null && execution.legGrades == null) continue;
    actuals.set(record.fingerprint, execution.lockedProfit / execution.totalStaked);
  }
  return actuals;
}
app.use(
  '/api/fund',
  createFundRouter({
    fund: fundService,
    assemblePosition: async () => {
      const [books, summary, paper] = await Promise.all([
        bookmakerService.list(),
        ledgerService.summarize(),
        paperService.book(),
      ]);
      return fundService.position(
        books,
        summary.realized.totalLockedProfit,
        paper.book.entries.length > 0 || paper.settings.enabled ? paper.book : null,
      );
    },
  }),
);

app.use(
  '/api',
  createAdvancedRouter({
    presets: new PresetService(new PresetStore(path.join(serverRoot, PRESETS_FILE))),
    snapshots: snapshotStore,
    opportunities: opportunityService,
    books: bookmakerService,
  }),
);
const reconcileDeps = { opportunities: opportunityService, books: bookmakerService };
// Quiet hours (01:00–08:00 America/Vancouver) block cockpit re-verify too —
// it's a live provider call. Registered before the router so a quiet-hours
// request 503s before verifyOpportunity can spend a credit.
app.post('/api/opportunities/:id/verify', quietHoursGuard());
app.use(
  '/api/opportunities',
  createOpportunitiesRouter(
    opportunityService,
    (id) => verifyOpportunity({ provider, opportunities: opportunityService }, id),
    {
      apply: (id, winningLegIndex) => applyToBalances(reconcileDeps, id, winningLegIndex),
      revert: (id) => revertBalances(reconcileDeps, id),
    },
  ),
);
/* ————— Confirmation fan-out (Phase 16 Part A) ————— */

/**
 * Records are ACTED ON only at the moment they reach 'confirmed' — scan B
 * re-sighted the same identity within ±0.5 pp. Consumers fire-and-forget
 * with a console.warn on failure (the notifier's discipline): one consumer
 * failing never starves another, and none may slow the scan-B pipeline.
 */
type ConfirmedConsumer = {
  name: string;
  consume: (records: OpportunityRecord[]) => void | Promise<void>;
};
const confirmedConsumers: ConfirmedConsumer[] = [];
function onConfirmed(records: OpportunityRecord[]): void {
  if (records.length === 0) return;
  for (const { name, consume } of confirmedConsumers) {
    try {
      void Promise.resolve(consume(records)).catch((err) =>
        console.warn(`Confirmed-record consumer '${name}' failed:`, err),
      );
    } catch (err) {
      console.warn(`Confirmed-record consumer '${name}' failed:`, err);
    }
  }
}

/**
 * Consumer #1 — WhatsApp alert dispatch (arb, EV, middle; free middles
 * included). The pipeline is unchanged from Phase 15 — limited/dead-book
 * filter → per-strategy dispatch → markAlerted — only its TRIGGER moved:
 * it used to fire per scan, it now fires per confirmation, so alertWorthy's
 * at-most-once fingerprint dedup composes with the confirmed-only gate.
 * single_sighting and pending records can never reach here by construction.
 */
async function dispatchConfirmedAlerts(records: OpportunityRecord[]): Promise<void> {
  const opportunities = records.map(recordToOpportunity);
  const alertable = await bookmakerService.filterAlertable(opportunities);
  if (alertable.length === 0) return;
  const arbs = alertable.filter((o) => !o.ev && !o.middle);
  const evBets = alertable.filter((o) => o.ev);
  const middleBets = alertable.filter((o) => o.middle);
  const [fundSettings, books, evSettings, middlesSettings] = await Promise.all([
    fundService.settings(),
    bookmakerService.list(),
    evStore.read(),
    middlesStore.read(),
  ]);
  const balances = new Map(books.map((b) => [b.key, b.balance ?? null]));
  const { sentFingerprints } = await notifyNewOpportunities(
    {
      store: whatsappStore,
      sender: whatsappSender,
      appUrl,
      planStakes:
        fundSettings.defaultStake > 0
          ? (arb) => planStakes(arb.legs, fundSettings.defaultStake, balances)
          : undefined,
    },
    arbs,
  );
  let evSent: string[] = [];
  if (evBets.length > 0) {
    try {
      const result = await notifyEvBets(
        {
          store: whatsappStore,
          sender: whatsappSender,
          appUrl,
          evThresholdPercent: evSettings.alertMinEdgePct,
          stake: fundSettings.defaultStake > 0 ? fundSettings.defaultStake : undefined,
        },
        evBets,
      );
      evSent = result.sentFingerprints;
    } catch (err) {
      console.warn('EV alert dispatch failed:', err);
    }
  }
  let middleSent: string[] = [];
  if (middleBets.length > 0) {
    try {
      const result = await notifyMiddleBets(
        {
          store: whatsappStore,
          sender: whatsappSender,
          appUrl,
          maxBreakevenPct: middlesSettings.alertMaxBreakevenPct,
          stake: fundSettings.defaultStake > 0 ? fundSettings.defaultStake : undefined,
        },
        middleBets,
      );
      middleSent = result.sentFingerprints;
    } catch (err) {
      console.warn('Middle alert dispatch failed:', err);
    }
  }
  await opportunityService.markAlerted([...sentFingerprints, ...evSent, ...middleSent]);
}
confirmedConsumers.push({ name: 'whatsapp-alerts', consume: dispatchConfirmedAlerts });

// The Analytics Hub's purchase consumer registers on this same fan-out
// below, after its construction. Purchases key off the fan-out ONLY —
// nothing short of 'confirmed' is ever bought (design contract, Parts A+B).

// One ScanDeps, shared by the manual /api/scan route AND the scheduler, so a
// scheduled scan fires the exact same notifier pipeline (paper fund, grading
// piggyback, backup) a manual scan does. WhatsApp dispatch no longer lives
// here — alerts fire from the onConfirmed fan-out above when scan B confirms
// (Phase 16 Part A superseded the Phase 15 second-sighting toggle).
const scanDeps: ScanDeps = {
    provider,
    store,
    books: bookmakerService,
    opportunityLog: opportunityService,
    snapshots: snapshotStore,
    scanLog: scanHistoryStore,
    leaderboard: leaderboardStore,
    ev: { settings: () => evStore.read() },
    middles: { settings: () => middlesStore.read() },
    marketSettings: { read: async () => (await opsStore.read()).markets },
    notifier: async (opportunities) => {
      // Phase 16 Part A: recordScan (already done by now) may have left
      // candidates pending — wake the scheduler so their scan B is armed
      // precisely, manual scans included. The 60s max-sleep is the backstop
      // when a wake lands mid-tick.
      scheduler?.wake();

      // The paper fund stays on the UNGATED per-scan stream (recorded
      // decision: paper wants max samples; the confirmation gate applies to
      // alerts and Hub purchases only). Same rules as ever: the alertable
      // (limited/dead-filtered) stream, arbs at the paper threshold, middles
      // at the alert breakeven cap (stored at their worst-case FLOOR); EV
      // proof stays grading-only.
      try {
        const alertable = await bookmakerService.filterAlertable(opportunities);
        const middlesSettings = await middlesStore.read();
        await paperService.considerEntries(
          alertable.filter((o) => !o.ev),
          middlesSettings.alertMaxBreakevenPct,
        );
      } catch (err) {
        console.warn('Paper fund entry failed:', err);
      }

      // Grading piggybacks on every scan (same fire-and-forget rule alerts
      // follow) — never fails the scan. Phase 16 adds the scheduler's own
      // score-poll ticks on top; this piggyback stays for manual scans.
      try {
        void gradingService.poll().catch((err) => {
          console.warn('Grading poll failed:', err);
        });
      } catch (err) {
        console.warn('Grading poll failed:', err);
      }

      // Backups piggyback on scans too (Phase 15 #6) — fire-and-forget,
      // no-ops if today's dated dir already exists.
      try {
        void backupService.runIfNeeded().catch((err) => {
          console.warn('Backup failed:', err);
        });
      } catch (err) {
        console.warn('Backup failed:', err);
      }
    },
};

// ── PHASE-16 HUB CONSUMER ────────────────────────────────────────────────
// Analytics Hub (Part B, SIMULATED): each profile is a parameterized engine
// series that auto-purchases CONFIRMED opportunities. It rides the same
// onConfirmed fan-out as WhatsApp alerts — the fan-out emits records at the
// confirmation TRANSITION only, so pre-Phase-16 records are never
// retro-purchased (mirror of the never-retro-alert rule). onConfirmed is
// idempotent (purchases/skips dedupe by recordId); a Hub failure is a
// console.warn, never a failed scan.
const hubProfileStore = new HubProfileStore(path.join(serverRoot, HUB_FILE));
const hubService = new HubService({
  store: hubProfileStore,
  records: () => ledgerService.allRecordsList(),
});
app.use(
  '/api/hub',
  createHubRouter({ hub: hubService, leaderboards: () => leaderboardStore.readHubLeaderboards() }),
);
confirmedConsumers.push({
  name: 'hub-purchases',
  consume: (records) => hubService.onConfirmed(records),
});
// ─────────────────────────────────────────────────────────────────────────

// ── PHASE-17 SAFETY SCORE ────────────────────────────────────────────────
// WP-A: settings + advisory rotation telemetry (zero credits). WP-B: the
// scoring assembly (safety/scoring.ts) runs at the confirmation transition
// inside the scheduler's runConfirmScan below, and passesSafetyGate is
// applied inside BOTH fan-out consumers (dispatchConfirmedAlerts above, the
// hub-purchases consumer). Rotation's/exposure's acted-on population =
// alerted OR Hub-purchased (recordId set read from the hub store).
const hubPurchasedRecordIds = async (): Promise<ReadonlySet<string>> =>
  new Set((await hubProfileStore.read()).purchases.map((p) => p.recordId));
app.use(
  '/api/safety',
  createSafetyRouter({
    settings: safetyStore,
    records: () => ledgerService.allRecordsList(),
    hubPurchasedRecordIds,
  }),
);

// What score-at-confirmation assembles the engine inputs from. A failure of
// ANY of these must never block confirmation — scoreConfirmedRecords never
// throws; it warns and the record confirms WITHOUT safety (ungated,
// pre-Phase-17 semantics).
const safetyScoringDeps: ConfirmationScoringDeps = {
  snapshots: snapshotStore,
  settings: safetyStore,
  history: () => ledgerService.allRecordsList(),
  hubPurchasedIds: hubPurchasedRecordIds,
  fundSettings: () => fundService.settings(),
  bookBalances: async () =>
    new Map((await bookmakerService.list()).map((b) => [b.key, b.balance ?? null])),
  // The arb alert min-profit threshold the $-rounding must preserve: the
  // LOWEST verified+active subscription threshold (the edge below which no
  // alert would fire anyway). No subscribers → 0, so rounding still may not
  // eat the guarantee itself. EV/middles score with 0 (WP-A's arb-only rule).
  arbMinEdgePct: async () => {
    const thresholds = (await whatsappStore.read()).subscriptions
      .filter((s) => s.verified && s.active)
      .map((s) => s.thresholdPercent);
    return thresholds.length > 0 ? Math.min(...thresholds) : 0;
  },
};
// ─────────────────────────────────────────────────────────────────────────

// Manual scans are blocked in quiet hours too (spec: "zero calls of any
// kind"). Manual scans stay never-blocked by the credit budget — that guard
// lives only in the scheduler's plan — but quiet hours bind everything.
app.post('/api/scan', quietHoursGuard());
app.use('/api', createApiRouter(scanDeps));
app.use(apiErrorHandler);

// THE one wall-clock scheduler. It is DEFAULT DISABLED (opsStore) and thus
// inert until the operator enables it from the UI — safe on the hot-reloading
// dev server, which is why the migration must never flip enabled true. plan.ts
// makes it budget-, cap-, and quiet-hours-aware; runScan reuses scanDeps so a
// scheduled scan is indistinguishable from a manual one (same alerts, paper
// fund, grading piggyback, backup).
//
// Confirmation pairs (Phase 16 Part A) also live here — scan B timing is
// scheduler timing. The pending pair is derived from the opportunity STORE,
// so it survives hot reloads: a due B fires from the fresh process (it
// completes a pair the user's own scan A already started and priced — never
// a spontaneous call), and a pair whose window lapsed resolves to
// single_sighting without ever touching the provider. With no pending
// records, a disabled scheduler stays completely inert on reload.
scheduler = new Scheduler({
  now: () => new Date(),
  setTimer: realTimer.setTimer,
  clearTimer: realTimer.clearTimer,
  readSettings: () => opsStore.read(),
  disable: (reason) =>
    opsStore.update((data) => ({
      data: { ...data, scheduler: { ...data.scheduler, enabled: false, disabledReason: reason } },
      result: undefined,
    })),
  runScan: async (params) => {
    const parsed = parseScanRequest({ topN: params.topN, regionTab: params.regionTab });
    if (!parsed.ok) throw new Error(`Invalid scheduler scanParams: ${parsed.message}`);
    await runScan(scanDeps, parsed.request);
  },
  // Scan B: snapshot the pending pair BEFORE the scan (headline fields
  // refresh at every sighting, so the pre-B store carries scan A's edges),
  // run the same full pipeline, then judge the pair against the post-B
  // store and persist the verdicts.
  runConfirmScan: async (params) => {
    const before = await opportunityService.pendingConfirmations();
    if (before.length === 0) return; // raced away — nothing to confirm, zero credits
    const parsed = parseScanRequest({ topN: params.topN, regionTab: params.regionTab });
    if (!parsed.ok) throw new Error(`Invalid confirmation scanParams: ${parsed.message}`);
    await runScan(scanDeps, parsed.request);
    const after = await opportunityService.list();
    const confirmedAt = new Date();
    const outcomes = matchConfirmationPair(before, after, confirmedAt);
    // Phase 17 (WP-B): score EVERY newly-confirming record — gate-filtered
    // ones included — before the verdicts persist and the fan-out runs.
    // scoreConfirmedRecords never throws: a scoring failure is a warn and
    // the record confirms WITHOUT safety (ungated, pre-Phase-17 semantics).
    const afterByFingerprint = new Map(after.map((r) => [r.fingerprint, r]));
    const confirming = outcomes
      .filter((o) => o.status === 'confirmed')
      .map((o) => afterByFingerprint.get(o.fingerprint))
      .filter((r): r is OpportunityRecord => r != null);
    const safetyByFingerprint = await scoreConfirmedRecords(
      safetyScoringDeps,
      confirming,
      confirmedAt,
    );
    const confirmed = await opportunityService.applyConfirmations(
      outcomes.map((o) => ({ ...o, safety: safetyByFingerprint.get(o.fingerprint) })),
    );
    onConfirmed(confirmed); // alerts + Hub purchases, both safety-gated
  },
  // The pair's B window lapsed (quiet hours / stop / restart): resolve to
  // single_sighting — bookkeeping only, zero provider calls.
  resolveConfirmations: async () => {
    await opportunityService.expirePendingConfirmations();
  },
  pendingConfirmation: async () => {
    const candidates = (await opportunityService.pendingConfirmations()).filter(isPendingCandidate);
    return {
      count: candidates.length,
      latestSeenAtMs:
        candidates.length > 0
          ? Math.max(...candidates.map((r) => Date.parse(r.lastSeenAt)))
          : null,
    };
  },
  // Scan B reuses the LAST scan's fetch scope — manual or scheduled alike.
  lastScanParams: async () => {
    const meta = await store.read();
    return meta ? seedScanParams({ regionTab: meta.regionTab, topN: meta.topN }) : null;
  },
  pollGrading: async () => {
    await gradingService.poll();
  },
  lastScanAtMs: async () => {
    const [latest] = await scanHistoryStore.lastN(1);
    return latest ? Date.parse(latest.scannedAt) : null;
  },
  usedTotal: async () => (await store.read())?.usage.requestsUsedTotal ?? null,
  // Phase 16 Part C.3: dense-week spend + measured per-pair cost from scan
  // history — the tick derives the elevated interval and the hard caps bind.
  denseWeekInputs: async (startedAtMs, at) => {
    const scans = await collectScanHistory();
    return {
      ...denseWeekSpend(startedAtMs, at, scans),
      perPairCost: measurePerPairCost(scans, at),
    };
  },
  clearDenseWeek: async () => {
    await opsStore.update((data) => ({
      data: { ...data, scheduler: { ...data.scheduler, denseWeek: null } },
      result: undefined,
    }));
  },
  scorePollIntervalMs: SCHEDULER_SCORE_POLL_INTERVAL_MS,
  maxSleepMs: SCHEDULER_MAX_SLEEP_MS,
  log: (message, err) => console.warn(message, err),
});
scheduler.start();

const port = Number(process.env.PORT) || DEFAULT_PORT;
app.listen(port, () => {
  console.log(`Evil Eye Arbitrage server listening on http://localhost:${port}`);
  console.log(
    provider.mode === 'mock'
      ? 'Provider: MOCK (no ODDS_API_KEY set — serving fixture data)'
      : 'Provider: LIVE (The Odds API)',
  );
  console.log(
    whatsappSender.mode === 'console'
      ? 'WhatsApp: DEV MODE (messages log to this console — set TWILIO_* vars to send for real)'
      : 'WhatsApp: Twilio configured',
  );
});
