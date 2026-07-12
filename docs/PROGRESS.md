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

Candidate next phases:
- Phase 16 — Analytics Hub + confirmation scanning + adaptive scheduling: design
  DONE at docs/superpowers/specs/2026-07-11-phase-16-design.md, build NOT started.
  This is the phase that retires "no server-side schedulers" (CLAUDE.md invariant
  rewrite is part of WP1) in favor of one self-rescheduling tick in
  server/src/scheduler/, plus scan-A/scan-B confirmation (supersedes Phase 15's
  confirmSecondSighting toggle) and a Hub extending leaderboardStore into
  per-strategy top-10 boards. Next task: Gate 0 + WP1 per that design doc.
- Kelly + stochastic risk models (Phase 11, still unbuilt).
- Props probe (out of scope through Phase 16).

Next task: Phase 16 Gate 0 + WP1 (docs/superpowers/specs/2026-07-11-phase-16-design.md).
