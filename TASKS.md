# TASKS — passive backlog

Bugs and follow-ups noticed in passing during other work. Rules:

- **Passive capture only** — never actively hunt for entries.
- Each entry is concise, self-contained, and workable in parallel in its own
  worktree (`git worktree add ~/evil-eye-worktrees/<name> -b wt/<name>`).
- Remove the entry in the same PR/commit that resolves it.

Format: `- [ ] <short imperative title> — <1-3 sentence context, file paths>`

## Open

- [ ] Make the server port env-overridable — `server/src/index.ts:11` hard-codes
  `PORT = 4400` (Plan 6 Decision 2 reserved the `PORT` env name for V1's server),
  so two v2 dev servers (main folder + worktree) cannot run simultaneously.
  Add a v2-specific override (e.g. `EE_PORT`, default 4400) without touching
  the V1 `PORT` name; client side already supports `EE_API_TARGET`.
