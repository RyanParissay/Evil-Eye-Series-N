# Evil Eye V1 — Architecture reference

The on-demand deep reference for this codebase: full module map, invariants
with rationale, extension recipes, and gotchas. Read the sections relevant to
the area you're touching. The always-loaded session contract (status, commands,
workflow) is CLAUDE.md; full product rationale is README.md.

## Layering (dependency rules, strictly one-way)

```
shared/          domain types + region-tab config + stakePlanning.ts (the ONE
                 planStakes implementation both sides run — alert dollars and
                 cockpit display must never compute caps separately). Zero imports.
server/src/
  engine/        PURE functions: arb math, filters, slider mapping, credit
                 math, fairProbability.ts (de-vig: benchmark odds → fair
                 probabilities, multiplicative behind an enum seam; typed
                 rejections for missing outcomes / line mismatches — the
                 line-group invariant extends to benchmark comparison),
                 clv.ts (Phase 18 CLV math: per-leg raw + de-vigged true
                 CLV%, per-record stake-weighted with missing closing legs
                 EXCLUDED — renormalized, never zeroed).
                 No Express, no Node built-ins, no provider imports.
  providers/     OddsProvider interface + adapters (TheOddsApi live, Mock fixtures).
                 Wire-format mapping and ProviderError creation happen ONLY here.
  scan/          scanRequest.ts  — request body validation (THE place for new options)
                 scanService.ts  — orchestration: catalogue → odds → engine → usage
                 detection.ts    — the reusable detection slice (allowlist filter →
                 engine → link fallbacks); runScan, cockpit re-verify, and Phase-4
                 presets all go through it
                 scanStore.ts    — last-scan JSON persistence (write-then-rename)
  bookmakers/    Per-book config (enabled/balance/status/notes). Registry
                 self-populates from each scan's raw feed. effectiveBookmakers.ts
                 (pure rules), bookmakerService.ts (façade), bookmakerStore.ts.
  opportunities/ Persisted opportunity records. opportunityId.ts (fingerprint —
                 THE identity, alert dedup imports it), opportunityLifecycle.ts
                 (pure transitions incl. applyStatusChange/applyVerification;
                 Phase 16 stamps eligible new records confirmation:'pending'
                 and resolves dying pendings to single_sighting),
                 confirmation.ts (Phase 16 Part A, pure: the pair matcher —
                 same fingerprint present in both scans via the lastSeenAt-
                 advanced judgement AND headline edge within ±0.5pp → confirmed,
                 else terminal single_sighting; headlineEdgePct, candidate
                 rule, record→opportunity conversion), opportunityService.ts
                 (also pendingConfirmations — DEEP-COPY snapshots —,
                 applyConfirmations, expirePendingConfirmations),
                 verifyService.ts (cockpit re-verify: cheap legs-only live
                 fetch → re-price → persist), opportunityStore.ts (active
                 JSON + monthly JSONL archive).
  ledger/        ledgerService.ts — the P&L read model: streams the active
                 file + JSONL archives line-by-line (never whole-file reads)
                 into server-computed aggregates; CSV export is Excel-safe
                 (quoted, formula-defanged). The client does ZERO money math.
  grading/       Phase 13 auto-grading orchestration (docs/GRADING_RULES.md
                 is binding). config/gradingRules.ts (rules table + poll
                 policy: first poll, retry interval, give-up, daily scores
                 cap) and engine/grading.ts (pure gradeRecord) do the actual
                 rules math; gradingService.ts is the I/O shell — what's due,
                 one fetchScores call per sport, writes land via
                 OpportunityService.applyGrading/setGradingFlag — and
                 gradingStore.ts (scores-spend ledger). Runs both ways now
                 (Phase 16): still fire-and-forget after each scan's notifier,
                 AND on the scheduler's own score-poll ticks (the replacement
                 for the retired client grading tick). Quiet hours block score
                 polls; overdue ones fire at/after 08:00.
  presets/       Advanced-mode book presets. presetStore.ts (JsonStore),
                 presetService.ts (CRUD + seeding + pure resolvePresetKeys —
                 dynamic presets resolve all_enabled/funded against the
                 registry at evaluation time; 'funded' requires enabled too).
  lib/           jsonStore.ts — generic crash-safe serialized JSON store; every
                 file store (scan/whatsapp/bookmakers) is or should be one.
  notifications/ WhatsApp alerts: whatsappSender.ts (Twilio via fetch OR console
                 dev mode), alertService.ts (alertWorthy — THE strategy-agnostic
                 selection core: threshold, non-suspicious, non-same-book,
                 fingerprint dedup; WhatsApp AND the paper fund both call it —
                 plus per-subscription rate limit, failure deactivation;
                 since Phase 16 Part A the WhatsApp dispatch is TRIGGERED by
                 index.ts's onConfirmed fan-out — records reaching
                 'confirmed' — not per scan),
                 verification.ts (hashed 6-digit codes), subscriptionStore.ts,
                 whatsappRequests.ts (validation, E.164).
  fund/          Fund settings (real bankroll, default stake, unallocated
                 cash) + position assembly (float, warnings: low-balance,
                 stale-balance at 14d). Balance edits stamp balanceUpdatedAt.
  ops/           Phase-8 evidence layer, all zero-credit by construction:
                 scanHistoryStore.ts (append-only per-scan JSONL, monthly —
                 runScan's scanLog dep writes one line per scan),
                 opsStore.ts (credit budget + markets + the Phase-16
                 scheduler config: scheduler.blocks/enabled/scanParams/
                 confirmationIntervalSecs (normalized to 60, range 10–600s),
                 enabled DEFAULT FALSE, migrated in via the normalize pattern;
                 Phase 15's confirmSecondSighting was CONVERTED into the
                 confirmation pair and its key is dropped on normalize;
                 the legacy weekday/weekend windows + inWindowMins/outWindowMins
                 are back-compat only — the scheduler ignores them),
                 coverageService.ts
                 (funded-book feed audit), survivalService.ts (survival at
                 next covering scan + gone-lifetimes + the measured-haircut
                 mapping), telemetryService.ts (reaction funnel + verify
                 outcome aggregation; missing steps excluded, never zeroed),
                 gapDetector.ts (Phase 13, pure: flags stretches whose START
                 sits inside a scheduler block and runs > 2× THAT block's
                 cadence — rewired off the legacy inWindowMins onto
                 scheduler.blocks in Phase 16, reusing plan.ts's activeBlock;
                 detection only, reused as-is by scanBrowser/portfolios/grading).
                 Phase 15: scanBrowser.ts (pairs each scanHistoryStore line
                 with its opportunities, matched by detection/sighting
                 timestamp falling in that scan's slot, plus the inline gap
                 indicator — feeds GET /api/ops/scans, the /scans page),
                 leaderboardStore.ts (per-book appearances + opportunity-leg
                 counts by strategy — ACCRUES per scan, since the raw
                 snapshot is latest-only and historic re-detection is
                 impossible; zero credits, no provider in its import graph),
                 backupService.ts (daily copy of server/data/ to BACKUP_DIR,
                 pruned to 14 dailies — NEVER a timer; triggered at server
                 startup and fire-and-forget after each scan, both no-op if
                 today's dated dir already exists).
  paper/         The SIMULATED shadow fund. paperStore.ts (own JsonStore,
                 facts only), paperMath.ts (pure deterministic settlement:
                 lazy at commence time, %-staking compounds off the settled
                 bankroll at entry, expectation-style haircut), paperService.ts
                 (entry via alertWorthy on the post-filterAlertable stream).
  portfolios/    Phase 14 — 13 parallel SIMULATED paper series ($10,000 each,
                 flat staked, no compounding; docs/GRADING_RULES.md §5 is
                 binding). scenarioEngine.ts (pure: replays the full
                 opportunity stream — LedgerService.allRecordsList — through
                 every series; exportPortfoliosCsv is the CSV surface),
                 optimizer.ts (deterministic grid-search combo weights,
                 0–70% bounds per group, gated on ≥30 graded records and ≥14
                 days per representative series — MODEL fit to history,
                 never a forecast). Zero provider deps, same structural
                 zero-credit shape as ops/ and advanced mode.
  scheduler/     Phase 16: THE one owner of wall-clock scheduling — the module
                 that retired "no server-side schedulers". plan.ts (PURE,
                 engine-grade) maps (settings, now, scan history, score polls,
                 budget, pending confirmation pair, dense-week state) → ONE
                 next action: run scan / run confirmation scan B / resolve a
                 lapsed pair / run score poll / sleep until T; its global gates
                 make it budget-, cap-, and quiet-hours-aware by construction.
                 confirmationPair.test.ts holds Part A's binding acceptance
                 fixtures (mini index.ts composition, counting provider,
                 injectable clock — no test sleeps). scheduler.ts is the single
                 self-rescheduling setTimeout chain (injectable clock/timer so
                 no test sleeps), started from index.ts; it self-disables
                 persistently on spent-quota / rejected-key errors, and each
                 tick resolves the dense week (Part C.3) from scan history.
                 denseWeek.ts (PURE, Part C.3) derives the dense-week interval
                 + day/week spend + cap banner; optimizer.ts (PURE, Part C.4)
                 is the deterministic MODEL weekly proposal (density→blocks
                 under quiet-hours + ≥1-window-per-2h + spend-ceiling
                 constraints). routes/scheduler.ts is their HTTP boundary
                 (zero credits structural): dense-week start/cancel/status +
                 GET/apply proposal — the SOLE writer of scheduler.blocks.
                 vancouverTime.ts is the DST-safe America/Vancouver clock via
                 Intl/IANA (local fields, quiet-hours predicate, next-08:00 +
                 next-local-midnight boundaries, local→epoch). realTimer.ts
                 holds the ONLY real setTimeout in server/src (timerScope.test
                 enforces the scope). routes/quietHoursGuard.ts is the
                 route-level half of quiet hours (manual scan + cockpit
                 re-verify).
  hub/           Phase 16 Part B — the Analytics Hub, all SIMULATED. Each
                 profile is a PARAMETERIZED ENGINE SERIES: hubService.ts
                 auto-purchases CONFIRMED opportunities (it registers on the
                 onConfirmed fan-out in index.ts — the same gate alerts use;
                 nothing short of 'confirmed' is ever bought) and settles via
                 portfolios/settlement.ts primitives (pnlForStake,
                 maxDrawdownOf — extracted so P&L math exists ONCE).
                 profileStore.ts (JsonStore, data/hub.json: profiles +
                 immutable purchase events + skipped events; premades
                 premade-arb|ev|middle seeded on first read, never deletable).
                 §5 stake discipline: flat-$ or %-of-STARTING bankroll, never
                 compounds. routes/hub.ts + the /hub client page (neon
                 yellow — the Hub button/page are part of the yellow=
                 speculative/simulated family). Leaderboard %-occurrence
                 boards ride ops/leaderboardStore accruals: zero credits.
  safety/        Phase 17 — the Safety Score, a deterministic account-
                 longevity filter (no ML, every score explainable).
                 engine/safety.ts is the PURE scorer (50 base + components
                 a–f from ONE settings object; any hard reject → 0) AND the
                 ONE gate function passesSafetyGate (safeMode off → pass;
                 no safety field → pass, never retro-gated; else score ≥
                 threshold). safety/scoring.ts assembles the engine's inputs
                 AT THE CONFIRMATION TRANSITION — snapshot consensus per
                 EXACT outcome+line from last-snapshot.json, the same
                 planStakes dollars alerts carry, the arb alert min-edge
                 (0 for EV/middles) and the records-derived ExposureView
                 (exposure.ts) — and runConfirmScan persists record.safety
                 BEFORE the onConfirmed fan-out, gate-filtered records
                 included. rotation.ts is the advisory side-imbalance hint;
                 cost.ts prices what the gate declined at current settings
                 (GET /api/safety/cost, simulated: true, zero credits).
                 ops/safetyStore.ts holds the one SafetySettings object;
                 routes/safety.ts (settings/rotation/cost) is the boundary.
  clv/           Phase 18 — Closing Line Value capture, ZERO CREDITS BY
                 CONSTRUCTION (no provider anywhere in clv/ or engine/clv.ts —
                 it reuses the raw snapshot a scan already fetched). clvCapture.ts
                 (PURE) builds a RecordClosing from the fresh snapshot — each
                 leg's OWN-book price + benchmark (Pinnacle) price + de-vigged
                 fair prob via engine/fairForLineGroup — for every record whose
                 event is in the snapshot AND has not commenced; ROLLING
                 OVERWRITE + FREEZE: every covering scan overwrites the
                 candidate, and once commence passes the last write is frozen
                 (OpportunityService.applyClosings re-checks commence, so the
                 freeze is structural, not just behavioral). It rides runScan's
                 notifier fire-and-forget (same discipline as leaderboards/
                 backups), reading only the ACTIVE file (a not-yet-commenced
                 record always lives there). clvSummary.ts is the read model
                 behind GET /api/clv/summary (routes/clv.ts): coverage honesty
                 header (records-with-closing, frozen-only median minutes),
                 signal cells (basis confirmation.confirmedLegOdds — scan B's
                 fresh odds stamped in matchConfirmationPair) by strategy ×
                 gate outcome (alerted / safety-filtered via the LIVE
                 passesSafetyGate / single_sighting), execution cells (filledLegs
                 basis) by strategy, and byBook (each leg's own signal CLV → its
                 book). Records without a closing are surfaced in coverage and
                 EXCLUDED from every cell, never zeroed.
  routes/        Express boundary: parse → runScan → JSON; ProviderError → HTTP status.
                 api.ts (/api/scan, /api/last-scan) + whatsapp.ts (/api/whatsapp/*).
  config/        constants.ts (every tunable) + bookmakerLinks.ts (homepage fallbacks)
client/src/      React/Vite; talks only to /api/*; renders shared types verbatim.
                 App.tsx is a react-router shell: pages/ScanPage.tsx (the
                 dashboard) + pages/CockpitPage.tsx (/opportunity/:id, the
                 mobile-first execution page WhatsApp deep links open).
                 cockpit.ts = pure display math (bankroll scaling only — the
                 engine still owns all arb math). Cockpit CSS is namespaced
                 .cockpit-* and mobile-first; the rest of styles.css is
                 desktop-first. No new colors: status renders typographically
                 (completed = the one inverted white block).
```

Import `shared/` from server code as `@shared/...` — the alias is declared in
`server/tsconfig.json` (read by tsc + tsx) AND `server/vitest.config.ts`
(vitest ignores tsconfig paths). Change one, change both.

## Invariants — do not break

- **The API key never leaves the server process.** It is not logged, not
  echoed in errors, not sent to the client. The client knows only `/api/*`.
- **The engine stays pure.** If a change needs Express, fetch, fs, or env
  vars inside `engine/`, it belongs in another layer.
- **Bookmaker filtering happens BEFORE arb detection** (scanService step 4),
  so no arb leg can ever point at a book the user cannot register at.
- **Line groups are sacred in the arb math.** Outcomes are only combined
  within the same |point| group (Over/Under 220.5 together; −3.5 with +3.5;
  never across lines). Mixing lines produces fake "arbs" that can lose both
  legs. See `evaluateMarket` in `engine/arbitrage.ts`.
- **Credits are real money.** Every odds call costs markets × regions
  credits. Anything that adds calls or regions must be reflected in the
  usage math (scanService step 5) and is worth flagging to the user.
- **All wall-clock scheduling lives in `server/src/scheduler/`** (Phase 16;
  this REPLACES the retired "scans are on-demand only / no server-side
  schedulers / timers live in the client" invariant). Exactly one
  self-rescheduling tick (a setTimeout chain), started from index.ts, with an
  injectable clock/timer so no test ever sleeps. No timers anywhere else in
  server/src — only `scheduler/realTimer.ts` calls setTimeout, and
  `scheduler/timerScope.test.ts` pins that. The scheduler is budget-, cap-,
  and quiet-hours-aware BY CONSTRUCTION: every provider call it initiates
  flows through the existing credit accounting and the 95% auto-stop, and
  `plan.ts`'s global gates refuse to emit any scan/score-poll in quiet hours
  or past the cap. ONE deliberate exception: a due confirmation scan B rides
  its scan A's authorization — it fires while the scheduler is disabled (a
  manual scan's pair must complete with the browser closed) and past the
  budget stop (manual scans were never budget-gated) — but quiet hours block
  it absolutely, and a B that cannot fire within 5× confirmationIntervalSecs
  of its due time resolves its candidates to single_sighting instead (zero
  credits). Scheduling decisions are PURE (`scheduler/plan.ts`,
  engine-grade: no fs/env/Express/provider imports). `scheduler.enabled`
  DEFAULTS FALSE — the dev server hot-reloads against real credits, so the
  migration must never flip it and the tick no-ops harmlessly while
  disabled; the pending pair is STORE-derived, so with no pending records a
  reload stays completely inert, and a pending pair survives the reload
  (fires or lapses honestly) instead of hanging.
- **Dense week + weekly proposal (Phase 16 Part C).** The dense
  data-gathering week (`scheduler.denseWeek.startedAt`, user-started via
  POST /api/scheduler/dense-week; DELETE cancels) runs 7 days and OVERRIDES
  the enabled gate — it scans even while `enabled:false`, so it is DELIBERATELY
  absent by default and NEVER migrated in (a present denseWeek would burn
  credits on the hot-reloading dev server). While active it replaces block
  cadence with pairs across all allowed hours at an interval DERIVED from
  measured per-pair cost (`max(5, ceil(1020 × perPairCost / 4500))`, perPairCost
  = per-scan credits × (1 + measured hit rate)). Two HARD caps, measured from
  scan-history `creditsComputed` scoped to the week, hard-stop SCHEDULED
  scanning (manual scans stay allowed): 4,500/Vancouver-day (resumes next local
  midnight) and 30,000/week (stops for the week) — quiet hours stay absolute
  and the 95% monthly auto-stop still applies on top. Day 7 → falls back to
  normal blocks automatically and denseWeek clears. The weekly optimizer
  (`scheduler/optimizer.ts`) is DETERMINISTIC and PROPOSE-ONLY: GET
  /api/scheduler/proposal computes a fresh MODEL proposal (409 below 7 days of
  history); POST /api/scheduler/proposal/apply is the ONLY writer of
  `scheduler.blocks` and stamps `proposalAppliedAt` — NEVER auto-applied, no
  timer-driven recompute.
- **Quiet hours are absolute** — zero Odds API calls of ANY kind 01:00–08:00
  America/Vancouver, DST-safe via Intl/IANA (never a fixed UTC offset).
  `plan.ts` blocks scheduler scans AND score polls; a route guard 503s manual
  scans and cockpit re-verify with the `quiet_hours` code. Overdue score polls
  queue and fire at/after 08:00.
- **Suspicious/same-book arbs are flagged, never hidden.** The user decides.
  (Exception: they're never PUSHED — WhatsApp alerts skip them by design.)
- **Twilio credentials never leave the server process** — same rule as the
  odds key. The client sees the phone number only masked (`/api/whatsapp/status`).
- **Alert dispatch is fire-and-forget.** runScan's notifier hook must never
  slow or fail a scan; a Twilio outage is a console.warn, not a 500.
- **Nothing is acted on before 'confirmed' (Phase 16 Part A).** Every scan
  (manual or scheduled) is a scan A; eligible detections persist
  `confirmation: pending` and, when ≥1 candidate exists, the scheduler fires
  scan B (same fetch scope) after `confirmationIntervalSecs` (default 60).
  Confirmed = same fingerprint present in both scans AND headline edge
  within ±0.5 pp (arb → profitPct, EV → ev.edgePct, middle → middle.costPct).
  Everything else — drifted, vanished, or a lapsed B window — is the TERMINAL
  `single_sighting`: kept for survival/coverage/leaderboard telemetry, never
  alerted, never Hub-purchased. WhatsApp alerts (free middles included) fire
  ONLY from index.ts's `onConfirmed` fan-out; the paper fund's
  considerEntries deliberately stays on the UNGATED per-scan stream (recorded
  decision — paper wants max samples). No candidates → no scan B → zero
  extra credits. Pre-Phase-16 records have no confirmation field and are
  never retro-alerted.
- **The safety gate sits AFTER confirmation, in exactly two consumers
  (Phase 17).** Pipeline: scan → confirmation pair → score → gate → alert +
  Hub purchase. Records are scored ONCE, at the confirmation transition,
  and record.safety persists BEFORE the fan-out runs; passesSafetyGate (the
  one function, engine/safety.ts) is applied inside dispatchConfirmedAlerts
  AND the hub-purchases consumer — never restated, never anywhere else (the
  paper fund and every telemetry surface stay ungated). Filtered records
  stay fully persisted with score + itemized reasons — the Cost of Safety
  readout prices them; safeMode OFF still computes and persists scores.
  A scoring failure NEVER fails the scan or blocks confirmation: it is a
  console.warn and the record confirms WITHOUT safety — and score-less
  records always pass the gate (ungated, pre-Phase-17 semantics; the mirror
  of the never-retro-alert rule). Rounded stakes (safety.roundedStakes,
  camouflage $5 rounding) are the PRIMARY displayed/alerted dollar amounts
  — arb alert profit is recomputed at those stakes — while exact-optimal
  stakes stay cockpit-only.
- **Scans still drive everything time-based.** The notifier fires only when
  a scan runs — manual OR scheduler-initiated (the scheduler's runScan
  reuses the SAME scanDeps/notifier: same paper fund, grading piggyback,
  backup, scheduler wake) — and alert dispatch fires only from a scan B's
  confirmation evaluation. Neither may grow a timer of its own — all scan
  timing (A and B alike) is the scheduler's, via the one tick.

## Extension recipes

- **New market (spreads/totals):** add the key to `MARKETS` in
  `config/constants.ts`. That's it — scanService threads markets to both the
  provider fetch and the engine, the engine already groups by line, and the
  provider maps `point`. (Alternate-line markets like `alternate_spreads`
  need real pairing logic — flipped pairs currently land in one |point|
  group and are safely skipped, not priced.)
- **New scan option (min profit, market picker, sport picker):** validate it
  in `scan/scanRequest.ts`, consume it in `scan/scanService.ts`, send it from
  `client/src/api.ts`. Nothing else changes.
- **New odds provider:** implement `OddsProvider` (listSports/fetchOdds) in
  `providers/`, throw `ProviderError` with the right code, swap it in at
  `index.ts`. Engine and UI need no changes.
- **New region tab / bookmaker list edits:** `shared/regionTabs.ts` only.
  Keep `apiRegions` minimal — every region multiplies every call's cost.
- **New notification channel (Telegram, email, …):** implement the
  `WhatsAppSender` interface in `notifications/`, swap it in at `index.ts`.
  The alert pipeline (selection, dedup, rate limit) is channel-agnostic.

## Gotchas

- The Odds API signals **quota exhaustion with 401** (error_code
  OUT_OF_USAGE_CREDITS), same status as a bad key — `toProviderError` in
  TheOddsApiProvider disambiguates by message text. Don't "simplify" it.
- Mock fixtures generate commence times relative to now, so they never go
  stale; `MockOddsProvider` fires when `ODDS_API_KEY` is unset or `mock`.
- `server/data/last-scan.json` is gitignored runtime state, not config.
- Tests import `@shared/...`; if vitest suddenly can't resolve it, check
  `server/vitest.config.ts` before suspecting anything else.
- Root `.env` is loaded by absolute path from `server/src/index.ts`, so the
  server works regardless of the directory it's launched from.
- WhatsApp runs in dev mode (messages → server console) when `TWILIO_*` vars
  are missing OR `WHATSAPP_DEV_MODE=true`. In dev mode the verification code
  is read from the server log. `server/data/whatsapp.json` is runtime state.
- `DEV_MODE=true` is the umbrella: mock odds provider + console WhatsApp,
  overriding the individual switches.
- Scans SERIALIZE: runScan queues every invocation (manual route, scheduler
  scan, scan B) through one in-module mutex — concurrent provider scans
  rate-limit each other, under-cover sports, and corrupt the confirmation
  pair's judgment. A scan during another scan waits seconds, never errors.
- The scan fetches by The Odds API's `bookmakers` param (10 books = 1
  region-equivalent) only when STRICTLY cheaper than the tab's regions —
  see planFetch. Deliberate consequence: while active, the feed omits
  non-allowlisted books, so the registry can't discover them; fetching by
  regions still does. Don't "optimize" the strictness away.
- Limited/dead books: visible in results (badged), excluded from alerts via
  BookmakerService.filterAlertable composed into the notifier in index.ts —
  NOT inside alertService (which only knows suspicious/sameBook).
- The alert fingerprint hashes event + market + legs but NOT profit — that's
  the debounce. Don't "improve" it by including profitPct, or every odds
  wobble re-alerts. It now lives in opportunities/opportunityId.ts (record
  IDs are its first 16 hex chars); alertService re-exports it.
- A scan can only declare a record dead within its own scope (same region
  tab + rescanned sport, fingerprint gone) or when the event commenced.
  'degraded'/'completed' are cockpit transitions (applyStatusChange →
  updateStatus → PATCH /api/opportunities/:id) — don't set them from scan
  code. Completing is allowed even on a dead record (the bets were placed
  while it lived); degrading is active-only; re-setting the current status
  is a no-op success so double-taps never error.
- 404s use ApiErrorCode 'not_found' (stale cockpit deep link ≠ validation
  error) and invalid transitions use 'conflict' (409). Don't collapse them
  back into 'bad_request'.
- Realized P&L comes ONLY from completions that carry filled numbers
  (execution.lockedProfit = worst-leg payout − total staked, computed by
  engine lockedProfit()). Unpriced completions count for capture rate but
  are excluded from every dollar figure — never estimate money.
- OpportunityRecord.strategy ('arb' today) is the future-strategies
  discriminator; stores normalize it in for pre-Phase-5 files.
- Everything paper-fund is SIMULATED and says so: `simulated: true` in
  every API payload, badges in the UI. Paper state lives in its own store
  and never touches balances, alerts, opportunity records, or credits; a
  paper failure in the notifier is a console.warn, never a dropped alert.
- Alert selection rules exist exactly once (alertWorthy). Adding a
  strategy or channel must reuse it, not restate it. Since Phase 16 its
  "exactly once" fingerprint dedup COMPOSES with the confirmation gate:
  onConfirmed hands dispatch only confirmed records, and alertWorthy still
  applies threshold/flags/dedup on top — so an alert requires confirmed AND
  worthy, at most once, in that order.
- Ops evidence semantics: survival-at-next-scan counts ANY sighting
  (scan re-detection or live re-verify) at/after the next covering scan;
  records with no covering scan are excluded. The paper haircut may be
  MEASURED = 100 × (1 − survival) only after ≥14 days of scan history
  and ≥50 samples — anything else is labeled ASSUMED. Funnel timestamps
  are first-write-wins; verifyPressedAt is stamped server-side.
- The credit budget auto-stop lives in the scheduler's plan.ts (Phase 16
  moved it off the client). It gates scheduler scans AND score polls, never
  manual scans (those are blocked only by quiet hours). Stop = used ≥
  autoStopPct% × budget, from the provider's own month counter; it releases
  when the counter resets (learned on the next scan that refreshes usage) or
  the budget moves.
- Benchmark books (BENCHMARK_BOOKS, currently pinnacle) are DUAL-ROLE:
  always carried in the fetch (planFetch unions them into the books
  param; the strictly-cheaper rule uses the union count, so crossing a
  10-book boundary falls back to regions rather than silently paying
  more) but bettability is governed ONLY by the enabled flag — arb
  behavior is untouched by the benchmark role. Ryan confirmed dual-role
  2026-07-10: Pinnacle is Ontario-licensed and stays bettable.
- Fair probabilities come only from fairForLineGroup within one |point|
  group; a benchmark missing a side or quoting a different line is a
  typed rejection. Never infer fair prices from soft-book consensus.
- YELLOW is reserved app-wide for exactly one meaning: speculative /
  expected value / simulated / NOT guaranteed (Risk Mode, and Phase 16's
  Analytics Hub — the neon #E8FF00 Hub button/page are deliberately in
  this family: Hub money is simulated). Red stays "guaranteed arb",
  green stays "surveillance live". EV/Hub surfaces never use the word
  "guaranteed" unnegated — the alert format test pins it.
- EV records (strategy 'ev', single leg + ev context) ride every shared
  rail: same fingerprints, lifecycle, cockpit, ledger, alertWorthy. But:
  the arb scan RESPONSE never contains them (Risk Mode reads persisted
  records via /api/ev/board); EV alerts are per-subscription OPT-IN
  (evEnabled, default false); the paper fund is arb-only by design.
- Grading IS EV money: won → +stake×(odds−1), lost → −stake, void → 0,
  written onto execution.lockedProfit. Ungraded EV completions count for
  capture rate but sum $0 (the EXPECTED model line shows Σ stake×edge,
  never mixed into realized). Regrade allowed until balances applied;
  EV apply-to-balances derives from the grade, not a winning leg.
- Middles (strategy 'middle', engine/middles.ts — a NEW module, never a
  relaxation of arb line-group discipline): two opposite bets on
  DIFFERENT lines, both-can-win. Direction rules are smart constructors
  (Over T₁ + Under T₂ needs T₁ < T₂; spreads need p₁+p₂ > 0) — reversed
  pairings are unrepresentable. Metrics are arithmetic on S = Σ1/odds:
  cost% = (1−1/S)·100, payout% = (2/S−1)·100, breakeven = S−1. No hit
  probabilities anywhere; key numbers are factual badges. Free middles
  (S ≤ 1) alert without opt-in and may say "guaranteed" — costed middles
  never do. Per-leg grading (legGrades) is the money; middle re-verify
  keeps costed middles ALIVE (a middle costing money is not dead).
- Extra markets (totals/spreads) are ops-settings toggles, default OFF —
  each multiplies every odds call's credits. /api/ops/cost-estimate is
  the pre-scan number that must move when a toggle does; since Phase 16 it
  also models the conditional pair (creditsPerPairWindow = creditsPerScan ×
  (1 + hitRate), hitRate MEASURED from ≥50 logged scans in 14 days via
  ScanLogEntry.confirmationCandidates, else ASSUMED 30% — the paper-haircut
  idiom), keeping the plain per-scan number visible. The paper fund
  takes middles at their worst-case FLOOR (labeled), adopting actuals
  from graded real records by fingerprint.
- Stake/cap math exists exactly once (shared/stakePlanning.ts planStakes):
  a leg never exceeds its book's recorded balance — the WHOLE position
  rescales to the binding book so the guarantee survives. The client
  running this shared function is the deliberate exception to "client
  computes no arb math".
- Apply-to-balances is bookkeeping assistance with an exact stored
  inverse (revert); balances stay manual-entry and the app never touches
  bookmaker accounts.
- last-snapshot.json stores the RAW pre-filter feed on purpose — Advanced
  Mode presets must be able to recompute with books outside the current
  allowlist filter. Don't "fix" it to store filtered events.
- POST /api/advanced/recompute has NO provider in its dependency graph —
  zero credits is structural. It never writes opportunity records; the
  client only deep-links cards whose id is in knownRecordIds (no
  fabricated records, no dead links).
- Snapshot addressing (decided 2026-07-10): the snapshot stays LATEST-ONLY.
  Cockpit re-verify does NOT recompute from it — it does a fresh
  single-sport fetch (a few credits, and you want live prices before
  staking anyway). Snapshot recompute is Phase-4 advanced mode only, and
  only for events still present in the latest snapshot; records from older
  scans are simply not recomputable. Accepted limitation — don't build
  per-scan snapshot files to "fix" it.
- backupService.ts NEVER uses setInterval/setTimeout — timers live ONLY in
  server/src/scheduler/ (Phase 16). It only runs when explicitly triggered
  (server startup, fire-and-forget after each scan) and no-ops if today's
  dated BACKUP_DIR directory already exists.
- The book leaderboard (ops/leaderboardStore.ts) ACCRUES per scan, forward
  only — it is not, and cannot be, recomputed from history, because
  last-snapshot.json is latest-only. Zero credits is structural (no
  provider import anywhere in that file), not just behavioral. Share is
  always recomputed against the CURRENT totalScans at read time, never
  frozen at accrual time.
- CLV capture (clv/, Phase 18) is ZERO CREDITS STRUCTURALLY — no provider
  import anywhere in clv/ or engine/clv.ts; it only reads the raw snapshot a
  scan already fetched. record.closing is a ROLLING candidate: every covering
  scan overwrites it while the event is pre-commence, and the last write before
  commence FREEZES (never overwritten after). The freeze is enforced in BOTH
  captureClosings (omits commenced records) AND applyClosings (re-checks
  commence at write time) — structural, not just behavioral. ALL records
  participate (confirmed, gate-filtered, single_sighting, legacy) — the gates'
  selection quality is exactly what CLV measures. Missing closing legs are
  EXCLUDED from the stake-weighted mean (weights renormalize), never zeroed; a
  record with zero usable legs has a null CLV and is surfaced only by coverage.
  confirmation.confirmedLegOdds (the signal-CLV basis) is stamped in
  matchConfirmationPair for every record scan B RE-SIGHTED — confirmed and
  drifted single_sighting alike; a vanished single_sighting carries none.
- /scans (ops/scanBrowser.ts) attributes a record to a scan by matching
  detection/sighting timestamps into that scan's SLOT (previous scan's
  timestamp, this scan's timestamp], scoped to the same region tab and a
  sport the scan actually covered — the same scoping "provenGone" uses
  for dead-detection. A fingerprint re-detected under a DIFFERENT region
  tab is correctly excluded from that scan's drill-down (its regionTab is
  stamped at creation and never moves); this is intentional scope
  discipline, not a bug to "fix" with looser matching.
- The MODEL label is a standing honesty rule (portfolios optimizer +, since
  Phase 16 Part C.4, the weekly schedule proposal): a deterministic in-sample
  fit computed from history, NEVER a live promise and NEVER auto-applied. The
  proposal carries `model: true`, its client surface is MODEL-tagged, and
  `scheduler.blocks` change ONLY through POST /api/scheduler/proposal/apply on
  explicit user confirmation — no timer recomputes or applies it. (Distinct
  from YELLOW = speculative/simulated/not-guaranteed; the proposal is neither
  yellow nor a forecast, just a fit.)
