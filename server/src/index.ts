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
  OPPORTUNITIES_FILE,
  OPPORTUNITY_ARCHIVE_DIR,
  WHATSAPP_DATA_FILE,
} from './config/constants';
import { notifyNewOpportunities } from './notifications/alertService';
import { WhatsAppStore } from './notifications/subscriptionStore';
import { senderFromEnv } from './notifications/whatsappSender';
import { OpportunityService } from './opportunities/opportunityService';
import { OpportunityArchive, OpportunityStore } from './opportunities/opportunityStore';
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

const opportunityService = new OpportunityService(
  new OpportunityStore(path.join(serverRoot, OPPORTUNITIES_FILE)),
  new OpportunityArchive(path.join(serverRoot, OPPORTUNITY_ARCHIVE_DIR)),
);

const snapshotStore = new SnapshotStore(path.join(serverRoot, LAST_SNAPSHOT_FILE));

const app = express();
app.use(express.json());
app.use('/api/whatsapp', createWhatsAppRouter({ store: whatsappStore, sender: whatsappSender }));
app.use('/api/bookmakers', createBookmakersRouter(bookmakerService));
app.use('/api/opportunities', createOpportunitiesRouter(opportunityService));
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
      const { sentFingerprints } = await notifyNewOpportunities(
        { store: whatsappStore, sender: whatsappSender },
        await bookmakerService.filterAlertable(opportunities),
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
