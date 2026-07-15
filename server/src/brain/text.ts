// Anthropic Brain text (Plan 6, Design §8 + HARD GATE 4): the LLM only ever
// ADDS one digest paragraph per consolidation — deterministic journal lines are
// always written first and always stand. No key → silence. $3/month HARD CAP in
// integer micro-dollars, refused BEFORE any request. Raw HTTP via injected
// fetch (locked stack, no new dependencies); model id + pricing per the
// claude-api skill: claude-haiku-4-5 at $1/$5 per MTok ⇒ 1/5 µ$ per token.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Repos } from '../db/db.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { ANTHROPIC_KEY_NAME } from '../live/env.js';

export const LLM_MODEL = 'claude-haiku-4-5';
export const LLM_CAP_MICRO = 3_000_000; // $3.00/month
export const LLM_MAX_TOKENS = 512;
const INPUT_MICRO_PER_TOKEN = 1;   // $1 / 1M tokens
const OUTPUT_MICRO_PER_TOKEN = 5;  // $5 / 1M tokens

const SYSTEM = 'You are the journal voice of a personal sports-betting scanner. '
  + 'Rewrite the given deterministic journal lines as ONE plain, calm paragraph. '
  + 'Never invent numbers; never add advice; keep every figure exactly as given.';

export interface TextWriter {
  available(): boolean;
  rewriteDigest(lines: string[]): Promise<string | null>;
}

/** The deterministic path: no LLM, ever. */
export function NullTextWriter(): TextWriter {
  return { available: () => false, rewriteDigest: async () => null };
}

/** Month spend in micro-dollars from the llm_spend ledger. */
export function llmSpentMicro(repos: Repos, monthKey: string): number {
  return repos.eventsLog.byKind('llm_spend')
    .filter((e) => dayKey(e.ts).startsWith(monthKey))
    .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costMicro?: number }).costMicro ?? 0), 0);
}

/** Conservative pre-call bound: chars/3 over-counts tokens; output at full budget. */
export function worstCaseMicro(promptChars: number): number {
  return Math.ceil(promptChars / 3) * INPUT_MICRO_PER_TOKEN + LLM_MAX_TOKENS * OUTPUT_MICRO_PER_TOKEN;
}

export function AnthropicTextWriter(
  fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number,
): TextWriter {
  const key = env[ANTHROPIC_KEY_NAME];
  return {
    available(): boolean {
      return key !== undefined && key !== '';
    },
    async rewriteDigest(lines: string[]): Promise<string | null> {
      const now = clock();
      const prompt = lines.join('\n');
      // THE HARD CAP: refuse before any request once the month would cross $3.
      const spent = llmSpentMicro(repos, dayKey(now).slice(0, 7));
      if (spent + worstCaseMicro(SYSTEM.length + prompt.length) > LLM_CAP_MICRO) {
        repos.eventsLog.add(now, 'llm_skipped_budget', JSON.stringify({ spentMicro: spent }));
        return null;
      }
      try {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key ?? '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: LLM_MODEL,
            max_tokens: LLM_MAX_TOKENS,
            system: SYSTEM,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) {
          repos.eventsLog.add(now, 'llm_error', JSON.stringify({ status: res.status }));
          return null;
        }
        const body = (await res.json()) as {
          content: { type: string; text?: string }[];
          stop_reason: string;
          usage: { input_tokens: number; output_tokens: number };
        };
        // Spend is recorded for every completed request, digest or not.
        const costMicro = body.usage.input_tokens * INPUT_MICRO_PER_TOKEN
          + body.usage.output_tokens * OUTPUT_MICRO_PER_TOKEN;
        repos.eventsLog.add(now, 'llm_spend', JSON.stringify({
          inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens, costMicro,
        }));
        if (body.stop_reason !== 'end_turn') return null; // refusal/max_tokens → templates stand
        const text = body.content.find((b) => b.type === 'text')?.text?.trim();
        return text !== undefined && text !== '' ? text : null;
      } catch (err) {
        repos.eventsLog.add(now, 'llm_error', JSON.stringify({
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
        return null;
      }
    },
  };
}

/**
 * After a brain pass: rewrite TODAY's deterministic journal lines into one
 * digest entry. Additive only — the lines it read remain untouched. Kill
 * switch off is the caller's concern (it gates the pass itself).
 */
export async function digestAfterPass(deps: PipeDeps, writer: TextWriter, now: number): Promise<boolean> {
  if (!writer.available()) return false;
  const today = dayKey(now);
  const lines = deps.repos.journal.all()
    .filter((j) => dayKey(j.ts) === today && !j.text.startsWith('Consolidation digest:'))
    .map((j) => j.text);
  if (lines.length === 0) return false;
  const text = await writer.rewriteDigest(lines);
  if (text === null) return false;
  deps.repos.journal.add(now, `Consolidation digest: ${text}`); // NEW copy — provenance visible
  return true;
}
