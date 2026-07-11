# Prompt: state report + next moves for Evil Eye Arbitrage

Copy everything below the line into a fresh Claude (Fable) conversation.
Pair with `docs/claude-onboarding-prompt.md` when the session needs code
detail; `docs/user-guide.md` is the operating tutorial.

---

You are my strategist on **Evil Eye Arbitrage** (`~/evil-eye-arbitrage`),
a personal sports-betting operation. The end goal is blunt: **a simple
app that makes money reliably** — one user (me), real dollars, provable
edge. Read this report, then do the job at the bottom.

## Where the app is (post–Phase 8, July 2026)

**All eight phases are built.** 245 tests green. The machine is
feature-complete for its mission and now *instruments itself*:

1–3. Scan (The Odds API, ~10 credits/scan, $30/20k plan) → strict
line-group arb detection → WhatsApp alert with exact dollar stakes +
deep link → mobile cockpit (re-verify ≈1 credit, record actual fills,
mark completed, apply to balances).

4–7. Advanced mode (zero-credit snapshot replays with book presets) ·
Ledger (realized P&L from hand-priced fills only, capture rate, edge
decay, CSV) · Paper fund (SIMULATED shadow book entering exactly what an
alert would, lazy settlement, ideal + haircut curves) · Fund position
(persisted bankroll, balance-capped stakes via ONE shared planStakes,
low/stale-balance warnings, apply-to-balances with exact revert).

8. **Evidence instrumentation**: per-scan history log; client-only scan
windows (weekday 18:30–22:30, weekend 12:00–22:30, 5-min in-window
cadence) with credit-budget projection and a hard auto-scan stop at 95%;
funded-book feed coverage audit; arb survival-at-next-scan + gone-
lifetime stats that feed a MEASURED paper haircut (qualified at ≥14 days
+ ≥50 samples, ASSUMED until then); reaction-funnel telemetry (median
alert→re-verify is the headline); a proving-month scoreboard.

**What it does NOT have: data.** The ledger is $0.00, the scan history
starts now, Twilio is unconfigured (alerts print to the server console),
and no scan window has yet run. Every remaining question about this app
is empirical, and the instruments to answer them are installed.

## Architecture verdict (short form)

Strengths that held under eight phases of pressure: money math exists
exactly once per concern (planStakes, lockedProfit, alertWorthy,
settlePaperBook, survival mapping), all pure and fixture-tested;
honest-numbers discipline everywhere (unpriced → counted not summed,
unknown → excluded not zeroed, simulated → labeled); strict layering
(pure engine, thin routes, crash-safe JSON stores, zero server timers).

Standing weaknesses, ranked by threat to "reliably": (1) detection
latency vs arb lifetime — now *measurable* via survival stats instead of
speculative; (2) single odds source — no cross-validation of stale odds;
(3) h2h-only surface — one config line to widen, but it multiplies scan
cost; (4) capture depends on my discipline (record fills, apply
balances); (5) book limiting is the unmodeled ceiling. Accepted small
stuff: markAlerted no-op on persistence failure; survival counts a live
re-verify as a sighting (slight upward bias, documented).

## The plan of record — the proving month

Setup (one evening): add `TWILIO_*` + `APP_URL` to `.env` so alerts hit
my phone with working deep links; set fund settings (bankroll, default
stake) and per-book balances; flip paper mode ON; enable auto-update and
let the scan windows run.

Operate (3–4 weeks): act on alerts through the cockpit — re-verify,
record real fills on anything placed, apply balances after events
settle. The scoreboard accrues: ideal curve, haircut curve (MEASURED
once qualified), real capture rate, median arb lifetime, median reaction
time, credit burn.

Decide (after): if ideal profit is real and capture is the leak → attack
latency (cadence/windows tuning, spreads/totals on liquid sports, plan
tier — in credit-economics order). If ideal profit is itself thin → the
soft-book h2h arb surface is too small; jump to the Pinnacle merge and
+EV, where the edge is bigger and slower-dying. Roadmap already scoped,
deliberately unbuilt: Pinnacle MERGE (not a swap) → +EV with fractional
Kelly → CLV capture → middles.

## Your job in this session

1. Audit the proving-month plan for blind spots: what will these
   instruments still fail to tell me, and what cheap addition (that
   speeds the loop or sharpens evidence — nothing else qualifies) would
   close the worst gap?
2. Pre-commit the decision rules: propose the specific numeric
   thresholds on the scoreboard (ideal $/mo, capture %, survival %,
   reaction time) that should trigger each branch — scale up real money /
   attack latency / pivot to +EV / stop. Make me argue with numbers, not
   vibes.
3. Name the failure mode I'm most likely to rationalize away when the
   data comes in, and the pre-agreed tripwire for it.
