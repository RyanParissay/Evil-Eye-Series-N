// Inbound WhatsApp reply poll (Plan 6, Design §6): a 45s HookTask on the ONE
// timer chain. Live mode only; quiet hours pause it (no sends happen then, and
// the SID dedupe catches up at 08:00). Injected fetchImpl only (HARD GATE 2).
import type { PipeDeps } from '../pipeline/scan.js';
import type { HookTask } from '../scheduler/runner.js';
import { confirmTrade } from '../pipeline/actions.js';
import { isQuietHours } from '../scheduler/vancouverTime.js';

const POLL_MS = 45_000;

interface TwilioMessage { sid: string; body: string; date_sent: string }

/** One poll: list inbound messages, dedupe by SID, apply 1/3 semantics. Returns replies handled. */
export async function pollInbound(
  deps: PipeDeps, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, now: number,
): Promise<number> {
  const { repos } = deps;
  repos.eventsLog.add(now, 'wa_poll', JSON.stringify({}));
  try {
    const sid = env.TWILIO_ACCOUNT_SID ?? '';
    const token = env.TWILIO_AUTH_TOKEN ?? '';
    const to = encodeURIComponent(env.TWILIO_WHATSAPP_FROM ?? '');
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?To=${to}&PageSize=50`,
      { headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } },
    );
    if (!res.ok) throw new Error(`twilio list ${res.status}`);
    const { messages } = (await res.json()) as { messages: TwilioMessage[] };

    const seen = new Set(
      repos.eventsLog.all().filter((e) => e.kind === 'wa_reply')
        .map((e) => (JSON.parse(e.payload) as { sid: string }).sid),
    );
    let handled = 0;
    for (const m of messages) {
      if (seen.has(m.sid)) continue;
      repos.eventsLog.add(now, 'wa_reply', JSON.stringify({ sid: m.sid, code: m.body.trim().slice(0, 1) }));
      applyReply(deps, m.body.trim(), now);
      handled += 1;
    }
    return handled;
  } catch (err) {
    repos.eventsLog.add(now, 'wa_error', JSON.stringify({
      message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    }));
    return 0;
  }
}

function applyReply(deps: PipeDeps, body: string, now: number): void {
  const { repos } = deps;
  if (body.startsWith('1')) {
    // Newest sent, still-VERIFIED trade (Decision 5) — compact codes can't address one card.
    const target = repos.trades.byStatus('VERIFIED')
      .filter((t) => t.verifiedAt !== null)
      .sort((a, b) => b.verifiedAt! - a.verifiedAt!)[0];
    if (target === undefined) {
      repos.journal.add(now, 'WhatsApp reply 1 received — nothing awaiting confirmation'); // NEW copy
      return;
    }
    confirmTrade(repos, target.id, now);
    return;
  }
  if (body.startsWith('3')) {
    // A bare 3 carries neither book nor max bet — the limited flow completes in-app.
    repos.eventsLog.add(now, 'wa_reply_limited', JSON.stringify({}));
    repos.journal.add(now, 'WhatsApp reply 3 received — report the limit with book and amount on the TRADES screen'); // NEW copy
  }
  // anything else: recorded in wa_reply, deliberately ignored (no skip feature, no other codes)
}

/** The HookTask: live-only, quiet-hours-gated, watermarked at 45s. */
export function inboundPollHook(deps: PipeDeps, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv): HookTask {
  return {
    name: 'inbound-poll',
    nextAt(now: number): number | null {
      const s = deps.s();
      if (s.liveMode !== 1) return null;
      if (isQuietHours(now, s)) return null;
      const polls = deps.repos.eventsLog.all().filter((e) => e.kind === 'wa_poll');
      if (polls.length === 0) return now;
      return polls[polls.length - 1]!.ts + POLL_MS;
    },
    run(now: number): Promise<void> {
      return pollInbound(deps, fetchImpl, env, now).then(() => undefined);
    },
  };
}
