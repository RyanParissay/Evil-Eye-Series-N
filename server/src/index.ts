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
  DEFAULT_PORT,
  LAST_SCAN_FILE,
  LAST_SNAPSHOT_FILE,
  FUND_FILE,
  OPPORTUNITIES_FILE,
  OPPORTUNITY_ARCHIVE_DIR,
  PAPER_FILE,
  PRESETS_FILE,
  WHATSAPP_DATA_FILE,
} from './config/constants';
import { notifyNewOpportunities } from './notifications/alertService';
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
import { createFundRouter } from './routes/fund';
import { createPaperRouter } from './routes/paper';
import { PresetService } from './presets/presetService';
import { PresetStore } from './presets/presetStore';
import { createAdvancedRouter } from './routes/advanced';
import { createLedgerRouter } from './routes/ledger';
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

const snapshotStore = new SnapshotStore(path.join(serverRoot, LAST_SNAPSHOT_FILE));

// Where WhatsApp deep links point. Default matches the Vite dev client;
// set APP_URL when the client lives anywhere else.
const appUrl = process.env.APP_URL?.trim() || 'http://localhost:5173';

const app = express();
app.use(express.json());
app.use('/api/whatsapp', createWhatsAppRouter({ store: whatsappStore, sender: whatsappSender }));
app.use('/api/bookmakers', createBookmakersRouter(bookmakerService));
app.use('/api/ledger', createLedgerRouter(ledgerService));
const paperService = new PaperService(new PaperStore(path.join(serverRoot, PAPER_FILE)));
app.use('/api/paper', createPaperRouter(paperService));

const fundService = new FundService(new FundStore(path.join(serverRoot, FUND_FILE)));
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
    // Limited/dead/disabled books never page the phone — filter before
    // dispatch; whatever actually sent gets flagged on its stored record.
    notifier: async (opportunities) => {
      const alertable = await bookmakerService.filterAlertable(opportunities);
      // The paper fund watches the SAME alertable stream a phone would —
      // its failure must never dent the real alert path.
      try {
        await paperService.considerEntries(alertable);
      } catch (err) {
        console.warn('Paper fund entry failed:', err);
      }
      // Exact-dollar stakes from persisted fund settings + current balances.
      const [fundSettings, books] = await Promise.all([
        fundService.settings(),
        bookmakerService.list(),
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
        alertable,
      );
      await opportunityService.markAlerted(sentFingerprints);
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
