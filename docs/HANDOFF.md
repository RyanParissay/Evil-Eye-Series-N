# HANDOFF — 2026-07-11 (Phase 16 WP1 complete — scheduler foundation; WP2 next)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/PROGRESS.md
3. docs/superpowers/specs/2026-07-11-phase-16-design.md (the phase design — the contract)
4. this file

## Where we are
- Current phase & task: Phase 16 **WP1 (scheduler foundation) COMPLETE** — all
  seven WP1 deliverables landed and committed. Next per the design doc's build
  order: **WP2 (Opus)** — confirmation pairs (Part A) + cost model + Phase-15
  filter conversion + single_sighting flag + alert/purchase gating. Not started.
- Tests: **452 server + 34 client green** (was 411 + 34 at WP1 start — WP1 added
  41 server tests: vancouverTime 10, plan 11, scheduler 7, timerScope 1, opsStore
  6, quietHoursGuard 3, ops-route scheduler PATCH 2, gapDetector +1). Root
  `npm run typecheck` green.
- Last commits (this session, in order): scheduler core+plan+quiet-hours+tick;
  quiet-hours route guards; enable-toggle + quota self-disable + gap rewire +
  client timer retirement; this CLAUDE.md/HANDOFF sweep.

## In flight RIGHT NOW
- Nothing in flight. Tree clean once the CLAUDE.md/HANDOFF commit lands.

## Done this session (WP1)
- **THE invariant flip.** "No server-side schedulers / scans on-demand only /
  timers live in the client" is RETIRED. Replacement (now in CLAUDE.md): all
  wall-clock scheduling lives in `server/src/scheduler/` — one self-rescheduling
  tick, pure plan.ts, injectable clock/timer, budget/cap/quiet-hours-aware by
  construction. Swept every stale reference (invariants list, ops/grading
  layering entries, backupService + credit-budget gotchas, alerts-piggyback
  invariant, and the code comments in index.ts / constants.ts / backupService.ts
  / alertService.ts / client api.ts).
- **`server/src/scheduler/`**: `plan.ts` (pure decision core — engine-grade),
  `vancouverTime.ts` (DST-safe America/Vancouver via Intl/IANA — quiet-hours
  predicate + next-08:00 + local→epoch), `scheduler.ts` (the one setTimeout
  chain, injected clock/timer, self-disables on spent-quota / rejected-key),
  `realTimer.ts` (the ONLY real setTimeout in server/src — `timerScope.test.ts`
  enforces the scope). Started from index.ts, DEFAULT DISABLED.
- **Scheduler settings in opsStore**: `scheduler { enabled(false), blocks[],
  scanParams, disabledReason }`; seed blocks per the design's revised schedule
  (moderate 08–14, dense 14–19 & 19–23, moderate 23–01 as two within-day blocks;
  01–08 quiet = hard guard, not a block); legacy ops.json migrates in via the
  normalize pattern. `seedScanParams` = last-scan meta else ca_us/topN 5.
- **Quiet hours (01:00–08:00 America/Vancouver, DST-safe)**: plan.ts blocks
  scheduler scans + score polls; `routes/quietHoursGuard.ts` 503s manual scans
  and cockpit re-verify with the new `quiet_hours` ApiErrorCode. Overdue score
  polls fire at 08:00. Proven by a simulated-24h test on a PST date AND a PDT
  date (drives the real tick loop with a fake clock/timer, asserts zero provider
  calls in 01:00–08:00 while work still happens outside it).
- **Server enable toggle + quota self-disable**: PATCH /api/ops/settings takes a
  partial `scheduler` patch; enabling clears the self-disable reason, seeds
  scope from the last scan, and wakes the running scheduler. Quota/bad-key errors
  self-disable persistently with a stored reason.
- **Gap-detector rewire**: `detectScanGaps(entries, scheduler.blocks, now)` —
  per-block cadence, Vancouver-local membership via plan.ts's activeBlock;
  scanBrowser / portfolios / grading updated to pass `scheduler.blocks`.
- **Client timer retirement**: ScanPage's auto-scan setTimeout loop + 30s cadence
  tick + 5-min grading tick are gone. The auto-scan switch PATCHes
  scheduler.enabled and renders enabled/disabledReason from the server;
  AutoScanControl is a plain server switch; CadencePanel shows the read-only
  block schedule + budget/markets settings (legacy window editors dropped). The
  credit-budget auto-stop moved into plan.ts. Manual scan button, the manual
  grading-poll endpoint, and every page fetch stay.

## Next actions (per the design doc's build order)
1. **WP2 (Opus)**: confirmation pairs (Part A) — scan A → scan B after
   `confirmationIntervalSecs`; confirmed = same event/market/leg identities +
   headline edge within ±0.5pp; only confirmed records alert/Hub-purchase;
   unconfirmed persist `single_sighting`. Convert Phase-15's
   `confirmSecondSighting` machinery into the A/B pair-matcher and REMOVE the
   dead ops toggle from the UI (it's still live in CadencePanel — WP2 removes it).
   Cost model widget = cost(A) + hitRate × cost(B).
2. WP3: dense week caps + banners + weekly optimizer + proposal API/UI (the
   optimizer becomes the editor for scheduler.blocks — read-only in WP1).
3. WP4a/b: Analytics Hub server + client.

## Traps for the incoming agent
- Vitest from `server/` (repo root loses `@shared`). Client from `client/`.
- The live `:8787` runs `tsx watch` against Ryan's REAL key/data — never
  `POST /api/scan` there. `scheduler.enabled` DEFAULTS FALSE and the tick no-ops
  while disabled, so hot-reloads stay dormant; NEVER seed/migrate it true. For
  live-ish checks, run your own instance on another port with DEV_MODE=true and
  BACKUP_DIR to a temp dir; server/data/ has no path override, so snapshot +
  restore if you cause writes (this session's boot smoke test only read + 400'd,
  so it touched nothing).
- Timers: setTimeout/setInterval are allowed ONLY under `server/src/scheduler/`
  now (`timerScope.test.ts` fails otherwise). The one client setTimeout is a
  Portfolios slider debounce — unrelated.
- Quiet-hours guards use real time; they're mounted only on POST /api/scan and
  POST /api/opportunities/:id/verify from index.ts (via app.post before the
  routers), deliberately kept OUT of the router unit tests so nothing else is
  time-dependent. Keep that pattern if you add more guarded routes.
- Scheduler settings: `plan.ts` is pure/engine-grade — keep fs/env/Express/
  provider imports out of it. All local-time reasoning goes through
  vancouverTime (Intl/IANA), never a fixed offset.
- WP2's confirmation supersedes `confirmSecondSighting` — don't extend it;
  convert its pure gate into the pair-matcher and remove the UI toggle.

## First prompt to paste into the new agent
"Read CLAUDE.md, docs/PROGRESS.md, docs/superpowers/specs/2026-07-11-phase-16-design.md,
and docs/HANDOFF.md, then start Phase 16 WP2 (confirmation pairs / Part A). Do
not re-plan completed WP1 work."
