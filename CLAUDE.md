# Evil Eye V2 — session contract

> **STATUS: PRIMARY DEV SPACE.** Trunk is `main`. V2 is the from-scratch
> rebuild of Evil Eye; V1 at `../evil-eye-arbitrage` is the LIVE daily driver
> (frozen, reference only — never develop there). V2 runs in **SIM mode by
> default**: fully deterministic, structurally network-inert, zero API keys.

Sports-betting arbitrage/EV/middle finder. Scan → kill battery → pending →
double-verification → verified live with exact stakes. Information tool only.

## Commands

```bash
npm test               # Vitest, server AND client workspaces (run from repo root)
npm run typecheck      # tsc for server AND client
npm run dev            # server on :4400 (SIM mode, no keys needed)
npm run dev:client     # Vite on :5174 (proxies /api → :4400)
```

## Workflow

- Remote: `git@github.com:RyanParissay/Evil-Eye-Series-N.git` — branch
  `v2-dev` = this trunk; `main` = V1 stable. Push `main:v2-dev`.
- **Feature work happens in worktrees**, never long-lived branches in this
  folder: `git worktree add ~/evil-eye-worktrees/<feature> -b wt/<feature>`.
  Merge to `main` → `git worktree remove` + delete the branch. Ephemeral only.
- **Port isolation per worktree:** main folder uses 4400/5174. Worktrees pick
  4410+, and set `EE_API_TARGET=http://localhost:<port>` for the client proxy.
  `server/data/` is per-checkout and gitignored, so db state isolates itself.
- **TASKS.md** is the passive backlog: when a bug or worthwhile follow-up
  surfaces during other work, add a concise entry there (do NOT actively hunt
  for tasks). Entries must be self-contained and parallelizable in a worktree.
- Locked product rules live in `docs/handoff/DECISIONS.md` — never contradict
  them without an explicit user decision. Rolling state: `docs/HANDOFF.md`.
- `.env` and `server/data/` are gitignored — never commit them.

## Invariants — one-liners (full rules + module map in ARCHITECTURE.md)

- SIM is structurally network-inert: no fetch path exists in SIM, even with
  real keys present. Tests inject a throwing fetch to prove it.
- `POST /api/mode` is the ONLY liveMode writer; going LIVE 409s unless all
  required env names are present — names only, never values.
- Time and I/O are injected everywhere: every function takes `now: number`;
  the only real setTimeout/Date.now/fetch live in `index.ts`.
- One timer chain (`scheduler/runner.ts`), generation-counter superseded;
  all cadenced work (brain pass, closes, snapshots, hooks) rides the scan tick.
- Quiet hours (00:00–08:00 Vancouver, DST-safe) always win — even over an
  overdue verify.
- No stakes before promotion: PENDING trades carry `stakeCents = null`;
  money appears only after the double-verification recheck passes.
- Line groups are sacred: candidates group by event+market+|line|; middles
  require different lines by construction.
- Kill battery: six ordered gates, first failure wins, unknown book auto-kills.
- Money is integer signed cents; LLM spend is integer micro-dollars with a
  $3/month hard cap refused BEFORE any request.
- Engine (`engine/`) and the other pure leaves take no clock, rng, db, or env.
- Strategy mix is locked to 100%; per-category allowance enforced at promotion.

## Routing — read before you touch

- **Any server change:** ARCHITECTURE.md §1 (module map + purity table).
- **Detection/gates/staking math:** ARCHITECTURE.md §1 engine/pipeline +
  §6 invariants; tests are co-located `*.test.ts`.
- **Scheduler/timers/quiet hours:** ARCHITECTURE.md §5.
- **SIM/LIVE seam, env, providers:** ARCHITECTURE.md §4 and §8.
- **DB changes:** ARCHITECTURE.md §2 — migrations are guarded ALTERs, never
  drop/recreate.
- **Client:** ARCHITECTURE.md §3 — server contract mirrors live in
  `client/src/lib/`; update both sides together.
