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

Hub v2 (deferred from Phase 16 by spec — do not build unprompted):
- Multi-profile overlay charts; density heatmap UI polish; profile
  archiving/cloning. Also noted: EquityChart's hi/$0 axis labels collide
  when a profile's peak profit is within ~$2 of zero (pre-existing shared
  component geometry, cosmetic).

Candidate next phases:
- Phase 17 — Safety Score (spec saved VERBATIM at docs/prompts/phase-17.md,
  Ryan-provided; gates alerts + Hub purchases on a deterministic 0–100
  account-longevity score, sits AFTER confirmation in the pipeline).
- Kelly + stochastic risk models (Phase 11, still unbuilt; real graded
  distributions now accruing).
- Props probe (out of scope through Phase 16).

Next task: Phase 17 Gate 0 (docs/prompts/phase-17.md) — after Ryan reviews Phase 16.
