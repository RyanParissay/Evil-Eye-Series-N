// Mode wiring (Plan 6, Design §2–3): ONE function decides what sits behind the
// provider/sender seams, driven by the liveMode settings key. Flipping is owned
// by POST /api/mode; this module never flips anything itself.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Repos } from '../db/db.js';
import type { Settings } from '../shared/defaults.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import { OddsApiProvider } from './oddsApi.js';
import { TwilioWhatsAppSender } from './twilio.js';

export function modeLabel(s: Settings): 'SIMULATED' | 'LIVE' {
  return s.liveMode === 1 ? 'LIVE' : 'SIMULATED';
}

/**
 * Swap the seams in place to match liveMode. SIMULATED restores the sim pair;
 * LIVE installs the Odds API provider + Twilio sender (which itself honors
 * WHATSAPP_DEV_MODE — dev is the default, Decision 6). Returns the label.
 */
export function wireMode(
  deps: PipeDeps, env: NodeJS.ProcessEnv, repos: Repos, fetchImpl: typeof fetch,
): 'SIMULATED' | 'LIVE' {
  const label = modeLabel(deps.s());
  if (label === 'LIVE') {
    deps.provider = OddsApiProvider(fetchImpl, env, repos);
    deps.sender = TwilioWhatsAppSender(fetchImpl, env, repos, () => Date.now());
  } else {
    deps.provider = SimOddsProvider(deps.rng);
    deps.sender = simSender(repos);
  }
  deps.lastQuotes = [];
  return label;
}

/** The sim sender, identical in behavior to routes.ts's console sender. */
function simSender(repos: Repos): PipeDeps['sender'] {
  return {
    sendVerified(t): void {
      console.log(`[SIM-WHATSAPP] ${t.category} ${t.event}`);
      repos.eventsLog.add(Date.now(), 'alert', JSON.stringify({ tradeId: t.id, transport: 'sim' }));
    },
  };
}
