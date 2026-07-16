import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import {
  AnthropicTextWriter, LLM_CAP_MICRO, LLM_MAX_TOKENS, LLM_MODEL, NullTextWriter,
  digestAfterPass, llmSpentMicro, worstCaseMicro,
} from './text.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

test('constants are the locked product spec', () => {
  expect(LLM_MODEL).toBe('claude-haiku-4-5');
  expect(LLM_CAP_MICRO).toBe(3_000_000); // $3.00/month in micro-dollars
  expect(LLM_MAX_TOKENS).toBe(512);
});

test('no key → writer unavailable, digestAfterPass is silent, ZERO events', async () => {
  const deps = mkDeps();
  const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const writer = AnthropicTextWriter(throwing, {} as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(writer.available()).toBe(false);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false);
  expect(deps.repos.journal.all()).toHaveLength(0);
  expect(deps.repos.eventsLog.all()).toHaveLength(0); // silent — the templates already stand
  expect(NullTextWriter().available()).toBe(false);
});

test('spend math: usage → micro-dollars, exactly', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: 16 of 16 books green');
  const fetchImpl = (async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'All sixteen books calm; credits on pace.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1_234, output_tokens: 256 },
  }), { status: 200 })) as typeof fetch;
  const writer = AnthropicTextWriter(fetchImpl, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(writer.available()).toBe(true);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(true);

  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Consolidation digest: All sixteen books calm; credits on pace.');
  const spends = deps.repos.eventsLog.all().filter((e) => e.kind === 'llm_spend');
  expect(spends).toHaveLength(1);
  const payload = JSON.parse(spends[0]!.payload) as { inputTokens: number; outputTokens: number; costMicro: number };
  expect(payload).toEqual({ inputTokens: 1_234, outputTokens: 256, costMicro: 1_234 * 1 + 256 * 5 });
  expect(llmSpentMicro(deps.repos, '2026-07')).toBe(2_514);
});

test('the HARD CAP refuses before any request once the month is spent', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: …');
  // Seed the ledger to a hair under the cap so the worst-case estimate crosses it.
  deps.repos.eventsLog.add(NOW - 2, 'llm_spend', JSON.stringify({ inputTokens: 0, outputTokens: 0, costMicro: LLM_CAP_MICRO - 100 }));
  const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const writer = AnthropicTextWriter(throwing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false); // refused — fetch never ran
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'llm_skipped_budget')).toBe(true);
  expect(deps.repos.journal.all().map((j) => j.text).some((t) => t.startsWith('Consolidation digest:'))).toBe(false);
});

test('worstCaseMicro over-estimates conservatively', () => {
  expect(worstCaseMicro(3_000)).toBe(1_000 + 512 * 5); // ceil(3000/3) input + full output budget
  expect(worstCaseMicro(1)).toBe(1 + 2_560);
});

test('API errors and refusals degrade silently to the templates', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: …');
  const failing = (async () => new Response('{"error":{"type":"overloaded_error"}}', { status: 529 })) as typeof fetch;
  const writer = AnthropicTextWriter(failing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false);
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'llm_error')).toBe(true);
  expect(deps.repos.journal.all()).toHaveLength(1); // only the deterministic line

  const refusing = (async () => new Response(JSON.stringify({
    content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 },
  }), { status: 200 })) as typeof fetch;
  const writer2 = AnthropicTextWriter(refusing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer2, NOW)).toBe(false); // spend recorded, no digest
  expect(deps.repos.eventsLog.all().filter((e) => e.kind === 'llm_spend')).toHaveLength(1);
});
