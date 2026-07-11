# PHASE 13 — Scores ingestion + auto-grading (foundation)

Read `docs/GRADING_RULES.md` in full before writing any code. It is binding. If a settlement
situation arises that it does not cover, flag the record `needs_rules` and surface it — do not guess.

## Context

The app scans The Odds API for arbs, EV bets, and middles; records paper opportunities to
per-scan JSONL history; and sends WhatsApp alerts. EV and middle records currently have no
settlement. This phase adds final-score ingestion and automatic grading. Everything in
Phases 14–15 (multi-scenario portfolios, leaderboards) consumes this phase's output, so
correctness beats speed. Do not rebuild existing scanning, persistence, or alerting.

## Deliverables

1. Sports rules table — module + seed data per GRADING_RULES.md §1, per-market overrides,
   unknown sport → needs_rules path.
2. Scores ingestion (The Odds API scores endpoint) — poll per §4 (open positions only,
   start+duration+30min first poll, 45-min retries, ungraded_stale at 24h); all spend
   through existing credit accounting; 500 credits/day cap with UI banner; never call the
   live endpoint from tests (fixtures only).
3. Auto-grading engine — grades settled EV and middle records vs final scores per §2
   (win/loss/push/void, broken_arb, half vs whole lines). Arbs deterministic except
   broken-arb. Idempotent re-runs.
4. Manual override — per-record result + note → manually_graded; always wins; append-only
   audit log per §3.
5. Schema versioning + backfill posture — schemaVersion on new records; pre-v13 records
   without grading fields → visible "ungradeable (pre-v13)" bucket, never dropped.
6. Scan-gap detector — gaps > 2× scan interval in active window → "missed scans" indicator
   with timespans. Detection only, NO server-side scheduler.
7. Golden-file grading tests — ≥15 hand-specified bets covering: win, loss, push on whole
   total, push on whole spread, half-point line, OT-decided total (included), soccer total
   with ET (regulation-only), void, broken arb survivor wins, broken arb survivor loses,
   manual override beating re-poll, needs_rules, pre-v13 bucket, ungraded_stale, idempotent
   re-grade. In the standard test command.

## Out of scope
Phases 14–15 features, Kelly, props, live modes, CLV, backup/export, in-app usage monitoring.

## Acceptance
Golden tests green · manual EV record grades from fixture scores · scores spend visible +
daily cap banner · manual override survives re-poll · gap detector flags a punched hole ·
docs/PROGRESS.md updated (Phase 13 checked, next = Phase 14).
