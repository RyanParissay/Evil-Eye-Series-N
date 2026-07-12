# HANDOFF — 2026-07-11 (Phase 16 WP2 complete — confirmation pairs; WP3 next)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/PROGRESS.md
3. docs/superpowers/specs/2026-07-11-phase-16-design.md (the phase design — the contract)
4. this file

## Where we are
- Current phase & task: Phase 16 **WP2 (confirmation pairs, Part A) COMPLETE**
  — all eight deliverables landed and committed. Next per the design doc's
  build order: **WP3 (Opus)** — dense week caps + banners + weekly optimizer +
  proposal API/UI. WP4a (Hub server) was building in a PARALLEL worktree
  against the same shared/types.ts contracts; its merge point in index.ts is
  the marked "Analytics Hub consumer registration point" comment (search for
  it) — one `confirmedConsumers.push(...)` line wires purchases.
- Tests: **501 server + 36 client green** (was 452 + 34 at WP2 start — WP2
  added 49 server: confirmation matcher 15, lifecycle +7, service +5,
  scanService +2, plan +11, scheduler tick +5, pair acceptance fixtures 3,
  opsStore +2, ops routes net +3, minus 4 converted second-sighting tests;
  client +2 pair-cost formatter). Root `npm run typecheck` green.
- WP2 commits, in order: confirmation core (matcher/stamping/candidates);
  scheduler owns scan B; onConfirmed fan-out + acceptance fixtures;
  confirmSecondSighting retired for confirmationIntervalSecs; pair cost
  model; this docs sweep.

## Done this session (WP2 — Part A)
- **Pair orchestration.** Every scan is a scan A: `applyScanToRecords` stamps
  eligible new records (non-suspicious/same-book) `confirmation: pending` and
  reports the candidate count; runScan logs it per scan
  (`ScanLogEntry.confirmationCandidates`). ≥1 candidate → the scheduler fires
  scan B (same fetch scope, from last-scan meta) after
  `scheduler.confirmationIntervalSecs` (normalized 60, PATCH range 10–600s).
  No candidates → no B, zero extra credits. The pending pair is STORE-derived
  (records with pending status + scan history), so it survives hot reloads;
  the notifier wakes the scheduler so manual pairs arm precisely and complete
  with the browser closed and the toggle off.
- **Matching.** `opportunities/confirmation.ts` (pure): presence = same
  fingerprint with lastSeenAt advanced past the pre-B snapshot (the converted
  Phase 15 machinery), confirmed iff headline edge within ±0.5 pp inclusive
  (arb→profitPct, EV→ev.edgePct, middle→middle.costPct); else terminal
  single_sighting (scanBAt always stamped; edgeDeltaPp only when re-sighted).
  `pendingConfirmations()` returns DEEP COPIES — the pre-B snapshot must not
  alias store objects (a real bug the acceptance fixture caught).
- **Quiet-hours/lapse rule.** plan.ts: a due B outranks the enabled/budget
  gates (rides scan A's authorization) but never quiet hours; if B can't fire
  within 5× the interval of its due time → `resolveConfirmations` (all
  pendings → single_sighting, zero credits, allowed even in quiet hours /
  disabled). Due anchors to the last scan ATTEMPT (bounded ~5 retries on
  provider failure), expiry to the last real sighting.
- **Acting gates.** WhatsApp dispatch (arb/EV/middle incl. free middles)
  moved verbatim from the per-scan notifier into index.ts's `onConfirmed`
  fan-out (fire-and-forget per consumer, console.warn discipline). Paper fund
  stays UNGATED per scan (recorded decision). Survival/coverage/leaderboard
  telemetry unchanged — the fixture proves survival is byte-identical with
  confirmation fields stripped.
- **Conversion.** `OpsSettings.confirmSecondSighting` is GONE (type, store
  default, normalize drops the legacy key, PATCH validator, CadencePanel
  toggle, index gate, filterConfirmedSightings + tests → seeded the matcher
  tests). CadencePanel now edits the confirmation interval (seconds,
  `patchScheduler({confirmationIntervalSecs})`) with the survival readout
  kept beside it.
- **Cost model.** /api/ops/cost-estimate adds `confirmation:
  {intervalSecs, hitRate, hitRateSource MEASURED|ASSUMED, samples,
  creditsPerPairWindow}` — hitRate = share of last-14-days logged scans with
  ≥1 candidate, MEASURED at ≥50 samples else ASSUMED 30%; plain per-scan
  number kept. Client: CadencePanel line + CreditSpendWidget "per scan
  window" stat (`describePairCost` in creditWidget.ts).
- **Acceptance fixtures** (binding): `scheduler/confirmationPair.test.ts` —
  a mini index.ts composition (real runScan/OpportunityService/Scheduler/
  notifyNewOpportunities, counting provider, hand-driven clock). No
  candidates → no B, credit counter proves it; candidates → B at exactly
  +60s with the scheduler disabled, exactly one alert; drift beyond ±0.5pp →
  single_sighting never alerted; survival blind to confirmation.

## Next actions (per the design doc's build order)
1. **WP3 (Opus):** dense week caps + banners + weekly optimizer + proposal
   API/UI (`scheduler/optimizer.ts`, GET /api/scheduler/proposal, POST
   .../apply; the optimizer becomes the editor for scheduler.blocks).
2. **WP4a merge:** wire the Hub consumer at the registration point in
   index.ts; Hub purchases must key off `onConfirmed` ONLY.
3. WP4b: Hub client page + neon button, on WP4a's API.

## Traps for the incoming agent
- Vitest from `server/` (repo root loses `@shared`). Client from `client/`.
- The live `:8787` runs `tsx watch` against Ryan's REAL key/data — never
  `POST /api/scan` there. `scheduler.enabled` stays FALSE by default; the
  confirmation pair fires scan B even while disabled, but ONLY when a scan A
  just left pending candidates — with no pending records a reload is inert.
- Timers only under `server/src/scheduler/` (timerScope.test pins it). Scan-B
  timing included — never add a confirmation timer anywhere else.
- `pendingConfirmations()` must keep returning deep copies; the pair matcher
  compares the pre-B snapshot against the post-B store (headline fields
  refresh per sighting, so the snapshot IS scan A's edge).
- `confirmationIntervalSecs` must stay ≤600s (validator + normalize) — above
  the smallest block cadence, scan B would forever chase the next scan A's
  re-basing.
- confirmed / single_sighting are TERMINAL; applyConfirmations only moves
  still-pending records (races are no-ops). Suspicious/same-book detections
  get NO confirmation field, so they can never buy a scan B.
- The onConfirmed fan-out passes live record references; consumers must not
  mutate them. Alert dispatch converts via recordToOpportunity (fingerprint
  round-trips — pinned by test).

## First prompt to paste into the new agent
"Read CLAUDE.md, docs/PROGRESS.md, docs/superpowers/specs/2026-07-11-phase-16-design.md,
and docs/HANDOFF.md, then start Phase 16 WP3 (dense week + weekly optimizer).
Do not re-plan completed WP1/WP2 work."
