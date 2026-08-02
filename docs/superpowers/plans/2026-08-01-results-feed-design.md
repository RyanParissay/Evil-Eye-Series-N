# Results feed / auto-settlement — design (§2.1 of MASTER-PROMPT-NEXT)

Status: DESIGN DRAFT — implementation is real-money-path work and does NOT
start until the owner gives an explicit go (MASTER-PROMPT-NEXT §5).
Author: Fable lead session, 2026-08-01.

## Goal

LIVE mode never auto-settles (honest: `runSimSettlement` is gated off — see
pipeline/actions.ts). Build the real feedback loop: fetch final scores from
The Odds API `/scores` endpoint, grade each finished CONFIRMED/UNCONFIRMED
trade, settle via the existing `settleTrade`. Strategy grades, closing price
edge, and heat already read settled trades — feedback flows automatically.

## Shape (follows the existing seams — nothing new invented)

1. **`engine/grading.ts` — PURE grading math** (no I/O/clock/rng, mirrors
   engine/ discipline). Input: a trade (category, market, legs incl. line +
   locked odds + stake) + a final score. Output:
   `{ kind: 'WON'|'LOST'|'VOID', resultCents: number } | { kind: 'UNRESOLVED', reason }`.
   This module is where ALL money-correctness lives; exhaustively tested.
   - **ARB**: pays its locked margin regardless of outcome — no score needed.
     `resultCents = round(totalStakeCents · marginFinal)`. Settles at cutoff
     even if the score never arrives.
   - **EV (moneyline/h2h)**: did the selected side win? WON pays
     `stake·(odds−1)`, LOST pays `−stake`. Draw on a 2-way market with a
     3-way book quote → follow book rules: h2h 2-way = push/VOID.
   - **TOTALS / SPREADS / MIDDLE legs**: score-vs-line math. Exactly on the
     line → PUSH → that leg VOID (stake returned, `resultCents` contribution
     0). MIDDLE settles per-leg, summed.
2. **`live/scores.ts` — ScoresProvider** (mirrors live/oddsApi.ts): injected
   fetch, `refreshScores(sportKeys, now)` →
   `GET {BASE}/sports/{key}/scores?daysFrom=3`, parse
   `{id, completed, scores[]}`, `recordCredits` from the same usage headers.
   ~1 credit per sport request (verify exact pricing at implementation).
   Only sports with settle-due trades are queried — no blanket polling.
3. **Scheduler hook `resultsFeedHook`** (registered in api/routes.ts next to
   inbound/backup/digest; rides the scan tick per §5 discipline):
   `nextAt` returns null unless `liveMode===1` AND at least one
   CONFIRMED/UNCONFIRMED trade has `eventStartsAt + SETTLE_CUTOFF_MS < now`
   (reuses the existing 3h cutoff). Cadence: at most every 30 min. Errors
   logged by the hook itself; the chain never dies (existing guard).
4. **Settlement**: hook calls grading per due trade; WON/LOST →
   existing `settleTrade` semantics (magnitude sign handled there); VOID →
   see decision D2. UNRESOLVED (not yet in feed / not completed) → retry
   next cycle, no state change.

## Edge cases (the actual work)

- **Score matching**: trades don't currently persist the provider event id.
  D1 (recommended): guarded ALTER `trades.event_id TEXT NULL`, stamped at
  creation in LIVE from the quote's event id (Quote/candidate plumbing).
  Fallback matcher (sport + team names + eventStartsAt ±) is fragile —
  use only for trades created before the migration.
- **VOID representation**: `settleTrade` accepts WON|LOST only and
  `result_cents=0` alone is ambiguous. D2 (recommended): extend result to
  `'VOID'` (resultCents 0) + guarded ALTER `trades.result_kind TEXT` so
  Analytics/grades can distinguish push from break-even. UI copy: "VOID".
- **Feed window**: `/scores` covers ~3 days back. A trade older than the
  window with no score (postponement slipped through) → VOID after
  `SCORES_GIVE_UP_MS` (propose 72h past start), journaled honestly.
- **Postponed/cancelled**: event in feed, never `completed`, commence far
  moved or absent → VOID per above, never fabricated WON/LOST.
- **Partial scores**: `completed:false` → UNRESOLVED, retry. Never grade a
  live/partial score.
- **Quiet hours**: hooks already can't fire then (chain sleeps) — scores
  fetches obey quiet hours for free; due settles catch up at 08:00.
- **Credits**: every scores request records into `credits_usage`; the credit
  forecaster picks it up. Batch by sport (one request settles many trades).

## Non-goals

- No LLM anywhere in grading (scores come from the provider, per §2.1).
- SIM behavior unchanged: `runSimSettlement` remains the SIM path; the hook's
  `nextAt` returns null in SIM (structurally network-inert, F7 pattern).
- No auto-bet, no new timers, no schema drop/recreate.

## Test plan (TDD)

- engine/grading.ts: exhaustive per category — ARB pays margin scoreless; EV
  win/lose; totals over/under/push; spreads cover/lose/push incl. half-lines
  (no push possible); middle both-legs/one-leg/push-leg combinations; VOID
  paths; integer-cents invariants (sum of leg results, sign conventions).
- live/scores.ts: parse fixtures (completed, live-partial, postponed), credit
  header recording, injected throwing fetch in SIM proof.
- Hook: due-trade gating (null in SIM / no due trades), retry-on-UNRESOLVED,
  give-up VOID at 72h, chain survives a fetch error.
- api/api.test.ts: end-to-end LIVE-mode settle cycle with faked scores feed;
  forbidden-words sweep still clean.

## Open decisions for Ryan (blocking implementation)

- **D1** event-id stamping migration — approve guarded ALTER?
- **D2** VOID as a first-class result (`result_kind` column) — approve?
- **D3** give-up window 72h → VOID — right call vs. leaving UNRESOLVED for
  manual settle?
- **GO** — explicit go for real-money-path implementation per §5.
