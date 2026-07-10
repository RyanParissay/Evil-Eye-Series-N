/**
 * WhatsApp message dispatch. TwilioWhatsAppSender talks to Twilio's REST API
 * with plain fetch (same no-SDK approach as TheOddsApiProvider);
 * ConsoleWhatsAppSender is the free dev-mode stand-in. The auth token stays
 * inside this module — never logged, never echoed in errors, never sent to
 * the client (same invariant as the odds key).
 */

export interface WhatsAppSender {
  /** 'console' means messages are logged, not sent — surfaced to the UI. */
  readonly mode: 'twilio' | 'console';
  send(toE164: string, body: string): Promise<void>;
}

export class TwilioWhatsAppSender implements WhatsAppSender {
  readonly mode = 'twilio' as const;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /** The sandbox/sender number, without the whatsapp: prefix. */
    private readonly fromE164: string,
  ) {}

  async send(toE164: string, body: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: `whatsapp:${this.fromE164}`,
          To: `whatsapp:${toE164}`,
          Body: body,
        }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach Twilio: ${reason}`);
    }
    if (!response.ok) {
      // Twilio error bodies are JSON { code, message, ... } — surface only
      // those fields; the request itself embeds credentials.
      let detail = `HTTP ${response.status}`;
      try {
        const parsed = (await response.json()) as { code?: number; message?: string };
        if (parsed.message) detail += ` — Twilio ${parsed.code ?? ''}: ${parsed.message}`;
      } catch {
        // Non-JSON error body: the status alone will have to do.
      }
      throw new Error(`WhatsApp send failed: ${detail}`);
    }
  }
}

export class ConsoleWhatsAppSender implements WhatsAppSender {
  readonly mode = 'console' as const;

  async send(toE164: string, body: string): Promise<void> {
    console.log(`[whatsapp dev] → ${toE164}: ${body}`);
  }
}

/**
 * Twilio when fully configured, console otherwise. WHATSAPP_DEV_MODE=true —
 * or the app-wide DEV_MODE=true umbrella — forces console mode even with
 * credentials present.
 */
export function senderFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppSender {
  if (
    env.WHATSAPP_DEV_MODE?.trim().toLowerCase() === 'true' ||
    env.DEV_MODE?.trim().toLowerCase() === 'true'
  ) {
    return new ConsoleWhatsAppSender();
  }
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const fromE164 = env.TWILIO_WHATSAPP_FROM?.trim().replace(/^whatsapp:/, '');
  if (!accountSid || !authToken || !fromE164) {
    return new ConsoleWhatsAppSender();
  }
  return new TwilioWhatsAppSender(accountSid, authToken, fromE164);
}
