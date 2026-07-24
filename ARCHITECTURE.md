# Evil Eye V2 — Architecture reference

The on-demand deep reference: module map, schema, seams, invariants. The
always-loaded session contract is CLAUDE.md. Locked product rules:
`docs/handoff/DECISIONS.md`. Build history: `docs/superpowers/plans/` and
`docs/superpowers/exec-logs/`.

Monorepo (npm workspaces): `server` + `client`. TypeScript throughout, ESM
(`"type": "module"`, `.js` import specifiers resolving `.ts`).

## 1. `server/src/` — module map

Central seam interface is `PipeDeps` (defined in `pipeline/scan.ts`):
`{ repos, provider, sender, s(): Settings, rng, lastQuotes? }`. Almost every
server module takes `PipeDeps` and a `now: number` — time and I/O are
injected, never read ambiently.

### `shared/` — the type root (pure)
- `shared/types.ts` — single source of truth: `Strategy` (`ARB|MIDDLE|EV`),
  `TradeStatus` (7 states), `KillReason` (7 reasons), `Leg`, `Trade`, `Quote`,
  `OddsProvider` (sync `fetchQuotes` + optional async `refresh`), `AlertSender`.
- `shared/defaults.ts` — `DEFAULT_SETTINGS` (the whole knob surface, ~50 keys)
  and `type Settings = typeof DEFAULT_SETTINGS`.
- Imports nothing (leaf). **Pure.**

### `engine/` — pure math (no I/O, no clock, no rng)
- `engine/odds.ts` — `devigFairProbs`, `arbMargin` (`1 − Σ1/odds`), `evEdge`
  (`fairProb·odds − 1`), `middleMetrics`. Fractions, never percents.
- `engine/stakes.ts` — `roundStake`, `kellyStakeCents` (fractional Kelly vs
  total bankroll, capped at `kellyCapPct%`), `arbStakesCents` (returns
  `{stakes, roundedMargin}`).
- `engine/mix.ts` — `mixPct`, `mixAllowance` (category's share of
  `dailyPickCap`; 0% = none, positive floors at 1).
- `engine/tolerance.ts` — `passesToleranceGate(initial, recheck, tolerancePct)`:
  `recheck ≥ initial/(1+tol/100)`.
- `engine/gates.ts` — the **kill battery**: `runKillBattery`, six ordered
  gates, first failure wins: `ONE_SPORT_RULE → HEAT_GATE → SHARP_VELOCITY_CAP
  → MARKET_BREADTH_CAP → ROUNDING_DESTROYS_MARGIN → QUOTE_STALE`. Unknown
  book auto-kills; sharp-exempt (pinnacle) skips ONE_SPORT/HEAT but not
  velocity/breadth. Pure — context supplies all counts.

### `pipeline/` — the core loop (I/O shells over engine)
- `pipeline/scan.ts` — `runScan(deps, now)`: one provider snapshot →
  `detectCandidates` → `runKillBattery` → survivors become PENDING trades
  (`stakeCents` null). Records one credit per snapshot.
- `pipeline/verify.ts` — `runVerifyDue(deps, now)`: the double-verification
  recheck. Sweeps (expire started PENDINGs, stale VERIFIEDs), then per due
  PENDING: refetch, recompute edge on the SAME legs, tolerance gate, stake at
  recheck odds, daily-cap → mix-allowance gates, promote + `sender.sendVerified`.
- `pipeline/candidates.ts` — `detectCandidates(quotes, s)`: groups by
  event+market+|line|, emits ARB/EV/MIDDLE candidates. **Pure.**
- `pipeline/eligibility.ts` — book-on + sport-on filters, applied at both
  pipe ends. **Pure.**
- `pipeline/actions.ts` — user verbs + sim settlement: `confirmTrade`,
  `unconfirmTrade`, `reportLimited`, `settleTrade`, `runSimSettlement`,
  `simOutcome`; `ConflictError` (→409), `NotFoundError` (→404). Constants:
  `SETTLE_CUTOFF_MS=3h`, `EV_WIN_PROB=0.55`, `MIDDLE_WIN_PROB=0.3`.

### `scheduler/` — the one timer chain
- `scheduler/plan.ts` — `planNext(state, now, s, rng) → scan|verify|sleepUntil`.
  Quiet hours always win; else earliest of due verify vs next scan (cadence
  `scanBaseMin`, or hot-window random `scanHotMinMin..scanHotMaxMin`). **Pure.**
- `scheduler/runner.ts` — `startScheduler(deps, planDeps, timer, clock, hooks)`:
  the single self-rescheduling timeout chain. Timer + clock injected; a
  `generation` counter kills superseded wakes (no `clearTimeout`). `doScan`
  bundles scan→verify→settlement→brain closes→brain pass→journal minimum→
  daily snapshot. Failed ticks retry in `RETRY_MS=60_000`, never kill the chain.
- `scheduler/vancouverTime.ts` — DST-safe Vancouver wall-clock via
  `Intl.DateTimeFormat`: `isQuietHours`, `nextQuietEnd`, `dayKey`. **Pure.**

### `db/` — persistence (the only SQL)
- `db/db.ts` — `openDb(path)`: WAL, idempotent schema exec, guarded `migrate`
  ALTERs (adds `trades.confirmed_at`, `books.enabled` — never drop/recreate),
  `seedIfEmpty` (16 books, RYAN profile $10,000 = 1,000,000 cents, defaults).
- `db/repos.ts` — `Repos(db)` factory: `trades`, `settings`, `books`,
  `journal`, `eventsLog`, `credits`, `snapshots`, `profiles`, `limits`.
- `db/schema.sql` — see §2.

### `providers/` — sim data source
- `providers/simOdds.ts` — `SimOddsProvider(rng)`: deterministic given the
  injected rng; ~10 events, plants 2 arbs (one 3-leg soccer 1X2), 2 EV,
  1 middle; drifts ±2%. **No `refresh` method — SIM is network-inert by
  construction.**

### `live/` — LIVE-mode I/O (SIM never touches these)
- `live/env.ts` — V1 `.env` loader (boot only): `LIVE_ENV_NAMES`,
  `REQUIRED_FOR_LIVE`, `parseEnvFile` (pure), `loadV1Env`, `missingLiveVars`
  (names only), `devMode`. Never exposes values.
- `live/mode.ts` — `wireMode(deps, env, repos, fetch)`: THE one seam-swap
  point by `liveMode` key. SIM ⇒ `SimOddsProvider` + sim sender; LIVE ⇒
  `OddsApiProvider` + `TwilioWhatsAppSender`.
- `live/oddsApi.ts` — `OddsApiProvider(fetch, env, repos)`: async `refresh`
  fills cache, sync `fetchQuotes` reads it; `recordCredits` from API usage
  headers. Injected fetch only.
- `live/twilio.ts` — `TwilioWhatsAppSender`; dev-mode short-circuits before
  any network (dev is default).
- `live/inbound.ts` — 45s inbound-WhatsApp poll hook, live-only, dedupes by
  SID, applies 1/3 confirm semantics.
- `live/backup.ts` — nightly (03:00 Vancouver) db copy, keeps 14. Both modes.

### `brain/` — heat/suspicion model (pure core + I/O shells)
- `brain/heat.ts` — **pure** deterministic heat in [0,100]: decayed incident
  ledger + capped exposure (`EXPOSURE_CAP=15`), `deriveHealth`,
  `suspicionLevel` (1–5), `deriveBelief`.
- `brain/grades.ts` — **pure**: `grade = round(100·min(1,(wins+1)/(expWins+2)))`;
  `PROVISIONAL_MIN_SETTLED=30`.
- `brain/pass.ts` — `runBrainPass`, `brainPassIfDue` (6h cadence riding the
  scan tick — no timer), `applyLimitsReport`.
- `brain/closes.ts` — pre-start closing-price capture (append-forever),
  `closingEdge`.
- `brain/journalMin.ts` — ≤3 supplementary deterministic observations to hit
  `journalMinPerDay`; kill switch writes nothing.
- `brain/text.ts` — the **only LLM path**: `AnthropicTextWriter`,
  `digestAfterPass`. Model `claude-haiku-4-5`, max 512 tokens. **µ$ ledger:**
  integer micro-dollars, input=1µ$/token, output=5µ$/token,
  `LLM_CAP_MICRO=3_000_000` ($3/mo) refused BEFORE any request; spend logged
  to `events_log`. No key ⇒ silence. LLM only ever ADDS a digest paragraph.
- `brain/report.ts` — `buildBrainView` read model.

### `analytics/` — read models + pure rollups
- `analytics/series.ts` — **pure** day-series/stats folds; the ALL chart
  shadow-settles at read time with a per-trade seeded rng (fnv1a32→mulberry32)
  reusing `simOutcome` math — never written to db.
- `analytics/rollups.ts` — **pure** folds: `monthlyRows`, `funnelCounts`,
  `openBets`, `leaderboards`, `roundingCost`, `retention`, `gateCost`,
  `opportunities`.
- `analytics/report.ts` — `buildAnalyticsView`, `profileView`.

### `settings/` / `demo/` / `api/` / boot
- `settings/report.ts` — `buildSettingsView`, `tradesCsv`, `LLM_CAP_CENTS=300`.
- `demo/seed.ts` — additive, simulation-only, deterministic backfill (fixed
  PRNG seed); gated off in live mode; idempotent (checks `demo-0000`).
- `api/routes.ts` — `createApp(o)`. Wires everything; registers hooks
  `[inboundPollHook, backupHook?, brain-digest]`. `TradeView` serialization
  (`STAKE_VISIBLE` set, labels, `middleEdgePct`). ~23 routes (§8). Error
  contract `{error:{code,message}}`.
- `index.ts` — **the only place real time/fetch/fs exist.** `PORT = 4400`
  (locked). `loadV1Env()`, hands `createApp` the one real
  setTimeout/Date.now/Math.random/fetch/env/backup dir.

**Dependency direction:** `shared` ← `engine` ← `pipeline`/`brain`/`analytics`
← `api`. `db`/`scheduler`/`live`/`providers` are seam layers wired only at
`api`/`index`. Pure leaves: all of `engine`, `shared`, `scheduler/plan`,
`scheduler/vancouverTime`, `pipeline/candidates`, `pipeline/eligibility`,
`brain/heat`, `brain/grades`, `analytics/series`, `analytics/rollups`,
`providers/simOdds` (rng-relative).

## 2. SQLite schema (`db/schema.sql`)

Conventions: money = `*_cents INTEGER`; timestamps = INTEGER ms; day keys =
TEXT `YYYY-MM-DD` Vancouver-local. Idempotent (`CREATE TABLE IF NOT EXISTS`).

| Table | Purpose |
|---|---|
| `profiles` | Bankroll funds: name, `starting_cash_cents`, `created_date`. |
| `books` | The 16 sportsbooks: `sport`, `sharp_exempt`, `heat`, `health`, `max_belief_cents`, `enabled`. |
| `trades` | Core entity: category/event/sport/market, `legs` (JSON), margins (initial/recheck/final), `status`, `kill_reason`, `result_cents`, lifecycle timestamps, `day_key`. Indexed on status + day_key. |
| `limits_reports` | "TRADE LIMITED?" reports per trade/book. |
| `journal` | Brain journal lines. |
| `events_log` | Generic append-only event stream (`kind`, JSON payload): alerts, brain_pass, close_capture, llm_spend/llm_error/llm_skipped_budget, … |
| `settings` | k/v store, JSON-encoded values (the Settings knobs). |
| `credits_usage` | Provider-snapshot credit accounting. |
| `bankroll_snapshots` | One row per profile per Vancouver day (PK profile+day). |

## 3. `client/src/` — React SPA

- **Entry:** `main.tsx` → `App.tsx` (tab state `TRADES|BRAIN|ANALYTICS|
  SETTINGS`, shared 1s `useTick`, `Header`, `DemoSeedControl`, `Nav`,
  `StatusLine`).
- **Screens** (`screens/`): `TradesScreen` (LiveCard, PendingCard, ViewAll),
  `BrainScreen` (SiteTable/SiteDetail, EngineStrip, RationalePanel,
  StrategyPerformance, BrainJournal, AdvancedBrainSettings),
  `AnalyticsScreen` (ProfileBar, RangeChips, ProfitChart, MonthlyTable,
  TimeToActFunnel, AdvancedAnalytics), `SettingsScreen` (StrategyMix,
  ScanRules, RiskBankroll, Brain, Whatsapp, Data, AdvancedSettings).
- **Hooks:** `useAppState`/`useBrain`/`useAnalytics`/`useSettingsView` poll
  their endpoint every 5s; `useTick` is the shared 1s clock.
- **Server contract mirrors live in `client/src/lib/`** — hand-maintained:
  `api.ts` (`AppState`, `TradeView`, `deriveStatusLine`, fetch/post helpers),
  `brain.ts`, `analytics.ts`, `settings.ts`, `format.ts`, `reveal.ts`,
  `timers.ts`. Helpers never throw (null on query fail, false on post fail).
  **Update both sides together when a read model changes.**
- **Proxy:** `client/vite.config.ts` proxies `/api` →
  `EE_API_TARGET ?? http://localhost:4400`; dev port `5174`.
- **Styling:** plain CSS with design tokens (`styles/tokens.css` — colors
  verbatim from design-inventory §0.2), plus global/brain/analytics/settings
  stylesheets. No CSS framework.

## 4. SIM vs LIVE seam

- **Switch state:** the `liveMode` settings key (0=SIM default, 1=LIVE).
- **Flip owner:** `POST /api/mode` ONLY; `PATCH /api/settings` refuses
  `liveMode`. Going LIVE requires `missingLiveVars(env)` empty, else 409 with
  **names only** — never values.
- **Wiring:** `live/mode.ts:wireMode` is the single seam-swap point.
- **SIM network-inertness is structural:** tests inject a throwing fetch;
  `SimOddsProvider` has no `refresh`; the brain-digest hook returns null
  unless `liveMode===1` even with a real key present (test F7);
  Twilio/inbound/oddsApi all take injected fetch only.
- **Env:** `LIVE_ENV_NAMES` = `ODDS_API_KEY, TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, WHATSAPP_DEV_MODE, PORT, APP_URL`
  (+ `ANTHROPIC_API_KEY`). `REQUIRED_FOR_LIVE` = the four ODDS/TWILIO names.
  `loadV1Env` reads `~/evil-eye-arbitrage/.env` (or `EE_ENV_PATH`) at boot,
  names checked / values never surfaced.

## 5. Scheduler / timer discipline

- One timer chain: `scheduler/runner.ts:startScheduler`. The only real
  `setTimeout` is passed in from `index.ts` via the `Timer` seam; `clock`
  injected. Self-rescheduling `arm → onTimer(gen) → runDue → arm`; the
  `generation` counter invalidates superseded wakes.
- Every scheduler/pipeline/brain function takes `now: number`; tests drive a
  fake clock + `handle.tick()`/`scanNow()` — no test ever sleeps.
- All cadenced work (6h brain pass, journal minimum, close capture, daily
  snapshot, hooks) rides the same scan tick — no independent timers anywhere.

## 6. Invariants — full statements

- **Line-group discipline:** candidates group by event+market+|line|; ARB
  legs and EV fair probs never mix lines; middles require different lines by
  smart construction.
- **Kill battery order is fail-fast** (see §1 engine/gates.ts); unknown book
  auto-kills; sharp-exempt skips ONE_SPORT/HEAT only.
- **No money before promotion:** PENDING carries `stakeCents=null`; the
  recheck re-runs tolerance + rounding gates at recheck odds, then
  daily-cap → mix-allowance ("SENT semantics" — counts verified/sent picks).
  Failed tolerance ⇒ `FAILED_VERIFICATION`.
- **µ$ ledger:** LLM spend in integer micro-dollars (input 1µ$, output 5µ$
  per token); $3/mo hard cap refused before the request is made.
- **Quiet hours:** `[00:00, 08:00)` Vancouver, DST-safe, beats even an
  overdue verify.
- **Credit accounting:** one `credits_usage` row per provider snapshot in
  SIM; LIVE reads real usage headers.
- Money always integer signed cents. Strategy mix locked to 100 at the API,
  per-category allowance enforced at promotion. Confirmed-money-only daily
  snapshots — the ALL chart shadow-settles at read time, never written back.
  Brain digest is additive-only over deterministic lines.

## 7. Tests

Co-located `*.test.ts` beside source (vitest). Server ~37 files / ~262
blocks; client 8 files / 63 blocks. Notable suites:

- `api/api.test.ts` — full supertest lifecycle (boot→scan→pending-no-stakes→
  advance 76s→verified-with-stakes; confirm/unconfirm; limited+settle;
  quiet-hours 503; no response body ever contains forbidden words;
  mode-flip name-only 409).
- `pipeline/pipeline.test.ts` + `mixcap.test.ts` — promotion gates, daily-cap
  held-back, rounding-eats-margin, zero-stake guard, 50-seed middle probe.
- `scheduler/*.test.ts` — single-chain firing, manual-scan re-arm, stale-wake
  no-op, DST spring/fall quiet-sleep math, dayKey rollover.
- `brain/wiring.test.ts`, `live/mode.test.ts`/`env.test.ts` — SIM structurally
  network-inert even with real-looking keys; env names-only.

## 8. Ports, env, routes

- **Ports:** server 4400 (locked in `index.ts`); Vite dev 5174; proxy target
  overridable via `EE_API_TARGET`. Worktree convention: 4410+ per CLAUDE.md.
- **Routes (~23):** `GET /api/state`, `GET /api/trades`, `POST /api/scan`,
  `POST /api/trades/:id/{confirm,unconfirm,limited,settle}`,
  `GET/PATCH /api/settings`, `GET /api/settings/view`, `GET /api/brain`,
  `POST /api/brain/{pass,anchor}`, `GET/POST /api/profiles`,
  `GET /api/analytics`, `PATCH /api/books/:name`, `POST /api/whatsapp/test`,
  `GET /api/export/{trades.csv,all.json}`, `POST /api/demo/seed`,
  `POST /api/mode`.
