# PROGRESS

- [x] Phases 1–10, 12 (see docs/claude-onboarding-prompt.md for the full state)
- [ ] Phase 11 — Kelly + stochastic risk models (unbuilt, pre-dates this sprint)
- [x] Phase 13 — scores ingestion + auto-grading (rules table, pure engine + 19 golden tests, scores polling via client ticks + scan piggyback with 500/day cap, manual override with audit log, schemaVersion 2 + pre-v13 bucket, scan-gap detector, grading UI in EvidencePanel + cockpit)
- [x] Phase 14 — multi-scenario paper portfolios + combo optimizer (13 series per GRADING_RULES §5, deterministic replay tested, /portfolios page with 4 tabs, gated Markowitz grid-search optimizer labeled MODEL, 0-70% bounds)
- [x] Phase 15 — evidence quality pack + ops hardening. All 7 deliverables landed:
      #4 WhatsApp copy pinned to exact format, #5 delivery-failure banner + capped
      retries, #7 credit-spend widget, #6 daily backup + CSV exports, #3
      second-sighting confirmation toggle, #2 scan history browser (/scans, gap
      indicators inline, drill-down via slot-matched opportunity records), #1 book
      leaderboards (accrues per scan in ops/leaderboardStore.ts, zero credits
      structural). 411 server + 34 client tests green, typecheck green. DEV_MODE
      walkthrough done (mock stack on :8790/:5190, never touched the real :8787/:5173
      processes or their data — see HANDOFF.md for the restore log); found and fixed
      one real bug: the /scans Sports column was unbounded and made rows unreadable
      on scans covering 20+ leagues, now truncated with a hover title.

- [x] Phase 16 — Analytics Hub + confirmation scanning + adaptive scheduling.
      Gate 0 report delivered pre-code. WP1: server/src/scheduler/ (THE invariant
      flip — one timer-owning module, pure plan.ts, injectable clock, DST-safe
      quiet hours 01:00–08:00 America/Vancouver blocking scans + score polls +
      manual scans + re-verify, quota self-disable, client timers retired,
      CLAUDE.md rewritten). WP2: confirmation pairs (scan B fires 60s after scan
      A only when candidates exist; ±0.5pp match; single_sighting terminal flag;
      alerts moved behind the onConfirmed fan-out; conditional-pair cost model
      MEASURED/ASSUMED; supersedes Phase 15's confirmSecondSighting). WP4a/4b:
      Analytics Hub (/hub, neon-yellow bottom button; three $1,000 premade
      profiles + custom CRUD; purchases ride the onConfirmed fan-out; settlement
      via extracted portfolios/settlement.ts — P&L math exists once; three
      top-10 %-occurrence leaderboards; all SIMULATED-labeled). WP3: dense
      data-gathering week (4,500/day + 30,000/week hard caps with banner, 95%
      auto-stop on top, interval derived from measured per-pair cost, 5-min
      floor) + deterministic MODEL weekly proposal (density → blocks under
      quiet-hours/2h-floor/90%-budget-ceiling constraints; applied ONLY via
      explicit user confirmation). Post-merge hardening: dense week never
      overrides a SELF-disable (dead key stops dense scans too). 578 server +
      49 client tests green.

Known issues / accepted limitations:
- Leaderboard cannot backfill history — last-snapshot.json is latest-only, so
  counts only accrue forward from when leaderboard.json is first created.
  Structural, not a bug (see CLAUDE.md).
- /scans drill-down scopes a record to the scan that shares its regionTab; a
  fingerprint re-detected under a DIFFERENT region tab (same event, different
  tab's allowlist) won't show up in that later scan's row, only the one whose
  tab it was first detected under. Intentional (mirrors the "provenGone"
  dead-detection scope), not a bug.
- Optimizer gates (Phase 14) still need ≥30 graded records + 14 days per group
  before /portfolios/optimize unlocks; grading data accrues only from live scans.

- [x] Phase 17 — Safety Score (branch merged dff5a23). Pure deterministic
      engine (engine/safety.ts, components a–f, hard rejects, 44 fixtures incl.
      every spec-named case + byte-identical determinism), exposure/cooldown
      DERIVED from records (no new mutable state), scoring persisted at the
      confirmation transition on every confirmed record (gate-filtered
      included), ONE passesSafetyGate in both consumers (alerts + Hub
      purchases; paper/telemetry ungated), WhatsApp `Safety NN/100` line +
      rounded ($5) primary stakes with profit recomputed at rounded stakes
      (Phase 15 pins amended), GET /api/safety/cost vs a hand-computed fixture
      week, score badges/breakdown + settings panel + Hub Cost of Safety +
      rotation advisory in the UI. Scoring failure NEVER blocks confirmation
      (warn + ungated). Nothing identity/VPN/multi-account related exists.
- [x] Post-P17 hardening (f3a2695..bfed2cf) — first real-data run of the
      confirmation pipeline exposed two Phase 16 bugs: (1) an under-covered
      scan B (concurrent manual scan → provider rate limiting) terminally
      muted every pending candidate, and the same attempted-vs-successful
      sports confusion let the kill-pass falsely kill records of failed
      sports; both fixed (coverage-aware judgment; persistence sees
      successful-only sports). (2) Scans now serialize through one in-process
      queue — concurrent scans can no longer race each other. One-off repair
      un-muted the 11 records from the 23:20Z incident; 10 from an earlier
      20:17Z incident left as-is (documented in HANDOFF; their events
      commence within days). 652 server + 68 client tests green.

- [~] Phase 18 — CLV capture (SERVER complete this session; UI next). Zero
      credits STRUCTURAL: engine/clv.ts (PURE raw + de-vigged true CLV%,
      per-record stake-weighted, missing closing legs EXCLUDED/renormalized,
      hand-computed goldens) + clv/clvCapture.ts (PURE, no provider — builds
      record.closing from the raw snapshot: own-book + benchmark price +
      de-vigged fair prob, for every not-yet-commenced snapshot record;
      ROLLING OVERWRITE + FREEZE at commence, structural in both capture and
      OpportunityService.applyClosings). Rides runScan's notifier
      fire-and-forget. confirmation.confirmedLegOdds (signal basis) stamped in
      matchConfirmationPair for every re-sighted record (confirmed + drifted
      single_sighting) — asserted through the real pair pipeline. Read model
      clv/clvSummary.ts + GET /api/clv/summary (routes/clv.ts): coverage
      honesty header (frozen-only median), signal cells by strategy × gate
      outcome (alerted/safety-filtered via LIVE passesSafetyGate/
      single_sighting), execution cells by strategy, byBook — every cell
      asserted exactly against a hand-built fixture. 686 server + 68 client
      tests green, typecheck clean, boots clean. UI (Ledger CLV panel + cockpit
      own-record CLV line) is the remaining Sonnet WP.

Hub v2 (deferred from Phase 16 by spec — do not build unprompted):
- Multi-profile overlay charts; density heatmap UI polish; profile
  archiving/cloning. Also noted: EquityChart's hi/$0 axis labels collide
  when a profile's peak profit is within ~$2 of zero (pre-existing shared
  component geometry, cosmetic).

Candidate next phases:
- Kelly + stochastic risk models (Phase 11, still unbuilt; real graded
  distributions now accruing).
- Props probe (out of scope through Phase 16).

Next task: Phase 18 UI (Sonnet) — CLV section in the Ledger evidence panel +
cockpit own-record CLV line, off GET /api/clv/summary (server done). Then
candidates: Phase 11 (Kelly, once ~2 weeks of graded data exist), Hub v2
polish, props probe.
