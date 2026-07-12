/**
 * Server entry point. Holds the API key (server-side only), picks the
 * provider, and wires the Express app.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { BookmakerService } from './bookmakers/bookmakerService';
import { BookmakerStore } from './bookmakers/bookmakerStore';
import {
  BOOKMAKERS_FILE,
  DATA_DIR,
  DEFAULT_BACKUP_DIR,
  DEFAULT_PORT,
  GRADING_FILE,
  LAST_SCAN_FILE,
  LAST_SNAPSHOT_FILE,
  EV_FILE,
  FUND_FILE,
  MIDDLES_FILE,
  OPPORTUNITIES_FILE,
  OPPORTUNITY_ARCHIVE_DIR,
  OPS_FILE,
  PAPER_FILE,
  PRESETS_FILE,
  SCAN_HISTORY_DIR,
  WHATSAPP_DATA_FILE,
} from './config/constants';
import { BackupService } from './ops/backupService';
import { GradingService } from './grading/gradingService';
import { GradingStore } from './grading/gradingStore';
import { createGradingRouter } from './routes/grading';
import { filterConfirmedSightings, notifyNewOpportunities } from './notifications/alertService';
import { WhatsAppStore } from './notifications/subscriptionStore';
import { senderFromEnv } from './notifications/whatsappSender';
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
import { OpsStore } from './ops/opsStore';
import { ScanHistoryStore } from './ops/scanHistoryStore';
import { notifyEvBets, notifyMiddleBets } from './notifications/alertService';
import { createEvRouter } from './routes/ev';
import { createMiddlesRouter } from './routes/middles';
import { computeSurvival } from './ops/survivalService';
import { createFundRouter } from './routes/fund';
import { createOpsRouter } from './routes/ops';
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
import { createBookmakersRouter } from './routes/bookmakers';
import { createOpportunitiesRouter } from './routes/opportunities';
import { createWhatsAppRouter } from './routes/whatsapp';
import { ScanStore } from './scan/scanStore';
import { SnapshotStore } from './scan/snapshotStore';

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
app.use(
  '/api',
  createApiRouter({
    provider,
    store,
    books: bookmakerService,
    opportunityLog: opportunityService,
    snapshots: snapshotStore,
    scanLog: scanHistoryStore,
    ev: { settings: () => evStore.read() },
    middles: { settings: () => middlesStore.read() },
    marketSettings: { read: async () => (await opsStore.read()).markets },
    // Limited/dead/disabled books never page the phone — filter before
    // dispatch; whatever actually sent gets flagged on its stored record.
    // The stream carries BOTH strategies; arbs and EV bets split here.
    notifier: async (opportunities) => {
      const alertable = await bookmakerService.filterAlertable(opportunities);
      const arbs = alertable.filter((o) => !o.ev && !o.middle);
      const evBets = alertable.filter((o) => o.ev);
      const middleBets = alertable.filter((o) => o.middle);
      const [fundSettings, books, evSettings, middlesSettings, opsSettings] = await Promise.all([
        fundService.settings(),
        bookmakerService.list(),
        evStore.read(),
        middlesStore.read(),
        opsStore.read(),
      ]);
      // The paper fund watches the SAME alertable stream a phone would when
      // second-sighting confirmation is off (its default) — arbs at the
      // paper threshold, middles at the alert breakeven cap (stored at
      // their worst-case FLOOR). EV proof stays grading-only. Paper entry
      // timing is intentionally NOT gated by confirmSecondSighting — that
      // toggle is scoped to phone alerts (Phase 15 #3).
      try {
        await paperService.considerEntries(
          [...arbs, ...middleBets],
          middlesSettings.alertMaxBreakevenPct,
        );
      } catch (err) {
        console.warn('Paper fund entry failed:', err);
      }

      // Second-sighting confirmation (ops toggle, default off): an
      // opportunity may reach a phone alert only once it's been seen in ≥2
      // scans, filtering ghosts that vanish before the next one. The
      // candidate set becomes records SEEN THIS SCAN not yet confirmed —
      // applies uniformly to arb, EV, and middle candidates.
      let alertArbs = arbs;
      let alertEvBets = evBets;
      let alertMiddleBets = middleBets;
      if (opsSettings.confirmSecondSighting) {
        const records = await opportunityService.list();
        const sightingByFingerprint = new Map(records.map((r) => [r.fingerprint, r]));
        const sightingOf = (fingerprint: string) => sightingByFingerprint.get(fingerprint);
        alertArbs = filterConfirmedSightings(arbs, true, sightingOf);
        alertEvBets = filterConfirmedSightings(evBets, true, sightingOf);
        alertMiddleBets = filterConfirmedSightings(middleBets, true, sightingOf);
      }

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
        alertArbs,
      );
      let evSent: string[] = [];
      if (alertEvBets.length > 0) {
        try {
          const result = await notifyEvBets(
            {
              store: whatsappStore,
              sender: whatsappSender,
              appUrl,
              evThresholdPercent: evSettings.alertMinEdgePct,
              stake: fundSettings.defaultStake > 0 ? fundSettings.defaultStake : undefined,
            },
            alertEvBets,
          );
          evSent = result.sentFingerprints;
        } catch (err) {
          console.warn('EV alert dispatch failed:', err);
        }
      }
      let middleSent: string[] = [];
      if (alertMiddleBets.length > 0) {
        try {
          const result = await notifyMiddleBets(
            {
              store: whatsappStore,
              sender: whatsappSender,
              appUrl,
              maxBreakevenPct: middlesSettings.alertMaxBreakevenPct,
              stake: fundSettings.defaultStake > 0 ? fundSettings.defaultStake : undefined,
            },
            alertMiddleBets,
          );
          middleSent = result.sentFingerprints;
        } catch (err) {
          console.warn('Middle alert dispatch failed:', err);
        }
      }
      await opportunityService.markAlerted([...sentFingerprints, ...evSent, ...middleSent]);

      // Grading piggybacks on scans too (same "no server-side scheduler"
      // rule alerts follow) — fire-and-forget, never fails the scan.
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
  }),
);
app.use(apiErrorHandler);

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
