# TASKS — passive backlog

Bugs and follow-ups noticed in passing during other work. Rules:

- **Passive capture only** — never actively hunt for entries.
- Each entry is concise, self-contained, and workable in parallel in its own
  worktree (`git worktree add ~/evil-eye-worktrees/<name> -b wt/<name>`).
- Remove the entry in the same PR/commit that resolves it.

Format: `- [ ] <short imperative title> — <1-3 sentence context, file paths>`

## Open

- [ ] Gate the scheduler's provider refresh on quiet hours —
  `server/src/scheduler/runner.ts` `pumpHooks()` calls `deps.provider.refresh()`
  on every chain wake whenever the provider defines `refresh`. In LIVE, a hook
  due during quiet hours (e.g. the 45s inbound WhatsApp poll) wakes the chain
  and triggers a real Odds API fetch, contradicting "quiet hours block all
  Odds API activity". Found during §2.2 hardening; needs a careful
  one-timer-chain change + tests.

- [ ] Prune dead settings display helpers — `client/src/lib/settings.ts`
  `cadenceText` and `riskRows` are unused since the §2.3 editable panels
  (kept conservatively, tests still cover them). Delete both + their tests
  if confirmed dead weight.
