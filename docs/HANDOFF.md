# HANDOFF — rolling current state

Update at the end of significant sessions: what's done, what's in flight,
what's next. Newest entry first.

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
