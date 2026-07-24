---
name: evil-eye-workflow
description: Use when working in any Evil Eye repo (evil-eye-arbitrage or evil-eye-v2) and deciding where changes go, creating branches or worktrees, pushing to the remote, or capturing a bug/follow-up noticed in passing.
---

# Evil Eye workflow

## Repo roles

| Folder | Role | Rule |
|---|---|---|
| `~/evil-eye-arbitrage` (V1) | LIVE daily driver | FROZEN: critical fixes + docs only. Never build features here. |
| `~/evil-eye-v2` (V2) | Primary dev space | All development. Trunk is `main`. SIM mode by default. |

Asked to build something while in V1? You're in the wrong folder — work in V2.

## Remote

`git@github.com:RyanParissay/Evil-Eye-Series-N.git` (origin in both repos):
- `main` = V1 stable — push from V1 as `git push origin main`
- `v2-dev` = V2 trunk — push from V2 as `git push origin main:v2-dev`

## Worktrees (ephemeral, only for feature work)

```bash
cd ~/evil-eye-v2   # worktrees branch off the V2 trunk
git worktree add ~/evil-eye-worktrees/<feature> -b wt/<feature>
# ... work, merge to main ...
git worktree remove ~/evil-eye-worktrees/<feature> && git branch -d wt/<feature>
```

- All worktrees live in `~/evil-eye-worktrees/` — never scattered elsewhere.
- No permanent worktrees; remove after merge.
- Ports: the V2 server port is currently HARD-CODED to 4400
  (`server/src/index.ts` — so only ONE v2 dev server can run at a time;
  see TASKS.md for the env-override task). Tests and typecheck need no
  server, so parallel worktree development still works — just don't expect
  two live servers. The client proxy target is overridable:
  `EE_API_TARGET=http://localhost:<port> npm run dev:client`.
  `server/data/` is per-checkout and gitignored, so db state self-isolates.
- (V1 ports, if ever needed: 8787/5173.)

## TASKS.md (V2 root) — passive backlog

When a bug or worthwhile follow-up surfaces DURING other work, add an entry.
Never actively hunt for entries. Each entry: concise, self-contained,
workable in parallel in its own worktree. Remove the entry in the commit
that resolves it.

## Doc map

- `CLAUDE.md` (each repo) — always-loaded session contract.
- `ARCHITECTURE.md` (each repo) — on-demand module map, invariants, gotchas.
- V2 `docs/handoff/DECISIONS.md` — locked product rules; never contradict
  without an explicit user decision.
- V2 `docs/HANDOFF.md` — rolling state; update after significant sessions.
