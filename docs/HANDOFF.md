# HANDOFF — 2026-07-11 (Phase 16 complete — Fable orchestration session)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/superpowers/specs/2026-07-11-phase-16-design.md
3. docs/PROGRESS.md  4. this file

## Where we are
- Phases 1–16 COMPLETE except Phase 11 (Kelly — deliberately parked).
- Tests: 578 server + 49 client, typecheck green, tree clean.
- Phase 16 landed as: Gate 0 report → WP1 scheduler foundation (Opus) →
  WP2 confirmation pairs (Fable) → WP4a Hub server (Opus, worktree) →
  WP3 dense week + optimizer (Opus) → WP4b Hub client (Sonnet, worktree)
  → merges + post-merge hardening (dense week never overrides a
  self-disable). Full commit trail in git log from 0c0b653 forward.
- Phase 17 spec saved VERBATIM at docs/prompts/phase-17.md — NOT started;
  wait for Ryan's go.

## Live operations (the part that spends money)
- :8787 runs tsx watch with the REAL key; :5173 Vite. Both untouched.
- scheduler.enabled = FALSE (dormant). Ryan must flip the toggle on the
  scanner page to start scheduled scan pairs. Quiet hours 01:00–08:00
  America/Vancouver block EVERYTHING including manual scans (his spec).
- Dense week: user-started only, 4,500/day / 30,000/week hard caps,
  never survives a self-disable (dead key).
- All three markets (h2h/totals/spreads) ON; 15–30 credits per scan,
  ~×(1+hitRate) per window once pairs run; budget 100k, auto-stop 95%.

## In flight RIGHT NOW
- Nothing. No background agents running.

## Open questions saved for Ryan (decisions made provisionally)
1. Quiet hours block MANUAL scans too (strict "zero calls of any kind").
   Relax to scheduler-only if unintended.
2. Premade Hub profiles: $1,000 start, flat $50 stake, minEdge 0 —
   stake/filters editable in the UI; confirm the defaults.
3. Dense week overrides the OFF toggle (starting it = authorization) but
   never a self-disable. Confirm the override half matches intent.
4. Alerts fire at the confirmation TRANSITION only; a record confirmed
   below a subscriber's threshold never alerts later (terminal).
5. Phase 14 series stakes ($200 flat) + manual-grade granularity
   (one overall result, not per-leg) — carried over from the P13/14 handoff.

## Traps for the incoming agent
- Vitest from server/ dir (repo root loses @shared) — unchanged.
- setTimeout is legal ONLY in server/src/scheduler/realTimer.ts
  (timerScope.test.ts pins it). No test may sleep — inject the clock.
- Scan B "rides scan A's authorization": it fires while the scheduler
  toggle is off and past the budget stop — by design (WP2 report). Quiet
  hours still block it; >5× interval late resolves single_sighting.
- The paper fund deliberately stays on the UNGATED stream; alerts + Hub
  purchases are the only confirmation-gated consumers.
- data/hub.json premades seed on first read; leaderboard %-occurrence
  boards need accrued totals (they start at zero, forward-only).

## First prompt to paste into a new agent
"Read CLAUDE.md, docs/PROGRESS.md, and docs/HANDOFF.md. Phase 16 is
complete; Phase 17's spec is docs/prompts/phase-17.md but do NOT start
it without Ryan's explicit go."
