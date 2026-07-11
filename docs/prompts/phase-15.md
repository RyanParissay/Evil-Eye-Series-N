# PHASE 15 — Evidence quality pack + ops hardening

Prerequisite: Phases 13–14 merged. Zero live Odds API calls except the existing scan path —
leaderboards and tests run on stored snapshots/fixtures only.

## Deliverables
1. Book leaderboards (zero credits) — opportunity counts per book per strategy since paper
   start by re-running detection over stored snapshots (all ~49 books). Per book: counts by
   strategy, share, first/last sighting. Incremental/cached, never recompute-on-every-load.
2. Scan history browser — past scans (time, credits, markets) + their opportunities with
   drill-down; Phase-13 gap indicators inline.
3. Second-sighting alert confirmation — ops toggle, default OFF; copy: "delays every alert
   by one scan interval (~5 min); filters ghosts"; survival-telemetry readout beside it.
4. WhatsApp copy to spec — per leg `Book | side @ odds | $amount`; then `Profit: $X (Y%)`;
   then `odds as of HH:MM`; then APP_URL cockpit link. Nothing else.
5. Delivery-failure detection — Twilio failures → persistent banner ("re-join sandbox" +
   instructions), logged, retries capped at 2/alert.
6. Backup + export — daily (or on startup if missed) copy of JSONL history + settings to
   BACKUP_DIR, keep 14 dailies; CSV exports: graded records + per-series P&L.
7. Credit-spend widget — spent, projected month-end, budget 100k, scores share; amber at
   80% projected, red at 100%. Existing accounting only.

## Out of scope
Kelly, props, live, CLV, server-side scheduler, compounding, grading changes.

## Acceptance
Leaderboard zero-credit-verified · scan browser with gaps · second-sighting fixture test ·
exact alert copy w/ APP_URL · simulated Twilio failure banner · backup runs+prunes · CSV
opens in spreadsheet · widget matches ledger · PROGRESS.md: sprint complete + known issues
+ candidate next phases (Kelly, props probe, server-side scheduler).
