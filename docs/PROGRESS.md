# PROGRESS

- [x] Phases 1–10, 12 (see docs/claude-onboarding-prompt.md for the full state)
- [ ] Phase 11 — Kelly + stochastic risk models (unbuilt, pre-dates this sprint)
- [x] Phase 13 — scores ingestion + auto-grading (rules table, pure engine + 19 golden tests, scores polling via client ticks + scan piggyback with 500/day cap, manual override with audit log, schemaVersion 2 + pre-v13 bucket, scan-gap detector, grading UI in EvidencePanel + cockpit)
- [x] Phase 14 — multi-scenario paper portfolios + combo optimizer (13 series per GRADING_RULES §5, deterministic replay tested, /portfolios page with 4 tabs, gated Markowitz grid-search optimizer labeled MODEL, 0-70% bounds)
- [ ] Phase 15 — evidence quality pack + ops hardening

Next task: Phase 15 (docs/prompts/phase-15.md). Known: optimizer gates need ≥30 graded records + 14 days per group before it unlocks; grading data starts accruing with live scans.
