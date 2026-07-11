# Middles Detection — Design (Phase 12, strategy: 'middle')

Status: **APPROVED 2026-07-11.** Ryan's decisions on the open questions:
cost path = **plan upgrade** (market toggles ship default OFF; he flips
them and raises `monthlyCreditBudget` once the higher credit tier is
active — no book trim required); board = **EDGES | MIDDLES segment
inside Risk Mode**; paper = **FLOOR inclusion** with the understatement
caveat surfaced. Arbitrage Mode and Risk Mode are frozen:
middles is a third strategy on the shared rails (fingerprints,
lifecycle, cockpit, ledger, alertWorthy, paper selection), built as a
NEW pure module — not a modification of arb detection. Player props out
of scope entirely.

## 1 · Markets expansion — the economics, exactly

**Cost model (from `creditCost.ts`):** credits per odds call =
`markets × region-equivalents`; one call per sport per scan; the sports
catalogue call is free. Region-equivalents = the tab's `apiRegions`
count on a regions fetch, or `⌈unionBooks/10⌉` when fetch-by-books is
strictly cheaper (union includes the benchmark).

**Current state (grounded):** the `ca` tab runs at **2 RE** (regions
`eu`+`uk`; the ~14-book allowlist union with pinnacle is ⌈14/10⌉ = 2 —
not strictly cheaper, so regions). h2h only, breadth 5:
`1 market × 2 RE × 5 sports = 10 credits/scan` — matches the UI.

**Scan volume at current windows/cadence** (weekday 4h + weekend 10.5h
@5 min): ≈ 48/weekday + 126/weekend-day ≈ **2,150 scans/month**.

| Configuration | credits/scan (N=5, ca tab) | ≈ month | vs 20k budget |
|---|---|---|---|
| h2h only (today) | 1×2×5 = 10 | 21.5k | ~at budget (guard trims) |
| + totals | 2×2×5 = 20 | 43k | 2.2× over |
| + totals + spreads | 3×2×5 = 30 | 64.5k | 3.2× over |
| **trimmed books** + totals | 2×**1**×5 = 10 | 21.5k | **same as today** |
| trimmed + both markets | 3×1×5 = 15 | 32k | 1.6× over |
| trimmed + both + 8-min cadence | 15 × ~1,345 | ≈20k | at budget |

*Trimmed books* = the one big lever: cutting the enabled allowlist to
**≤9 books (+pinnacle = 10 union)** makes fetch-by-books strictly
cheaper at **1 RE**, halving every scan cost. Nine books is plausibly
your whole funded reality anyway; the coverage audit shows which books
have never mattered.

**Operating options (pick at approval):**
1. **Recommended:** trim enabled books to ≤9 + enable **totals only** →
   middles data starts at literally today's burn (10/scan). Add spreads
   after a week if totals middles look thin, paired with 8-min cadence.
2. Both markets now + 8-min in-window cadence (trimmed books) → ~20k.
3. Plan upgrade at the provider (higher credit tiers exist; verify
   current pricing) — the only path keeping 5-min cadence with all
   three markets.

**Mechanics:** `markets: { totals: boolean; spreads: boolean }` joins
the ops settings store (default both OFF — you flip them). `runScan`
reads effective markets per scan via a new `marketSettings` dep; the
engine already evaluates exactly what's fetched. **New endpoint
`GET /api/ops/cost-estimate?regionTab=&topN=`** computes credits/scan
from the live fetch plan + enabled markets; the scanner shows it beside
RUN SCAN and the CadencePanel gains the toggles with that line. Budget
projection needs no change (it reads the provider's actual counter).
Zero-change-while-OFF is pinned by a usage-accounting test. No market
data → no middles → empty board, never an error.

## 2 · Middles engine — `engine/middles.ts`, pure, new

**Direction rules as smart constructors** (the both-legs-lose trap is
unrepresentable):

```ts
// Over T₁ + Under T₂, valid IFF T₁ < T₂ (strict; T₁=T₂ is an arb, not ours)
totalsMiddle(over: Offer, under: Offer): MiddleCandidate | null
// X −F + Y +D (opposite sides), valid IFF D > F (window = D − F > 0)
spreadsMiddle(favorite: Offer, underdog: Offer): MiddleCandidate | null
```

Factories return `null` on any invalid pairing; `MiddleCandidate`'s
constructor is not exported, so no code path can build a reversed
middle. Must-reject tests include Over 216 + Under 210 and spread
windows ≤ 0.

**Stake split = the existing shared planner.** Equal-risk (identical
worst-case loss whichever single side wins) is algebraically the
1/odds-proportional split `planStakes` already computes — the money
math stays in one place, balance caps and rounding included. Per-$100
metrics stored on the record; dollar figures derive at display.

**Core metrics (pure arithmetic, no probabilities):** with S = Σ1/oᵢ:
- worst-case **cost** = total − total/S (single side wins), as $ and %
- **middle payout** = total(2−S)/S (both legs win)
- **breakeven hit rate** = cost ÷ (cost + payout) — default sort,
  lowest first
- **free middle**: S ≤ 1 → cost ≤ 0 — an arb with a bonus window;
  flagged `freeMiddle`.

**Integer boundaries:** whole-number lines can land exactly on the line
→ that leg pushes (stake returned) — a factual `pushPossible` note on
the candidate; half-line middles sort ahead of integer-line middles at
equal breakeven. No push-probability modeling.

**Pair selection:** per event/market, for every line pair (T₁ < T₂ or
F < D): best price per side across allowed books (mirroring arb
best-price selection), one candidate per line pair. Same-book pairs are
flagged like same-book arbs — visible, never alerted. Filters
(settings, `data/middles.json`): `maxCostPct` (default 5), `minWindow`
(default 0.5). Key numbers from a static constant
(`KEY_NUMBERS: { americanfootball: [3, 7, 10] }`) → factual badge when
a key number sits strictly inside the window. No modeled hit
probability anywhere in this phase (the MODEL stub stays unbuilt).

## 3 · Records + board

- `strategy: 'middle'` records: two legs (both lines in the fingerprint
  via the existing point-inclusive leg identity) + a `middle` context
  block `{ lowLine, highLine, windowSize, costPct, payoutPct,
  breakevenPct, freeMiddle, pushPossible, keyNumbers }`, refreshed per
  sighting like the ev block.
- **Board placement (lean recommendation): a segmented control inside
  the Risk Mode page — `EDGES | MIDDLES`** — one yellow nav entry, same
  not-guaranteed family, separate table: event, market, lines, books,
  window, cost %, breakeven %, key-number + free-middle + push badges.
  Alternative: a separate `/middles` route (one more nav item).
- Alerts: per-subscription `middleEnabled` toggle (**default OFF**),
  honest copy pinned by test: "🎯 Middle: … costs $X if it misses, pays
  $Y if it lands in (T₁–T₂) — needs to hit Z% to profit." The word
  "guaranteed" never appears — **except free middles, which ride the
  ARB alert channel** (they are risk-free, so no opt-in needed) with
  "free middle: guaranteed +$X, pays +$Y in the window" — that is the
  clean wiring: the notifier split sends freeMiddle records through
  `notifyNewOpportunities`' path with a dedicated format line.

## 4 · Cockpit variant + per-leg grading

- `strategy === 'middle'`: two tickets like an arb; header shows
  window, worst-case cost, middle payout, breakeven — never
  "guaranteed" copy (free middles excepted, badge shown).
- Re-verify reuses the existing legs-only targeted fetch (~1 credit),
  recomputing window/cost/breakeven.
- **Grading is per leg** (extends the Risk Mode pattern):
  `execution.legGrades?: Array<'won'|'lost'|'void'>`; realized P&L =
  Σ per-leg from actual fills (won → +stake×(odds−1), lost → −stake,
  void/push → 0). Both-won = the middle hit; integer-line pushes grade
  that leg VOID. Apply-to-balances derives per-book deltas from the leg
  grades (−stake each; +stake×odds per won leg; +stake per void),
  exact-revertible as today. EV's single-grade endpoint generalizes:
  `POST /:id/grade` accepts `{ grade }` (EV) or `{ legGrades: [...] }`
  (middles) — one route, strategy-checked.

## 5 · Ledger, scoreboard, paper

- Strategy column already exists everywhere (tables, CSV); CSV gains
  middle context columns (lines, window, cost/breakeven, leg grades).
  Realized P&L from graded records only; ungraded middle completions
  sit at $0 with the EXPECTED-style honesty rules.
- **Paper (mission's FLOOR proposal, confirmed with a caveat):** middle
  entries enter via the shared selection at alert-time numbers and
  contribute their **worst-case floor, labeled FLOOR**, flipping to
  actual when a real record with the same fingerprint is graded.
  Caveat stated on-surface: never-graded paper middles keep the floor
  forever, so the paper fund systematically UNDERSTATES middle value —
  that is the honest direction to be wrong in. Argued alternative
  (Ryan may pick): keep paper arb-only (Phase 10 precedent) and let
  middles prove through grading alone. Free middles enter at their
  positive floor either way.

## Acceptance mapping

Direction-rule must-reject fixtures (incl. Over 216 + Under 210);
stakes/cost/payout/breakeven to the cent incl. a free middle and an
integer-push case; zero credit change with toggles OFF + correct
cost-estimate endpoint with each toggle ON (usage-accounting tests);
arb + EV outputs byte-identical on shared fixtures with middles present
in any toggle state; grading→ledger→balances reconciliation for middle
hit / side-A / side-B / push; alert-copy test (cost/payout/breakeven
present, "guaranteed" absent except free-middle); 3-strategy fixture
ledger sums; CSV round-trip; all existing suites green; grep-level
no-scheduler check.

## Open questions (blocking approval)

1. **Cost path** — recommend option 1: trim enabled books to ≤9
   (+pinnacle) and enable totals only → middles at today's 10
   credits/scan. Confirm the trim (I'll surface the coverage audit's
   never-seen books as trim candidates), or pick option 2/3.
2. **Board placement** — segmented `EDGES | MIDDLES` inside Risk Mode
   (recommended) vs a separate `/middles` nav entry.
3. **Paper treatment** — FLOOR-inclusion as specced (recommended, with
   the understatement caveat) vs arb-only paper.

## Out of scope

Player props; modeled hit probabilities (stub stays unbuilt); live
middles; alternate-line ladders; scores auto-grading; any Arbitrage or
Risk Mode behavior change.
