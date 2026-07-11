# Prompt: where Evil Eye is at + what to do next

Copy everything below the line into a fresh Claude (Fable) conversation.
Companions: `docs/claude-onboarding-prompt.md` (code detail),
`docs/user-guide.md` (operating tutorial).

---

You are my strategist on **Evil Eye Arbitrage** (`~/evil-eye-arbitrage`),
a personal betting operation. Goal unchanged: **a simple app that makes
money reliably.** Read this state report, then do the job at the bottom.

## Where it's at (July 2026, post–Risk Mode)

**Ten build phases are done. 276 tests green.** Two complete detection
strategies now share one set of rails:

- **Arbitrage Mode** (red = guaranteed): scan → strict line-group arb
  detection → WhatsApp alert with exact balance-capped dollar stakes →
  mobile cockpit (re-verify ~1 credit, record fills, complete, apply to
  balances) → ledger.
- **Risk Mode** (yellow = expected value, NOT guaranteed): every scan
  also de-vigs Pinnacle (dual-role benchmark riding the same fetch at
  zero extra credits) and surfaces soft-book prices beating fair —
  edge %, win probability, guards for longshots and benchmark staleness.
  Single-leg cockpit; **manual WON/LOST/VOID grading is what creates
  realized P&L**; ungraded bets live on a separate EXPECTED (model)
  line; EV alerts are per-subscription opt-in with honest copy.
- **Evidence layer**: peak-hours scan windows with a credit-budget hard
  stop; per-scan history; funded-book + benchmark-reach coverage audits;
  arb survival stats feeding a MEASURED paper haircut; reaction-funnel
  telemetry; the proving-month scoreboard; paper fund (arb-only, by
  design).

**What it still has none of: data.** Ledger $0.00. Scan history empty.
Twilio unconfigured (alerts print to server console). Paper mode off.
No scan window has ever run. Everything left is operation, plus exactly
one unbuilt phase.

## The two candidate next moves

**A — Build Phase 11 (the mission's last phase):** ¼-Kelly sizing
replacing Risk Mode's flat stakes (capped by book balances via the
shared planner), per-bet volatility (SD, bands), portfolio projections
inside Risk Mode (exact binomial / normal / seeded Monte Carlo: P(down
after N), percentiles, drawdown, risk of ruin — all labeled MODEL), and
the calibration stat: model-predicted win rate vs realized hit rate
across graded bets. That last number is the eventual proof that the
benchmark edge is real rather than staleness.

**B — Go operational tonight (10 minutes, no code):** add `TWILIO_*` +
`APP_URL` to `.env`; set fund settings (bankroll, default stake) and
per-book balances; flip paper mode ON; enable auto-update so the
18:30–22:30 window runs. From that moment every instrument accrues:
survival, coverage, reaction time, paper curves — and Risk Mode's board
starts showing real edges to optionally act on at small flat stakes.

My working recommendation: **B is not optional and shouldn't wait for
A** — data accrues while anything else happens, and every future
decision is starved without it. A is worth building before placing EV
bets at scale, because unsized EV betting (flat stakes, no variance
model) is how a real edge still ruins a bankroll — but small-stakes
graded EV bets during the proving month are exactly the calibration
data Phase 11's headline stat needs.

## Standing constraints and open risks

No auto bet placement; single user; no server-side schedulers; credits
real money; honest numbers everywhere. Risks unchanged in kind, now
measurable: arb lifetime vs reaction latency (survival + telemetry will
say); benchmark staleness making phantom EV edges (freshness guard +
calibration will say); book limiting as the ceiling (status field
tracks it); my own grading/fill discipline as the ledger's weakest link.

## Your job in this session

1. Sequence A and B concretely — including whether any slice of A
   (e.g., Kelly sizing alone, or just the calibration stat) should jump
   the queue before EV bets are placed even at small stakes.
2. Define "cleared to bet EV with real sizing" as numeric gates:
   minimum graded bets, calibration tolerance (predicted vs realized
   win rate), benchmark-reach floor, and what failing each gate implies
   (more data / fix the data source / stop).
3. Write my week-one operating checklist: what to do daily (grade
   settled bets, apply balances), what to glance at (scoreboard,
   coverage flags, budget projection), and what to ignore until the
   sample sizes mean something.
4. Reject anything — including my framing above — that neither speeds
   the loop nor sharpens the evidence.
