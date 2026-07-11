# Risk Mode: EV Detection + the Yellow Tab — Design (Speculative Mode, Phase 10)

Ryan approved starting immediately, with UI direction that overrides the
mission's tab naming: **one bright-yellow tab, "RISK MODE"**, opening on
the best upcoming EV bets. (The mission's separate "% EDGE" and "RISK"
tabs collapse into this one surface; Phase 11's stochastic models will
land inside it.) Everything else follows the Phases 9–11 mission.

Color decision: yellow joins the reserved palette with exactly one
meaning — **speculative, expected value, not guaranteed** — the visual
opposite of arb red's "guaranteed". Nothing else may use it.

## Detection (pure): `engine/evDetection.ts`

For each event → market → |point| line group in the RAW feed:

1. Benchmark side: `fairForLineGroup` (Phase 9) over the benchmark
   book's outcomes. Typed rejection → the group contributes nothing.
2. For every OTHER book in the detection allowlist (enabled + tab —
   the same allowlist arb detection uses; benchmark-only books are never
   candidates), for each outcome in the group:
   `edge = p_fair × offeredOdds − 1`.
3. Guards (from settings): `edge ≥ showMinEdgePct` (default 1%),
   `offeredOdds ≤ maxOdds` (default 4.0 — model error dominates
   longshots), benchmark freshness `now − benchmark.lastUpdate ≤
   maxBenchmarkAgeMins` (default 15), event not commenced.

Emits `EvBet`: event/market/line, outcome, book, offered odds, benchmark
odds, fair probability, edge %, benchmark lastUpdate. Never inferred
from soft-book consensus; no benchmark → no bet, silently (the coverage
audit already surfaces where that happens).

## Persistence: EV records ride the existing rails

- `ArbOpportunity` gains an optional `ev` block (benchmarkOdds,
  fairProbability, edgePct, benchmarkLastUpdate); detection wraps each
  EvBet as a single-leg opportunity (profitPct := edgePct; arbIndex := 1,
  never displayed for EV; suspicious/sameBookmaker false).
- `applyScanToRecords` sets `strategy: 'ev'` when the block is present
  and refreshes it on re-detection. Lifecycle rules apply unchanged
  (dead by absence in rescanned scope, commencement kill, revival);
  fingerprints can't collide with arb records (leg sets differ).
- `runScan` gains an optional `ev` dep ({ settings() }): after arb
  detection it computes EV bets from the SAME raw events — zero extra
  credits — hands `[...arbs, ...evOpps]` to persistence and the
  notifier, and **returns only arbs in the scan response**: the arb UI,
  alerts, and tests are untouched (acceptance: arb snapshots unchanged).

## Settings: `data/ev.json` (JsonStore), `GET/PATCH /api/ev/settings`

`{ showMinEdgePct: 1, alertMinEdgePct: 3, maxOdds: 4,
maxBenchmarkAgeMins: 15 }` — global; the WhatsApp toggle is per-sub.

## Alerts: honest, separate, off by default

- Subscription gains `evEnabled` (default **false**; toggle in the
  WhatsApp panel).
- Selection reuses `alertWorthy` verbatim (threshold =
  `alertMinEdgePct`, same fingerprint dedup store) via a
  `notifyEvBets` sibling of the arb notifier — same rate-limit budget.
- Distinct format, honest by construction: "🎲 EV bet: {event} —
  {outcome} @{odds} at {book}. Edge {x}%, win probability {p}%. Stake
  ${s}. **Not guaranteed — expected value.** {cockpit link}". The word
  "guaranteed" never appears unnegated; message-format test pins it.

## Risk Mode tab (client)

- Route `/risk`; nav link **RISK MODE** in bright yellow on every page
  masthead. Page accent yellow; header states "expected value —
  individual bets can and do lose".
- Board = `GET /api/ev/board`: ACTIVE `strategy:'ev'` records sorted by
  edge desc; columns per mission: event, market/line, book, offered vs
  fair (prob and fair odds), edge %, suggested stake (flat fund default
  until Phase 11 wires Kelly), expected profit $, win probability,
  benchmark age. Rows deep-link the cockpit. Empty state explains the
  benchmark dependency and points at the coverage audit.

## Cockpit: single-leg EV variant + grading

Same page, `strategy === 'ev'` branches:

- Copy: edge %, fair vs offered, win probability; NO guaranteed-profit
  language anywhere; stake defaults to the fund's flat default stake;
  "expected profit $X · if it loses: −$stake" replaces the guaranteed
  line. Re-verify hidden for EV in v1 (arb-flavored; Phase 11 may add
  benchmark re-check).
- Completion books the actual fill (existing form, one leg). Then
  **grading**: WON / LOST / VOID buttons — grade writes
  `execution.grade` and sets `execution.lockedProfit` to
  `+stake×(odds−1)` / `−stake` / `0`. Regrade allowed until balances
  applied; after that, revert first (conflict otherwise).
- **Honest-numbers rule extended:** ungraded EV completions count for
  capture rate but sum $0 realized. The ledger gains a separate
  `evExpected` line — Σ(stake × edge) over placed-but-ungraded bets —
  labeled **EXPECTED (model)**, never mixed into realized totals.
- Apply-to-balances for EV derives from the grade (−stake; +payout if
  won; +stake back if void) with the existing exact revert.

## Paper fund: stays arb-only (the lean choice, as the mission allowed)

EV paper entries would either need graded outcomes (fake bets nobody
grades) or reduce to plotting Σ(stake×edge) — which the EXPECTED ledger
line already shows without pretending to be a fund. Decision: paper
remains arb-only; EV's proof is grading calibration (Phase 11.4).

## Grading endpoint

`POST /api/opportunities/:id/grade { grade: 'won'|'lost'|'void' }` —
guards: strategy ev, completed with execution, not balances-applied.

## Acceptance mapping

Edge math fixtures (2-way + 3-way with draw, exact values); guards
(maxOdds, freshness, allowlist, commenced) each tested; line-group
discipline inherited from fairForLineGroup plus an evDetection
mismatch fixture; arb outputs and alerts byte-unchanged (existing suites
+ response-shape test); EV alert format test incl. "Not guaranteed";
grading → ledger reconciliation to the cent (won/lost/void); EXPECTED
never in realized; CSV gains ev columns (fair prob, benchmark odds,
edge, grade) and still round-trips; board endpoint provider-free.

## Out of scope

Kelly/risk models (Phase 11 — the tab's risk section arrives then),
CLV, auto-grading, power/Shin, EV re-verify, middles.
