# PHASE 14 — Multi-scenario paper portfolios + combo optimizer

Prerequisite: Phase 13 merged, golden tests green. Read docs/GRADING_RULES.md §5 first.

## Deliverables

1. Scenario engine — 13 parallel series from one opportunity stream:
   Arb ×3 (min edge 1/2/3%) · EV ×9 (edge min {3,5,7}% × risk/trade {3,2,1}% of series
   bankroll) · Middles ×1. $10,000 start per series, flat staking, no compounding;
   unaffordable signal → skip + skipped_insufficient_bankroll event (visible, counted).
   Backfill from persisted history; only gradeable records enter P&L; ungradeable bucket
   visible per series; Phase-13 scan gaps shown as caveats. Deterministic replay + test.
2. Four portfolio views — Arb-only, Edge-only, Middles-only, Combo. Per series: bankroll,
   P&L, ROI, record count, W/L/push/void, skipped count, max drawdown, equity curve.
   Combo: weight sliders across the 3 groups summing to 100% + Optimize button.
3. Optimize weights — deterministic Markowitz mean-variance on recorded series returns,
   labeled MODEL, no LLM. Gates: every included series ≥30 graded records AND ≥14 days
   (sample gate first); weight bounds 0–70% per group; in-sample caveat shown. Pure fn +
   unit tests incl. degenerate dominant-series case.

## Out of scope
Leaderboards, scan browser, second-sighting, WhatsApp copy, backup, Kelly, props, live, CLV.
Do not modify grading logic (fix via Phase 13 tests if wrong).

## Acceptance
13 series from backfill + determinism test · skip events visible · sliders sum 100% ·
optimizer gated + bounded + tested · ungradeable/gap caveats visible · PROGRESS.md → Phase 15.
