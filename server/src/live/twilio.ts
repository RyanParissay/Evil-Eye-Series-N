// Twilio WhatsApp sender (Plan 6, Design §7): the sender seam's live half.
// DEV MODE SHORT-CIRCUITS BEFORE ANY NETWORK (HARD GATE 2) — and dev is the
// DEFAULT (Decision 6). Sends are fire-and-forget: the pipeline must never
// block or crash on a webhook provider. Values never reach logs or payloads.
import type { AlertSender, Trade } from '../shared/types.js';
import type { Repos } from '../db/db.js';
import { devMode } from './env.js';

/** Book display labels live server-side already (Plan 2); reuse the brain's map. */
import { displayName } from '../brain/pass.js';

const metricLine = (t: Trade): string => {
  const pct = ((t.marginFinal ?? t.marginInitial) * 100).toFixed(1);
  return t.category === 'ARB' ? `MARGIN: ${pct}%` : `EDGE: +${pct}%`;
};

/** The alert text — verbatim card semantics: legs with the │ stake divider,
 *  the metric, the locked reply codes, the app link when APP_URL is set. */
export function verifiedMessageText(t: Trade, appUrl: string | undefined): string {
  const lines = [
    `${t.category} ${t.event} · ${t.sport.toUpperCase()}`,
    ...t.legs.map((l) =>
      `${displayName(l.book)} — ${l.selection} @ ${l.odds.toFixed(2)} │ BET $${Math.round((l.stakeCents ?? 0) / 100)}`),
    metricLine(t),
    'Reply 1 SECURED · 3 LIMITED',
  ];
  if (appUrl !== undefined && appUrl !== '') lines.push(appUrl);
  return lines.join('\n');
}

export function TwilioWhatsAppSender(
  fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number,
): AlertSender {
  return {
    sendVerified(t: Trade): void {
      const now = clock();
      const text = verifiedMessageText(t, env.APP_URL);
      repos.eventsLog.add(now, 'alert', JSON.stringify({ tradeId: t.id, transport: 'whatsapp' }));

      if (devMode(env)) {
        // Dev mode: the events row IS the send. No network, ever (HARD GATE 2).
        repos.eventsLog.add(now, 'wa_dev', JSON.stringify({ tradeId: t.id, chars: text.length }));
        return;
      }

      const to = repos.settings.all().whatsappNumber;
      const sid = env.TWILIO_ACCOUNT_SID ?? '';
      const token = env.TWILIO_AUTH_TOKEN ?? '';
      const from = env.TWILIO_WHATSAPP_FROM ?? '';
      if (to === '' || sid === '' || token === '' || from === '') {
        repos.eventsLog.add(now, 'wa_error', JSON.stringify({ tradeId: t.id, message: 'missing number or credentials (names only)' }));
        return;
      }

      const body = new URLSearchParams({ From: from, To: `whatsapp:${to.replaceAll(' ', '')}`, Body: text });
      // Fire and forget: promotion latency never waits on Twilio.
      void fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }).then((res) => {
        if (!res.ok) repos.eventsLog.add(clock(), 'wa_error', JSON.stringify({ tradeId: t.id, status: res.status }));
      }).catch((err: unknown) => {
        repos.eventsLog.add(clock(), 'wa_error', JSON.stringify({
          tradeId: t.id, message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
      });
    },
  };
}
