# Evil Eye Arbitrage — working notes for Claude

Sports-betting arbitrage finder. One button → scan live odds via The Odds API
→ show guaranteed-profit stake splits. Information tool only: it never places
bets or touches bookmaker accounts. Full product rationale is in README.md;
this file is the working map.

## Commands

```bash
npm test               # Vitest, server AND client workspaces (run from repo root)
npm run typecheck      # tsc for server AND client
npm run dev:server     # Express on :8787 (mock mode without ODDS_API_KEY)
npm run dev:client     # Vite on :5173
```

Verify a backend change end-to-end without spending API credits:

```bash
PORT=8788 ODDS_API_KEY=mock npx tsx server/src/index.ts &
curl -X POST localhost:8788/api/scan -H 'content-type: application/json' \
     -d '{"topN":5,"regionTab":"ca_us"}'
```

## Layering (dependency rules, strictly one-way)

```
shared/          domain types + region-tab config + stakePlanning.ts (the ONE
                 planStakes implementation both sides run — alert dollars and
                 cockpit display must never compute caps separately). Zero imports.
server/src/
  engine/        PURE functions: arb math, filters, slider mapping, credit math.
                 No Express, no Node built-ins, no provider imports. Fully tested.
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
                 (pure transitions incl. applyStatusChange/applyVerification),
                 opportunityService.ts, verifyService.ts (cockpit re-verify:
                 cheap legs-only live fetch → re-price → persist),
                 opportunityStore.ts (active JSON + monthly JSONL archive).
  ledger/        ledgerService.ts — the P&L read model: streams the active
                 file + JSONL archives line-by-line (never whole-file reads)
                 into server-computed aggregates; CSV export is Excel-safe
                 (quoted, formula-defanged). The client does ZERO money math.
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
                 plus per-subscription rate limit, failure deactivation),
                 verification.ts (hashed 6-digit codes), subscriptionStore.ts,
                 whatsappRequests.ts (validation, E.164).
  fund/          Fund settings (real bankroll, default stake, unallocated
                 cash) + position assembly (float, warnings: low-balance,
                 stale-balance at 14d). Balance edits stamp balanceUpdatedAt.
  paper/         The SIMULATED shadow fund. paperStore.ts (own JsonStore,
                 facts only), paperMath.ts (pure deterministic settlement:
                 lazy at commence time, %-staking compounds off the settled
                 bankroll at entry, expectation-style haircut), paperService.ts
                 (entry via alertWorthy on the post-filterAlertable stream).
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
- **Scans are on-demand only** — no polling, no timers. That's a product
  decision (credit spend), not an accident.
- **Suspicious/same-book arbs are flagged, never hidden.** The user decides.
  (Exception: they're never PUSHED — WhatsApp alerts skip them by design.)
- **Twilio credentials never leave the server process** — same rule as the
  odds key. The client sees the phone number only masked (`/api/whatsapp/status`).
- **Alert dispatch is fire-and-forget.** runScan's notifier hook must never
  slow or fail a scan; a Twilio outage is a console.warn, not a 500.
- **Alerts piggyback on scans.** The notifier fires only when a scan runs
  (manual or client auto-scan) — it must not become a server-side scheduler
  (that's the "scans are on-demand only" invariant wearing another hat).

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
  strategy or channel must reuse it, not restate it.
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
