/**
 * Server entry point. Holds the API key (server-side only), picks the
 * provider, and wires the Express app.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { DEFAULT_PORT, LAST_SCAN_FILE, WHATSAPP_DATA_FILE } from './config/constants';
import { notifyNewOpportunities } from './notifications/alertService';
import { WhatsAppStore } from './notifications/subscriptionStore';
import { senderFromEnv } from './notifications/whatsappSender';
import { MockOddsProvider } from './providers/MockOddsProvider';
import type { OddsProvider } from './providers/OddsProvider';
import { TheOddsApiProvider } from './providers/TheOddsApiProvider';
import { apiErrorHandler, createApiRouter } from './routes/api';
import { createWhatsAppRouter } from './routes/whatsapp';
import { ScanStore } from './scan/scanStore';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The .env lives at the repo root (shared by both workspaces); load it by
// absolute path so the server finds it regardless of the launch directory.
dotenv.config({ path: path.resolve(serverRoot, '../.env') });

const apiKey = process.env.ODDS_API_KEY?.trim();
const provider: OddsProvider =
  apiKey && apiKey.toLowerCase() !== 'mock'
    ? new TheOddsApiProvider(apiKey)
    : new MockOddsProvider();

const store = new ScanStore(path.join(serverRoot, LAST_SCAN_FILE));

const whatsappStore = new WhatsAppStore(path.join(serverRoot, WHATSAPP_DATA_FILE));
const whatsappSender = senderFromEnv();

const app = express();
app.use(express.json());
app.use('/api/whatsapp', createWhatsAppRouter({ store: whatsappStore, sender: whatsappSender }));
app.use(
  '/api',
  createApiRouter({
    provider,
    store,
    notifier: (opportunities) =>
      notifyNewOpportunities({ store: whatsappStore, sender: whatsappSender }, opportunities),
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
