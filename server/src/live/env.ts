// V1 .env loader (Plan 6, HARD GATE 3): reads ~/evil-eye-arbitrage/.env at BOOT
// ONLY, copies the KNOWN names into process.env without overwriting, and never
// exposes a VALUE anywhere — not in logs, errors, journals or payloads. Tests
// exercise the pure parser and name reporting with fake fixtures; nothing in
// this module prints.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LIVE_ENV_NAMES = [
  'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM', 'WHATSAPP_DEV_MODE', 'PORT', 'APP_URL',
] as const;

/** The names POST /api/mode requires before it will go live. */
export const REQUIRED_FOR_LIVE = [
  'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
] as const;

/** The Anthropic key is the SDK-standard eighth name (Decision 3): read if present,
 *  designed to be absent — absence selects the deterministic no-LLM path. */
export const ANTHROPIC_KEY_NAME = 'ANTHROPIC_API_KEY';

const DEFAULT_ENV_PATH = join(homedir(), 'evil-eye-arbitrage', '.env');

/** Pure KEY=VALUE parser: optional `export `, full-line # comments, single/double
 *  quotes stripped when they wrap the whole value. No interpolation, no escapes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}

/**
 * Merge the V1 file's KNOWN names (plus the Anthropic key) into `env`, never
 * overwriting an already-set variable. A missing/unreadable file is fine —
 * the app simply stays without live credentials.
 */
export function loadV1Env(env: NodeJS.ProcessEnv = process.env, path?: string): void {
  const file = path ?? env.EE_ENV_PATH ?? DEFAULT_ENV_PATH;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return; // no file → no live vars; never log the path's contents (there are none)
  }
  const parsed = parseEnvFile(text);
  for (const name of [...LIVE_ENV_NAMES, ANTHROPIC_KEY_NAME]) {
    if (env[name] === undefined && parsed[name] !== undefined) env[name] = parsed[name];
  }
}

/** Which REQUIRED names are absent — NAMES only, canonical order (409 message body). */
export function missingLiveVars(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_FOR_LIVE.filter((name) => {
    const v = env[name];
    return v === undefined || v === '';
  });
}

/** SAFE default: real sends require WHATSAPP_DEV_MODE to be explicitly 'false'/'0'. */
export function devMode(env: NodeJS.ProcessEnv): boolean {
  const v = env.WHATSAPP_DEV_MODE;
  return !(v === 'false' || v === '0');
}
