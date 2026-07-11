# Prompt: strategy session on Evil Eye Arbitrage

Copy everything below the line into a fresh Claude (Fable) conversation.
Pair it with `docs/claude-onboarding-prompt.md` if the session needs code
detail; this brief is about direction.

---

You are my strategist on **Evil Eye Arbitrage** (`~/evil-eye-arbitrage`),
a personal sports-betting arbitrage operation. The end goal is blunt: **a
simple app that makes money reliably.** Not a product, not a platform —
one user (me), real dollars, provable edge. Read this whole brief, then
do the job at the bottom.

## Where the app is (July 2026)

Seven phases built, TDD throughout, 226 tests green. The full loop
exists: scan live odds (The Odds API, ~10 credits/scan on a $30/20k-
credit plan) → arb detection with strict line-group math → WhatsApp
alert with exact dollar stakes and a deep link → mobile execution
cockpit (re-verify ≈1 credit, record actual fills, mark completed) →
ledger with realized P&L / capture rate / edge decay / CSV → paper fund
simulating "acted on 100% of alerts" (ideal + haircut curves, labeled
SIMULATED) → fund position with balance caps and apply-to-balances
reconciliation. Advanced mode replays the last scan against any book
subset at zero cost.

What it does NOT have: **any real trading history.** The ledger is at
$0.00 — the proof layer is built but empty. Twilio isn't configured yet
(alerts print to the server console), so the phone-buzz loop has never
fired for real. The paper fund was just turned on-able. Everything from
here is an evidence problem, not a code problem.

## Architecture strengths (verified, not aspirational)

- **Money math exists exactly once, pure and tested**: stake/cap
  planning (`shared/stakePlanning.ts` — same function renders alert
  dollars and cockpit stakes), realized profit (engine `lockedProfit`),
  alert selection (`alertWorthy` — WhatsApp and paper share it), paper
  settlement (deterministic, lazy, no schedulers).
- **Honest-numbers discipline**: completions without filled numbers are
  counted but never summed; everything simulated says SIMULATED;
  unknown decay is excluded, not zeroed; nothing is ever estimated.
- **Strict layering that held under pressure**: pure engine, swappable
  provider, crash-safe JSON stores, routes as thin boundaries. The
  line-group invariant (never combine across |point| lines) is tested at
  every level — the class of bug that loses both legs is fenced off.
- **Credit discipline**: every paid call is accounted; snapshot
  recompute and paper trading are structurally zero-cost.
- The scan→phone→cockpit loop is short: deep link, prefilled fills,
  one-tap completion.

## Architecture weaknesses (ranked by threat to "makes money reliably")

1. **Detection latency vs edge lifetime — the existential one.** Arbs on
   soft books live minutes. Scans are on-demand/client-timer only (a
   deliberate invariant), and the credit budget allows roughly a scan
   every ~20 minutes sustained (~2,000 scans/month at 10 credits). If
   real arbs die faster than the scan cadence + my reaction time, the
   system finds history, not money. No refactor fixes this — only
   measurement (the paper fund vs real capture rate) can say whether the
   loop is fast enough, and only cadence/market/plan changes can speed it.
2. **Single odds source.** No second feed to cross-validate stale or
   errored odds — the "suspicious" flag is a heuristic, not a check. A
   Pinnacle benchmark is roadmap, and it's a MERGE (fan-out + merge in
   runScan, per-source credit accounting), not the clean provider swap
   the interface suggests.
3. **Thin opportunity surface.** h2h only. Adding spreads/totals is
   literally one config line (`MARKETS`) — the engine already handles
   lines — but it multiplies the credit cost of every scan, so it's an
   economics decision, not a code decision.
4. **The ledger's value depends on my discipline.** Realized P&L only
   exists if I record fills at completion; capture rate only means
   something if I complete what I act on. The app can't force this.
5. **Book limiting is the real-world ceiling** for any winning arber.
   The bookmaker status field (limited/dead) tracks it, but nothing yet
   measures profit-per-book-before-limiting or spreads action to delay it.
6. Accepted small stuff: if record persistence fails but a send
   succeeds, `markAlerted` silently no-ops; no shared client state layer
   (pages self-fetch); single-provider coupling in runScan orchestration.

## Standing constraints

No auto bet placement, ever. Single user. No server-side schedulers
(client timers drive repetition). Credits are real money. New
strategies must ride the existing rails (`strategy` discriminator on
records, `alertWorthy` selection, shared stake planning). Roadmap items
already scoped but deliberately unbuilt: Pinnacle merge → +EV with
fractional Kelly → CLV capture → middles → reply-to-confirm.

## My working hypothesis for the path to reliable money

Phase A (now, ~zero effort): configure Twilio + APP_URL, set fund
settings and per-book balances, enable paper mode, run auto-scan
during peak sports hours for 3–4 weeks. Decide on the three numbers:
ideal curve, haircut curve, real capture rate.

Phase B (data-driven): if ideal profit is real but capture is poor →
attack latency (peak-hour cadence, spreads/totals on liquid sports,
plan upgrade — in credit-economics order). If ideal profit is itself
thin → the h2h/soft-book arb surface is too small; jump to the Pinnacle
merge and +EV, where the edge is bigger and slower-dying (and doesn't
get accounts limited as fast as pure arbing).

Phase C (only if A/B prove the loop): CLV capture to distinguish edge
from luck, then fractional-Kelly sizing.

## Your job in this session

1. Stress-test the hypothesis above. Where is it wrong or naive —
   especially the arb-lifetime economics and the book-limiting ceiling?
2. Give me the sharpest version of the NEXT move (one, not five), with
   the credit/dollar math spelled out.
3. Name the single biggest risk to "reliably," and what measurement
   would expose it earliest.
4. Keep the simplicity constraint: anything you propose must either
   speed the loop or sharpen the evidence. Feature ideas that do
   neither get rejected, including mine.
