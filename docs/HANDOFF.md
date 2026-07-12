# HANDOFF — 2026-07-11 (Phase 16 WP3 complete — dense week + weekly optimizer)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/PROGRESS.md
3. docs/superpowers/specs/2026-07-11-phase-16-design.md (the phase design — the contract)
4. this file

## Where we are
- Current phase & task: Phase 16 **WP3 (dense week + weekly optimizer, Part C.3
  + C.4) COMPLETE** — all deliverables landed and committed. WP4a (Hub server)
  was already merged to main; **WP4b (Hub client page + neon button) is being
  built in a PARALLEL worktree** and was untouched here. The remaining step is
  the final Fable acceptance/verification pass.
- Tests: **577 server + 36 client green** (was 534 + 36 at WP3 start — WP3
  added 43 server: denseWeek pure 9, plan +9, scheduler tick +5 (dense +
  accumulation acceptance), scheduler routes 10, optimizer pure 10). Root
  `npm run typecheck` green. Verified the server boots (mock mode, port 8799):
  GET /api/scheduler/dense-week + /proposal respond; ops.json byte-identical
  (no real data touched).
- WP3 commits, in order: dense-week plan logic (pure) + hard caps; dense-week
  routes + scheduler wiring + scanner UI; weekly deterministic optimizer
  (pure); proposal API + apply + scanner UI; this docs sweep.

## Done this session (WP3 — Part C.3 + C.4)
- **Dense week (Part C.3).** `scheduler/denseWeek.ts` (PURE): derives the
  elevated interval `max(5, ceil(1020 × perPairCost / 4500))` (perPairCost =
  per-scan credits × (1 + measured hit rate)); measures day/week spend from
  scan-history `creditsComputed` scoped to `denseWeek.startedAt`; the cap
  banner (`denseWeekStop`). `plan.ts` gained a dense-week branch that OVERRIDES
  the enabled gate (user-authorized, like scan B) but still respects quiet
  hours + the 95% monthly stop, with hard caps 4,500/Vancouver-day (sleep to
  next local midnight, resumes) and 30,000/week (sleep to week end). The tick
  (`scheduler.ts`) resolves the dense week each cycle from scan history (new
  OPTIONAL deps `denseWeekInputs`/`clearDenseWeek`, so existing fixtures are
  untouched) and auto-clears the expired week → normal blocks. Routes:
  GET/POST/DELETE `/api/scheduler/dense-week` (POST 409s if active; GET lazily
  clears an expired week). Scanner UI in CadencePanel: day X of 7, credits vs
  caps, derived interval, start (with real-credit warning) / cancel, amber
  cap-hit banner.
- **Weekly optimizer (Part C.4).** `scheduler/optimizer.ts` (PURE, MODEL):
  confirmed-opportunity density (hour × day per strategy, Vancouver local) →
  blocks. Allowed 2h-slot grid derived by subtracting quiet hours (00:00–01:00
  + eight 08:00–24:00 slots). Frequency ∝ density; ≥1 window per allowed 2h
  block (interval ≤ slot duration); a deterministic binary search scales the
  extra-budget allocation so the HONEST discrete projection ≤ spendCeiling =
  budget × 0.9. Per-day intervals merge (contiguous same-interval runs, then
  identical runs across days) into multi-day blocks; a flat history collapses
  to seed-style all-days blocks. `model: true` always; byte-identical two-run
  determinism fixture. Routes: GET `/api/scheduler/proposal` (409 below 7 days
  of history) + POST `/api/scheduler/proposal/apply` (the SOLE writer of
  `scheduler.blocks`, stamps `proposalAppliedAt`, never auto-applied). Scanner
  UI: MODEL-tagged density heat table (hour × day, per-strategy in tooltip),
  projected-vs-ceiling spend, Apply behind a confirm, ">7 days old, re-run
  weekly" nudge.
- **Contracts.** shared/types: new `DenseWeekStatus`; `SchedulerSettings`
  gained `proposalAppliedAt?`. opsStore default carries `proposalAppliedAt:
  null`; `denseWeek` stays absent by default and normalize passes both through.
- **Acceptance fixtures (binding).** Day-cap: `scheduler.test.ts`
  "pairs accumulate to the 4,500/day cap" drives real scan-history lines
  through the tick (denseWeekSpend, no injected cap) → scanning stops at the
  cap, resumes next local day; `plan.test.ts` + route test cover the banner.
  Week-cap: plan + tick tests stop for the week. Optimizer determinism +
  projected ≤ ceiling: `optimizer.test.ts`. Apply writes blocks / a read never
  does: `routes/scheduler.test.ts`. Every cap fixture simulates a day/week by
  constructing history lines + advancing the injected clock — no test sleeps.

## Next actions
1. **WP4b (Sonnet, parallel):** Hub client page + neon-yellow button on WP4a's
   API — untouched here; nothing in WP3 conflicts (Hub server was left alone).
2. **Final (Fable):** acceptance-checklist verification pass, DEV_MODE
   walkthrough, PROGRESS.md + this HANDOFF.

## Traps for the incoming agent
- Vitest from `server/` (repo root loses `@shared`). Client from `client/`.
- The live `:8787` runs `tsx watch` against Ryan's REAL key/data. Everything
  WP3 added stays inert while `enabled:false` AND `denseWeek` absent — and
  `denseWeek` is absent by default and NEVER migrated in. A migration that set
  denseWeek would start burning real credits (it overrides the enabled gate).
- The dense week OVERRIDES `enabled` (unlike normal cadence) — that is the
  point (user-started), and it is why denseWeek must never be seeded.
- The hard caps + banner are DERIVED from scan history (no separate persisted
  flag), so they survive restarts and the day cap self-resets at local
  midnight. Don't "fix" this by persisting a stopped boolean.
- `scheduler.blocks` is written ONLY by POST /api/scheduler/proposal/apply
  (the ops PATCH validator still refuses blocks). Keep it that way — the
  optimizer is propose-only, never timer-applied.
- New scheduler tick deps (`denseWeekInputs`, `clearDenseWeek`) are OPTIONAL;
  omitting them = normal block cadence (how the pre-WP3 tick tests still pass).

## First prompt to paste into the new agent
"Read CLAUDE.md, docs/PROGRESS.md, docs/superpowers/specs/2026-07-11-phase-16-design.md,
and docs/HANDOFF.md. WP1/WP2/WP3 and WP4a are done; run the final Phase 16
acceptance/verification pass (or finish WP4b Hub client if still open). Do not
re-plan completed work."
