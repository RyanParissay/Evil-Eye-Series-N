# HANDOFF — rolling current state

Update at the end of significant sessions: what's done, what's in flight,
what's next. Newest entry first.

## 2026-08-01 — §2.2 + §2.3 + EE_PORT landed; results-feed design drafted

**Done (three parallel worktrees, two-layer reviewed, merged to main):**
- **§2.2 live-fetch hardening** (`f8e4679`): manual-scan-refresh turned out
  already fixed on this trunk (6aa206a) — locked with a regression test.
  New `FeedHealth` (`OddsProvider.health()`, surfaced as
  `GET /api/state.feedHealth`, null in SIM) + TRADES-screen feed chip
  (FEED · SIM / AWAITING FIRST FETCH / OK / ERROR with last-known-good time),
  so a broken live feed is no longer indistinguishable from "no
  opportunities".
- **§2.3 settings editability MVP** (`7097629`): SCAN RULES · CREDIT
  FORECASTER + RISK & BANKROLL panels fully editable via existing
  `PATCH /api/settings`; client mirrors `RANGE_RULES` (verified against a
  real server); display always server-truth, zero server changes.
- **EE_PORT override** (`0f6f3ad`): server port env-overridable
  (default 4400), TASKS.md entry resolved, docs updated.
- 342 tests green (270 server / 72 client), typecheck clean.

**Drafted, awaiting Ryan:** results feed / auto-settlement design (§2.1) at
`docs/superpowers/plans/2026-08-01-results-feed-design.md` — pure
`engine/grading.ts`, `live/scores.ts` provider, LIVE-gated hook on the 3h
cutoff. Blocking decisions D1 (event-id column), D2 (VOID result kind),
D3 (72h give-up), plus the explicit real-money-path GO per §5.

**New TASKS.md items:** quiet-hours gap — `pumpHooks()` refreshes the live
provider on hook wakes even in quiet hours; dead settings helpers prune.

## 2026-07-23 — workflow restructure

**Done:**
- V2 declared the primary dev space; V1 (`../evil-eye-arbitrage`) is LIVE +
  FROZEN (critical fixes/docs only).
- Branch consolidation: `main` fast-forwarded to the former
  `plan-1-simulated-core`/`p6b-integration` tip; all 10 stale plan/worktree
  branches verified merged and deleted; the six scattered `~/evil-eye-v2-wt-*`
  worktrees removed (their untracked EXEC-LOGs preserved in
  `docs/superpowers/exec-logs/`).
- Remote: `Evil-Eye-Series-N` — `main` = V1, `v2-dev` = this trunk.
- Docs written: CLAUDE.md (session contract), ARCHITECTURE.md (deep
  reference), README.md, TASKS.md (passive backlog), this file.
- `.gitignore` now covers `.env` (was a live-key commit risk).
- Worktree convention: ephemeral only, `~/evil-eye-worktrees/<feature>` on
  `wt/<feature>`, ports 4410+/`EE_API_TARGET`.

**State of the app:** Plans 1–6 built and merged (simulated core, TRADES,
BRAIN, ANALYTICS, SETTINGS, LIVE-mode seams); Phase B SIM/LIVE integration
done; F1–F7 review fixes landed. 63 client + ~262 server tests green;
typecheck clean. SIM mode fully functional end-to-end; LIVE mode wired but
results feed not yet connected (see DECISIONS/journal note).

**Next candidates:**
- Wire the LIVE results feed (Plan 6 deferral).
- First LIVE-mode trial run against real keys (careful: credits).
- Design-reference visual parity pass on the client.
