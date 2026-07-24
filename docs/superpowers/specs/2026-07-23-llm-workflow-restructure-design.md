# LLM Workflow Restructure — Design

Date: 2026-07-23
Status: approved pending user review

## Goal

Make the two-repo Evil Eye setup efficient for LLM-driven development:
v2 becomes the primary dev space, docs split into an always-loaded contract
vs an on-demand reference, and parallel work happens in a disciplined
worktree convention instead of scattered ad-hoc folders.

## Context

- **v1** (`~/evil-eye-arbitrage`): the live daily driver. Runs real scans and
  alerts. FROZEN — critical fixes only. Has a ~300-line monolithic CLAUDE.md.
- **v2** (`~/evil-eye-v2`): the from-scratch rebuild, now past Plans 1–6 and
  into integration/hardening. Real trunk is `plan-1-simulated-core` at
  `5f1ac5b` (== `p6b-integration`); local `main` is 41 commits stale. Eleven
  local branches, six stale worktree folders scattered in `~`
  (`evil-eye-v2-wt-{demo,p6b,plan4,plan5,plan6,stage}`). No LLM-facing docs.
- **Remote**: `git@github.com:RyanParissay/Evil-Eye-Series-N.git` —
  `main` = v1 stable (`470f6f6`), `v2-dev` = v2 trunk (`5f1ac5b`). Both repos
  have it as `origin`.
- **Risk found during exploration**: v2's `.gitignore` does NOT ignore `.env`,
  and Plan 6 wired live-mode env loading (Odds API / Twilio / Anthropic keys).

## Decisions (user-confirmed)

1. v1 stays live + frozen; all development happens in v2.
2. v2 branches: delete only branches verified fully merged into the tip;
   worktrees consolidate into one holding folder documented in the docs.
3. Doc split applies to BOTH repos.
4. Worktree model: parallel feature worktrees (ephemeral, per-feature);
   the main v2 folder is the runnable trunk. No permanent worktrees.
5. Remote layout unchanged: `main` = v1, `v2-dev` = v2.

## Design

### 1. Doc separation principle

`CLAUDE.md` is auto-loaded into every session; everything else is read on
demand. So the split is **"what every session must know before doing
anything"** vs **"what you look up when working on an area"** — not a topic
split. This keeps every session's base context small and makes the big
reference free until needed.

Each repo gets:

**`CLAUDE.md` (~60–80 lines, always loaded):**
- Status header FIRST. v1: "LIVE daily driver, FROZEN — critical fixes only,
  all dev happens in `../evil-eye-v2`." v2: "primary dev space, trunk is
  `main`, SIM mode by default."
- Commands (test, typecheck, dev servers, zero-credit verification recipe).
- Workflow rules: worktree convention, branch discipline, remote layout.
- Invariants compressed to one-liners (e.g. "API keys never leave the
  server", "engine stays pure", "line groups are sacred", "credits are real
  money"), each pointing to its full rule in ARCHITECTURE.md.
- Explicit routing lines: "Before changing server code, read
  ARCHITECTURE.md §…" so on-demand loading actually happens.

**`ARCHITECTURE.md` (unbounded, on demand):**
- Full layering/module map. v1: current CLAUDE.md diagram moves verbatim.
  v2: written fresh from the actual code (`engine/`, `pipeline/`, `brain/`,
  `db/`, `live/`, `analytics/`, `scheduler/`, `settings/`, `api/`, client).
- Full-text invariants with rationale.
- Extension recipes.
- Complete gotchas list.

**v2 additionally:**
- Root `README.md` — orientation for a fresh clone (what the product is,
  repo layout, how to run SIM mode).
- `docs/HANDOFF.md` — rolling "current state / what's next" page (v1's
  existing pattern), updated at the end of significant sessions.
- `docs/handoff/DECISIONS.md` stays put as the locked-product-rules log;
  CLAUDE.md points to it.

Nothing from v1's current CLAUDE.md is deleted — content moves, split
between the new CLAUDE.md and ARCHITECTURE.md.

### 2. v2 branch + worktree consolidation

- Fast-forward local `main` to `5f1ac5b`; the main folder checks out `main`
  and it becomes the working trunk.
- Delete local branches ONLY if `git branch --merged main` proves them fully
  contained: expected list — `plan-1-simulated-core`, `p6b-integration`,
  `stage-trial`, `plan-4-exec`, `plan-5-exec`, `plan-6-exec`,
  `feat-demo-seed`, `plan2-trades-cards`, `worktree-agent-ae3b…`,
  `worktree-agent-af4d…`. Any branch NOT proven merged is kept and flagged.
- `git worktree remove` the six stale `~/evil-eye-v2-wt-*` folders (their
  branches must be deleted-or-kept per the same merged check; a worktree
  with uncommitted changes is NOT removed — flagged instead).
- Push `main` → `origin/v2-dev` (same commit, no history change).

### 3. Worktree convention (documented in both CLAUDE.mds)

- Holding folder: `~/evil-eye-worktrees/` — every feature worktree lives
  there. Never scattered in `~` again.
- Create: `git worktree add ~/evil-eye-worktrees/<feature> -b wt/<feature>`
  from v2 trunk.
- Isolation per worktree: `server/data/` is per-checkout (gitignored, so
  automatic — each worktree gets its own sqlite/state); dev-server ports
  offset so parallel servers never collide. Main folder: 8787 (server) /
  5173 (client). Worktrees: pick from 8790+ / 5180+, noted in the doc.
- Lifecycle: branch merges to `main` → `git worktree remove` + branch
  delete. Ephemeral only; no permanent worktrees.

### 4. Safety fixes

- Add `.env` (and `.env.*`, keeping `.env.example` allowed) to v2's
  `.gitignore` BEFORE any other git operation.
- Verify no `.env` file is currently tracked in v2 (confirmed untracked
  during exploration; re-check at execution).

## Execution order

1. v2 `.gitignore` fix (safety first).
2. v2 consolidation: ff `main`, switch main folder to `main`, merged-check,
   remove the six worktree folders FIRST (a branch checked out in a worktree
   cannot be deleted), then delete proven-stale branches, create
   `~/evil-eye-worktrees/`.
3. Push v2 `main` → `origin/v2-dev`.
4. Write v2 docs: `CLAUDE.md`, `ARCHITECTURE.md` (from reading the actual
   v2 code), root `README.md`, `docs/HANDOFF.md`.
5. Split v1's CLAUDE.md → new `CLAUDE.md` + `ARCHITECTURE.md` with frozen
   header.
6. Commit + push docs in both repos (v1 doc commit is a docs-only change,
   allowed under the freeze).

## Error handling

- Branch deletion is gated on `git branch --merged` proof; anything
  ambiguous is kept and reported.
- Worktree removal refuses dirty worktrees; dirty ones are reported, not
  forced.
- v1 changes are docs-only; the running app is untouched. The user's
  uncommitted v1 working-tree changes (ScanPage/styles/easter-egg files)
  are left exactly as they are.

## Testing / verification

- `git worktree list` shows only the main folders after cleanup.
- `git branch -vv` in v2 shows `main` at `5f1ac5b` plus only unproven
  branches (expected: none).
- `git ls-remote origin` shows `main`=`470f6f6`, `v2-dev`=`5f1ac5b`.
- v2: `npm test` and `npm run typecheck` pass on `main` after the switch.
- Both CLAUDE.md files under ~80 lines; a fresh-session read of v2
  CLAUDE.md alone is sufficient to know where to work and how.

## Out of scope

- No renaming of remote branches.
- No merging of the two repos into one local checkout.
- No feature work in v1 or v2.
- No changes to v1's running configuration, data, or env.
