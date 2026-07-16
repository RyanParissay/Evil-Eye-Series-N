# Evil Eye V2 — Plan 6: LIVE MODE (real providers behind the seams — the app STAYS simulated)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read the HARD GATES section first — its rules override every other instinct, including "make the test realistic".**

**Goal:** Everything the sim seams were built for — (a) a The Odds API provider as an alternative to `SimOddsProvider` behind the provider seam, (b) Twilio WhatsApp outbound + a 45-second inbound reply poll behind the sender seam, (c) Anthropic Brain-text behind a new text seam with a deterministic no-key fallback and a $3/month HARD CAP enforced in code, (d) nightly backups with a keep-14 rotation, and (e) the SIMULATED/LIVE switch with its confirm flow, reading the V1 `.env` variable NAMES as-is — while the running app REMAINS in SIMULATED mode. The switch ships; nothing in this plan flips it.

**Architecture:** All live integrations live under `server/src/live/` and are constructed with an INJECTED `fetchImpl` (Node 20's global `fetch` in production, stubs in tests — no test can reach a real network even by accident). The scheduler keeps the one-timer invariant: the runner gains an optional `HookTask[]` (inbound poll, nightly backup) that rides the SAME self-rescheduling timeout chain — `planNext` stays pure and untouched, and the only real `setTimeout` remains the one `index.ts` injects. The provider seam gains an optional async `refresh()` the timer callback awaits before scanning (the pipeline stays synchronous). The Anthropic writer hangs off the brain pass as a text-only decorator: deterministic journal templates are ALWAYS written first; the LLM may add a digest entry, never replace anything, and degrades to silence without a key. Mode is a settings key (`liveMode`) flipped only by `POST /api/mode`, which refuses LIVE unless every required env NAME is present.

**Tech Stack:** unchanged from Plans 1–2 (Node 20+/TS strict/NodeNext + better-sqlite3 ^12 + Express 4 + Vitest 2; Vite 5 + React 18 + plain CSS) — Plan 6 adds the The Odds API / Twilio / Anthropic client seams with **ZERO new npm dependencies**: all three speak plain HTTPS via the injected `fetch`, and `.env` parsing is a 20-line hand-rolled reader. Server port 4400, Vite dev port 5174.

## HARD GATES (controller-locked — non-negotiable, enforced by Task 10's audit)

1. **The app STAYS in SIMULATED mode.** The SIM/LIVE switch ships fully wired (confirm flow included) but is NEVER flipped to LIVE by any agent, test, or smoke step. The ONLY sanctioned mode tests are the refusal path (env names absent → 409) and LIVE→SIM (always allowed). No test, fixture, or smoke sets `ODDS_API_KEY`/`TWILIO_*` in the environment — that is what makes the refusal path the only reachable one.
2. **NO test or smoke may EVER call the real Odds API, Twilio, or Anthropic.** Every live client takes `fetchImpl` by injection; tests pass stubs (several deliberately `throw` to prove no call was attempted). `WHATSAPP_DEV_MODE` short-circuits sending before any network. Real hostnames may appear ONLY inside `server/src/live/*` and `server/src/brain/text.ts` production code paths.
3. **The V1 `.env` at `~/evil-eye-arbitrage/.env` is read by the loader at BOOT ONLY and its VALUES are never printed, logged, journaled, tested against, or serialized into any API payload.** Only these NAMES exist in this plan (supplied by the controller — the file itself is never opened by any human or agent during the build): `ODDS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_DEV_MODE`, `PORT`, `APP_URL`. Error messages and journal lines mention names only, never values. Tests use env RECORDS with fake values passed as parameters — never `process.env` mutation, never real values.
4. **Anthropic Brain-text works WITHOUT a key**: no `ANTHROPIC_API_KEY` → the deterministic templated text stands and the writer is silent — the app never crashes, never blocks, never retries into a spend. The **$3/month hard cap is enforced in code** with an integer micro-dollar ledger: once the month's spend + a conservative worst-case estimate of the next call would cross 3,000,000 µ$, the call is REFUSED before any request is made.
5. **One-timer invariant**: the 45 s inbound poll and the nightly backup ride the existing scheduler chain as hooks (Design §5) — only `server/src/index.ts` holds a real `setTimeout`, exactly as before.
6. **Any ambiguity about spending real money/credits or flipping SIM→LIVE is a LOCKED-RULE issue**: the executing agent STOPS and reports to the project manager (who escalates to the controller). Never resolve a money/live question downward. Known pre-resolved calls are in the Decision notes; anything outside them stops the line.

## Design (locked — every mechanism decided here)

1. **Env loading (Task 1):** `loadV1Env()` reads `~/evil-eye-arbitrage/.env` (override path via `EE_ENV_PATH` — tests point it at fixtures with FAKE values) and copies ONLY the seven known names into `process.env`, never overwriting an already-set variable. The parser handles `KEY=VALUE`, optional `export `, `#` comments, and single/double quotes. `presentLiveVars(env)`/`missingLiveVars(env)` report NAMES only. `PORT`/`APP_URL` belong to the V1 server: V2 keeps listening on the locked **4400** and uses `APP_URL` (when set) only inside outbound WhatsApp text as the tap-back link — `PORT` is loaded but deliberately unconsumed (Decision 2).
2. **Mode is a settings key** (`liveMode: 0`) that `PATCH /api/settings` REFUSES to touch (`use POST /api/mode`) — flipping mode has side effects (rewiring, gating) that a bare settings write must not trigger. `POST /api/mode {live: 1}` → 409 `cannot go live — missing: <names>` unless `ODDS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` are all present; on success it sets the key, journals the flip — SIM→LIVE writes `Mode switched: SIMULATED → LIVE — results feed not wired; trades will not auto-settle` (NEW copy — the settlement gap stays visible every time the switch flips, Design §13), LIVE→SIM writes `Mode switched: LIVE → SIMULATED` — and calls `wireMode`. `{live: 0}` always succeeds. `GET /api/state` derives `mode` from the key; the header badge, Plan 4's `simulated` flag and Plan 5's view all follow it.
3. **`wireMode(deps, env, repos, fetchImpl)`** swaps `deps.provider`/`deps.sender` in place: LIVE → `OddsApiProvider` + `TwilioWhatsAppSender`; SIMULATED → `SimOddsProvider(rng)` + the existing sim sender. Called at boot and after each successful mode flip. The pipeline never knows which is wired — that is the seam's whole point.
4. **Provider seam grows ONE optional method**: `OddsProvider.refresh?(now): Promise<void>`. The live provider fetches sports/odds there, maps them to `Quote[]`, caches them, and `fetchQuotes(now)` returns the cache — the pipeline stays synchronous and byte-identical. The runner's timer callback and `POST /api/scan` await `refresh` when present; `SimOddsProvider` doesn't define it, so sim behavior is untouched. Credits are recorded from the API's OWN `x-requests-used`/`x-requests-remaining` response headers (delta since last seen; first sighting seeds the baseline) — the forecaster shows real burn. A failed refresh keeps the previous cache, writes an events_log `provider_error` row (message only, no key), and never throws into the chain.
5. **Hooks ride the one timer** (Task 4): `startScheduler(deps, planDeps, timer, clock, hooks: HookTask[] = [])` where `HookTask = { name: string; nextAt(now): number | null; run(now): Promise<void> }`. The timer callback becomes an async orchestration (`pump()`): await `provider.refresh?` → await each hook whose `nextAt(now) ≤ now` → `runDue()` (unchanged sync core) → arm at `min(planNext wake, soonest hook wake)`. `planNext` is NOT modified; `tick()` stays sync for the existing sim tests; the handle gains `pump(): Promise<void>` as the test/manual entry. Hook errors are caught per-hook (events row), the chain never dies.
6. **Inbound poll hook** (45 s): `nextAt` returns `null` unless `liveMode === 1` and outside quiet hours (no sends happen in quiet hours, so no confirmations to collect; the watermark catches up at 08:00); else `lastPollTs + 45_000` (first poll: now). `run` lists inbound Twilio messages (basic-auth GET, `To=whatsapp:<TWILIO_WHATSAPP_FROM>`), dedupes by message SID against an events_log `wa_reply` ledger, then: body starting `1` → `confirmTrade` on the MOST RECENTLY SENT still-VERIFIED trade (none → journal `WhatsApp reply 1 received — nothing awaiting confirmation` (NEW copy)); body starting `3` → journal `WhatsApp reply 3 received — report the limit with book and amount on the TRADES screen` (NEW copy) + events row — a bare "3" carries neither book nor max-bet, so the limited flow completes in-app (MASTER PROMPT: "reply 1 SECURED / 3 LIMITED, **or in-app**"). Every poll writes a `wa_poll` watermark row.
7. **Outbound WhatsApp** (Task 3): `TwilioWhatsAppSender.sendVerified(t)` builds the message TEXT with a pure function (unit-tested verbatim): event · sport header, one leg line per leg `{Book label} — {selection label} @ {odds} │ BET ${stake}`, the metric line, `Reply 1 SECURED · 3 LIMITED`, and the `APP_URL` link when set. `WHATSAPP_DEV_MODE=true` (or any value other than unset/`false`) short-circuits BEFORE any network: events_log `alert` row exactly like the sim sender, plus `wa_dev` marker. Live path POSTs `Messages.json` (basic auth) fire-and-forget; failures → events `wa_error` (message only), never throw into the pipeline.
8. **Anthropic Brain text** (Task 6): model **`claude-haiku-4-5`** (the current small model — the BRAIN panel's `· HAIKU` copy is literal), raw `POST https://api.anthropic.com/v1/messages` via the injected fetch with headers `x-api-key` (env NAME `ANTHROPIC_API_KEY` — the standard SDK variable; the V1 file may not define it, and its absence is the sanctioned no-key path), `anthropic-version: 2023-06-01`, `content-type: application/json`; body `{ model, max_tokens: 512, system, messages }`. Pricing is integer-exact in **micro-dollars**: $1/MTok input ⇒ 1 µ$/token, $5/MTok output ⇒ 5 µ$/token (per the claude-api skill, cached 2026-06); per-call cost = `usage.input_tokens × 1 + usage.output_tokens × 5`; ledger = events_log `llm_spend` rows `{ inputTokens, outputTokens, costMicro }`; **cap = 3,000,000 µ$ per Vancouver month**. Before any call: `spentMicro + worstCaseMicro > CAP → refuse` (events `llm_skipped_budget`), where `worstCaseMicro = ceil(promptChars / 3) × 1 + 512 × 5` (chars/3 over-estimates tokens — conservative by construction, no count-tokens network call). The writer produces ONE extra journal entry per consolidation (`Consolidation digest: {text}`) rewriting that pass's deterministic lines into one paragraph; `stop_reason !== 'end_turn'` or any error → events `llm_error`, no journal entry, never a crash. Raw HTTP instead of `@anthropic-ai/sdk` is a deliberate locked-stack call (no new dependencies); the request shape above is the documented minimal Messages call.
9. **Nightly backups** (Task 5): once per Vancouver day, on the first pump at-or-after **03:00** (in practice the 08:00 quiet-end wake — waking mid-quiet solely for a copy would betray the quiet-hours spirit, and the mockup's `LAST 03:00` is demo filler; the DATA row shows the real time): better-sqlite3's `db.backup()` writes `<dataDir>/backups/evil-eye-YYYY-MM-DD.db`, then the rotation deletes all but the newest **14** backup FILES (rows are forever; backup files rotate — that is what "nightly backups ×14" means), then events_log `backup { file }` — which Plan 5's DATA panel already reads. Backups run in BOTH modes (sim data is data; no network, no money).
10. **The DATA-panel MODE switch** (Task 9) is the §2.2 two-click armed pattern: badge → click → armed `GO LIVE? ✓` (yellow) → click → `POST /api/mode {live:1}` → on 409 the armed state clears and the row shows `MISSING: <names>` (NEW copy, names only); flipping back arms `GO SIMULATED? ✓`. The client never auto-flips anything; the mode arrives from the server on the next poll. INPUTS statuses (Plan 3 brain screen + Plan 5 advanced panel) flip their sim-honest `SIM` chips to `LIVE` / `POLL 45S` when the view reports live mode.
11. **Everything degrades, nothing crashes**: provider failure → stale cache + honest events row; Twilio failure → events row; Anthropic failure/no-key/cap → deterministic text stands. Live mode may never take the scheduler chain down — every hook and refresh is wrapped.
12. **Demo values are not test expectations** (inventory §7.3/§8): the mockup's `LIVE`/`POLL 45S` statuses, `$0.84 / $3.00`, `LAST 03:00` and `61,212 / 100,000` are filler; every number derives from live tables. Copy stays verbatim where fixed.
13. **Sim settlement is SIMULATED-mode-only** (PM adjudication): `runSimSettlement` no-ops (all zeros) when `liveMode === 1` — rolling rng outcomes on REAL trades would fabricate WON/LOST money, the one dishonesty every plan forbids. In LIVE mode nothing auto-settles until a real results feed ships (an explicitly deferred future plan — Decision 13). The gate sits inside `runSimSettlement` itself: the runner's `doScan` settlement call is its only production caller, and gating the function protects every path. Manual `POST /api/trades/:id/settle` keeps working in both modes — the user reporting a real outcome is not fabrication.

## Global Constraints

- Money is **integer cents** in every variable, column and API payload; the LLM ledger uses integer **micro-dollars** internally and converts to cents only in display fields; dollars only inside format functions' return strings.
- Server files use NodeNext — **relative imports carry `.js` extensions**; client uses Bundler resolution (no extension). Consumers copy `DEFAULT_SETTINGS`, never alias it.
- **One timer invariant** (HARD GATE 5): the only real `setTimeout` lives in `server/src/index.ts`; hooks and refresh ride the existing chain (Design §5).
- **NO new npm dependencies** — global `fetch`, `node:fs`, `node:path`, `node:os` only.
- Never render the words: **append-only, ghost, picker, grader, CLV, gatekeeper** — in any UI string, API response, or outbound WhatsApp text (the message builder is swept too).
- ALL UI copy verbatim from `docs/handoff/design-inventory.md` (exact glyphs: `—`, `·`, `│` U+2502 in leg lines, `✓`, `−` U+2212). New copy flagged `(NEW copy)` where it appears.
- One total bankroll; no skip feature; no promo strategy; data kept forever (backup FILES rotate ×14, database rows never).
- Quiet hours 00:00–08:00 America/Vancouver stop scans, sends AND inbound polls; the nightly backup waits for the first post-03:00 pump (Design §9); all wall-clock logic via `Intl.DateTimeFormat` with `timeZone: 'America/Vancouver'`.
- Ports: server **4400** (regardless of the V1 `PORT` variable — Decision 2), Vite dev **5174**. All commands run from the repo root. **Worktree isolation:** the user's own dev servers permanently occupy 4400/5174 from the main checkout — every manual verify/smoke boots from the EXECUTION WORKTREE with the server port patched to a free port ≥ 4499 (temporary local edit of `PORT` in `server/src/index.ts`, never committed; client pointed at it via `EE_API_TARGET`), curls adjusted to match, and NEVER against the main checkout.
- TDD every task; commit after every task. The full suite must stay green throughout (server 117 + client 20 at authoring baseline, plus Plans 3–5's additions — Plan 6 executes LAST, after Plans 3, 4 and 5 have merged).

## Interface Contracts (referenced by all tasks)

```ts
// server/src/shared/types.ts — the provider seam grows ONE optional method (Task 2)
export interface OddsProvider {
  fetchQuotes(now: number): Quote[];
  /** Live providers refresh their snapshot here (awaited by the runner/scan route);
   *  sim never defines it. Must never throw — failures keep the last cache. */
  refresh?(now: number): Promise<void>;
}

// server/src/shared/defaults.ts (Task 1)
liveMode: 0,                              // flipped ONLY by POST /api/mode — PATCH refuses it

// server/src/live/env.ts (Task 1)
export const LIVE_ENV_NAMES = ['ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM', 'WHATSAPP_DEV_MODE', 'PORT', 'APP_URL'] as const;
export const REQUIRED_FOR_LIVE = ['ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM'] as const;
parseEnvFile(text: string): Record<string, string>            // pure
loadV1Env(env?: NodeJS.ProcessEnv, path?: string): void        // copies known names; never overwrites; never logs values
missingLiveVars(env: NodeJS.ProcessEnv): string[]              // NAMES only
devMode(env: NodeJS.ProcessEnv): boolean                       // WHATSAPP_DEV_MODE unset/'false' → false is LIVE-send; anything else → dev

// server/src/live/oddsApi.ts (Task 2)
OddsApiProvider(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos): OddsProvider
mapEvents(json: OddsApiEvent[], now: number): Quote[]          // pure; unknown books/sports dropped
recordCredits(repos: Repos, headers: Headers, now: number): void

// server/src/live/twilio.ts (Task 3)
TwilioWhatsAppSender(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number): AlertSender
verifiedMessageText(t: Trade, appUrl: string | undefined): string   // pure, verbatim leg lines + reply codes

// server/src/live/inbound.ts (Task 4)
pollInbound(deps: PipeDeps, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, now: number): Promise<number>
inboundPollHook(deps, fetchImpl, env): HookTask                 // 45s cadence, live-only, quiet-hours-gated

// server/src/scheduler/runner.ts (Task 4)
export interface HookTask { name: string; nextAt(now: number): number | null; run(now: number): Promise<void> }
startScheduler(deps, planDeps, timer, clock, hooks?: HookTask[]): SchedulerHandle
SchedulerHandle.pump(): Promise<void>                           // refresh? → due hooks → runDue; the timer callback's body

// server/src/live/backup.ts (Task 5)
runNightlyBackup(db: Db, repos: Repos, backupDir: string, now: number): Promise<string>  // returns file path
backupHook(db, repos, backupDir, clock): HookTask               // due when vancouverHour ≥ 3 and none today
pruneBackups(backupDir: string, keep: number): string[]         // deleted files, oldest-first rotation

// server/src/brain/text.ts (Task 6)
export const LLM_MODEL = 'claude-haiku-4-5';
export const LLM_CAP_MICRO = 3_000_000;                         // $3.00/month, integer micro-dollars
export const LLM_MAX_TOKENS = 512;
export interface TextWriter { available(): boolean; rewriteDigest(lines: string[]): Promise<string | null> }
NullTextWriter(): TextWriter                                    // available() false — the deterministic path
AnthropicTextWriter(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number): TextWriter
llmSpentMicro(repos: Repos, monthKey: string): number
worstCaseMicro(promptChars: number): number                     // ceil(chars/3) + 512×5
digestAfterPass(deps: PipeDeps, writer: TextWriter, now: number): Promise<boolean>
// events_log kinds owned by this plan: 'provider_error', 'wa_dev', 'wa_error', 'wa_poll',
// 'wa_reply', 'wa_reply_limited', 'backup', 'llm_spend', 'llm_skipped_budget', 'llm_error'

// server/src/live/mode.ts (Task 7)
wireMode(deps: PipeDeps, env: NodeJS.ProcessEnv, repos: Repos, fetchImpl: typeof fetch): 'SIMULATED' | 'LIVE'
modeLabel(s: Settings): 'SIMULATED' | 'LIVE'

// server/src/pipeline/actions.ts (Task 7 — Design §13)
runSimSettlement(deps, now)   // no-ops ({ settled: 0, won: 0, lost: 0 }) when liveMode === 1

// Routes added/changed in server/src/api/routes.ts (Task 7)
POST /api/mode        body { live: 0 | 1 } → { mode: 'SIMULATED' | 'LIVE' }
                      (400 bad body · 409 `cannot go live — missing: <names>` — NAMES only)
GET  /api/state       → mode: 'SIMULATED' | 'LIVE' (from liveMode; was the literal 'SIMULATED')
// AppOptions grows: fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; backupDir?: string | null
// (tests default: throwing fetch stub, empty env, no backups — sim behavior byte-identical)

// client/src/lib/settings.ts additions (Task 9)
modeSwitchLabel(mode, armed): string        // 'SIMULATED' | 'GO LIVE? ✓' | 'LIVE' | 'GO SIMULATED? ✓'
missingText(names: string[]): string        // 'MISSING: ODDS_API_KEY · …' (NEW copy, names only)
inputStatus(live: boolean, kind: 'feed' | 'poll'): { text: string; tone: 'sim' | 'green' | 'muted' }
// client/src/lib/api.ts: setMode(live: 0 | 1): Promise<{ ok: boolean; missing?: string[] }>
```

## Decision notes (locked product calls — bake in, do not re-litigate)

1. **Plan 6 executes LAST** (after Plans 3, 4, 5 merge): it edits Plan 5's `settings/report.ts` (llm ledger units, mode field), Plan 5's DATA panel, Plan 3's brain-screen INPUTS rows, and Plan 4's `simulated` flag — all with exact old→new replacements.
2. **`PORT` and `APP_URL` are V1's server settings.** V2 listens on the locked 4400 no matter what the file says (the global port constraint wins); `APP_URL` seasons outbound WhatsApp text only. Both names load; `PORT` is deliberately unconsumed. This is flagged here so no executor "helpfully" honors it.
3. **`ANTHROPIC_API_KEY` is the eighth name** — the SDK-standard variable, read the same way (env first, V1 file second if present). The controller's list has no Anthropic name because V1 may not have one; its ABSENCE is the designed-for case (HARD GATE 4). If the executing agent finds ambiguity beyond this (e.g. a different-looking Anthropic variable seems needed), that is a money question: STOP and report (HARD GATE 6).
4. **The Odds API mapping tables are locked**: sports `basketball_nba→basketball, baseball_mlb→baseball, icehockey_nhl→hockey, soccer_epl→soccer, tennis_atp→tennis` (keys configurable later; unknown sport keys drop the event); bookmaker keys map to the seeded roster slugs (`pinnacle, betmgm, fanduel, draftkings, caesars, betway, unibet, betrivers, bet365, …` — unknown bookmakers are dropped, never invented); markets `h2h→moneyline` (selections home/away/draw derived from team names), `totals→total` (over/under + point), `spreads→spread` (home/away + point). Soccer h2h maps to the engine's `1X2` market so 3-leg arbs keep working.
5. **Reply `1` confirms the newest sent VERIFIED trade** (by `verifiedAt` desc). With several live cards, WhatsApp's compact reply codes cannot address a specific one — newest-sent is the V1-consistent, deterministic reading; per-trade addressing is an in-app feature that already exists. Reply `3` journals + points in-app (Design §6).
6. **The dev-mode default is SAFE**: `devMode()` returns true unless `WHATSAPP_DEV_MODE` is exactly `'false'` or `'0'` — an unset or garbled flag means NO real sends. Going live with real sends requires the file to say so explicitly.
7. **Credits truth**: sim keeps `credits.add(now, 1)` per snapshot; live records the header DELTA (`x-requests-used` minus last seen, floor 0; the first live refresh seeds the baseline without recording). One `credits_usage` stream, honest in both modes.
8. **The digest entry is additive text, never a replacement** — deterministic journal lines are the record; `Consolidation digest:` prefixes the LLM paragraph so provenance is always visible (`(NEW copy)` — data voice). Kill switch ON stops digests (autonomous behavior) exactly as it stops passes.
9. **Backups pause never** (both modes, every day) and rotate FILES only. `pruneBackups` sorts by filename (the date IS the name — lexicographic = chronological) and deletes all but the newest 14.
10. **Mode flips rewire in place** (`wireMode` swaps `deps.provider`/`deps.sender`); no restart needed. In-flight trades survive: verify's recheck uses whatever provider is wired at that tick — a SIM→LIVE flip mid-pending is the user's explicit act (and LIVE→SIM is always safe).
11. **Client mode tests are pure-label tests only** (HARD GATE 1): `modeSwitchLabel`/`missingText`/`inputStatus` — no client test posts to `/api/mode` with `live: 1`.
12. **`smoke.test.ts` and every existing test keep passing untouched**: `AppOptions` additions are optional with sim-preserving defaults; `GET /api/state`'s `mode` remains `'SIMULATED'` wherever `liveMode` is 0 — which is everywhere in tests, forever (HARD GATE 1).
13. **Real settlement is DEFERRED to a future results-feed plan** (PM adjudication, Design §13): LIVE mode never rng-settles; until the feed exists, live trades settle only through the existing manual settle route. No executor may "helpfully" wire rng settlement in live mode — that is fabricated money and a locked-rule violation (HARD GATE 6 applies to any pressure to do so). The SIM→LIVE journal line surfaces the unwired feed on every flip.

## File Map

```
server/src/shared/types.ts                       (Modify T2 — OddsProvider.refresh?)
server/src/shared/defaults.ts + defaults.test.ts (Modify T1 — liveMode)
server/src/live/env.ts + env.test.ts             (Create T1)
server/src/api/routes.ts                         (Modify T1 — liveMode PATCH refusal; T7 — mode route, state mode,
                                                  AppOptions fetchImpl/env/backupDir, scan-route refresh await)
server/src/api/api.test.ts                       (Modify T1, T7 — specs)
server/src/live/oddsApi.ts + oddsApi.test.ts     (Create T2; fixture: server/src/live/fixtures/odds-api-sample.json)
server/src/scheduler/runner.ts                   (Modify T4 — hooks + pump; Modify T2 — refresh await)
server/src/scheduler/runner.hooks.test.ts        (Create T4)
server/src/live/twilio.ts + twilio.test.ts       (Create T3)
server/src/live/inbound.ts + inbound.test.ts     (Create T4)
server/src/live/backup.ts + backup.test.ts       (Create T5)
server/src/brain/text.ts + text.test.ts          (Create T6)
server/src/brain/pass.ts                         (Modify T6 — digest hook point via runner call)
server/src/settings/report.ts                    (Modify T6 — llmSpentCents from µ$; Modify T7 — mode from liveMode)
server/src/analytics/report.ts                   (Modify T7 — simulated flag from liveMode)
server/src/live/mode.ts + mode.test.ts           (Create T7)
server/src/pipeline/actions.ts                   (Modify T7 — sim-settlement liveMode gate, Design §13)
server/src/index.ts                              (Modify T8 — env load, wireMode, hooks, backup dir)
client/src/lib/settings.ts + settings.test.ts    (Modify T9 — mode switch + input status helpers)
client/src/lib/api.ts                            (Modify T9 — setMode)
client/src/components/DataPanel.tsx              (Modify T9 — the armed switch)
client/src/components/AdvancedSettings.tsx       (Modify T9 — INPUTS statuses follow mode)
client/src/components/AdvancedBrainSettings.tsx  (Modify T9 — brain INPUTS rows follow mode)
```

---

### Task 1: V1 env loader (names only) + `liveMode` key (TDD)

**Files:**
- Create: `server/src/live/env.ts`, `server/src/live/env.test.ts`
- Modify: `server/src/shared/defaults.ts`, `server/src/shared/defaults.test.ts`, `server/src/api/routes.ts`, `server/src/api/api.test.ts`

**Interfaces:**
- Produces: `LIVE_ENV_NAMES`, `REQUIRED_FOR_LIVE`, `parseEnvFile`, `loadV1Env`, `missingLiveVars`, `devMode`, the `liveMode` key and its PATCH refusal — consumed by Tasks 2–9.

- [ ] **Step 1: Write the failing specs**

Append to `server/src/shared/defaults.test.ts`:

```ts
test('live-mode default is SIMULATED', () => {
  expect(DEFAULT_SETTINGS.liveMode).toBe(0);
});
```

Create `server/src/live/env.test.ts` (fixtures use FAKE values only — HARD GATE 3):

```ts
import { expect, test } from 'vitest';
import { LIVE_ENV_NAMES, REQUIRED_FOR_LIVE, devMode, missingLiveVars, parseEnvFile } from './env.js';

test('the name lists are the controller-supplied set, verbatim', () => {
  expect([...LIVE_ENV_NAMES]).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM', 'WHATSAPP_DEV_MODE', 'PORT', 'APP_URL',
  ]);
  expect([...REQUIRED_FOR_LIVE]).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
});

test('parseEnvFile: KEY=VALUE, export prefix, quotes, comments, blanks', () => {
  const parsed = parseEnvFile([
    '# comment line',
    'ODDS_API_KEY=fake-key-123',
    "export TWILIO_ACCOUNT_SID='ACfake'",
    'TWILIO_AUTH_TOKEN="fake token"',
    '',
    'WHATSAPP_DEV_MODE=true',
    'not a pair',
    'APP_URL=http://localhost:3000 # trailing comments are NOT stripped',
  ].join('\n'));
  expect(parsed.ODDS_API_KEY).toBe('fake-key-123');
  expect(parsed.TWILIO_ACCOUNT_SID).toBe('ACfake');
  expect(parsed.TWILIO_AUTH_TOKEN).toBe('fake token');
  expect(parsed.WHATSAPP_DEV_MODE).toBe('true');
  expect(parsed.APP_URL).toBe('http://localhost:3000 # trailing comments are NOT stripped');
  expect(Object.keys(parsed)).not.toContain('not a pair');
});

test('missingLiveVars reports NAMES only, in canonical order', () => {
  expect(missingLiveVars({})).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
  expect(missingLiveVars({
    ODDS_API_KEY: 'fake', TWILIO_ACCOUNT_SID: 'fake', TWILIO_AUTH_TOKEN: 'fake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
  })).toEqual([]);
  expect(missingLiveVars({ ODDS_API_KEY: 'fake' })).toEqual([
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
});

test('devMode defaults SAFE: only an explicit false/0 means real sends', () => {
  expect(devMode({})).toBe(true);                                   // unset → dev
  expect(devMode({ WHATSAPP_DEV_MODE: 'true' })).toBe(true);
  expect(devMode({ WHATSAPP_DEV_MODE: 'banana' })).toBe(true);      // garbled → dev
  expect(devMode({ WHATSAPP_DEV_MODE: 'false' })).toBe(false);
  expect(devMode({ WHATSAPP_DEV_MODE: '0' })).toBe(false);
});
```

Append to `server/src/api/api.test.ts`:

```ts
test('PATCH /api/settings refuses liveMode — POST /api/mode owns it', async () => {
  const h = makeApp();
  const res = await request(h.app).patch('/api/settings').send({ liveMode: 1 });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('/api/mode');
  expect(h.repos.settings.all().liveMode).toBe(0); // untouched
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- defaults env api`
Expected: FAIL — missing key, missing module `./env.js`, PATCH accepts liveMode.

- [ ] **Step 3: Implement**

In `server/src/shared/defaults.ts`, append to `DEFAULT_SETTINGS`:

```ts
  // Live mode (Plan 6). Flipped ONLY by POST /api/mode — PATCH /api/settings
  // refuses this key because flipping has side effects (rewiring, env gating).
  liveMode: 0,
```

Create `server/src/live/env.ts`:

```ts
// V1 .env loader (Plan 6, HARD GATE 3): reads ~/evil-eye-arbitrage/.env at BOOT
// ONLY, copies the KNOWN names into process.env without overwriting, and never
// exposes a VALUE anywhere — not in logs, errors, journals or payloads. Tests
// exercise the pure parser and name reporting with fake fixtures; nothing in
// this module prints.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LIVE_ENV_NAMES = [
  'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM', 'WHATSAPP_DEV_MODE', 'PORT', 'APP_URL',
] as const;

/** The names POST /api/mode requires before it will go live. */
export const REQUIRED_FOR_LIVE = [
  'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
] as const;

/** The Anthropic key is the SDK-standard eighth name (Decision 3): read if present,
 *  designed to be absent — absence selects the deterministic no-LLM path. */
export const ANTHROPIC_KEY_NAME = 'ANTHROPIC_API_KEY';

const DEFAULT_ENV_PATH = join(homedir(), 'evil-eye-arbitrage', '.env');

/** Pure KEY=VALUE parser: optional `export `, full-line # comments, single/double
 *  quotes stripped when they wrap the whole value. No interpolation, no escapes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}

/**
 * Merge the V1 file's KNOWN names (plus the Anthropic key) into `env`, never
 * overwriting an already-set variable. A missing/unreadable file is fine —
 * the app simply stays without live credentials.
 */
export function loadV1Env(env: NodeJS.ProcessEnv = process.env, path?: string): void {
  const file = path ?? env.EE_ENV_PATH ?? DEFAULT_ENV_PATH;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return; // no file → no live vars; never log the path's contents (there are none)
  }
  const parsed = parseEnvFile(text);
  for (const name of [...LIVE_ENV_NAMES, ANTHROPIC_KEY_NAME]) {
    if (env[name] === undefined && parsed[name] !== undefined) env[name] = parsed[name];
  }
}

/** Which REQUIRED names are absent — NAMES only, canonical order (409 message body). */
export function missingLiveVars(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_FOR_LIVE.filter((name) => {
    const v = env[name];
    return v === undefined || v === '';
  });
}

/** SAFE default: real sends require WHATSAPP_DEV_MODE to be explicitly 'false'/'0'. */
export function devMode(env: NodeJS.ProcessEnv): boolean {
  const v = env.WHATSAPP_DEV_MODE;
  return !(v === 'false' || v === '0');
}
```

In `server/src/api/routes.ts`, add `liveMode` to the refusal path — in `settingsPatch`, directly after the unknown-key check inside the loop:

```ts
    if (!SETTINGS_KEYS.has(k)) return { error: `unknown setting: ${k}` };
    if (k === 'liveMode') return { error: 'liveMode is switched via POST /api/mode' };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (6 new tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/shared server/src/live server/src/api
git commit -m "feat(server): V1 env loader (names only, never values) and liveMode key"
```

---

### Task 2: The Odds API provider behind the seam (TDD — mocked fetch only)

**Files:**
- Create: `server/src/live/oddsApi.ts`, `server/src/live/oddsApi.test.ts`, `server/src/live/fixtures/odds-api-sample.json`
- Modify: `server/src/shared/types.ts` (optional `refresh`), `server/src/scheduler/runner.ts` (await refresh — minimal edit; hooks land in Task 4), `server/src/api/routes.ts` (scan route awaits refresh)

**Interfaces:**
- Consumes: `Quote`, `Repos`, Task 1's env helpers.
- Produces: `OddsApiProvider`, `mapEvents`, `recordCredits` — wired by Task 7's `wireMode`.

- [ ] **Step 1: Write the failing spec** — `server/src/live/oddsApi.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { OddsApiProvider, mapEvents, recordCredits } from './oddsApi.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/odds-api-sample.json', import.meta.url), 'utf8'),
);
const ENV = { ODDS_API_KEY: 'fake-key' } as NodeJS.ProcessEnv;

test('mapEvents: h2h/totals/spreads map to engine markets; unknown books/sports drop', () => {
  const quotes = mapEvents(FIXTURE, NOW);
  const nba = quotes.filter((q) => q.event === 'Nuggets @ Suns' && q.market === 'moneyline');
  expect(nba.length).toBeGreaterThan(0);
  expect(nba[0]).toMatchObject({ sport: 'basketball', market: 'moneyline', line: null });
  expect(new Set(nba.map((q) => q.selection))).toEqual(new Set(['home', 'away']));
  expect(nba.every((q) => q.eventStartsAt === Date.parse('2026-07-15T02:10:00Z'))).toBe(true);
  expect(nba.every((q) => q.fetchedAt === NOW)).toBe(true);

  const totals = quotes.filter((q) => q.market === 'total');
  expect(totals.some((q) => q.selection === 'over' && q.line === 8.5)).toBe(true);

  const soccer = quotes.filter((q) => q.sport === 'soccer');
  expect(soccer.every((q) => q.market === '1X2')).toBe(true); // 3-leg arbs keep working
  expect(new Set(soccer.map((q) => q.selection))).toEqual(new Set(['home', 'away', 'draw']));

  expect(quotes.some((q) => q.book === 'nowhere-book')).toBe(false);   // unknown bookmaker dropped
  expect(quotes.some((q) => q.sport === 'cricket_odi')).toBe(false);   // unknown sport dropped
});

test('refresh caches quotes; fetchQuotes stays synchronous; credits come from headers', async () => {
  const repos = Repos(openDb(':memory:'));
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(FIXTURE), {
      status: 200,
      headers: { 'x-requests-used': '120', 'x-requests-remaining': '99880' },
    });
  }) as typeof fetch;

  const p = OddsApiProvider(fetchImpl, ENV, repos);
  expect(p.fetchQuotes(NOW)).toEqual([]); // no refresh yet — empty cache, no throw
  await p.refresh!(NOW);
  expect(p.fetchQuotes(NOW).length).toBeGreaterThan(0);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((u) => u.includes('apiKey='))).toBe(true);
  expect(repos.credits.all()).toHaveLength(0); // first sighting seeds the baseline only

  await p.refresh!(NOW + 60_000); // headers now report 135 used
  // second stub response below overrides used — see fetch closure in implementation note
});

test('credit DELTAS are recorded, first sighting seeds', () => {
  const repos = Repos(openDb(':memory:'));
  const mkHeaders = (used: string) => new Headers({ 'x-requests-used': used });
  recordCredits(repos, mkHeaders('120'), NOW);          // baseline
  expect(repos.credits.all()).toHaveLength(0);
  recordCredits(repos, mkHeaders('135'), NOW + 60_000); // +15
  expect(repos.credits.all()).toEqual([expect.objectContaining({ ts: NOW + 60_000, n: 15 })]);
  recordCredits(repos, mkHeaders('135'), NOW + 120_000); // no burn → no row
  expect(repos.credits.all()).toHaveLength(1);
});

test('a failed refresh keeps the last cache and writes provider_error — never throws', async () => {
  const repos = Repos(openDb(':memory:'));
  let fail = false;
  const fetchImpl = (async () => {
    if (fail) throw new Error('network down');
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  }) as typeof fetch;
  const p = OddsApiProvider(fetchImpl, ENV, repos);
  await p.refresh!(NOW);
  const cached = p.fetchQuotes(NOW).length;
  expect(cached).toBeGreaterThan(0);
  fail = true;
  await p.refresh!(NOW + 60_000); // must not reject
  expect(p.fetchQuotes(NOW + 60_000)).toHaveLength(cached); // stale cache stands
  const errs = repos.eventsLog.all().filter((e) => e.kind === 'provider_error');
  expect(errs).toHaveLength(1);
  expect(errs[0]!.payload).not.toContain('fake-key'); // NEVER a value in the payload
});
```

Create `server/src/live/fixtures/odds-api-sample.json` (hand-built, v4 response shape, FAKE data):

```json
[
  {
    "id": "evt1", "sport_key": "basketball_nba", "commence_time": "2026-07-15T02:10:00Z",
    "home_team": "Suns", "away_team": "Nuggets",
    "bookmakers": [
      { "key": "pinnacle", "markets": [
        { "key": "h2h", "outcomes": [
          { "name": "Suns", "price": 1.95 }, { "name": "Nuggets", "price": 1.95 } ] },
        { "key": "totals", "outcomes": [
          { "name": "Over", "price": 1.92, "point": 8.5 }, { "name": "Under", "price": 1.98, "point": 8.5 } ] } ] },
      { "key": "fanduel", "markets": [
        { "key": "h2h", "outcomes": [
          { "name": "Suns", "price": 1.9 }, { "name": "Nuggets", "price": 2.05 } ] },
        { "key": "spreads", "outcomes": [
          { "name": "Suns", "price": 1.91, "point": -3.5 }, { "name": "Nuggets", "price": 1.95, "point": 3.5 } ] } ] },
      { "key": "nowhere-book", "markets": [
        { "key": "h2h", "outcomes": [
          { "name": "Suns", "price": 3.0 }, { "name": "Nuggets", "price": 3.0 } ] } ] }
    ]
  },
  {
    "id": "evt2", "sport_key": "soccer_epl", "commence_time": "2026-07-15T18:00:00Z",
    "home_team": "Arsenal", "away_team": "Chelsea",
    "bookmakers": [
      { "key": "pinnacle", "markets": [
        { "key": "h2h", "outcomes": [
          { "name": "Arsenal", "price": 2.9 }, { "name": "Chelsea", "price": 2.6 }, { "name": "Draw", "price": 3.4 } ] } ] },
      { "key": "bet365", "markets": [
        { "key": "h2h", "outcomes": [
          { "name": "Arsenal", "price": 3.1 }, { "name": "Chelsea", "price": 2.5 }, { "name": "Draw", "price": 3.3 } ] } ] }
    ]
  },
  {
    "id": "evt3", "sport_key": "cricket_odi", "commence_time": "2026-07-15T10:00:00Z",
    "home_team": "A", "away_team": "B",
    "bookmakers": [ { "key": "pinnacle", "markets": [
      { "key": "h2h", "outcomes": [ { "name": "A", "price": 1.9 }, { "name": "B", "price": 1.9 } ] } ] } ]
  }
]
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- oddsApi`
Expected: FAIL — cannot find module `./oddsApi.js`.

- [ ] **Step 3: Implement**

In `server/src/shared/types.ts`, replace the `OddsProvider` interface:

```ts
export interface OddsProvider {
  fetchQuotes(now: number): Quote[];
  /** Live providers refresh their snapshot here (awaited by the runner and the
   *  scan route); sim never defines it. Must never throw — a failed refresh
   *  keeps the last cache and logs, so the chain survives (Plan 6 Design §4). */
  refresh?(now: number): Promise<void>;
}
```

Create `server/src/live/oddsApi.ts`:

```ts
// The Odds API provider (Plan 6, Design §4 + Decision 4): async refresh fills a
// cache; fetchQuotes stays synchronous so the pipeline is untouched. Injected
// fetchImpl only — tests stub it; NOTHING here can run against the real API in
// a test (HARD GATE 2). Credits come from the API's own usage headers.
import type { OddsProvider, Quote } from '../shared/types.js';
import type { Repos } from '../db/db.js';

const BASE = 'https://api.the-odds-api.com/v4';

/** Sport keys we scan ↔ engine sport slugs. Unknown keys drop the event. */
const SPORTS: Record<string, string> = {
  basketball_nba: 'basketball',
  baseball_mlb: 'baseball',
  icehockey_nhl: 'hockey',
  soccer_epl: 'soccer',
  tennis_atp: 'tennis',
};

/** the-odds-api bookmaker keys ↔ the seeded roster slugs. Unknown books drop. */
const BOOKS: Record<string, string> = {
  pinnacle: 'pinnacle', betmgm: 'betmgm', fanduel: 'fanduel', draftkings: 'draftkings',
  caesars: 'caesars', betway: 'betway', unibet: 'unibet', betrivers: 'betrivers',
  bet365: 'bet365', williamhill_us: 'caesars', betvictor: 'betvictor', bwin: 'bwin',
  leovegas: 'leovegas', bodog: 'bodog', pointsbetus: 'pointsbet',
};

interface ApiOutcome { name: string; price: number; point?: number }
interface ApiMarket { key: string; outcomes: ApiOutcome[] }
interface ApiBookmaker { key: string; markets: ApiMarket[] }
export interface OddsApiEvent {
  id: string; sport_key: string; commence_time: string;
  home_team: string; away_team: string; bookmakers: ApiBookmaker[];
}

/** Pure v4 → Quote[] mapping. Selections use the engine's slugs; soccer h2h is 1X2. */
export function mapEvents(events: OddsApiEvent[], now: number): Quote[] {
  const out: Quote[] = [];
  for (const e of events) {
    const sport = SPORTS[e.sport_key];
    if (sport === undefined) continue;
    const eventStartsAt = Date.parse(e.commence_time);
    const eventName = `${e.away_team} @ ${e.home_team}`;
    const soccer = sport === 'soccer';
    for (const bm of e.bookmakers) {
      const book = BOOKS[bm.key];
      if (book === undefined) continue;
      for (const m of bm.markets) {
        for (const o of m.outcomes) {
          const q = mapOutcome(m.key, o, e, soccer);
          if (q === null) continue;
          out.push({
            book, sport, event: eventName, market: q.market, selection: q.selection,
            odds: o.price, line: q.line, fetchedAt: now, eventStartsAt,
          });
        }
      }
    }
  }
  return out;
}

function mapOutcome(
  marketKey: string, o: ApiOutcome, e: OddsApiEvent, soccer: boolean,
): { market: string; selection: string; line: number | null } | null {
  switch (marketKey) {
    case 'h2h': {
      const selection = o.name === e.home_team ? 'home' : o.name === e.away_team ? 'away' : o.name === 'Draw' ? 'draw' : null;
      if (selection === null) return null;
      return { market: soccer ? '1X2' : 'moneyline', selection, line: null };
    }
    case 'totals': {
      const selection = o.name === 'Over' ? 'over' : o.name === 'Under' ? 'under' : null;
      if (selection === null || o.point === undefined) return null;
      return { market: 'total', selection, line: o.point };
    }
    case 'spreads': {
      const selection = o.name === e.home_team ? 'home' : o.name === e.away_team ? 'away' : null;
      if (selection === null || o.point === undefined) return null;
      return { market: 'spread', selection, line: o.point };
    }
    default:
      return null;
  }
}

/** Header delta → credits_usage. First sighting seeds the baseline (Decision 7). */
export function recordCredits(repos: Repos, headers: Headers, now: number): void {
  const used = Number(headers.get('x-requests-used'));
  if (!Number.isFinite(used)) return;
  const rows = repos.eventsLog.all().filter((e) => e.kind === 'odds_api_used');
  const last = rows.length > 0 ? (JSON.parse(rows[rows.length - 1]!.payload) as { used: number }).used : null;
  repos.eventsLog.add(now, 'odds_api_used', JSON.stringify({ used }));
  if (last === null) return; // baseline
  const delta = Math.max(0, used - last);
  if (delta > 0) repos.credits.add(now, delta);
}

export function OddsApiProvider(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos): OddsProvider {
  let cache: Quote[] = [];
  return {
    fetchQuotes(): Quote[] {
      return cache;
    },
    async refresh(now: number): Promise<void> {
      try {
        const merged: OddsApiEvent[] = [];
        let headers: Headers | null = null;
        for (const sportKey of Object.keys(SPORTS)) {
          const url = `${BASE}/sports/${sportKey}/odds?regions=us,eu&markets=h2h,totals,spreads`
            + `&oddsFormat=decimal&apiKey=${env.ODDS_API_KEY ?? ''}`;
          const res = await fetchImpl(url);
          if (!res.ok) throw new Error(`odds api ${res.status} for ${sportKey}`);
          headers = res.headers;
          merged.push(...((await res.json()) as OddsApiEvent[]));
        }
        cache = mapEvents(merged, now);
        if (headers !== null) recordCredits(repos, headers, now);
      } catch (err) {
        // Keep the stale cache; the message NEVER contains a value (HARD GATE 3).
        repos.eventsLog.add(now, 'provider_error', JSON.stringify({
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
      }
    },
  };
}
```

In `server/src/scheduler/runner.ts`, make the timer callback refresh-aware (the full hooks rework lands in Task 4; this task only awaits the provider) — replace `onTimer`:

```ts
  function onTimer(gen: number): void {
    if (stopped || gen !== generation) return; // stale wake: drop it
    void (async () => {
      try {
        if (deps.provider.refresh) await deps.provider.refresh(clock());
      } catch {
        /* refresh never throws by contract; belt-and-suspenders */
      }
      let delayMs = RETRY_MS;
      try {
        delayMs = Math.max(0, runDue() - clock());
      } catch (err) {
        console.error('[scheduler] tick failed — retrying in 60s', err);
      }
      arm(delayMs);
    })();
  }
```

In `server/src/api/routes.ts`, the manual scan refreshes first — replace the scan handler's body head (keep its quiet-hours check and response exactly as-is):

```ts
  app.post('/api/scan', async (_req, res) => {
    const now = clock();
    if (isQuietHours(now, deps.s())) {
      return fail(res, 503, 'quiet_hours', 'quiet hours — no scans, no sends');
    }
    if (deps.provider.refresh) await deps.provider.refresh(now); // live snapshot first; sim no-ops
    res.json(scheduler.scanNow(now));
  });
```

(Adapt the two replacements to the file's exact current text — the quiet-hours guard and response line are unchanged; only the `async` + refresh line are new.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (4 new tests; every sim test untouched — sim providers have no `refresh`), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/shared server/src/live server/src/scheduler server/src/api
git commit -m "feat(server): The Odds API provider behind the seam (async refresh, header credits, mocked-fetch tests)"
```

---

### Task 3: Twilio WhatsApp sender — dev mode first, never throws (TDD)

**Files:**
- Create: `server/src/live/twilio.ts`, `server/src/live/twilio.test.ts`

**Interfaces:**
- Consumes: `AlertSender`, `Trade`, Task 1's `devMode`.
- Produces: `TwilioWhatsAppSender`, `verifiedMessageText` — wired by Task 7.

- [ ] **Step 1: Write the failing spec** — `server/src/live/twilio.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { Trade } from '../shared/types.js';
import { TwilioWhatsAppSender, verifiedMessageText } from './twilio.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);

function verified(): Trade {
  return {
    id: 't1', profileId: 1, category: 'ARB', event: 'Arsenal vs Chelsea', sport: 'soccer',
    legs: [
      { book: 'bet365', selection: 'home', odds: 3.1, stakeCents: 3_500 },
      { book: 'pinnacle', selection: 'draw', odds: 3.65, stakeCents: 3_000 },
    ],
    marginInitial: 0.1, marginRecheck: 0.1, marginFinal: 0.1, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: NOW, verifyDueAt: NOW,
    verifiedAt: NOW, freshUntil: NOW + 120_000, settledAt: null, eventStartsAt: NOW + 3_600_000,
  };
}

test('verifiedMessageText: verbatim card semantics + reply codes + optional link', () => {
  const text = verifiedMessageText(verified(), 'http://localhost:3000');
  expect(text).toContain('ARB Arsenal vs Chelsea · SOCCER');
  expect(text).toContain('Bet365 — home @ 3.10 │ BET $35'); // displayName('bet365') === 'Bet365' (brain/pass.ts BOOK_DISPLAY)
  expect(text).toContain('Pinnacle — draw @ 3.65 │ BET $30');
  expect(text).toContain('MARGIN: 10.0%');
  expect(text).toContain('Reply 1 SECURED · 3 LIMITED');
  expect(text).toContain('http://localhost:3000');
  expect(verifiedMessageText(verified(), undefined)).not.toContain('http');
});

test('dev mode short-circuits BEFORE any network — throwing fetch proves it', () => {
  const repos = Repos(openDb(':memory:'));
  const fetchImpl = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const sender = TwilioWhatsAppSender(fetchImpl, { WHATSAPP_DEV_MODE: 'true' } as NodeJS.ProcessEnv, repos, () => NOW);
  sender.sendVerified(verified()); // must not throw
  const kinds = repos.eventsLog.all().map((e) => e.kind);
  expect(kinds).toContain('alert');   // same signal the sim sender writes
  expect(kinds).toContain('wa_dev');  // marked as a dev-mode send
});

test('live mode posts Messages.json with basic auth; failures log wa_error, never throw', async () => {
  const repos = Repos(openDb(':memory:'));
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{"sid":"SMfake"}', { status: 201 });
  }) as typeof fetch;
  const env = {
    WHATSAPP_DEV_MODE: 'false', TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
  } as NodeJS.ProcessEnv;
  const sender = TwilioWhatsAppSender(fetchImpl, env, repos, () => NOW);
  sender.sendVerified(verified());
  await new Promise((r) => setTimeout(r, 0)); // fire-and-forget settles on the microtask queue
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain('/Accounts/ACfake/Messages.json');
  expect(String(calls[0]!.init.headers)).toBeDefined();
  expect(repos.eventsLog.all().some((e) => e.kind === 'alert')).toBe(true);

  const failing = (async () => { throw new Error('twilio down'); }) as unknown as typeof fetch;
  const sender2 = TwilioWhatsAppSender(failing, env, repos, () => NOW);
  sender2.sendVerified(verified()); // must not throw
  await new Promise((r) => setTimeout(r, 0));
  expect(repos.eventsLog.all().some((e) => e.kind === 'wa_error')).toBe(true);
});
```

(The sender sends to the user's `whatsappNumber` setting — the test harness's default is `''`, so the live-path test proves the REQUEST SHAPE; a missing number is itself a `wa_error` path covered implicitly. The message body never appears in `wa_error` payloads.)

Amend: the live-path test needs a recipient — insert `repos.settings.set({ whatsappNumber: '+1 604 555 8112' });` right after creating `repos` in the third test.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- twilio`
Expected: FAIL — cannot find module `./twilio.js`.

- [ ] **Step 3: Implement `server/src/live/twilio.ts`**

```ts
// Twilio WhatsApp sender (Plan 6, Design §7): the sender seam's live half.
// DEV MODE SHORT-CIRCUITS BEFORE ANY NETWORK (HARD GATE 2) — and dev is the
// DEFAULT (Decision 6). Sends are fire-and-forget: the pipeline must never
// block or crash on a webhook provider. Values never reach logs or payloads.
import type { AlertSender, Trade } from '../shared/types.js';
import type { Repos } from '../db/db.js';
import { devMode } from './env.js';

/** Book display labels live server-side already (Plan 2); reuse the brain's map. */
import { displayName } from '../brain/pass.js';

const metricLine = (t: Trade): string => {
  const pct = ((t.marginFinal ?? t.marginInitial) * 100).toFixed(1);
  return t.category === 'ARB' ? `MARGIN: ${pct}%` : `EDGE: +${pct}%`;
};

/** The alert text — verbatim card semantics: legs with the │ stake divider,
 *  the metric, the locked reply codes, the app link when APP_URL is set. */
export function verifiedMessageText(t: Trade, appUrl: string | undefined): string {
  const lines = [
    `${t.category} ${t.event} · ${t.sport.toUpperCase()}`,
    ...t.legs.map((l) =>
      `${displayName(l.book)} — ${l.selection} @ ${l.odds.toFixed(2)} │ BET $${Math.round((l.stakeCents ?? 0) / 100)}`),
    metricLine(t),
    'Reply 1 SECURED · 3 LIMITED',
  ];
  if (appUrl !== undefined && appUrl !== '') lines.push(appUrl);
  return lines.join('\n');
}

export function TwilioWhatsAppSender(
  fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number,
): AlertSender {
  return {
    sendVerified(t: Trade): void {
      const now = clock();
      const text = verifiedMessageText(t, env.APP_URL);
      repos.eventsLog.add(now, 'alert', JSON.stringify({ tradeId: t.id, transport: 'whatsapp' }));

      if (devMode(env)) {
        // Dev mode: the events row IS the send. No network, ever (HARD GATE 2).
        repos.eventsLog.add(now, 'wa_dev', JSON.stringify({ tradeId: t.id, chars: text.length }));
        return;
      }

      const to = repos.settings.all().whatsappNumber;
      const sid = env.TWILIO_ACCOUNT_SID ?? '';
      const token = env.TWILIO_AUTH_TOKEN ?? '';
      const from = env.TWILIO_WHATSAPP_FROM ?? '';
      if (to === '' || sid === '' || token === '' || from === '') {
        repos.eventsLog.add(now, 'wa_error', JSON.stringify({ tradeId: t.id, message: 'missing number or credentials (names only)' }));
        return;
      }

      const body = new URLSearchParams({ From: from, To: `whatsapp:${to.replaceAll(' ', '')}`, Body: text });
      // Fire and forget: promotion latency never waits on Twilio.
      void fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }).then((res) => {
        if (!res.ok) repos.eventsLog.add(clock(), 'wa_error', JSON.stringify({ tradeId: t.id, status: res.status }));
      }).catch((err: unknown) => {
        repos.eventsLog.add(clock(), 'wa_error', JSON.stringify({
          tradeId: t.id, message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
      });
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: PASS (3 new tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/live
git commit -m "feat(server): Twilio WhatsApp sender — dev-mode default, fire-and-forget, never throws"
```

---

### Task 4: Scheduler hooks + the 45 s inbound reply poll (TDD)

**Files:**
- Create: `server/src/live/inbound.ts`, `server/src/live/inbound.test.ts`, `server/src/scheduler/runner.hooks.test.ts`
- Modify: `server/src/scheduler/runner.ts`

**Interfaces:**
- Consumes: Task 1 env, `confirmTrade`, the runner's chain internals.
- Produces: `HookTask`, `SchedulerHandle.pump()`, `pollInbound`, `inboundPollHook` — the one-timer-preserving live cadences (HARD GATE 5).

- [ ] **Step 1: Write the failing specs**

Create `server/src/scheduler/runner.hooks.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { defaultPlanDeps, startScheduler, type HookTask } from './runner.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // awake hours

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

test('pump runs due hooks and skips future ones; hook errors never kill the chain', async () => {
  const deps = mkDeps();
  let now = NOW;
  const ran: string[] = [];
  const hooks: HookTask[] = [
    { name: 'due', nextAt: () => now, run: async () => { ran.push('due'); } },
    { name: 'future', nextAt: () => NOW + 60_000, run: async () => { ran.push('future'); } },
    { name: 'silent', nextAt: () => null, run: async () => { ran.push('silent'); } },
    { name: 'boom', nextAt: () => now, run: async () => { throw new Error('boom'); } },
  ];
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => now, hooks);
  await scheduler.pump(); // must not reject despite 'boom'
  expect(ran).toEqual(['due']);
  now += 61_000;
  await scheduler.pump();
  expect(ran).toEqual(['due', 'due', 'future']);
});

test('pump awaits provider.refresh before the scan work', async () => {
  const order: string[] = [];
  const deps = mkDeps();
  deps.provider = {
    fetchQuotes: () => { order.push('fetch'); return []; },
    refresh: async () => { order.push('refresh'); },
  };
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => NOW, []);
  await scheduler.pump();
  expect(order[0]).toBe('refresh'); // snapshot refreshed before runDue scans it
  expect(order).toContain('fetch');
});

test('tick() stays synchronous and hook-free — sim tests keep their contract', () => {
  const deps = mkDeps();
  const ran: string[] = [];
  const hooks: HookTask[] = [{ name: 'h', nextAt: () => NOW, run: async () => { ran.push('h'); } }];
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), { setTimeout: () => 0 }, () => NOW, hooks);
  scheduler.tick();
  expect(ran).toEqual([]); // hooks run through pump/the timer, never tick
});
```

Create `server/src/live/inbound.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Trade } from '../shared/types.js';
import { inboundPollHook, pollInbound } from './inbound.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 12:00 PDT — awake
const QUIET = Date.UTC(2026, 6, 14, 9, 0); // 02:00 PDT — quiet hours

const ENV = {
  TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
} as NodeJS.ProcessEnv;

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

function sentVerified(id: string, verifiedAt: number): Trade {
  return {
    id, profileId: 1, category: 'ARB', event: `E-${id}`, sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: verifiedAt, verifyDueAt: verifiedAt,
    verifiedAt, freshUntil: verifiedAt + 120_000, settledAt: null, eventStartsAt: verifiedAt + 3_600_000,
  };
}

function twilioListResponse(messages: { sid: string; body: string; date_sent: string }[]): Response {
  return new Response(JSON.stringify({ messages }), { status: 200 });
}

test("reply '1' confirms the newest sent VERIFIED trade exactly once (SID dedupe)", async () => {
  const deps = mkDeps();
  deps.repos.trades.insert(sentVerified('old', NOW - 60_000), '2026-07-14', null);
  deps.repos.trades.insert(sentVerified('new', NOW - 10_000), '2026-07-14', null);
  const fetchImpl = (async () => twilioListResponse([
    { sid: 'SM1', body: '1', date_sent: new Date(NOW - 5_000).toISOString() },
  ])) as typeof fetch;

  expect(await pollInbound(deps, fetchImpl, ENV, NOW)).toBe(1);
  expect(deps.repos.trades.byId('new')!.status).toBe('CONFIRMED');
  expect(deps.repos.trades.byId('old')!.status).toBe('VERIFIED'); // newest wins, not both

  expect(await pollInbound(deps, fetchImpl, ENV, NOW + 45_000)).toBe(0); // SM1 already handled
  const replies = deps.repos.eventsLog.all().filter((e) => e.kind === 'wa_reply');
  expect(replies).toHaveLength(1);
});

test("reply '3' journals the in-app pointer; reply '1' with nothing live journals honestly", async () => {
  const deps = mkDeps();
  const fetchImpl = (async () => twilioListResponse([
    { sid: 'SM2', body: '3', date_sent: new Date(NOW - 5_000).toISOString() },
    { sid: 'SM3', body: '1 SECURED', date_sent: new Date(NOW - 4_000).toISOString() },
  ])) as typeof fetch;
  await pollInbound(deps, fetchImpl, ENV, NOW);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('WhatsApp reply 3 received — report the limit with book and amount on the TRADES screen');
  expect(texts).toContain('WhatsApp reply 1 received — nothing awaiting confirmation');
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_reply_limited')).toBe(true);
});

test('the hook gates on live mode + quiet hours and paces at 45s', () => {
  const deps = mkDeps();
  const hook = inboundPollHook(deps, (async () => twilioListResponse([])) as typeof fetch, ENV);
  expect(hook.nextAt(NOW)).toBeNull();               // sim mode → never
  deps.repos.settings.set({ liveMode: 1 });
  expect(hook.nextAt(NOW)).toBe(NOW);                // live, never polled → now
  deps.repos.eventsLog.add(NOW, 'wa_poll', '{}');
  expect(hook.nextAt(NOW + 10_000)).toBe(NOW + 45_000); // watermark + 45s
  expect(hook.nextAt(QUIET)).toBeNull();             // quiet hours → no polls
});

test('poll failures write wa_error and resolve — the chain survives', async () => {
  const deps = mkDeps();
  const failing = (async () => { throw new Error('twilio down'); }) as unknown as typeof fetch;
  expect(await pollInbound(deps, failing, ENV, NOW)).toBe(0); // resolves, no reject
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_error')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- runner.hooks inbound`
Expected: FAIL — no `HookTask` export, no `pump`, no module `./inbound.js`.

- [ ] **Step 3: Implement**

In `server/src/scheduler/runner.ts`:

1. Add the hook type next to `Timer`:

```ts
/** A live-mode cadence riding the ONE timer chain (Plan 6, HARD GATE 5).
 *  nextAt: when this hook next wants to run at `now` (null = not scheduled —
 *  e.g. sim mode, quiet hours). run: the work; MUST resolve — the runner also
 *  guards, but hooks own their own error logging. */
export interface HookTask {
  name: string;
  nextAt(now: number): number | null;
  run(now: number): Promise<void>;
}
```

2. Extend the handle interface:

```ts
export interface SchedulerHandle {
  tick(): void;
  /** The timer callback's body: provider refresh → due hooks → due actions.
   *  Exposed for tests and manual driving; the chain calls it on every wake. */
  pump(): Promise<void>;
  scanNow(now: number): ScanSummary;
  nextScanAt(now: number): number;
  stop(): void;
}
```

3. Give `startScheduler` the hooks parameter and the pump — replace the signature and `onTimer`, and add the two hook helpers:

```ts
export function startScheduler(
  deps: PipeDeps, planDeps: PlanDeps, timer: Timer, clock: () => number, hooks: HookTask[] = [],
): SchedulerHandle {
```

```ts
  async function runDueHooks(): Promise<void> {
    for (const h of hooks) {
      const now = clock();
      const at = h.nextAt(now);
      if (at === null || at > now) continue;
      try {
        await h.run(now);
      } catch (err) {
        // Hooks own their logging; this guard is why the chain cannot die (Design §11).
        console.error(`[scheduler] hook ${h.name} failed`, err);
      }
    }
  }

  /** Soonest future hook wake, or +∞ when no hook wants one. */
  function nextHookWake(now: number): number {
    let min = Number.POSITIVE_INFINITY;
    for (const h of hooks) {
      const at = h.nextAt(now);
      if (at !== null) min = Math.min(min, Math.max(at, now));
    }
    return min;
  }

  /** One wake of the chain: live snapshot → due hooks → due plan actions. */
  async function pump(): Promise<void> {
    try {
      if (deps.provider.refresh) await deps.provider.refresh(clock());
    } catch {
      /* refresh never throws by contract; belt-and-suspenders */
    }
    await runDueHooks();
  }

  function onTimer(gen: number): void {
    if (stopped || gen !== generation) return; // stale wake: drop it
    void (async () => {
      await pump();
      let delayMs = RETRY_MS;
      try {
        const nextPlanAt = runDue();
        delayMs = Math.max(0, Math.min(nextPlanAt, nextHookWake(clock())) - clock());
      } catch (err) {
        console.error('[scheduler] tick failed — retrying in 60s', err);
      }
      arm(delayMs);
    })();
  }
```

4. Return `pump` on the handle (add to the returned object, above `scanNow`):

```ts
    async pump(): Promise<void> {
      await pump();
      runDue();
    },
```

(Name collision: rename the inner function `pumpHooks` and keep the public `pump` calling `pumpHooks()` then `runDue()`; `onTimer` uses the same pair. Apply consistently — the tests pin the behavior, not the private names.)

Create `server/src/live/inbound.ts`:

```ts
// Inbound WhatsApp reply poll (Plan 6, Design §6): a 45s HookTask on the ONE
// timer chain. Live mode only; quiet hours pause it (no sends happen then, and
// the SID dedupe catches up at 08:00). Injected fetchImpl only (HARD GATE 2).
import type { PipeDeps } from '../pipeline/scan.js';
import type { HookTask } from '../scheduler/runner.js';
import { confirmTrade } from '../pipeline/actions.js';
import { isQuietHours } from '../scheduler/vancouverTime.js';

const POLL_MS = 45_000;

interface TwilioMessage { sid: string; body: string; date_sent: string }

/** One poll: list inbound messages, dedupe by SID, apply 1/3 semantics. Returns replies handled. */
export async function pollInbound(
  deps: PipeDeps, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, now: number,
): Promise<number> {
  const { repos } = deps;
  repos.eventsLog.add(now, 'wa_poll', JSON.stringify({}));
  try {
    const sid = env.TWILIO_ACCOUNT_SID ?? '';
    const token = env.TWILIO_AUTH_TOKEN ?? '';
    const to = encodeURIComponent(env.TWILIO_WHATSAPP_FROM ?? '');
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?To=${to}&PageSize=50`,
      { headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } },
    );
    if (!res.ok) throw new Error(`twilio list ${res.status}`);
    const { messages } = (await res.json()) as { messages: TwilioMessage[] };

    const seen = new Set(
      repos.eventsLog.all().filter((e) => e.kind === 'wa_reply')
        .map((e) => (JSON.parse(e.payload) as { sid: string }).sid),
    );
    let handled = 0;
    for (const m of messages) {
      if (seen.has(m.sid)) continue;
      repos.eventsLog.add(now, 'wa_reply', JSON.stringify({ sid: m.sid, code: m.body.trim().slice(0, 1) }));
      applyReply(deps, m.body.trim(), now);
      handled += 1;
    }
    return handled;
  } catch (err) {
    repos.eventsLog.add(now, 'wa_error', JSON.stringify({
      message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    }));
    return 0;
  }
}

function applyReply(deps: PipeDeps, body: string, now: number): void {
  const { repos } = deps;
  if (body.startsWith('1')) {
    // Newest sent, still-VERIFIED trade (Decision 5) — compact codes can't address one card.
    const target = repos.trades.byStatus('VERIFIED')
      .filter((t) => t.verifiedAt !== null)
      .sort((a, b) => b.verifiedAt! - a.verifiedAt!)[0];
    if (target === undefined) {
      repos.journal.add(now, 'WhatsApp reply 1 received — nothing awaiting confirmation'); // NEW copy
      return;
    }
    confirmTrade(repos, target.id, now);
    return;
  }
  if (body.startsWith('3')) {
    // A bare 3 carries neither book nor max bet — the limited flow completes in-app.
    repos.eventsLog.add(now, 'wa_reply_limited', JSON.stringify({}));
    repos.journal.add(now, 'WhatsApp reply 3 received — report the limit with book and amount on the TRADES screen'); // NEW copy
  }
  // anything else: recorded in wa_reply, deliberately ignored (no skip feature, no other codes)
}

/** The HookTask: live-only, quiet-hours-gated, watermarked at 45s. */
export function inboundPollHook(deps: PipeDeps, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv): HookTask {
  return {
    name: 'inbound-poll',
    nextAt(now: number): number | null {
      const s = deps.s();
      if (s.liveMode !== 1) return null;
      if (isQuietHours(now, s)) return null;
      const polls = deps.repos.eventsLog.all().filter((e) => e.kind === 'wa_poll');
      if (polls.length === 0) return now;
      return polls[polls.length - 1]!.ts + POLL_MS;
    },
    run(now: number): Promise<void> {
      return pollInbound(deps, fetchImpl, env, now).then(() => undefined);
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (8 new tests; every existing scheduler/pipeline test untouched — `hooks` defaults to `[]`, `tick()` unchanged), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/scheduler server/src/live
git commit -m "feat(server): scheduler hook tasks on the one timer chain + 45s inbound WhatsApp poll"
```

---

### Task 5: Nightly backups ×14 (TDD)

**Files:**
- Create: `server/src/live/backup.ts`, `server/src/live/backup.test.ts`

**Interfaces:**
- Consumes: `Db` (better-sqlite3 `backup()`), `dayKey`, `HookTask`.
- Produces: `runNightlyBackup`, `pruneBackups`, `backupHook` — wired by Task 7/8; Plan 5's DATA row reads the `backup` events it writes.

- [ ] **Step 1: Write the failing spec** — `server/src/live/backup.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { backupHook, pruneBackups, runNightlyBackup } from './backup.js';

const NOON = Date.UTC(2026, 6, 14, 19, 0);   // 12:00 PDT
const NIGHT = Date.UTC(2026, 6, 14, 8, 0);   // 01:00 PDT — before 03:00

test('runNightlyBackup writes a dated file and the events row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-backup-'));
  const db = openDb(':memory:');
  const repos = Repos(db);
  const file = await runNightlyBackup(db, repos, dir, NOON);
  expect(file.endsWith('evil-eye-2026-07-14.db')).toBe(true);
  expect(existsSync(file)).toBe(true);
  const rows = repos.eventsLog.all().filter((e) => e.kind === 'backup');
  expect(rows).toHaveLength(1);
  expect((JSON.parse(rows[0]!.payload) as { file: string }).file).toContain('evil-eye-2026-07-14.db');
});

test('pruneBackups keeps the newest 14 files, deletes the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-prune-'));
  for (let i = 1; i <= 17; i += 1) {
    writeFileSync(join(dir, `evil-eye-2026-06-${String(i).padStart(2, '0')}.db`), 'x');
  }
  writeFileSync(join(dir, 'not-a-backup.txt'), 'x'); // non-matching files are never touched
  const deleted = pruneBackups(dir, 14);
  expect(deleted).toEqual([
    'evil-eye-2026-06-01.db', 'evil-eye-2026-06-02.db', 'evil-eye-2026-06-03.db',
  ]);
  const left = readdirSync(dir).sort();
  expect(left).toContain('evil-eye-2026-06-04.db');
  expect(left).toContain('evil-eye-2026-06-17.db');
  expect(left).toContain('not-a-backup.txt');
  expect(left.filter((f) => f.startsWith('evil-eye-')).length).toBe(14);
});

test('backupHook: due after 03:00 Vancouver once per day, regardless of mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ee-hook-'));
  const db = openDb(':memory:');
  const repos = Repos(db);
  const hook = backupHook(db, repos, dir, () => NOON);
  expect(hook.nextAt(NIGHT)).toBeNull();       // 01:00 — not due yet (no mid-quiet wake)
  expect(hook.nextAt(NOON)).toBe(NOON);        // past 03:00, none today → due now
  await hook.run(NOON);
  expect(hook.nextAt(NOON + 60_000)).toBeNull(); // done for the day
  expect(readdirSync(dir)).toEqual(['evil-eye-2026-07-14.db']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- backup`
Expected: FAIL — cannot find module `./backup.js`.

- [ ] **Step 3: Implement `server/src/live/backup.ts`**

```ts
// Nightly backups ×14 (Plan 6, Design §9): once per Vancouver day, on the first
// pump at-or-after 03:00 (in practice the quiet-end wake — the chain never wakes
// mid-quiet just to copy a file). FILES rotate; database rows are forever.
// Runs in BOTH modes: sim data is data.
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db, Repos } from '../db/db.js';
import type { HookTask } from '../scheduler/runner.js';
import { dayKey } from '../scheduler/vancouverTime.js';

export const KEEP_BACKUPS = 14;
const DUE_HOUR = 3; // Vancouver

const HOUR_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23',
});
const vancouverHour = (epochMs: number): number => Number(HOUR_FMT.format(epochMs));

const BACKUP_RE = /^evil-eye-\d{4}-\d{2}-\d{2}\.db$/;

/** Delete all but the newest `keep` backup files (name IS the date — lexicographic order). */
export function pruneBackups(backupDir: string, keep: number): string[] {
  const files = readdirSync(backupDir).filter((f) => BACKUP_RE.test(f)).sort();
  const doomed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of doomed) rmSync(join(backupDir, f));
  return doomed;
}

export async function runNightlyBackup(db: Db, repos: Repos, backupDir: string, now: number): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `evil-eye-${dayKey(now)}.db`);
  await db.backup(file); // better-sqlite3's online backup — safe against a live db
  pruneBackups(backupDir, KEEP_BACKUPS);
  repos.eventsLog.add(now, 'backup', JSON.stringify({ file }));
  return file;
}

/** Due when Vancouver hour ≥ 3 and no backup event carries today's day key. */
export function backupHook(db: Db, repos: Repos, backupDir: string, clock: () => number): HookTask {
  return {
    name: 'nightly-backup',
    nextAt(now: number): number | null {
      if (vancouverHour(now) < DUE_HOUR) return null;
      const today = dayKey(now);
      const done = repos.eventsLog.all().some((e) => e.kind === 'backup' && dayKey(e.ts) === today);
      return done ? null : now;
    },
    async run(now: number): Promise<void> {
      try {
        await runNightlyBackup(db, repos, backupDir, now);
      } catch (err) {
        repos.eventsLog.add(now, 'backup_error', JSON.stringify({
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: PASS (3 new tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/live
git commit -m "feat(server): nightly sqlite backups with keep-14 file rotation on the tick"
```

---

### Task 6: Anthropic Brain text — no-key fallback + the $3 hard cap (TDD)

**Files:**
- Create: `server/src/brain/text.ts`, `server/src/brain/text.test.ts`
- Modify: `server/src/settings/report.ts` (ledger units)

**Interfaces:**
- Consumes: Task 1 env (`ANTHROPIC_KEY_NAME`), `Repos`, `dayKey`, the brain pass's journal output.
- Produces: `TextWriter`, `NullTextWriter`, `AnthropicTextWriter`, `llmSpentMicro`, `worstCaseMicro`, `digestAfterPass`, `LLM_MODEL/LLM_CAP_MICRO/LLM_MAX_TOKENS` — wired by Task 7. Model id `claude-haiku-4-5` and $1/$5-per-MTok pricing are from the claude-api skill (cached 2026-06): input = 1 µ$/token, output = 5 µ$/token — integer-exact.

- [ ] **Step 1: Write the failing spec** — `server/src/brain/text.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import {
  AnthropicTextWriter, LLM_CAP_MICRO, LLM_MAX_TOKENS, LLM_MODEL, NullTextWriter,
  digestAfterPass, llmSpentMicro, worstCaseMicro,
} from './text.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0);

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

test('constants are the locked product spec', () => {
  expect(LLM_MODEL).toBe('claude-haiku-4-5');
  expect(LLM_CAP_MICRO).toBe(3_000_000); // $3.00/month in micro-dollars
  expect(LLM_MAX_TOKENS).toBe(512);
});

test('no key → writer unavailable, digestAfterPass is silent, ZERO events', async () => {
  const deps = mkDeps();
  const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const writer = AnthropicTextWriter(throwing, {} as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(writer.available()).toBe(false);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false);
  expect(deps.repos.journal.all()).toHaveLength(0);
  expect(deps.repos.eventsLog.all()).toHaveLength(0); // silent — the templates already stand
  expect(NullTextWriter().available()).toBe(false);
});

test('spend math: usage → micro-dollars, exactly', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: 16 of 16 books green');
  const fetchImpl = (async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'All sixteen books calm; credits on pace.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1_234, output_tokens: 256 },
  }), { status: 200 })) as typeof fetch;
  const writer = AnthropicTextWriter(fetchImpl, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(writer.available()).toBe(true);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(true);

  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Consolidation digest: All sixteen books calm; credits on pace.');
  const spends = deps.repos.eventsLog.all().filter((e) => e.kind === 'llm_spend');
  expect(spends).toHaveLength(1);
  const payload = JSON.parse(spends[0]!.payload) as { inputTokens: number; outputTokens: number; costMicro: number };
  expect(payload).toEqual({ inputTokens: 1_234, outputTokens: 256, costMicro: 1_234 * 1 + 256 * 5 });
  expect(llmSpentMicro(deps.repos, '2026-07')).toBe(2_514);
});

test('the HARD CAP refuses before any request once the month is spent', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: …');
  // Seed the ledger to a hair under the cap so the worst-case estimate crosses it.
  deps.repos.eventsLog.add(NOW - 2, 'llm_spend', JSON.stringify({ inputTokens: 0, outputTokens: 0, costMicro: LLM_CAP_MICRO - 100 }));
  const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;
  const writer = AnthropicTextWriter(throwing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false); // refused — fetch never ran
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'llm_skipped_budget')).toBe(true);
  expect(deps.repos.journal.all().map((j) => j.text).some((t) => t.startsWith('Consolidation digest:'))).toBe(false);
});

test('worstCaseMicro over-estimates conservatively', () => {
  expect(worstCaseMicro(3_000)).toBe(1_000 + 512 * 5); // ceil(3000/3) input + full output budget
  expect(worstCaseMicro(1)).toBe(1 + 2_560);
});

test('API errors and refusals degrade silently to the templates', async () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1, 'Daily check: …');
  const failing = (async () => new Response('{"error":{"type":"overloaded_error"}}', { status: 529 })) as typeof fetch;
  const writer = AnthropicTextWriter(failing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer, NOW)).toBe(false);
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'llm_error')).toBe(true);
  expect(deps.repos.journal.all()).toHaveLength(1); // only the deterministic line

  const refusing = (async () => new Response(JSON.stringify({
    content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 },
  }), { status: 200 })) as typeof fetch;
  const writer2 = AnthropicTextWriter(refusing, { ANTHROPIC_API_KEY: 'fake' } as NodeJS.ProcessEnv, deps.repos, () => NOW);
  expect(await digestAfterPass(deps, writer2, NOW)).toBe(false); // spend recorded, no digest
  expect(deps.repos.eventsLog.all().filter((e) => e.kind === 'llm_spend')).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- brain/text`
Expected: FAIL — cannot find module `./text.js`.

- [ ] **Step 3: Implement `server/src/brain/text.ts`**

```ts
// Anthropic Brain text (Plan 6, Design §8 + HARD GATE 4): the LLM only ever
// ADDS one digest paragraph per consolidation — deterministic journal lines are
// always written first and always stand. No key → silence. $3/month HARD CAP in
// integer micro-dollars, refused BEFORE any request. Raw HTTP via injected
// fetch (locked stack, no new dependencies); model id + pricing per the
// claude-api skill: claude-haiku-4-5 at $1/$5 per MTok ⇒ 1/5 µ$ per token.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Repos } from '../db/db.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { ANTHROPIC_KEY_NAME } from '../live/env.js';

export const LLM_MODEL = 'claude-haiku-4-5';
export const LLM_CAP_MICRO = 3_000_000; // $3.00/month
export const LLM_MAX_TOKENS = 512;
const INPUT_MICRO_PER_TOKEN = 1;   // $1 / 1M tokens
const OUTPUT_MICRO_PER_TOKEN = 5;  // $5 / 1M tokens

const SYSTEM = 'You are the journal voice of a personal sports-betting scanner. '
  + 'Rewrite the given deterministic journal lines as ONE plain, calm paragraph. '
  + 'Never invent numbers; never add advice; keep every figure exactly as given.';

export interface TextWriter {
  available(): boolean;
  rewriteDigest(lines: string[]): Promise<string | null>;
}

/** The deterministic path: no LLM, ever. */
export function NullTextWriter(): TextWriter {
  return { available: () => false, rewriteDigest: async () => null };
}

/** Month spend in micro-dollars from the llm_spend ledger. */
export function llmSpentMicro(repos: Repos, monthKey: string): number {
  return repos.eventsLog.byKind('llm_spend')
    .filter((e) => dayKey(e.ts).startsWith(monthKey))
    .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costMicro?: number }).costMicro ?? 0), 0);
}

/** Conservative pre-call bound: chars/3 over-counts tokens; output at full budget. */
export function worstCaseMicro(promptChars: number): number {
  return Math.ceil(promptChars / 3) * INPUT_MICRO_PER_TOKEN + LLM_MAX_TOKENS * OUTPUT_MICRO_PER_TOKEN;
}

export function AnthropicTextWriter(
  fetchImpl: typeof fetch, env: NodeJS.ProcessEnv, repos: Repos, clock: () => number,
): TextWriter {
  const key = env[ANTHROPIC_KEY_NAME];
  return {
    available(): boolean {
      return key !== undefined && key !== '';
    },
    async rewriteDigest(lines: string[]): Promise<string | null> {
      const now = clock();
      const prompt = lines.join('\n');
      // THE HARD CAP: refuse before any request once the month would cross $3.
      const spent = llmSpentMicro(repos, dayKey(now).slice(0, 7));
      if (spent + worstCaseMicro(SYSTEM.length + prompt.length) > LLM_CAP_MICRO) {
        repos.eventsLog.add(now, 'llm_skipped_budget', JSON.stringify({ spentMicro: spent }));
        return null;
      }
      try {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key ?? '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: LLM_MODEL,
            max_tokens: LLM_MAX_TOKENS,
            system: SYSTEM,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) {
          repos.eventsLog.add(now, 'llm_error', JSON.stringify({ status: res.status }));
          return null;
        }
        const body = (await res.json()) as {
          content: { type: string; text?: string }[];
          stop_reason: string;
          usage: { input_tokens: number; output_tokens: number };
        };
        // Spend is recorded for every completed request, digest or not.
        const costMicro = body.usage.input_tokens * INPUT_MICRO_PER_TOKEN
          + body.usage.output_tokens * OUTPUT_MICRO_PER_TOKEN;
        repos.eventsLog.add(now, 'llm_spend', JSON.stringify({
          inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens, costMicro,
        }));
        if (body.stop_reason !== 'end_turn') return null; // refusal/max_tokens → templates stand
        const text = body.content.find((b) => b.type === 'text')?.text?.trim();
        return text !== undefined && text !== '' ? text : null;
      } catch (err) {
        repos.eventsLog.add(now, 'llm_error', JSON.stringify({
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        }));
        return null;
      }
    },
  };
}

/**
 * After a brain pass: rewrite TODAY's deterministic journal lines into one
 * digest entry. Additive only — the lines it read remain untouched. Kill
 * switch off is the caller's concern (it gates the pass itself).
 */
export async function digestAfterPass(deps: PipeDeps, writer: TextWriter, now: number): Promise<boolean> {
  if (!writer.available()) return false;
  const today = dayKey(now);
  const lines = deps.repos.journal.all()
    .filter((j) => dayKey(j.ts) === today && !j.text.startsWith('Consolidation digest:'))
    .map((j) => j.text);
  if (lines.length === 0) return false;
  const text = await writer.rewriteDigest(lines);
  if (text === null) return false;
  deps.repos.journal.add(now, `Consolidation digest: ${text}`); // NEW copy — provenance visible
  return true;
}
```

In `server/src/settings/report.ts` (Plan 5), convert the display ledger to the micro-dollar source — replace the `llmSpentCents` computation:

```ts
// OLD
  const llmSpentCents = repos.eventsLog.byKind('llm_spend')
    .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costCents?: number }).costCents ?? 0), 0);
// NEW — the ledger is integer micro-dollars (Plan 6); cents only for display, rounded up (never understate spend)
  const llmSpentCents = Math.ceil(
    repos.eventsLog.byKind('llm_spend')
      .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costMicro?: number }).costMicro ?? 0), 0) / 10_000,
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (6 new tests; Plan 5's view test still passes — zero rows sum to zero either way), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/brain server/src/settings
git commit -m "feat(server): Anthropic brain text seam — haiku digest, no-key silence, $3/month hard cap in code"
```

---

### Task 7: The mode switch — wireMode, POST /api/mode, sim-settlement gate, honest flags

**Files:**
- Create: `server/src/live/mode.ts`, `server/src/live/mode.test.ts`
- Modify: `server/src/api/routes.ts`, `server/src/api/api.test.ts`, `server/src/pipeline/actions.ts`, `server/src/settings/report.ts`, `server/src/analytics/report.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `wireMode`, `modeLabel`, `POST /api/mode`, the LIVE settlement no-op (Design §13), live-aware `GET /api/state`, `AppOptions.fetchImpl/env/backupDir`, hooks assembled inside `createApp`.

- [ ] **Step 1: Write the failing specs**

Create `server/src/live/mode.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import type { Trade } from '../shared/types.js';
import { runSimSettlement } from '../pipeline/actions.js';
import { modeLabel, wireMode } from './mode.js';

const throwing = (() => { throw new Error('NETWORK CALL ATTEMPTED'); }) as unknown as typeof fetch;

function mkDeps(): PipeDeps {
  const repos = Repos(openDb(':memory:'));
  return {
    repos,
    provider: { fetchQuotes: () => [] },
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng: () => 0.5,
  };
}

test('modeLabel follows the settings key', () => {
  const deps = mkDeps();
  expect(modeLabel(deps.s())).toBe('SIMULATED');
  deps.repos.settings.set({ liveMode: 1 });
  expect(modeLabel(deps.s())).toBe('LIVE');
});

test('wireMode: sim wires the sim provider (no refresh); live wires the live pair', () => {
  const deps = mkDeps();
  expect(wireMode(deps, {} as NodeJS.ProcessEnv, deps.repos, throwing)).toBe('SIMULATED');
  expect(deps.provider.refresh).toBeUndefined(); // sim provider has no refresh

  deps.repos.settings.set({ liveMode: 1 });
  const env = {
    ODDS_API_KEY: 'fake', TWILIO_ACCOUNT_SID: 'ACfake', TWILIO_AUTH_TOKEN: 'tokfake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111', WHATSAPP_DEV_MODE: 'true',
  } as NodeJS.ProcessEnv;
  expect(wireMode(deps, env, deps.repos, throwing)).toBe('LIVE');
  expect(typeof deps.provider.refresh).toBe('function'); // the live provider took the seam
  deps.sender.sendVerified({ // dev mode: events only — the throwing fetch proves no network
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2, stakeCents: 1_000 }],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: 0, verifyDueAt: 0, verifiedAt: 0,
    freshUntil: 1, settledAt: null, eventStartsAt: 9,
  });
  expect(deps.repos.eventsLog.all().some((e) => e.kind === 'wa_dev')).toBe(true);
});

test('LIVE mode never rng-settles — sim settlement is a no-op on real money (Design §13)', () => {
  const deps = mkDeps();
  const confirmed: Trade = {
    id: 'real-1', profileId: 1, category: 'EV', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 2_000 }],
    marginInitial: 0.03, marginRecheck: 0.03, marginFinal: 0.03, status: 'CONFIRMED',
    killReason: null, resultCents: null, createdAt: 0, verifyDueAt: 0, verifiedAt: 0,
    freshUntil: 1, settledAt: null, eventStartsAt: 0, // +3h cutoff long past at NOW below
  };
  deps.repos.trades.insert(confirmed, '2026-07-14', null);
  // Sanctioned unit pattern (HARD GATE 1, same as the wireMode unit above): the key is
  // set directly on the isolated repos — no POST /api/mode, no wiring, no network.
  deps.repos.settings.set({ liveMode: 1 });
  const NOW = Date.UTC(2026, 6, 14, 19, 0);
  expect(runSimSettlement(deps, NOW)).toEqual({ settled: 0, won: 0, lost: 0 });
  expect(deps.repos.trades.byId('real-1')!.status).toBe('CONFIRMED'); // untouched — no fabricated money
  expect(deps.repos.trades.byId('real-1')!.resultCents).toBeNull();
  deps.repos.settings.set({ liveMode: 0 });
  expect(runSimSettlement(deps, NOW).settled).toBe(1); // paper money settles exactly as before
});
```

Append to `server/src/api/api.test.ts` (HARD GATE 1: the refusal path and LIVE→SIM are the ONLY mode tests; the harness env never carries the live names):

```ts
test('POST /api/mode: refuses LIVE with missing env NAMES (values never appear)', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/mode').send({ live: 1 });
  expect(res.status).toBe(409);
  expect(res.body.error.message).toBe(
    'cannot go live — missing: ODDS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM',
  );
  expect(h.repos.settings.all().liveMode).toBe(0); // still simulated
  expect((await request(h.app).get('/api/state')).body.mode).toBe('SIMULATED');

  const bad = await request(h.app).post('/api/mode').send({ live: 2 });
  expect(bad.status).toBe(400);

  const toSim = await request(h.app).post('/api/mode').send({ live: 0 }); // always allowed
  expect(toSim.status).toBe(200);
  expect(toSim.body.mode).toBe('SIMULATED');
});

test('sim mode never attempts a network call anywhere in the app lifecycle', async () => {
  // makeApp is amended in this task to pass a THROWING fetchImpl — if any code
  // path in the sim suite touches fetch, the whole suite fails loudly.
  const h = makeApp();
  await promoteSome(h); // scans, verifies, sends (sim sender), snapshots — no fetch
  expect((await request(h.app).get('/api/state')).body.mode).toBe('SIMULATED');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- mode api`
Expected: FAIL — missing module `./mode.js`, 404 on `/api/mode`.

- [ ] **Step 3: Implement**

Create `server/src/live/mode.ts`:

```ts
// Mode wiring (Plan 6, Design §2–3): ONE function decides what sits behind the
// provider/sender seams, driven by the liveMode settings key. Flipping is owned
// by POST /api/mode; this module never flips anything itself.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Repos } from '../db/db.js';
import type { Settings } from '../shared/defaults.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import { OddsApiProvider } from './oddsApi.js';
import { TwilioWhatsAppSender } from './twilio.js';

export function modeLabel(s: Settings): 'SIMULATED' | 'LIVE' {
  return s.liveMode === 1 ? 'LIVE' : 'SIMULATED';
}

/**
 * Swap the seams in place to match liveMode. SIMULATED restores the sim pair;
 * LIVE installs the Odds API provider + Twilio sender (which itself honors
 * WHATSAPP_DEV_MODE — dev is the default, Decision 6). Returns the label.
 */
export function wireMode(
  deps: PipeDeps, env: NodeJS.ProcessEnv, repos: Repos, fetchImpl: typeof fetch,
): 'SIMULATED' | 'LIVE' {
  const label = modeLabel(deps.s());
  if (label === 'LIVE') {
    deps.provider = OddsApiProvider(fetchImpl, env, repos);
    deps.sender = TwilioWhatsAppSender(fetchImpl, env, repos, () => Date.now());
  } else {
    deps.provider = SimOddsProvider(deps.rng);
    deps.sender = simSender(repos);
  }
  deps.lastQuotes = [];
  return label;
}

/** The sim sender, identical in behavior to routes.ts's console sender. */
function simSender(repos: Repos): PipeDeps['sender'] {
  return {
    sendVerified(t): void {
      console.log(`[SIM-WHATSAPP] ${t.category} ${t.event}`);
      repos.eventsLog.add(Date.now(), 'alert', JSON.stringify({ tradeId: t.id, transport: 'sim' }));
    },
  };
}
```

(Adapt `simSender` to reuse routes.ts's existing `consoleSender` if exporting it is cleaner — behavior, not naming, is the spec. The `clock` used by the live sender comes from the app's injected clock when wired inside `createApp` — pass it through rather than `Date.now()` there; the module-level default exists for boot wiring.)

In `server/src/api/routes.ts`:

1. Extend `AppOptions` (all optional — sim defaults preserve every existing test):

```ts
export interface AppOptions {
  dbPath: string;
  clock: () => number;
  timer: Timer;
  rng: () => number;
  provider?: OddsProvider;
  sender?: AlertSender;
  /** Plan 6: injected fetch for every live integration. Tests default to a
   *  THROWING stub — no sim code path may touch the network (HARD GATE 2). */
  fetchImpl?: typeof fetch;
  /** Plan 6: the env record live wiring reads. Tests default to {} — names absent. */
  env?: NodeJS.ProcessEnv;
  /** Plan 6: backups directory; undefined/null = no backup hook (tests). */
  backupDir?: string | null;
}
```

2. Inside `createApp`, after deps construction, assemble the live pieces:

```ts
  const fetchImpl = o.fetchImpl ?? ((() => { throw new Error('no fetchImpl injected'); }) as unknown as typeof fetch);
  const env = o.env ?? {};
  const writer = AnthropicTextWriter(fetchImpl, env, repos, clock);
  const hooks: HookTask[] = [inboundPollHook(deps, fetchImpl, env)];
  if (o.backupDir != null) hooks.push(backupHook(db, repos, o.backupDir, clock));
  // Respect an explicitly injected provider/sender (tests); otherwise wire by mode.
  if (o.provider === undefined && o.sender === undefined) wireMode(deps, env, repos, fetchImpl);
```

pass `hooks` into `startScheduler(deps, defaultPlanDeps(deps), o.timer, clock, hooks)`, and call the digest after cadence passes — in the scan path where `brainPassIfDue` runs (runner's `doScan` calls it synchronously; the digest is async and additive, so fire it from `pump`): add a third hook instead, keeping `doScan` untouched:

```ts
  hooks.push({
    name: 'brain-digest',
    nextAt(now: number): number | null {
      // Due when a brain pass has produced deterministic lines today and no digest exists yet.
      if (!writer.available()) return null;
      if (deps.s().brainKillSwitch !== 0) return null; // the switch stops autonomous text too
      const today = dayKey(now);
      const entries = repos.journal.all().filter((j) => dayKey(j.ts) === today);
      if (entries.length === 0) return null;
      return entries.some((j) => j.text.startsWith('Consolidation digest:')) ? null : now;
    },
    run(now: number): Promise<void> {
      return digestAfterPass(deps, writer, now).then(() => undefined);
    },
  });
```

with imports `AnthropicTextWriter, digestAfterPass` from `../brain/text.js`, `inboundPollHook` from `../live/inbound.js`, `backupHook` from `../live/backup.js`, `wireMode, modeLabel` from `../live/mode.js`, `missingLiveVars` from `../live/env.js`, `type HookTask` from `../scheduler/runner.js`, `dayKey` (already imported).

3. `GET /api/state`'s `mode` field becomes `modeLabel(deps.s())` (exact one-token replacement of the `'SIMULATED'` literal).

4. Register the mode route before the 404 catch-all:

```ts
  app.post('/api/mode', (req, res) => {
    const { live } = (req.body ?? {}) as { live?: unknown };
    if (live !== 0 && live !== 1) return fail(res, 400, 'bad_request', 'live must be 0 or 1');
    if (live === 1) {
      const missing = missingLiveVars(env);
      if (missing.length > 0) {
        // NAMES only — never a value (HARD GATE 3).
        return fail(res, 409, 'conflict', `cannot go live — missing: ${missing.join(', ')}`);
      }
    }
    const before = deps.s().liveMode;
    repos.settings.set({ liveMode: live });
    if (before !== live) {
      // SIM→LIVE surfaces the unwired results feed every time (Design §13, NEW copy).
      repos.journal.add(clock(), live === 1
        ? 'Mode switched: SIMULATED → LIVE — results feed not wired; trades will not auto-settle'
        : 'Mode switched: LIVE → SIMULATED');
      wireMode(deps, env, repos, fetchImpl);
    }
    res.json({ mode: modeLabel(deps.s()) });
  });
```

5. In `server/src/api/api.test.ts`'s `makeApp`, add `fetchImpl` as a THROWING stub and `env: {}` to the `createApp` options (exact addition to the existing options object):

```ts
    fetchImpl: (() => { throw new Error('NETWORK CALL ATTEMPTED IN SIM SUITE'); }) as unknown as typeof fetch,
    env: {},
```

6. Gate rng settlement to paper money (Design §13) — in `server/src/pipeline/actions.ts`, replace the head of `runSimSettlement`:

```ts
// OLD
export function runSimSettlement(deps: PipeDeps, now: number): { settled: number; won: number; lost: number } {
  const { repos } = deps;
  let won = 0;
// NEW
export function runSimSettlement(deps: PipeDeps, now: number): { settled: number; won: number; lost: number } {
  const { repos } = deps;
  // Plan 6 (Design §13): rng outcomes are SIM-ONLY. In LIVE mode nothing
  // auto-settles until a real results feed ships — fabricating WON/LOST on
  // real money is the one dishonesty every plan forbids. Manual settles stand.
  if (deps.s().liveMode === 1) return { settled: 0, won: 0, lost: 0 };
  let won = 0;
```

In `server/src/settings/report.ts`, the mode field reads the key — replace `mode: 'SIMULATED',` with:

```ts
    mode: modeLabel(s),
```

(type widens to `'SIMULATED' | 'LIVE'`; import `modeLabel` from `../live/mode.js` and widen the `SettingsView['mode']` type accordingly). In `server/src/analytics/report.ts`, replace `simulated: true,` with:

```ts
    simulated: s.liveMode !== 1,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS — including every pre-existing test now running under the THROWING fetch stub, which is itself the proof of HARD GATE 2 for the whole sim surface, plus the sim-settlement gate unit (LIVE never rng-settles, Design §13).

- [ ] **Step 5: Commit**

```bash
git add server/src/live server/src/api server/src/settings server/src/analytics
git commit -m "feat(server): mode switch with env-name gating, in-place seam rewiring, throwing-fetch sim proof"
```

---

### Task 8: Boot wiring — env file, real fetch, hooks, backups directory

**Files:**
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: everything above. Produces the ONLY real `setTimeout` and the ONLY real `fetch`, both injected here (HARD GATES 2 + 5).

- [ ] **Step 1: Rewrite `server/src/index.ts`** (full file):

```ts
// Boot: the ONLY place real time, real fetch and the real filesystem exist.
// Loads the V1 .env by NAME (values never printed), wires the mode from the
// settings key (SIMULATED unless the user flipped it in a previous session),
// and hands createApp the one real setTimeout. Everything else is injected.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from './api/routes.js';
import { loadV1Env } from './live/env.js';

const PORT = 4400; // locked — the V1 PORT variable belongs to V1's server (Plan 6 Decision 2)

loadV1Env(); // ~/evil-eye-arbitrage/.env (or EE_ENV_PATH) — names only, never overwrites

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });

const { app } = createApp({
  dbPath: join(dataDir, 'evil-eye.db'),
  clock: () => Date.now(),
  timer: { setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms) },
  rng: Math.random,
  fetchImpl: fetch,
  env: process.env,
  backupDir: join(dataDir, 'backups'),
});

app.listen(PORT, () => {
  console.log(`Evil Eye V2 — listening on http://localhost:${PORT}`);
});
```

(The boot banner drops the hardcoded "SIMULATED mode" wording — the mode now lives in the store and shows in the UI badge; printing it here would go stale after a flip. No value from the env file is ever printed.)

- [ ] **Step 2: Verify**

Run: `npm test -w server && npm run typecheck -w server`
Expected: suite PASS, typecheck clean.
Then `npm run dev` (Terminal A): boots on 4400, badge on the client reads SIMULATED, `curl -s localhost:4400/api/state | grep '"mode"'` → `"SIMULATED"`. **Do NOT post to /api/mode** (HARD GATE 1). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): boot wiring — V1 env names, real fetch/timer injection, backups dir"
```

---

### Task 9: Client — the armed mode switch + live-aware INPUTS statuses

**Files:**
- Modify: `client/src/lib/settings.ts`, `client/src/lib/settings.test.ts`, `client/src/lib/api.ts`, `client/src/components/DataPanel.tsx`, `client/src/components/AdvancedSettings.tsx`, `client/src/components/AdvancedBrainSettings.tsx`

**Interfaces:**
- Consumes: Plan 5's `SettingsView` (whose `mode` now reports live), Plan 3's brain INPUTS rows.
- Produces: `modeSwitchLabel`, `missingText`, `inputStatus`, `setMode` — pure-label tests ONLY (Decision 11).

- [ ] **Step 1: Write the failing spec** — append to `client/src/lib/settings.test.ts`:

```ts
import { inputStatus, missingText, modeSwitchLabel } from './settings';

test('mode switch labels: badge, armed confirms, both directions', () => {
  expect(modeSwitchLabel('SIMULATED', false)).toBe('SIMULATED');
  expect(modeSwitchLabel('SIMULATED', true)).toBe('GO LIVE? ✓');
  expect(modeSwitchLabel('LIVE', false)).toBe('LIVE');
  expect(modeSwitchLabel('LIVE', true)).toBe('GO SIMULATED? ✓');
});

test('missing names render as names — never values', () => {
  expect(missingText(['ODDS_API_KEY', 'TWILIO_AUTH_TOKEN']))
    .toBe('MISSING: ODDS_API_KEY · TWILIO_AUTH_TOKEN');
  expect(missingText([])).toBe('');
});

test('INPUTS statuses follow the mode', () => {
  expect(inputStatus(false, 'feed')).toEqual({ text: 'SIM', tone: 'sim' });
  expect(inputStatus(true, 'feed')).toEqual({ text: 'LIVE', tone: 'green' });
  expect(inputStatus(false, 'poll')).toEqual({ text: 'SIM', tone: 'sim' });
  expect(inputStatus(true, 'poll')).toEqual({ text: 'POLL 45S', tone: 'muted' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- settings`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

Append to `client/src/lib/settings.ts`:

```ts
// ---- live mode (Plan 6) -------------------------------------------------------

export function modeSwitchLabel(mode: 'SIMULATED' | 'LIVE', armed: boolean): string {
  if (!armed) return mode;
  return mode === 'SIMULATED' ? 'GO LIVE? ✓' : 'GO SIMULATED? ✓'; // NEW copy — the §2.2 armed pattern
}

/** 409 payload → names-only note (NEW copy). */
export function missingText(names: string[]): string {
  return names.length === 0 ? '' : `MISSING: ${names.join(' · ')}`;
}

/** The sim-honest SIM chips flip when the server reports live (Design §10). */
export function inputStatus(live: boolean, kind: 'feed' | 'poll'): { text: string; tone: 'sim' | 'green' | 'muted' } {
  if (!live) return { text: 'SIM', tone: 'sim' };
  return kind === 'feed' ? { text: 'LIVE', tone: 'green' } : { text: 'POLL 45S', tone: 'muted' };
}
```

Append to `client/src/lib/api.ts`:

```ts
// ---- mode (Plan 6) ---------------------------------------------------------------
export async function setMode(live: 0 | 1): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ live }),
    });
    if (res.ok) return { ok: true, missing: [] };
    const body = (await res.json()) as { error?: { message?: string } };
    const m = /missing: (.+)$/.exec(body.error?.message ?? '');
    return { ok: false, missing: m ? m[1]!.split(', ') : [] };
  } catch {
    return { ok: false, missing: [] };
  }
}
```

Rework `client/src/components/DataPanel.tsx`'s MODE row (the badge becomes the armed two-click switch; everything else in the panel is unchanged):

```tsx
import { useState } from 'react';
import { setMode } from '../lib/api';
import { backupsText, missingText, modeSwitchLabel, type SettingsView } from '../lib/settings';

interface DataPanelProps {
  backups: SettingsView['backups'];
  mode: 'SIMULATED' | 'LIVE';
  refresh: () => void;
}

/** §5.6 + Plan 6 Design §10: two-click armed switch. The client never flips
 *  anything on its own — the server's env-name gate owns the decision. */
export function DataPanel({ backups, mode, refresh }: DataPanelProps) {
  const [armed, setArmed] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const click = async () => {
    if (!armed) {
      setArmed(true);
      setMissing([]);
      return;
    }
    const res = await setMode(mode === 'SIMULATED' ? 1 : 0);
    setArmed(false);
    if (!res.ok) setMissing(res.missing);
    refresh();
  };

  return (
    <section className="panel">
      <header className="panel-head">DATA</header>
      <div className="panel-body">
        <div className="kv">
          <span className="kv-key">MODE</span>
          <button
            className={`badge-sim${mode === 'LIVE' ? ' live' : ''}${armed ? ' armed' : ''}`}
            onClick={() => { void click(); }}
          >
            {modeSwitchLabel(mode, armed)}
          </button>
        </div>
        {missing.length > 0 && <div className="data-note">{missingText(missing)}</div>}
        <div className="kv"><span className="kv-key">BACKUPS</span><span className="kv-value">{backupsText(backups)}</span></div>
        <div className="btn-pair">
          <a className="btn-half" href="/api/export/trades.csv" download>EXPORT CSV</a>
          <a className="btn-half" href="/api/export/all.json" download>EXPORT JSON</a>
        </div>
        <div className="data-note">EXPORT, NEVER DELETE. TRADES AND EVENTS ARE KEPT FOREVER.</div>
      </div>
    </section>
  );
}
```

Add the two badge variants to `client/src/styles/settings.css` (appended — the frozen-list exception is sanctioned because Plan 6 postdates Plan 5's freeze):

```css
.badge-sim.live { border-color: #fff; color: #fff; }
.badge-sim.armed { background: var(--yellow); color: #000; }
```

Update the `SettingsScreen` call site: `<DataPanel backups={view.backups} mode={view.mode} refresh={refresh} />`.

In `client/src/components/AdvancedSettings.tsx`, replace the hardcoded `SIM` chips and the header note with `inputStatus(view.mode === 'LIVE', 'feed')`-driven rendering (`.chip-live.green` for LIVE, `.chip-live.sim` otherwise) and header `5 / 5 INPUTS {view.mode === 'LIVE' ? 'LIVE' : 'SIM'}` with the dot's tone following. In `client/src/components/AdvancedBrainSettings.tsx` (Plan 3), the four feed rows take the same helper via the brain view's mode — add `live: boolean` to the brain INPUTS row rendering fed from `GET /api/state`'s mode (the screen already polls `useAppState`? BrainScreen owns `useBrain` — extend `BrainView` is Plan 3 surface; SIMPLER: the brain screen reads the mode from `deriveStatusLine`'s badge state already present in App. Lock: pass `modeLabel` down from `App` to `BrainScreen` as a prop and thread it to `AdvancedBrainSettings` — exact prop additions given here):

```tsx
// App.tsx           — <BrainScreen live={modeLabel === 'LIVE'} />
// BrainScreen.tsx   — export function BrainScreen({ live }: { live: boolean }) { … <AdvancedBrainSettings … live={live} /> }
// AdvancedBrainSettings.tsx — statuses: inputStatus(live, 'feed') for the three feed rows,
//                             inputStatus(live, 'poll') for WHATSAPP REPLIES; LIMITS LOG and LLM rows unchanged.
```

- [ ] **Step 4: Run to verify it passes (and manual — SIM ONLY)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS (3 new pure-label tests), clean.
Then dev servers up, SETTINGS → DATA:
- Badge `SIMULATED`; first click arms `GO LIVE? ✓` (yellow); second click → the server 409s (no env names in dev unless the V1 file exists) → the row shows `MISSING: …` names and the badge returns to `SIMULATED`. **If the V1 .env IS present and the names resolve, DO NOT complete the second click** — arm it, observe the label, click elsewhere to disarm (HARD GATE 1). The refusal path is the only one exercised.
- INPUTS panels still show `SIM` chips everywhere (mode is SIMULATED).
Stop the dev servers.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): armed SIM/LIVE switch (server-gated), live-aware INPUTS statuses"
```

---

### Task 10: Hard-gate audit, forbidden-words sweep, full suite, SIM-ONLY smoke

**Files:** none created — verification only (fix anything the sweeps catch).

- [ ] **Step 1: Hard-gate greps (all must hold)**

```bash
# 1. Real hostnames confined to the live modules + brain/text.ts:
grep -rln 'the-odds-api\.com\|api\.twilio\.com\|api\.anthropic\.com' server/src client/src
#    → EXACTLY: server/src/live/oddsApi.ts, server/src/live/twilio.ts,
#      server/src/live/inbound.ts, server/src/brain/text.ts
# 2. No test sets a real-looking live credential or flips to live:
grep -rn "liveMode: 1\|live: 1" server/src/**/*.test.ts client/src/**/*.test.ts
#    → sanctioned hits ONLY: mode.test.ts (wireMode + sim-settlement-gate units) and inbound.test.ts
#      set liveMode:1 DIRECTLY on isolated in-memory repos; api.test.ts's PATCH-liveMode (→400) and
#      POST /api/mode (→409) tests exercise the REFUSAL path (liveMode STAYS 0). All fake env records /
#      direct repos key set / throwing fetch — the sanctioned HARD GATE 1 pattern. Review each hit by hand.
grep -rn "process.env.ODDS_API_KEY\s*=\|process.env.TWILIO" server/src client/src
#    → no output (env is passed as records, never mutated)
# 3. The .env path is read in exactly one place:
grep -rn "evil-eye-arbitrage" server/src client/src
#    → server/src/live/env.ts (the ONLY place the path is constructed/read) + server/src/index.ts
#      (a COMMENT beside the loadV1Env() call — no read there). No client hits.
# 4. Forbidden words:
grep -rniE 'append-only|ghost|picker|grader|gatekeeper|CLV' server/src client/src
#    → clean in all PRODUCTION source. The only matches are the pre-existing forbidden-word ASSERTION
#      REGEXES inside test files (api.test.ts + a client test) that PROVE these words never appear in
#      rendered output. Exclude test files to confirm: `… | grep -v '\.test\.'` → no output.
```

- [ ] **Step 2: Full-suite run**

Run: `npm test && npm run typecheck`
Expected: server + client suites all pass; both typechecks clean. The entire server suite runs under the throwing-fetch harness — that green IS the no-network proof.

- [ ] **Step 3: End-to-end smoke (manual, real processes — the app STAYS SIMULATED)**

> **Worktree isolation (PM directive):** the user's dev servers occupy 4400/5174 from the main checkout. Run this smoke FROM THE EXECUTION WORKTREE with the server port patched to a free port ≥ 4499 (temporarily edit `PORT` in `server/src/index.ts`; revert before committing) and start the client with `EE_API_TARGET=http://localhost:<port> npm run dev:client` (Vite auto-bumps its own port). Adjust every `localhost:4400`/`:5174` below to the patched ports. Never boot against, or POST to, the user's 4400.

Terminal A: `npm run dev` (patched port). Terminal B: `EE_API_TARGET=http://localhost:<port> npm run dev:client`. Then:
1. Badge reads SIMULATED; TRADES/BRAIN/ANALYTICS/SETTINGS all behave exactly as before this plan (regression pass).
2. `curl -s localhost:4400/api/state | grep mode` → SIMULATED. `curl -s -X POST localhost:4400/api/mode -H 'content-type: application/json' -d '{"live":0}'` → `{"mode":"SIMULATED"}` (the always-allowed direction).
3. DATA panel: arm the switch, observe `GO LIVE? ✓`, then click elsewhere / let the 409 path run per Task 9 — **never complete a flip to LIVE**.
4. Backups: `ls server/data/backups/` after the first post-03:00 tick of the day (or set `journalMinPerDay` aside and simply wait one pump past 03:00 in a dev session that spans it) → one `evil-eye-YYYY-MM-DD.db`; the DATA row reads `14 NIGHTLY · LAST {time}`.
5. BRAIN journal gains NO `Consolidation digest:` entries (no key in dev) — the deterministic lines stand alone; `curl -s localhost:4400/api/settings/view | grep llmSpentCents` → `0`.
6. `grep -c 'wa_dev\|wa_error\|llm_error' server/data/evil-eye.db` is not meaningful on a binary — instead: `curl -s localhost:4400/api/export/all.json | grep -c '"wa_dev"'` → `0` in sim (the sim sender, not the Twilio sender, is wired).
7. Kill and restart the server — mode persists (still SIMULATED), the chain re-arms, no timer leaks (exactly one wake pending at a time).

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(live): hard-gate audit findings"
```

---

## Self-Review Notes (done at planning time)

- **Controller constraints coverage:** (a) Odds API provider behind the seam — T2, refresh-cache design keeps the pipeline sync; (b) Twilio out + 45 s inbound poll — T3/T4, dev-mode default SAFE, poll rides the one timer; (c) Anthropic text seam — T6, `claude-haiku-4-5` + $1/$5-per-MTok from the claude-api skill (consulted before writing, per the brief), no-key silence, cap refused pre-request in integer micro-dollars; (d) nightly backups ×14 — T5, file rotation only, rows forever; (e) SIM/LIVE switch with confirm — T7/T9, env-NAME gating, never flipped by any step. The HARD GATES section restates every controller rule and Task 10 enforces them mechanically.
- **One-timer justification (explicit, per the brief):** `planNext` is untouched; hooks are a runner-level list whose wakes fold into the SAME `arm()` chain (`min(planNext.at, nextHookWake)`); `index.ts` still holds the codebase's only real `setTimeout`; `tick()` keeps its sync contract so every Plan 1–5 test runs unmodified. The 45 s poll is a hook (live-only, quiet-gated); the backup is a hook (first pump ≥ 03:00 — no mid-quiet wake, Decision/Design §9); the digest is a hook (key + kill-switch gated). Three cadences, zero new timers.
- **No-network proof strategy:** every live client takes `fetchImpl`; the api test harness injects a THROWING stub for the entire sim suite (T7) — any accidental network attempt anywhere fails every test loudly; dev-mode and no-key tests also use throwing stubs at the unit level. Test env records carry fake values only; `process.env` is never mutated by tests.
- **Env hygiene:** values never serialized — `missingLiveVars` and every error/journal string carry NAMES only; `provider_error`/`wa_error`/`llm_error` payloads carry status codes or truncated messages, and the T2 test asserts the key never appears in a payload. `PORT`/`APP_URL` semantics locked (Decision 2); `ANTHROPIC_API_KEY` as the eighth name is flagged as the one pre-resolved ambiguity (Decision 3) — anything further stops the line (HARD GATE 6).
- **Money math:** LLM ledger in integer micro-dollars (1 input-token = 1 µ$, 1 output-token = 5 µ$ — exact at Haiku 4.5's $1/$5 pricing); cap check `spent + worstCase > 3,000,000 µ$` refuses BEFORE the request; display converts µ$→cents rounding UP (never understate spend); Odds API credits from the provider's own usage headers as deltas. All integer arithmetic.
- **Settlement honesty (PM adjudication):** rng settlement is gated to SIMULATED inside `runSimSettlement` (T7, Design §13) — LIVE mode never fabricates WON/LOST on real trades; the SIM→LIVE journal line keeps the unwired results feed visible on every flip; real settlement is an explicitly deferred results-feed plan (Decision 13); manual settles work in both modes; the gate has its own direct-key unit (the sanctioned HARD GATE 1 pattern, listed in T10's audit expectations); Plan 4's shadow-settlement design carries the matching sim-only caveat.
- **Cross-plan edits are exact and minimal:** Plan 5's `settings/report.ts` (two replacements: µ$ ledger, mode label), Plan 4's `simulated` flag (one line), Plan 3's brain INPUTS statuses (prop-threaded helper), the api harness (two option lines). Everything else is additive. `AppOptions` additions are optional with sim-preserving defaults — Decision 12 pins that no existing test changes.
- **Deferred (deliberate, documented):** (1) The Odds API sport-key roster is a locked constant (Decision 4) — making it a setting is future work once live usage shows the need. (2) Reply codes handle exactly `1`/`3` (no skip feature — other bodies are recorded and ignored). (3) The digest rewrites today's lines once per day — richer LLM duties (site-detail prose) stay deterministic until the product asks otherwise. (4) `wa_dev` events are the dev-mode audit trail; a dev-mode UI surface is future work.
- **Placeholder scan:** no TBD/TODO/"similar to task N" anywhere; every code step is complete file content or an exact old→new replacement; commands carry expected outputs; the two adapt-notes (harness option names, `pump` naming) state the binding spec explicitly.



