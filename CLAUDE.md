# Evil Eye Arbitrage — working notes for Claude

Sports-betting arbitrage finder. One button → scan live odds via The Odds API
→ show guaranteed-profit stake splits. Information tool only: it never places
bets or touches bookmaker accounts. Full product rationale is in README.md;
this file is the working map.

## Commands

```bash
npm test               # Vitest, server workspace (run from repo root)
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
shared/          domain types + region-tab config. Zero imports. Both sides use it.
server/src/
  engine/        PURE functions: arb math, filters, slider mapping, credit math.
                 No Express, no Node built-ins, no provider imports. Fully tested.
  providers/     OddsProvider interface + adapters (TheOddsApi live, Mock fixtures).
                 Wire-format mapping and ProviderError creation happen ONLY here.
  scan/          scanRequest.ts  — request body validation (THE place for new options)
                 scanService.ts  — orchestration: catalogue → odds → engine → usage
                 scanStore.ts    — last-scan JSON persistence (write-then-rename)
  bookmakers/    Per-book config (enabled/balance/status/notes). Registry
                 self-populates from each scan's raw feed. effectiveBookmakers.ts
                 (pure rules), bookmakerService.ts (façade), bookmakerStore.ts.
  opportunities/ Persisted opportunity records. opportunityId.ts (fingerprint —
                 THE identity, alert dedup imports it), opportunityLifecycle.ts
                 (pure transitions), opportunityService.ts, opportunityStore.ts
                 (active JSON + monthly JSONL archive under data/).
  lib/           jsonStore.ts — generic crash-safe serialized JSON store; every
                 file store (scan/whatsapp/bookmakers) is or should be one.
  notifications/ WhatsApp alerts: whatsappSender.ts (Twilio via fetch OR console
                 dev mode), alertService.ts (threshold match, fingerprint dedup,
                 rate limit, failure deactivation), verification.ts (hashed
                 6-digit codes), subscriptionStore.ts (JSON persistence,
                 serialized update()), whatsappRequests.ts (validation, E.164).
  routes/        Express boundary: parse → runScan → JSON; ProviderError → HTTP status.
                 api.ts (/api/scan, /api/last-scan) + whatsapp.ts (/api/whatsapp/*).
  config/        constants.ts (every tunable) + bookmakerLinks.ts (homepage fallbacks)
client/src/      React/Vite; talks only to /api/*; renders shared types verbatim.
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
  'degraded'/'completed' are cockpit (Phase 3) transitions — don't set them
  from scan code.
- last-snapshot.json stores the RAW pre-filter feed on purpose — Advanced
  Mode presets must be able to recompute with books outside the current
  allowlist filter. Don't "fix" it to store filtered events.
