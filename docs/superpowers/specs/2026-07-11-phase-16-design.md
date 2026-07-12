# Phase 16 — Analytics Hub + confirmation scanning + adaptive scheduling (design)

Spec: Ryan's Phase 16 (revised) prompt, 2026-07-11. Settlement stays Phase 13's job.
Prereq: Phase 15 fully landed (builders B/C in flight at design time) + Gate 0 report.

## THE invariant flip (decided, sanctioned by the spec)

"No server-side schedulers / scans on-demand only" is RETIRED. Replacement invariant
(CLAUDE.md must be rewritten in WP1, not patched around):

> All wall-clock scheduling lives in `server/src/scheduler/` — exactly one
> self-rescheduling tick (setTimeout chain), started from index.ts, with an
> injectable clock/timer so no test ever sleeps. No timers anywhere else in
> server/src. The scheduler is budget-aware, cap-aware, and quiet-hours-aware
> BY CONSTRUCTION: every provider call it initiates flows through the existing
> credit accounting and the 95% auto-stop. Scheduling decisions are computed by
> pure functions in `scheduler/plan.ts` (engine-grade: no fs/env/Express).

Consequences: the client auto-scan timer retires; the scanner-page toggle now
PATCHes a persisted server-side `scheduler.enabled`; quota 401 self-disables the
scheduler (persisted reason, banner) exactly like the old client behavior; the
scan-gap detector compares actual scan history against the scheduler's OWN plan.
The client grading tick retires too — due score polls run on scheduler ticks.

**Quiet hours (strict):** zero Odds API calls of ANY kind 01:00–08:00
America/Vancouver, DST-safe via Intl/IANA (never a fixed UTC offset). This blocks
scheduler scans, score polls, AND manual scans/cockpit re-verifies (spec says "of
any kind"; UI shows "quiet hours until 08:00" copy instead of a scan). Overdue
score polls queue and fire at 08:00. DST test: one PST date + one PDT date fixture.

## Part A — confirmation scanning (converts Phase 15 second-sighting)

- Every scheduled window runs **scan A**. If scan A yields ≥1 candidate — an
  active opportunity of any strategy that is NOT suspicious/same-book and not
  already confirmed+alerted — the scheduler fires **scan B** (same fetch scope)
  after `confirmationIntervalSecs` (ops setting, default 60). No candidates → no
  scan B, no credits.
- **Confirmed** = same eventId + marketKey + outcome pair + bookmaker pair
  (sorted leg identities incl. points) present in both scans, AND headline edge
  within ±0.5 pp of scan A's (arb → profitPct, EV → edge %, middle → cost %).
- Only confirmed records are alerted or Hub-purchased. Unconfirmed-after-B and
  vanished records persist flagged `single_sighting` — kept for survival
  telemetry, never acted on. Fingerprint dedup still guarantees at-most-once.
- Manual scans return scan A immediately with candidates marked "pending
  confirmation"; scan B still fires via the scheduler with the browser closed.
- Phase 15's `confirmSecondSighting` toggle is SUPERSEDED: the ≥2-sightings gate
  machinery converts into the A/B match (reuse its pure-gate tests as the seed
  for the pair-matcher tests); the ops field is replaced by
  `confirmationIntervalSecs`. Do not leave the dead toggle in the UI.
- Cost model: cost estimator + credit widget show `cost(A) + hitRate × cost(B)`.
  hitRate is MEASURED from the last 14 days of scan history (share of scans with
  ≥1 candidate) once ≥50 scans exist; before that it is labeled ASSUMED (30%).

## Part B — Analytics Hub

- Route `/hub`, opened by a neon-yellow (#E8FF00 family, dark text, subtle glow)
  button at the BOTTOM of the scanner page labeled "Analytics Hub". Yellow stays
  the "speculative/simulated, not guaranteed" family — the Hub is simulated
  money, so this is consistent; note it in CLAUDE.md's color rule.
- **Profiles are engine series.** `server/src/hub/` holds profileStore (JsonStore:
  name, startingBankroll, stake flat-$ or %-of-START (§5: no compounding),
  strategy mix, minEdgePct) and hubService. Premade Arb / EV / Middles profiles:
  $1,000 start (§5 amendment — profile settings win inside the Hub), default
  stake flat $50 (editable; flagged as a saved question for Ryan). Settlement and
  P&L math call the SAME Phase 13/14 primitives (gradeRecord outcomes, scenario
  engine settle path) — acceptance grep must find zero duplicated P&L logic.
- Purchases are persisted events written at confirmation time (confirmed records
  matching the profile's filters, at the profile's stake); insufficient bankroll
  → `skipped_insufficient_bankroll` event (same shape as Phase 14). Pending
  positions show exposure; grading lands via record.grading (Phase 13), EV and
  over/under outcomes included.
- Per profile: lifetime equity curve, total profit, ROI, bankroll now vs start,
  bet count, W/L/push/void/pending, max drawdown, skipped count, filterable
  position history with grade source + flags.
- **Leaderboards:** three boards (Arb, Middles, EV) extending the Phase 15
  accruing leaderboardStore — top 10 books by opportunity count with
  % occurrence = book appearances ÷ total opportunities of that strategy
  (two-leg strategies credit both books). Served from the store + in-memory
  cache; zero API credits structurally.
- Deferred to Hub v2 (list in PROGRESS.md): overlay charts, density heatmap
  polish, profile archiving/cloning.

## Part C — adaptive scheduling

- **Schedule is data:** ops-store `scheduler.blocks: Array<{days, startMin,
  endMin, intervalMins}>` in America/Vancouver local time. Seed (subject to the
  research agent's findings; else this prior, PT): dense 08:00–11:00 and
  14:00–19:00, moderate 11:00–14:00 and 19:00–01:00, quiet 01:00–08:00.
- **Dense data-gathering week:** user-started mode (`denseWeek.startedAt`),
  replaces normal cadence for 7 days: pairs at elevated frequency across allowed
  hours; the scheduler DERIVES the interval from measured per-pair cost so the
  caps bind (floor 5 min). Hard caps 4,500 credits/day and 30,000/week → stop +
  explanatory banner; the 95% monthly auto-stop still applies on top. UI: "dense
  week: day X of 7 · credits Y / 30,000" on the scanner page.
- **Weekly deterministic optimizer (MODEL-labeled, no LLM):**
  `scheduler/optimizer.ts`, pure. Input: scan history + confirmed-opportunity
  density by hour-of-day × day-of-week per strategy (America/Vancouver). Output:
  proposed blocks allocating frequency ∝ density, subject to: quiet hours; ≥1
  scan window per allowed 2-hour block; projected monthly spend (scan pairs at
  measured hit rate + score polls) ≤ monthly budget minus 10% reserve. Served
  with its density table via GET /api/scheduler/proposal; applied ONLY via POST
  .../apply after user confirmation; re-proposed weekly, never auto-applied.

## Build order & model assignment (Ryan's directive: Fable + Opus, Sonnet for routine)

0. Phase 15 builders B/C (Sonnet, already designed) → Gate 0 report (Fable).
1. **WP1 (Opus):** scheduler foundation — module, pure plan.ts, quiet hours,
   server-side enabled toggle + quota self-disable, gap-detector rewire, client
   timer retirement, CLAUDE.md invariant rewrite. The DST-safe simulated-24h test.
2. **WP2 (Opus):** confirmation pairs (Part A) + cost model + Phase 15 filter
   conversion + single_sighting flag + alert/purchase gating.
3. **WP3 (Opus):** dense week caps + banners + weekly optimizer + proposal API/UI.
4. **WP4a (Opus):** Hub server — profiles, purchases, series reuse, leaderboards.
   **WP4b (Sonnet):** Hub client page + neon button + widgets, on WP4a's API.
5. Final (Fable): acceptance-checklist verification pass, DEV_MODE walkthrough,
   PROGRESS.md + HANDOFF.md.

Each WP: strict TDD, vitest from server/, root typecheck, commit per WP, repo
never broken, HANDOFF.md updated per the standing protocol.

## Saved questions for Ryan
- Premade Hub profile stake defaulted to flat $50 on $1,000 — right number?
- Quiet hours block MANUAL scans too (strict reading of "zero calls of any
  kind"). Confirm that's intended; easy to relax to scheduler-only later.
