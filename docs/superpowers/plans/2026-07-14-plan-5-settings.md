# Evil Eye V2 — Plan 5: SETTINGS (six panels + advanced expander, every knob live)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SETTINGS screen pixel-faithful to design inventory §5 — six panels (STRATEGY MIX — LOCKED TO 100 · SCAN RULES · CREDIT FORECASTER · RISK & BANKROLL · BRAIN · WHATSAPP · DATA) plus the ADVANCED SETTINGS expander (INPUTS · MY BOOKS · SPORTS & LEAGUES · EDGE THRESHOLDS & FRESHNESS · REFERENCE PRICER FALLBACK · ACCOUNT SAFETY RULES · STRATEGY KILL RULES + JOURNAL) — fully wired to the settings store through the existing `PATCH /api/settings` (extended by Plan 3, extended again here). EVERY interactive knob observably changes engine behavior, and each wiring task proves it with a test that shows the engine reading the changed value: the strategy mix caps per-category sends, disabled books/sports stop producing candidates, the one-sport rule toggles, the reference-pricer fallback redirects EV detection, edge thresholds move the qualification bar, the kill switch stops brain passes, and the journal minimum makes the brain write.

**Architecture:** Server: new settings keys + validation in the existing `settingsPatch` (string keys join the number keys; the mix trio carries a sum-to-100 invariant; account-safety keys carry a calm-only lock), one `enabled` column on `books`, a pure eligibility filter (`pipeline/eligibility.ts`) applied at both scan and recheck, a pure mix-allowance module (`engine/mix.ts`) enforced beside the daily pick cap, fallback-aware candidate detection, a journal-minimum module riding the existing scan tick (NO new timers), one read model (`settings/report.ts` → `GET /api/settings/view`) and four small routes (whatsapp test stub, two exports, per-book PATCH). Client: `SettingsScreen` composed of one component per panel, every display derivation in pure functions in `client/src/lib/settings.ts` (the ONLY unit-tested client layer, per Plan 2's convention), one `useSettingsView` polling hook, and one new stylesheet `settings.css`.

**Tech Stack:** unchanged from Plans 1–2 — Node 20+/TS strict/NodeNext + better-sqlite3 ^12 + Express 4 + Vitest 2 (server); Vite 5 + React 18 + plain CSS custom properties (client). Server port 4400, Vite dev port 5174.

## Design (locked — every knob's semantics decided here)

1. **Plan 5 executes after Plan 3 merges** (per the build brief): the settings validation extends Plan 3's `RANGE_RULES` version of `settingsPatch`; the BRAIN panel toggles Plan 3's `brainKillSwitch` and calls Plan 3's `POST /api/brain/pass`; the view reuses `lastPass`/`displayName` (`brain/pass.js`) and `eventsLog.byKind`. Plan 4 may or may not have merged — nothing here touches Plan 4 surfaces, and the one shared file edit (`App.tsx`) is a surgical placeholder-line replacement.
2. **New settings keys** (defaults locked): `mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29` (the mockup's slider values — integers 0–100, PATCHed as a trio that MUST sum to exactly 100, else 400: LOCKED TO 100 is a server invariant, not a UI nicety); `whatsappNumber: ''` (string — the mockup's `+1 604 555 8112` is demo filler; empty until the user types theirs); `disabledSports: ''` (string — comma-joined sport slugs); `anchorFallback: 0` (0 = fall back to consensus, 1 = pause EV + middles, 2 = pause everything); `oneSportRule: 1` (0/1); `journalMinPerDay: 1` (integer 1–4 — the brain can honestly produce at most the daily check + 3 distinct observations per day, so the range is capped where honesty ends).
3. **Strategy mix is enforced at promotion, exactly like the daily pick cap**: category allowance = `0` when its pct is 0, else `max(1, round(dailyPickCap × pct / 100))` (defaults: ARB 6 · MIDDLE 3 · EV 3 — sums to the cap). A pick that passes verification but finds its category at its allowance is held back — `EXPIRED`, `verified_at` NULL, journal line `{CAT} {event} passed verification but was held back — {CAT} mix at its {pct}% cap.` — the exact clause shape Plan 3's rationale panel already renders. The existing daily-cap test stays green: its 11 seeds are one category (mix-held), the sim's other-category candidates fill the 12th slot, and the test asserts counts, never identities.
4. **Book/sport eligibility is a pure quote filter applied at BOTH ends of the pipe** (`eligibleQuotes`): quotes from a disabled book (`books.enabled = 0`) or a disabled sport (`disabledSports`) never become candidates at scan, and at the recheck a newly-disabled leg reads as no-quote → the trade dies `QUOTE_STALE` (the kill taxonomy is locked; "the quote is no longer available to us" is honest dead air). The full unfiltered snapshot still caches to `deps.lastQuotes` and still feeds the pinnacle benchmark — the anchor is never a bet. Pinnacle cannot be disabled (`SHARP — ALWAYS ON` → 409), and a sharp book's sport cannot change.
5. **One-sport rule is a gate toggle, not a gate rewrite**: `oneSportRule: 0` skips ONLY the sport-mismatch check in gate 1 — the unknown-book kill stays unconditional (an unvalidatable book must never reach a trade).
6. **Reference pricer fallback** (`IF THE ANCHOR GOES DOWN`) binds when a snapshot contains NO pinnacle quotes: `0` — EV detection devigs a CONSENSUS benchmark (best odds per selection across all books in the line group, ≥ 2 selections) and the recheck mirrors it; middles and arbs continue. `1` — EV and MIDDLE detection pause, arbs continue. `2` — no candidates at all. In sim the anchor never goes down (the provider always quotes pinnacle) — the wiring is proven with a stub provider that omits pinnacle, never by faking an outage. The radios echo the verbatim labels; switching journals (Design §12).
7. **Journal minimum rides the scan tick** (`ensureJournalMinimum`, called from `runner.doScan` after the brain hooks — the one-timer invariant holds): when today's journal count (Vancouver day) is below `journalMinPerDay` and the kill switch is off, it appends deterministic observation lines derived from live tables — `Watch list: {top-3 books by heat} …`, `Today so far: {candidates} candidates · {sent} sent · {killed} killed`, `Credits used this month: {used} of {plan}` — at most 3 per day beyond the brain's own entries. The kill switch stops it (autonomous behavior); quiet hours already stop scans.
8. **Every panel row renders LIVE settings** — the KV values are formatted from `GET /api/settings/view`, never hardcoded: SCAN WINDOW derives from the quiet hours (`08:00 – 24:00 PT` at defaults), CADENCE from the three scan knobs, the CREDIT FORECASTER from `credits_usage` (projected/day = trailing-7-day mean daily burn; daily allowance = `floor(creditPlanMonthly / 30)`; month-end projection = used-this-month + projected × days-left; remaining + runway reuse the brain tile's math). The mockup's numbers are demo filler (inventory §7.3).
9. **Interactive controls sit exactly where the mockup has them** (inventory §5 + §6's inert-list): the mix sliders, the REMOVE STALE stepper, the LINE MOVE TOLERANCE stepper (the ONE addition beyond the mockup's static row — MASTER PROMPT hard rule 2 says the tolerance is "user-set 0–100% in SETTINGS → RISK & BANKROLL", and a hard rule beats a static mock), the KILL SWITCH toggle, UPDATE UNDERSTANDING, the WhatsApp number input, SEND TEST MESSAGE, EXPORT CSV/JSON, book ON/OFF chips + sport selects, SPORTS & LEAGUES ✓/✗ toggles, the four EDGE THRESHOLDS steppers, the fallback radios, and the JOURNAL MINIMUM stepper. Everything else stays a live-value display (PATCHable via API, not via this screen), and `+ ADD BOOK`, `CHECK FOR UPDATES`, `EDIT` (API key) stay inert — roster growth and key management are live-mode concerns (Plan 3's `+ ADD DATA SOURCE` precedent; Plan 6 owns keys).
10. **Account-safety keys are calm-locked SERVER-side**: PATCHing any of `sharpVelocityPerDayPerBook`, `marketBreadthPerWeekPerBook`, `oneSportRule`, `goGentleHeat`, `stopHeat` while any non-sharp book is amber or red → 409 (`account safety rules are locked while any book is amber or red`). The panel's helper sentence is the verbatim copy; the client also greys the panel, but the server is the lock.
11. **"Changes here are written to the brain journal." is literal**: the PATCH route journals every change to an advanced key (`Settings changed: {key} {old} → {new}`) and `PATCH /api/books/:name` journals roster changes (`Books: {display} sport {old} → {new}` / `Books: {display} turned OFF` / `… ON`). Main-panel knobs (mix, stale, tolerance, whatsapp number, kill switch) do NOT journal — they live outside the advanced expander.
12. **Sim-honest INPUTS panel** (Plan 3 Task 12 precedent): the §5.7 INPUTS rows keep their verbatim labels and helper sentences, but statuses render `SIM` (yellow) instead of `LIVE`, the masked key renders `NO KEY — SIM` (NEW copy), the header dot is yellow with `5 / 5 INPUTS SIM` (NEW copy), `LAST TICK {n} S AGO` derives from the last scan event, `PLAN {plan} / MO` from `creditPlanMonthly`, and BRAIN MEMORY counts live rows (`{trades} RECEIPTS · {journal} JOURNAL ENTRIES · GROWING`). `YOUR REPORTS` keeps its green `LINKED` chip — that pipe is genuinely wired in sim. Plan 6 flips the SIM statuses.
13. **WHATSAPP panel wires VALUES only** (the brief is explicit — sending is Plan 6): the number input PATCHes `whatsappNumber` on blur when it validates (`+` then 7–19 digits/spaces; empty allowed); SEND TEST MESSAGE POSTs `/api/whatsapp/test`, which writes an events_log `wa_test` row and returns `{ ok: true, simulated: true }` — no network, ever, in this plan. The button label flips to `SENT ✓` (NEW copy) after a success and stays until re-armed by another click.
14. **DATA panel**: MODE badge stays non-interactive `SIMULATED` (the SIM/LIVE switch with its confirm dialog is Plan 6's — the brief locks this); BACKUPS renders `14 NIGHTLY · NONE YET` (NEW copy) until Plan 6's first backup writes its events_log row, then `14 NIGHTLY · LAST {HH:MM}`; EXPORT CSV → `GET /api/export/trades.csv` (every trade, every column, RFC-4180 quoting), EXPORT JSON → `GET /api/export/all.json` (every table, whole) — export, never delete; neither endpoint mutates anything. The buttons are plain anchors so the browser downloads natively.
15. **BRAIN panel**: HEAT WEIGHTS renders `DEFAULT · EDITABLE WHILE GREEN` or `CUSTOM · EDITABLE WHILE GREEN` (custom ⇔ any weight differs from defaults); CONSOLIDATION PASS `EVERY {n} H · HAIKU`; LLM BUDGET `${spent} / $3.00 THIS MONTH` from Σ events_log `llm_spend` rows (honest $0.00 until Plan 6 spends); KILL SWITCH is the interactive toggle (PATCH `brainKillSwitch`); LAST DIGEST `TODAY {HH:MM} · {n} BOOKS` from the last `brain_pass` ledger row (`—` before the first); UPDATE UNDERSTANDING POSTs `/api/brain/pass` (runs even under the kill switch — Plan 3 Decision 13) and refreshes.
16. **Demo values are not test expectations** (inventory §7.3/§8): every KV value, slider percent, forecaster number and INPUTS status in the mockup is filler; this plan derives everything from live settings/tables and keeps only LABELS, helper sentences and fixed prose verbatim (exact glyphs: `—`, `·`, `▾`, `✓`, `✗`, `●`, `○`, `□`, `→`, `−` U+2212, `–` U+2013, `×` in `1.5× BREAKEVEN HIT RATE`).

## Global Constraints

- Money is **integer cents** in every variable, column and API payload; dollars only inside format functions' return strings.
- Server files use NodeNext — **relative imports carry `.js` extensions**; client uses Bundler resolution (no extension). Consumers copy `DEFAULT_SETTINGS`, never alias it.
- **One timer invariant**: the only real `setTimeout` lives in `server/src/index.ts`. Plan 5 adds NO timers — the journal minimum rides `runner.doScan`; the only new client interval is `useSettingsView`'s 5 s poll (the established hook pattern).
- **One total bankroll; no skip feature; no promo strategy; STRATEGY MIX locked to 100** (server-enforced invariant, Design §2).
- Never render the words: **append-only, ghost, picker, grader, CLV, gatekeeper** — in any UI string or API response (MASTER PROMPT hard rule 6).
- ALL UI copy verbatim from `docs/handoff/design-inventory.md` §5 (exact glyphs listed in Design §16). New copy not in the inventory is flagged `(NEW copy)` where it appears.
- Data kept forever — exports never delete; settings history is journaled, not overwritten silently (Design §11); no table ever loses rows.
- Quiet hours 00:00–08:00 America/Vancouver; all wall-clock rendering via `Intl.DateTimeFormat` with `timeZone: 'America/Vancouver'` (never a fixed UTC offset).
- Ports: server **4400**, Vite dev **5174**. All commands run from the repo root.
- TDD every task; commit after every task. The full suite must stay green throughout (server 117 + client 20 at this plan's authoring baseline, plus Plan 3's — and possibly Plan 4's — additions).

## Interface Contracts (referenced by all tasks)

```ts
// server/src/shared/defaults.ts — new keys (Task 1); appended AFTER Plan 3's brain keys
mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,        // LOCKED TO 100 — trio-validated
anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
whatsappNumber: '' as string, disabledSports: '' as string,
// Settings = typeof DEFAULT_SETTINGS — now a mixed number/string record; every
// consumer that iterated "all numbers" is updated by Task 1's validation rewrite.

// server/src/db/repos.ts additions (Task 1)
export interface Book { /* existing fields */; enabled: 0 | 1 }   // migration DEFAULT 1
books.setEnabled(name: string, enabled: 0 | 1): void
books.setSport(name: string, sport: string): void
trades.sentTodayByCategory(dayKey: string, category: Strategy): number
trades.exportRows(): AnalyticsTradeRow-like full dump rows                 // exports; ORDER BY created_at ASC, id ASC
  // If Plan 4 has merged, reuse its AnalyticsTradeRow + add profileId to the export mapping;
  // if not, define ExportTradeRow locally with the same columns + profileId.

// server/src/engine/mix.ts (pure — Task 1)
mixPct(category: Strategy, s: Settings): number                            // 47 | 24 | 29 by key
mixAllowance(category: Strategy, s: Settings): number                      // 0 if pct 0, else max(1, round(cap × pct/100))

// server/src/pipeline/eligibility.ts (pure — Task 2)
disabledSportSet(s: Settings): Set<string>
eligibleQuotes(quotes: Quote[], books: Book[], s: Settings): Quote[]

// server/src/brain/journalMin.ts (Task 3)
ensureJournalMinimum(deps: PipeDeps, now: number): number                  // entries written (0..3)

// server/src/settings/report.ts → GET /api/settings/view (client mirror in client/src/lib/settings.ts)
interface SettingsBookView { name: string; displayName: string; sport: string; sharpExempt: boolean; enabled: boolean }
interface SettingsView {
  mode: 'SIMULATED';                                   // Plan 6 flips
  settings: Settings;                                  // the raw store, whole
  forecaster: { projectedPerDay: number; dailyAllowance: number; usedThisMonth: number;
                monthEndProjection: number; planMonthly: number; remaining: number; runwayDays: number };
  brain: { lastPassAt: number | null; lastPassBooks: number | null;
           llmSpentCents: number; llmCapCents: number; weightsCustom: boolean };
  books: SettingsBookView[];                           // seed order
  sports: { sport: string; enabled: boolean }[];       // distinct non-ANY sports, name order
  safetyLocked: boolean;                               // any non-sharp book amber/red
  memory: { receipts: number; journalEntries: number };
  lastTickAt: number | null;                           // newest 'scan' events_log ts
  backups: { lastAt: number | null; keep: 14 };        // Plan 6 writes 'backup' rows
}

// Routes added/changed in server/src/api/routes.ts (Tasks 1 + 4)
PATCH /api/settings                → extended validation (strings, trio, ranges) + calm-lock 409 + advanced-key journaling
GET   /api/settings/view           → SettingsView
PATCH /api/books/:name             → { book: SettingsBookView }   body { enabled?: 0|1, sport?: string }
                                     (404 unknown · 400 bad body/sport · 409 sharp book)
POST  /api/whatsapp/test           → { ok: true, simulated: true }        (writes events_log 'wa_test')
GET   /api/export/trades.csv       → text/csv attachment, every trade
GET   /api/export/all.json         → application/json attachment, every table

// client/src/lib/settings.ts — mirror types + pure helpers (Task 5; exhaustive list)
scanWindowText(s), quietHoursText(s), cadenceText(s), verifyGapText(s), staleText(s)
forecastRows(f): [key, value, tone][]                          // the three forecaster rows
mixRows(s): { key: 'ARB'|'MIDDLE'|'EV'; pct: number }[]
rebalanceMix(mix: {arb,middle,ev}, key, value): {arb,middle,ev} // deterministic, sums to 100
riskRows(s): [key, value][]                                    // six RISK & BANKROLL rows
toleranceText(s)                                               // '5% · 0–100%'
heatWeightsValue(s): string                                    // 'DEFAULT · EDITABLE WHILE GREEN' | 'CUSTOM · …'
consolidationText(s), llmBudgetText(brain), killSwitchValue(s), lastDigestText(brain)
validWaNumber(v: string): boolean
backupsText(b), modeBadge(mode)
inputsRows(view): { src, detail, status: {text, tone} }[]      // §5.7 INPUTS, sim-honest
planText(planMonthly): string                                  // 100_000 → 'PLAN 100K / MO'
lastTickText(lastTickAt, now): string                          // 'LAST TICK 41 S AGO' | '—'
memoryText(m): string
bookRow(b): { name, sportLabel, chip: {label, tone} }
sportCell(x): string                                           // '✓ BASKETBALL' | '✗ SOCCER'
thresholdTexts(s): [label, value][]                            // the four steppers' value strings
fallbackItems(s): { idx: 0|1|2; label: string; active: boolean }[]  // ● / ○ prefixed
safetyRows(s): [key, value, tone][]
killRuleRows(): [key, value][]                                 // fixed verbatim strings
journalMinText(s): string                                      // '1 / DAY'
advSettingsToggle(open): string

// client/src/lib/api.ts additions (Task 5)
fetchSettingsView(): Promise<SettingsView | null>
patchSettings(patch: Record<string, number | string>): Promise<boolean>
patchBook(name: string, body: { enabled?: 0 | 1; sport?: string }): Promise<boolean>
sendWaTest(): Promise<boolean>
// UPDATE UNDERSTANDING reuses Plan 3's postBrainPass()

// client/src/hooks/useSettingsView.ts (Task 5)
useSettingsView(): { view: SettingsView | null; refresh: () => void }
```

## Decision notes (locked product calls — bake in, do not re-litigate)

1. **The mix sliders are real controls**: HTML `<input type="range" 0–100 step 1>` restyled to the mockup's track/knob; changing one rebalances the OTHER TWO proportionally (largest-remainder rounding, deterministic — `rebalanceMix` is pure and unit-tested) so the trio always sums to 100 before PATCHing all three together. The panel header `STRATEGY MIX — LOCKED TO 100` is thereby literally true end-to-end.
2. **Steppers follow the mockup's stepper anatomy** (§5.2's REMOVE STALE): value text + `−`/`+` 22×22 buttons. Locked steps and floors: REMOVE STALE 1 MIN step, floor 1 (existing semantics); LINE MOVE TOLERANCE step 1, clamp 0–100; MIN ARB MARGIN step 0.05, floor 0.05; MIN EV EDGE step 0.1, floor 0.1; MIN MIDDLE QUALITY step 0.1, floor 1.0; FRESH WINDOW step 10 S, floor 30; JOURNAL MINIMUM step 1, clamp 1–4.
3. **`Settings` becomes a mixed record** (numbers + two strings). Plan 3's `settingsPatch` is REPLACED wholesale (exact code in Task 1) — number keys keep their existing rules verbatim; `RANGE_RULES` gains the four new bounded keys + the three mix keys; `STRING_RULES` validates `whatsappNumber` and `disabledSports`; the mix trio is all-or-nothing.
4. **`disabledSports` slugs validate against the live book roster** (distinct non-`ANY` sports) — unknown slugs 400. Disabling every sport is legal (the scanner idles honestly).
5. **KILL SWITCH in the BRAIN panel is a two-state chip button** (`OFF` white outline / `ON` yellow) PATCHing `brainKillSwitch`; the BRAIN screen's header chip (Plan 3) stays read-only and reflects the change on its next poll. No confirm dialog — the mockup has none and the switch is reversible.
6. **UPDATE UNDERSTANDING** posts `/api/brain/pass`, then refreshes the view; LAST DIGEST moves. It works with the kill switch ON (explicit user command — Plan 3 Decision 13's exact reasoning).
7. **`SEND TEST MESSAGE` in sim never sends anything anywhere** — the stub writes `wa_test` + returns `simulated: true`; Plan 6 swaps the stub's internals behind the same route. Any real Twilio call in this plan is a defect.
8. **Exports are complete, deterministic dumps**: CSV columns in schema order, rows in `created_at, id` order, RFC-4180 quoting (fields with `",\n` get quoted, quotes doubled); JSON is one object with every table array plus `exportedAt`. No pagination, no filters — data kept forever, exported whole.
9. **The sports grid derives from the engine's actual sport roster** (distinct sports of the seeded books) with uppercase slug labels (`✓ BASKETBALL` … `✗ SOCCER`). The mockup's league names (NHL, EPL, `✗ NCAA`…) are demo filler for a league system the sim does not have — rendering leagues that filter nothing would fake a knob (honesty rule). The helper sentence stays verbatim: `More leagues = more credits. The forecaster updates live.`
10. **MY BOOKS sport selects list the roster's sports**; changing a book's sport PATCHes it and the one-sport gate reads it on the next scan (the ONE-SPORT panel row shows `ON`/`OFF` from `oneSportRule`). Disabled books grey their row exactly like the mockup's Bet365 row. Pinnacle renders the `SHARP — ALWAYS ON` chip with no controls.
11. **ACCOUNT SAFETY RULES + the fallback radios sit in the advanced expander and journal every change** (Design §11); the safety panel header carries `□ EDITABLE WHILE GREEN`, and when `safetyLocked` the rows grey, the steppers/radios no-op client-side, and the server 409s regardless (Design §10). STRATEGY KILL RULES rows are the three verbatim strings, display-only — the strategy-death engine is future work; Plan 3's grades are its measurement layer (Plan 3 Deferred §6).
12. **`ADVANCED SETTINGS →` / `ADVANCED SETTINGS — COLLAPSE`** toggle + intro sentence `Changes here are written to the brain journal.` are verbatim; the expander renders BELOW the six panels (mockup order), not above a CTA — this is the §5.7 text-button pattern, not the §2.4 CTA pattern.
13. **`SettingsScreen` owns its data** via `useSettingsView()` (5 s poll + `refresh()`); server down → single calm note `SETTINGS OFFLINE — SERVER UNREACHABLE` (NEW copy, `.empty-note` style). Optimistic UI is banned: every control PATCHes, then `refresh()` — the store is the truth.
14. **Number input is the only free-text field**; it PATCHes on blur only when `validWaNumber` passes (or the field is empty — clearing is legal), focus ring yellow (§5.5's unique focus color). Invalid text stays local and un-PATCHed — the store never holds junk.
15. **The RISK & BANKROLL non-tolerance rows stay displays** (flat pair, Kelly, bankroll, min/round, cap): each renders live store values and every one is PATCHable via API (proven by the existing settings tests) — the mockup gives them no controls and none is added (Design §9). The tolerance stepper is the sanctioned exception (hard rule 2).
16. **VERIFY GAP renders `{verifyGapSecs} S`** — a display row (the 75 s recheck is a locked pipeline constant by default; the knob exists in the store and API since Plan 1).

## File Map

```
server/src/shared/defaults.ts                        (Modify T1 — new keys)
server/src/shared/defaults.test.ts                   (Modify T1)
server/src/db/schema.sql                             (Modify T1 — books.enabled for fresh dbs)
server/src/db/db.ts                                  (Modify T1 — enabled migration)
server/src/db/repos.ts                               (Modify T1 — Book.enabled, setters, category count, export rows)
server/src/db/repos.settings.test.ts                 (Create T1)
server/src/engine/mix.ts + mix.test.ts               (Create T1)
server/src/api/routes.ts                             (Modify T1 — settingsPatch rewrite + calm-lock + journaling;
                                                      Modify T4 — view/books/test/export routes)
server/src/api/api.test.ts                           (Modify T1 — validation specs; Modify T4 — route specs)
server/src/pipeline/eligibility.ts + .test.ts        (Create T2)
server/src/pipeline/scan.ts                          (Modify T2 — eligibility filter)
server/src/pipeline/verify.ts                        (Modify T2 — mix cap + eligibility at recheck;
                                                      Modify T3 — fallback-aware fair prob)
server/src/pipeline/mixcap.test.ts                   (Create T2)
server/src/engine/gates.ts                           (Modify T3 — one-sport toggle)
server/src/engine/gates.test.ts                      (Modify T3 — toggle specs)
server/src/pipeline/candidates.ts                    (Modify T3 — anchor fallback)
server/src/pipeline/candidates.test.ts               (Modify T3 — fallback specs)
server/src/brain/journalMin.ts + journalMin.test.ts  (Create T3)
server/src/scheduler/runner.ts                       (Modify T3 — ensureJournalMinimum on the tick)
server/src/settings/report.ts                        (Create T4)
client/src/lib/settings.ts + settings.test.ts        (Create T5)
client/src/lib/api.ts                                (Modify T5 — fetch helpers)
client/src/hooks/useSettingsView.ts                  (Create T5)
client/src/styles/settings.css                       (Create T6)
client/src/main.tsx                                  (Modify T6 — import settings.css)
client/src/App.tsx                                   (Modify T6 — SettingsScreen replaces the placeholder)
client/src/screens/SettingsScreen.tsx                (Create T6; grows T7, T8, T9, T10)
client/src/components/Stepper.tsx                    (Create T6)
client/src/components/StrategyMixPanel.tsx           (Create T6)
client/src/components/ScanRulesPanel.tsx             (Create T7)
client/src/components/RiskBankrollPanel.tsx          (Create T7)
client/src/components/BrainPanel.tsx                 (Create T8)
client/src/components/WhatsappPanel.tsx              (Create T8)
client/src/components/DataPanel.tsx                  (Create T8)
client/src/components/AdvancedSettings.tsx           (Create T9; grows T10)
```

---

### Task 1: Settings keys, validation rewrite, calm-lock, books.enabled, mix math

**Files:**
- Modify: `server/src/shared/defaults.ts`, `server/src/shared/defaults.test.ts`, `server/src/db/schema.sql`, `server/src/db/db.ts`, `server/src/db/repos.ts`, `server/src/api/routes.ts`, `server/src/api/api.test.ts`
- Create: `server/src/db/repos.settings.test.ts`, `server/src/engine/mix.ts`, `server/src/engine/mix.test.ts`

**Interfaces:**
- Consumes: Plan 3's `settingsPatch` (RANGE_RULES version), existing `Repos`.
- Produces: the eight new settings keys, string validation, the mix trio invariant, the calm-lock 409, advanced-key journaling, `Book.enabled` + setters, `sentTodayByCategory`, `exportRows`/`exportColumns`, `mixPct`/`mixAllowance` — everything Tasks 2–4 consume.

- [ ] **Step 1: Write the failing specs**

Append to `server/src/shared/defaults.test.ts`:

```ts
test('settings-screen defaults (Plan 5)', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,
    anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
    whatsappNumber: '', disabledSports: '',
  });
  expect(DEFAULT_SETTINGS.mixArbPct + DEFAULT_SETTINGS.mixMiddlePct + DEFAULT_SETTINGS.mixEvPct).toBe(100);
});
```

Create `server/src/db/repos.settings.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from './db.js';
import type { Trade } from '../shared/types.js';

function mkTrade(over: Partial<Trade>): Trade {
  return {
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: null }],
    marginInitial: 0.02, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1_000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: 9_999_999,
    ...over,
  };
}

test('books.enabled defaults 1; setEnabled and setSport round-trip', () => {
  const r = Repos(openDb(':memory:'));
  expect(r.books.byName('bet365')!.enabled).toBe(1);
  r.books.setEnabled('bet365', 0);
  expect(r.books.byName('bet365')!.enabled).toBe(0);
  r.books.setSport('bet365', 'tennis');
  expect(r.books.byName('bet365')!.sport).toBe('tennis');
  r.books.setEnabled('bet365', 1);
  expect(r.books.byName('bet365')!.enabled).toBe(1);
});

test('string settings round-trip through the k/v store', () => {
  const r = Repos(openDb(':memory:'));
  r.settings.set({ whatsappNumber: '+1 604 555 8112', disabledSports: 'soccer,tennis' });
  const s = r.settings.all();
  expect(s.whatsappNumber).toBe('+1 604 555 8112');
  expect(s.disabledSports).toBe('soccer,tennis');
});

test('sentTodayByCategory counts sent picks per category per day', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'VERIFIED', verifiedAt: 1 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'b', status: 'CONFIRMED', verifiedAt: 2 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'c', category: 'EV', status: 'VERIFIED', verifiedAt: 3 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'd' }), '2026-07-14', null); // never sent
  r.trades.insert(mkTrade({ id: 'e', status: 'VERIFIED', verifiedAt: 4 }), '2026-07-13', null); // other day
  expect(r.trades.sentTodayByCategory('2026-07-14', 'ARB')).toBe(2);
  expect(r.trades.sentTodayByCategory('2026-07-14', 'EV')).toBe(1);
  expect(r.trades.sentTodayByCategory('2026-07-14', 'MIDDLE')).toBe(0);
});

test('exportRows/exportColumns: raw whole-table dump in stable order', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'b', createdAt: 2 }), '2026-07-14', 'moneyline');
  r.trades.insert(mkTrade({ id: 'a', createdAt: 1 }), '2026-07-14', null);
  const cols = r.trades.exportColumns();
  expect(cols[0]).toBe('id');
  expect(cols).toContain('day_key');
  const rows = r.trades.exportRows();
  expect(rows.map((x) => x.id)).toEqual(['a', 'b']);
  expect(typeof rows[0]!.legs).toBe('string'); // raw JSON column — an export, not a view
});
```

Create `server/src/engine/mix.test.ts`:

```ts
import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import { mixAllowance, mixPct } from './mix.js';

test('mixPct maps categories to their keys', () => {
  expect(mixPct('ARB', DEFAULT_SETTINGS)).toBe(47);
  expect(mixPct('MIDDLE', DEFAULT_SETTINGS)).toBe(24);
  expect(mixPct('EV', DEFAULT_SETTINGS)).toBe(29);
});

test('allowances share the daily cap: 6/3/3 at defaults, floor 1, zero means zero', () => {
  expect(mixAllowance('ARB', DEFAULT_SETTINGS)).toBe(6);   // round(12 × 0.47)
  expect(mixAllowance('MIDDLE', DEFAULT_SETTINGS)).toBe(3);
  expect(mixAllowance('EV', DEFAULT_SETTINGS)).toBe(3);
  const tiny = { ...DEFAULT_SETTINGS, dailyPickCap: 1 };
  expect(mixAllowance('MIDDLE', tiny)).toBe(1);            // round(0.24) = 0 → floor 1
  const none = { ...DEFAULT_SETTINGS, mixEvPct: 0, mixArbPct: 71 };
  expect(mixAllowance('EV', none)).toBe(0);                // 0% means none, ever
});
```

Append to `server/src/api/api.test.ts`:

```ts
test('PATCH settings: strings validate, the mix trio is all-or-nothing and sums to 100', async () => {
  const h = makeApp();
  const okStr = await request(h.app).patch('/api/settings')
    .send({ whatsappNumber: '+1 604 555 8112', disabledSports: 'soccer' });
  expect(okStr.status).toBe(200);
  expect(okStr.body.settings.whatsappNumber).toBe('+1 604 555 8112');
  expect((await request(h.app).patch('/api/settings').send({ whatsappNumber: 'hello' })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ whatsappNumber: '' })).status).toBe(200); // clearing is legal
  expect((await request(h.app).patch('/api/settings').send({ disabledSports: 'SOCCER!' })).status).toBe(400);

  expect((await request(h.app).patch('/api/settings').send({ mixArbPct: 50 })).status).toBe(400); // trio only
  expect((await request(h.app).patch('/api/settings')
    .send({ mixArbPct: 50, mixMiddlePct: 30, mixEvPct: 30 })).status).toBe(400); // 110 ≠ 100
  const okMix = await request(h.app).patch('/api/settings')
    .send({ mixArbPct: 100, mixMiddlePct: 0, mixEvPct: 0 });
  expect(okMix.status).toBe(200);
  expect(okMix.body.settings.mixArbPct).toBe(100);

  expect((await request(h.app).patch('/api/settings').send({ anchorFallback: 3 })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ journalMinPerDay: 5 })).status).toBe(400);
  expect((await request(h.app).patch('/api/settings').send({ oneSportRule: 0 })).status).toBe(200);
});

test('PATCH settings: safety keys are calm-locked; advanced keys journal their changes', async () => {
  const h = makeApp();
  const ok = await request(h.app).patch('/api/settings').send({ goGentleHeat: 25 });
  expect(ok.status).toBe(200); // every book green — editable
  let texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Settings changed: goGentleHeat 30 → 25');

  h.repos.books.update('bet365', 41, 'yellow', null); // one book struggles (Plan 3 writer)
  const locked = await request(h.app).patch('/api/settings').send({ stopHeat: 70 });
  expect(locked.status).toBe(409);
  const alsoLocked = await request(h.app).patch('/api/settings').send({ oneSportRule: 0 });
  expect(alsoLocked.status).toBe(409);
  const nonSafety = await request(h.app).patch('/api/settings').send({ minEvEdgePct: 2.5 });
  expect(nonSafety.status).toBe(200); // only SAFETY keys lock
  texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Settings changed: minEvEdgePct 2 → 2.5');

  const mainPanel = await request(h.app).patch('/api/settings').send({ staleRemoveMin: 12 });
  expect(mainPanel.status).toBe(200);
  expect(h.repos.journal.all().some((j) => j.text.includes('staleRemoveMin'))).toBe(false); // not advanced — no journal
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- defaults repos.settings mix api`
Expected: FAIL — missing keys, missing repo methods/columns, 400/409 mismatches.

- [ ] **Step 3: Implement**

In `server/src/shared/defaults.ts`, append to `DEFAULT_SETTINGS` (after Plan 3's brain keys, before the closing brace):

```ts
  // Settings screen (Plan 5). The mix trio is LOCKED TO 100 — validated as a
  // trio at the API edge and enforced per-category at promotion (engine/mix.ts).
  mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,
  anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
  // String settings — the store is k/v JSON; validation lives in settingsPatch.
  whatsappNumber: '', disabledSports: '',
```

(`Settings = typeof DEFAULT_SETTINGS` now mixes numbers and strings — Step 3's `settingsPatch` rewrite is the only consumer that assumed all-numbers.)

In `server/src/db/schema.sql`, inside `CREATE TABLE IF NOT EXISTS books`, add after `max_belief_cents INTEGER`:

```sql
  max_belief_cents INTEGER,
  enabled          INTEGER NOT NULL DEFAULT 1
```

In `server/src/db/db.ts`, extend the migration guard. If Plan 4 has merged, `migrate(db)` already exists — append the books guard to it; otherwise create it exactly as below and call `migrate(db);` after `db.exec(schemaSql);`:

```ts
/** Idempotent column migrations for databases created before this plan (data kept
 *  forever — never recreate, never drop). */
function migrate(db: Db): void {
  const tradeCols = (db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map((c) => c.name);
  if (!tradeCols.includes('confirmed_at')) db.exec('ALTER TABLE trades ADD COLUMN confirmed_at INTEGER'); // Plan 4's
  const bookCols = (db.prepare('PRAGMA table_info(books)').all() as { name: string }[]).map((c) => c.name);
  if (!bookCols.includes('enabled')) db.exec('ALTER TABLE books ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
}
```

(If Plan 4 has NOT merged when this executes, drop the `confirmed_at` guard line — each plan owns its own column.)

In `server/src/db/repos.ts`:

1. `Book` and `BookRow` gain `enabled: 0 | 1`; `rowToBook` maps `enabled: r.enabled,`.

2. Add prepared statements to the `st` map:

```ts
    bookSetEnabled: db.prepare('UPDATE books SET enabled = ? WHERE name = ?'),
    bookSetSport: db.prepare('UPDATE books SET sport = ? WHERE name = ?'),
    tradeSentTodayByCategory: db.prepare(
      'SELECT COUNT(*) AS n FROM trades WHERE day_key = ? AND category = ? AND verified_at IS NOT NULL'),
    tradeExportRows: db.prepare('SELECT * FROM trades ORDER BY created_at ASC, id ASC'),
    tradeExportColumns: db.prepare('PRAGMA table_info(trades)'),
```

3. Add to the `books` object:

```ts
    /** MY BOOKS panel writers (Plan 5). The route guards sharp books; these don't. */
    setEnabled(name: string, enabled: 0 | 1): void { st.bookSetEnabled.run(enabled, name); },
    setSport(name: string, sport: string): void { st.bookSetSport.run(sport, name); },
```

4. Add to the `trades` object:

```ts
    /** SENT semantics per category — the strategy-mix allowance's counter. */
    sentTodayByCategory(dayKey: string, category: Trade['category']): number {
      return (st.tradeSentTodayByCategory.get(dayKey, category) as { n: number }).n;
    },
    /** Raw whole-table dump (snake_case, legs as stored JSON) — exports only, never a view. */
    exportRows(): Record<string, unknown>[] {
      return st.tradeExportRows.all() as Record<string, unknown>[];
    },
    exportColumns(): string[] {
      return (st.tradeExportColumns.all() as { name: string }[]).map((c) => c.name);
    },
```

Create `server/src/engine/mix.ts`:

```ts
// Strategy mix (Plan 5, Design §3): LOCKED TO 100 becomes an engine fact — each
// category owns a share of the daily pick cap. Pure math, no I/O.
import type { Strategy } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';

export function mixPct(category: Strategy, s: Settings): number {
  switch (category) {
    case 'ARB': return s.mixArbPct;
    case 'MIDDLE': return s.mixMiddlePct;
    case 'EV': return s.mixEvPct;
  }
}

/** 0% means none, ever; any positive share floors at 1 so a small cap can't starve a category. */
export function mixAllowance(category: Strategy, s: Settings): number {
  const pct = mixPct(category, s);
  if (pct <= 0) return 0;
  return Math.max(1, Math.round((s.dailyPickCap * pct) / 100));
}
```

In `server/src/api/routes.ts`, replace Plan 3's `settingsPatch` (and its rule constants) wholesale:

```ts
const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const HOUR_KEYS = new Set(['quietStartHour', 'quietEndHour']);
/** Keys allowed to be ≤ 0 or bounded enums (brain + settings-screen knobs). */
const RANGE_RULES: Record<string, { min: number; max: number; integer: boolean }> = {
  heatWeightWithdrawal: { min: -100, max: 0, integer: false },
  anchorIdx: { min: 0, max: 2, integer: true },
  brainKillSwitch: { min: 0, max: 1, integer: true },
  anchorFallback: { min: 0, max: 2, integer: true },
  oneSportRule: { min: 0, max: 1, integer: true },
  journalMinPerDay: { min: 1, max: 4, integer: true },
  mixArbPct: { min: 0, max: 100, integer: true },
  mixMiddlePct: { min: 0, max: 100, integer: true },
  mixEvPct: { min: 0, max: 100, integer: true },
};
const MIX_KEYS = ['mixArbPct', 'mixMiddlePct', 'mixEvPct'] as const;
/** String-typed settings and their validators (null = ok, string = error message). */
const STRING_RULES: Record<string, (v: string) => string | null> = {
  whatsappNumber: (v) =>
    v === '' || /^\+\d[\d ]{6,18}$/.test(v) ? null : 'whatsappNumber must look like +1 604 555 0000 (or be empty)',
  disabledSports: (v) =>
    /^[a-z]*(,[a-z]+)*$/.test(v) ? null : 'disabledSports must be a comma-joined list of lowercase sport slugs',
};

function settingsPatch(body: unknown): { patch: Partial<Settings> } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const patch: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTINGS_KEYS.has(k)) return { error: `unknown setting: ${k}` };
    const stringRule = STRING_RULES[k];
    if (stringRule) {
      if (typeof v !== 'string') return { error: `${k} must be a string` };
      const err = stringRule(v);
      if (err !== null) return { error: err };
      patch[k] = v;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${k} must be a finite number` };
    const range = RANGE_RULES[k];
    if (range) {
      if (v < range.min || v > range.max) return { error: `${k} must be between ${range.min} and ${range.max}` };
      if (range.integer && !Number.isInteger(v)) return { error: `${k} must be an integer` };
    } else if (k === 'tolerancePct') {
      if (v < 0 || v > 100) return { error: 'tolerancePct must be between 0 and 100' };
    } else if (HOUR_KEYS.has(k)) {
      if (!Number.isInteger(v) || v < 0 || v > 23) return { error: `${k} must be an integer hour between 0 and 23` };
    } else if (v <= 0) {
      return { error: `${k} must be positive` };
    }
    patch[k] = v;
  }
  // STRATEGY MIX — LOCKED TO 100: the trio moves together or not at all.
  const mixTouched = MIX_KEYS.filter((k) => k in patch);
  if (mixTouched.length > 0) {
    if (mixTouched.length !== 3) return { error: 'mixArbPct, mixMiddlePct and mixEvPct must be patched together' };
    const sum = MIX_KEYS.reduce((acc, k) => acc + (patch[k] as number), 0);
    if (sum !== 100) return { error: 'strategy mix must sum to exactly 100' };
  }
  return { patch: patch as Partial<Settings> };
}

/** §5.7 is literal: advanced-expander keys journal their changes. */
const ADVANCED_JOURNAL_KEYS = new Set([
  'minArbMarginPct', 'minEvEdgePct', 'middleRatio', 'freshWindowSecs',
  'anchorFallback', 'sharpVelocityPerDayPerBook', 'marketBreadthPerWeekPerBook',
  'oneSportRule', 'goGentleHeat', 'stopHeat', 'journalMinPerDay', 'disabledSports',
]);
/** Calm-locked: editable only while every non-sharp book is green (§5.7 helper sentence). */
const SAFETY_KEYS = new Set([
  'sharpVelocityPerDayPerBook', 'marketBreadthPerWeekPerBook', 'oneSportRule', 'goGentleHeat', 'stopHeat',
]);
```

and replace the `PATCH /api/settings` handler with:

```ts
  app.patch('/api/settings', (req, res) => {
    const parsed = settingsPatch(req.body);
    if ('error' in parsed) return fail(res, 400, 'bad_request', parsed.error);
    if (Object.keys(parsed.patch).some((k) => SAFETY_KEYS.has(k))
      && repos.books.all().some((b) => !b.sharpExempt && b.health !== 'green')) {
      return fail(res, 409, 'conflict', 'account safety rules are locked while any book is amber or red');
    }
    const before = repos.settings.all();
    const settings = repos.settings.set(parsed.patch);
    for (const [k, v] of Object.entries(parsed.patch)) {
      if (ADVANCED_JOURNAL_KEYS.has(k) && before[k as keyof Settings] !== v) {
        repos.journal.add(clock(), `Settings changed: ${k} ${String(before[k as keyof Settings])} → ${String(v)}`);
      }
    }
    res.json({ settings });
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (every pre-existing test green — no existing key's rule changed; 8 new tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/shared server/src/db server/src/engine server/src/api
git commit -m "feat(server): settings keys + string/trio/calm-lock validation, books.enabled, mix allowances"
```

---

### Task 2: Engine wiring A — strategy-mix cap + book/sport eligibility (TDD)

**Files:**
- Create: `server/src/pipeline/eligibility.ts`, `server/src/pipeline/eligibility.test.ts`, `server/src/pipeline/mixcap.test.ts`
- Modify: `server/src/pipeline/scan.ts`, `server/src/pipeline/verify.ts`

**Interfaces:**
- Consumes: Task 1 (`mixAllowance`, `sentTodayByCategory`, `Book.enabled`, `disabledSports`).
- Produces: `eligibleQuotes`, the mix hold-back at promotion, eligibility at scan AND recheck — the panel knobs' observable engine behavior.

- [ ] **Step 1: Write the failing specs**

Create `server/src/pipeline/eligibility.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import type { Quote } from '../shared/types.js';
import { disabledSportSet, eligibleQuotes } from './eligibility.js';

function q(book: string, sport: string): Quote {
  return {
    book, sport, event: 'A vs B', market: 'moneyline', selection: 'home',
    odds: 2.0, line: null, fetchedAt: 0, eventStartsAt: 9_999,
  };
}

test('disabledSportSet parses the CSV, ignoring blanks', () => {
  expect(disabledSportSet({ ...DEFAULT_SETTINGS, disabledSports: '' }).size).toBe(0);
  const set = disabledSportSet({ ...DEFAULT_SETTINGS, disabledSports: 'soccer,tennis' });
  expect(set.has('soccer')).toBe(true);
  expect(set.has('hockey')).toBe(false);
});

test('eligibleQuotes drops disabled books and disabled sports, keeps the rest', () => {
  const r = Repos(openDb(':memory:'));
  r.books.setEnabled('bet365', 0);
  const books = r.books.all();
  const s = { ...DEFAULT_SETTINGS, disabledSports: 'tennis' };
  const quotes = [q('bet365', 'basketball'), q('fanduel', 'basketball'), q('unibet', 'tennis'), q('pinnacle', 'basketball')];
  expect(eligibleQuotes(quotes, books, s).map((x) => x.book)).toEqual(['fanduel', 'pinnacle']);
});
```

Create `server/src/pipeline/mixcap.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import type { OddsProvider, Quote, Trade } from '../shared/types.js';
import type { PipeDeps } from './scan.js';
import { runScan } from './scan.js';
import { runVerifyDue } from './verify.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const VNOW = NOW + 76_000;
const DAY = '2026-07-14';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frozen(base: OddsProvider): OddsProvider {
  let first: Quote[] | null = null;
  return {
    fetchQuotes(now: number): Quote[] {
      first ??= base.fetchQuotes(now);
      return first.map((x) => ({ ...x, fetchedAt: now }));
    },
  };
}

function mkDeps() {
  const repos = Repos(openDb(':memory:'));
  const rng = mulberry32(42);
  const deps: PipeDeps = {
    repos,
    provider: frozen(SimOddsProvider(rng)),
    sender: { sendVerified: () => {} },
    s: () => repos.settings.all(),
    rng,
  };
  return { deps, repos };
}

function sentSeed(id: string, category: Trade['category']): Trade {
  return {
    id, profileId: 1, category, event: `seed-${id}`, sport: 'basketball',
    legs: [{ book: 'seedbook', selection: 'home', odds: 2.0, stakeCents: 1_500 }],
    marginInitial: 0.03, marginRecheck: 0.03, marginFinal: 0.03, status: 'VERIFIED',
    killReason: null, resultCents: null, createdAt: NOW - 1_000, verifyDueAt: NOW - 1_000,
    verifiedAt: NOW - 1_000, freshUntil: NOW + 120_000, settledAt: null, eventStartsAt: NOW + 9_999_999,
  };
}

test('a category at its mix allowance is held back with the mix clause; others promote', () => {
  const { deps, repos } = mkDeps();
  // ARB allowance at defaults = 6; seed 6 sent ARBs today.
  for (let i = 0; i < 6; i += 1) repos.trades.insert(sentSeed(`arb-${i}`, 'ARB'), DAY, null);
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);
  runVerifyDue(deps, VNOW);
  expect(repos.trades.sentTodayByCategory(DAY, 'ARB')).toBe(6); // no 7th ARB, ever
  const texts = repos.journal.all().map((j) => j.text);
  expect(texts.some((t) => t.includes('held back — ARB mix at its 47% cap'))).toBe(true);
  // The other categories were NOT starved by the ARB cap.
  const promotedCats = repos.trades.byStatus('VERIFIED')
    .filter((t) => !t.id.startsWith('arb-')).map((t) => t.category);
  expect(promotedCats.length).toBeGreaterThan(0);
  expect(promotedCats.every((c) => c !== 'ARB')).toBe(true);
});

test('a 0% mix share promotes nothing of that category', () => {
  const { deps, repos } = mkDeps();
  repos.settings.set({ mixArbPct: 71, mixMiddlePct: 0, mixEvPct: 29 });
  const scan = runScan(deps, NOW);
  expect(scan.created).toBeGreaterThan(0);
  runVerifyDue(deps, VNOW);
  expect(repos.trades.byStatus('VERIFIED').every((t) => t.category !== 'MIDDLE')).toBe(true);
  expect(repos.trades.sentTodayByCategory(DAY, 'MIDDLE')).toBe(0);
});

test('a disabled book produces no candidates at scan', () => {
  const { deps, repos } = mkDeps();
  const probe = mkDeps(); // same seed → same snapshot; find a soft book that quotes
  const probeScan = runScan(probe.deps, NOW);
  expect(probeScan.created).toBeGreaterThan(0);
  const probeBooks = new Set(
    [...probe.repos.trades.byStatus('PENDING'), ...probe.repos.trades.byStatus('KILLED')]
      .flatMap((t) => t.legs.map((l) => l.book)).filter((b) => b !== 'pinnacle'),
  );
  const target = [...probeBooks].sort()[0]!;
  repos.books.setEnabled(target, 0);
  runScan(deps, NOW);
  const legBooks = [...repos.trades.byStatus('PENDING'), ...repos.trades.byStatus('KILLED')]
    .flatMap((t) => t.legs.map((l) => l.book));
  expect(legBooks).not.toContain(target);
});

test('a disabled sport produces no candidates of that sport', () => {
  const { deps, repos } = mkDeps();
  const probe = mkDeps();
  runScan(probe.deps, NOW);
  const sports = [...new Set(
    [...probe.repos.trades.byStatus('PENDING'), ...probe.repos.trades.byStatus('KILLED')].map((t) => t.sport),
  )].sort();
  expect(sports.length).toBeGreaterThan(0);
  const target = sports[0]!;
  repos.settings.set({ disabledSports: target });
  runScan(deps, NOW);
  const created = [...repos.trades.byStatus('PENDING'), ...repos.trades.byStatus('KILLED')];
  expect(created.every((t) => t.sport !== target)).toBe(true);
});

test('disabling a pending trade\'s book mid-flight kills it QUOTE_STALE at the recheck', () => {
  const { deps, repos } = mkDeps();
  runScan(deps, NOW);
  const pending = repos.trades.byStatus('PENDING');
  expect(pending.length).toBeGreaterThan(0);
  const victim = pending[0]!;
  const book = victim.legs.map((l) => l.book).find((b) => b !== 'pinnacle') ?? victim.legs[0]!.book;
  repos.books.setEnabled(book, 0);
  runVerifyDue(deps, VNOW);
  const after = repos.trades.byId(victim.id)!;
  expect(after.status).toBe('KILLED');
  expect(after.killReason).toBe('QUOTE_STALE'); // the quote is no longer available TO US
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- eligibility mixcap`
Expected: FAIL — cannot find module `./eligibility.js`; mix clause never written.

- [ ] **Step 3: Implement**

Create `server/src/pipeline/eligibility.ts`:

```ts
// Quote eligibility (Plan 5, Design §4): MY BOOKS ON/OFF and SPORTS & LEAGUES
// become a pure filter applied at BOTH ends of the pipe. Pure — no I/O.
import type { Quote } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Book } from '../db/repos.js';

export function disabledSportSet(s: Settings): Set<string> {
  return new Set(s.disabledSports.split(',').map((x) => x.trim()).filter((x) => x !== ''));
}

/** Quotes we are allowed to act on: book ON and sport ON. The caller keeps the
 *  FULL snapshot for the benchmark — the anchor is never a bet. */
export function eligibleQuotes(quotes: Quote[], books: Book[], s: Settings): Quote[] {
  const off = new Set(books.filter((b) => b.enabled === 0).map((b) => b.name));
  const sportsOff = disabledSportSet(s);
  return quotes.filter((q) => !off.has(q.book) && !sportsOff.has(q.sport));
}
```

In `server/src/pipeline/scan.ts`, add the import:

```ts
import { eligibleQuotes } from './eligibility.js';
```

materialize the roster once — replace:

```ts
  const day = dayKey(now);
  const ctx: GateContext = {
    now,
    s,
    books: new Map(repos.books.all().map((b) => [b.name, b])),
```

with:

```ts
  const day = dayKey(now);
  const allBooks = repos.books.all();
  const ctx: GateContext = {
    now,
    s,
    books: new Map(allBooks.map((b) => [b.name, b])),
```

and feed detection only eligible quotes — replace:

```ts
  detectCandidates(quotes, s).forEach((c, i) => {
```

with:

```ts
  // Plan 5: disabled books/sports never become candidates; the full snapshot
  // stays cached (deps.lastQuotes) for the UI and the pinnacle benchmark.
  detectCandidates(eligibleQuotes(quotes, allBooks, s), s).forEach((c, i) => {
```

In `server/src/pipeline/verify.ts`, add the imports:

```ts
import { mixAllowance, mixPct } from '../engine/mix.js';
import { eligibleQuotes } from './eligibility.js';
```

apply eligibility to the leg lookup — replace:

```ts
  const quotes = deps.provider.fetchQuotes(now);
  deps.lastQuotes = quotes;
  const lookup = buildLookup(quotes);
```

with:

```ts
  const quotes = deps.provider.fetchQuotes(now);
  deps.lastQuotes = quotes;
  // Plan 5: legs must still be ELIGIBLE (book on, sport on) — a disabled leg reads
  // as no-quote and the trade dies QUOTE_STALE. The benchmark keeps the FULL snapshot.
  const lookup = buildLookup(eligibleQuotes(quotes, repos.books.all(), s));
```

and add the mix hold-back directly AFTER the daily-pick-cap block (same shape, same held-back semantics):

```ts
    // STRATEGY MIX — LOCKED TO 100 (Plan 5): the category's share of the daily cap.
    // Same SENT semantics as the cap; the clause feeds the brain's rationale panel.
    if (repos.trades.sentTodayByCategory(day, t.category) >= mixAllowance(t.category, s)) {
      t.status = 'EXPIRED';
      repos.trades.update(t);
      repos.journal.add(now, `${t.category} ${t.event} passed verification but was held back — ${t.category} mix at its ${mixPct(t.category, s)}% cap.`);
      expired += 1;
      continue;
    }
```

**Why every existing test stays green:** the daily-cap test's 11 seeds are all one category (its `mkTrade` default) — they exhaust that category's allowance, but the sim snapshot always plants candidates of the other categories, one of which becomes the 12th send; the test asserts `promoted === 1` and counts, never identities. The `dailyPickCap: 100`/`1000` tests promote ~2 per category — far under the 47/24/29 allowances. If the seeded rng ever shifts the snapshot so no other-category candidate exists, amend that test's seeds to `category: 'EV'` for `i >= 6` (splitting the 11 across categories) — the assertions stay untouched.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (7 new tests; every pre-existing pipeline/api test still green), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/pipeline server/src/engine
git commit -m "feat(server): strategy-mix promotion cap + book/sport eligibility at scan and recheck"
```

---

### Task 3: Engine wiring B — one-sport toggle, pricer fallback, journal minimum (TDD)

**Files:**
- Modify: `server/src/engine/gates.ts`, `server/src/engine/gates.test.ts`, `server/src/pipeline/candidates.ts`, `server/src/pipeline/candidates.test.ts`, `server/src/pipeline/verify.ts`, `server/src/scheduler/runner.ts`
- Create: `server/src/brain/journalMin.ts`, `server/src/brain/journalMin.test.ts`

**Interfaces:**
- Consumes: Task 1 keys; Plan 3's `displayName` and repo queries (`countToday`, `killedTodayByReason`).
- Produces: `oneSportRule` gate toggle, `anchorFallback` detection + recheck behavior, `ensureJournalMinimum` on the tick.

- [ ] **Step 1: Write the failing specs**

Append to `server/src/engine/gates.test.ts` (self-contained fixtures — adapt nothing):

```ts
test('oneSportRule 0 skips the sport check but never the unknown-book kill', () => {
  const s0 = { ...DEFAULT_SETTINGS, oneSportRule: 0 };
  const books = new Map<string, Book>([
    ['bet365', { name: 'bet365', sport: 'soccer', sharpExempt: 0, heat: 0, health: 'green', maxBeliefCents: null, enabled: 1 }],
  ]);
  const ctx: GateContext = {
    now: 1_000, books, s: s0,
    sentTodayByBook: () => 0, sentThisWeekByBookMarket: () => 0,
  };
  const c: Candidate = {
    category: 'EV', sport: 'basketball', event: 'A vs B', market: 'moneyline',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.5, fetchedAt: 1_000 }],
    edge: 0.03, fairProbs: [0.42], eventStartsAt: 9_999,
  };
  expect(runKillBattery(c, ctx)).toEqual({ verdict: 'pass' }); // wrong sport, rule off → pass
  expect(runKillBattery(c, { ...ctx, s: DEFAULT_SETTINGS }))
    .toEqual({ verdict: 'kill', reason: 'ONE_SPORT_RULE' });   // rule on → kill
  const unknown = { ...c, legs: [{ book: 'nobody', selection: 'home', odds: 2.5, fetchedAt: 1_000 }] };
  expect(runKillBattery(unknown, ctx)).toEqual({ verdict: 'kill', reason: 'ONE_SPORT_RULE' }); // unconditional
});
```

(Use the file's existing imports; add `DEFAULT_SETTINGS`, `Book`, `GateContext`, `Candidate` to them if missing.)

Append to `server/src/pipeline/candidates.test.ts`:

```ts
function anchorlessGroup(): Quote[] {
  // Two-sided moneyline quoted by soft books only — no pinnacle anywhere.
  const base = { event: 'X vs Y', sport: 'basketball', market: 'moneyline', line: null, fetchedAt: 0, eventStartsAt: 9_999 };
  return [
    { ...base, book: 'bet365', selection: 'home', odds: 2.3 },
    { ...base, book: 'fanduel', selection: 'home', odds: 2.02 },
    { ...base, book: 'bet365', selection: 'away', odds: 1.9 },
    { ...base, book: 'fanduel', selection: 'away', odds: 1.88 },
  ];
}

test('anchor down + FALL BACK TO CONSENSUS: EV detects against the consensus devig', () => {
  const s = { ...DEFAULT_SETTINGS, anchorFallback: 0, minEvEdgePct: 2.0 };
  const out = detectCandidates(anchorlessGroup(), s);
  const evs = out.filter((c) => c.category === 'EV');
  // consensus devig of best odds (2.3 / 1.9): fair home = (1/2.3)/(1/2.3 + 1/1.9) = 0.4524
  // bet365 home edge = 0.4524 × 2.3 − 1 = +4.05% → candidate; every other quote is under the bar
  expect(evs).toHaveLength(1);
  expect(evs[0]!.legs[0]).toMatchObject({ book: 'bet365', selection: 'home' });
  expect(evs[0]!.edge).toBeCloseTo(0.0405, 3);
});

test('anchor down + PAUSE EV+MIDDLES: arbs continue, nothing else', () => {
  const s = { ...DEFAULT_SETTINGS, anchorFallback: 1, minArbMarginPct: 0.5 };
  // 2.3 / 1.9 best-line arb margin = 1 − (1/2.3 + 1/1.9) = 0.0083 → 0.83% ≥ 0.5% qualifies
  const out = detectCandidates(anchorlessGroup(), s);
  expect(out.some((c) => c.category === 'ARB')).toBe(true);
  expect(out.every((c) => c.category === 'ARB')).toBe(true);
});

test('anchor down + PAUSE EVERYTHING: no candidates at all', () => {
  const s = { ...DEFAULT_SETTINGS, anchorFallback: 2, minArbMarginPct: 0.5 };
  expect(detectCandidates(anchorlessGroup(), s)).toEqual([]);
});

test('anchor up: fallback setting is inert — pinnacle stays the benchmark', () => {
  const withPinnacle = [
    ...anchorlessGroup(),
    { event: 'X vs Y', sport: 'basketball', market: 'moneyline', line: null, fetchedAt: 0, eventStartsAt: 9_999, book: 'pinnacle', selection: 'home', odds: 2.1 },
    { event: 'X vs Y', sport: 'basketball', market: 'moneyline', line: null, fetchedAt: 0, eventStartsAt: 9_999, book: 'pinnacle', selection: 'away', odds: 1.8 },
  ];
  const paused = detectCandidates(withPinnacle, { ...DEFAULT_SETTINGS, anchorFallback: 2 });
  expect(paused.some((c) => c.category === 'EV')).toBe(true); // anchor present → nothing pauses
});
```

(Reuse the file's `Quote` import and `DEFAULT_SETTINGS` import; the literals are complete rows so no local helpers are needed beyond `anchorlessGroup`.)

Create `server/src/brain/journalMin.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { ensureJournalMinimum } from './journalMin.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT

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

test('writes deterministic observations up to the minimum, then stops', () => {
  const deps = mkDeps();
  deps.repos.settings.set({ journalMinPerDay: 3 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(3);
  const texts = deps.repos.journal.all().map((j) => j.text);
  expect(texts[0]).toMatch(/^Watch list: /);
  expect(texts[1]).toBe('Today so far: 0 candidates · 0 sent · 0 killed');
  expect(texts[2]).toBe('Credits used this month: 0 of 100,000');
  expect(ensureJournalMinimum(deps, NOW + 60_000)).toBe(0); // minimum already met today
});

test('existing entries today count toward the minimum', () => {
  const deps = mkDeps();
  deps.repos.journal.add(NOW - 1_000, 'Daily check: …');
  expect(ensureJournalMinimum(deps, NOW)).toBe(0); // min 1, one entry exists
  deps.repos.settings.set({ journalMinPerDay: 2 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(1); // tops up exactly one
});

test('the kill switch stops autonomous writing', () => {
  const deps = mkDeps();
  deps.repos.settings.set({ brainKillSwitch: 1, journalMinPerDay: 4 });
  expect(ensureJournalMinimum(deps, NOW)).toBe(0);
  expect(deps.repos.journal.all()).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- gates candidates journalMin`
Expected: FAIL — sport check unconditional, fallback unreads, missing module `./journalMin.js`.

- [ ] **Step 3: Implement**

In `server/src/engine/gates.ts`, replace the gate-1 sport-check line:

```ts
// OLD
    if (!book.sharpExempt && book.sport !== c.sport) return kill('ONE_SPORT_RULE');
// NEW — ONE-SPORT RULE is a knob (Plan 5); the unknown-book kill above stays unconditional
    if (s.oneSportRule !== 0 && !book.sharpExempt && book.sport !== c.sport) return kill('ONE_SPORT_RULE');
```

In `server/src/pipeline/candidates.ts`, replace the `detectCandidates` body:

```ts
export function detectCandidates(quotes: Quote[], s: Settings): Candidate[] {
  // Engine odds math assumes odds > 1 — callers own hygiene, so drop garbage here.
  const clean = quotes.filter((q) => q.odds > 1);

  // REFERENCE PRICER FALLBACK (Plan 5): binds ONLY when the snapshot carries no
  // anchor at all. In sim the provider always quotes pinnacle, so this is dormant
  // until a live outage — proven by stub providers, never by faking one.
  const anchorUp = clean.some((q) => q.book === PINNACLE);
  if (!anchorUp && s.anchorFallback === 2) return []; // PAUSE EVERYTHING

  const groups = new Map<string, Quote[]>();
  for (const q of clean) {
    const key = `${q.event}\u0000${q.market}\u0000${q.line === null ? 'ML' : Math.abs(q.line)}`;
    const group = groups.get(key);
    if (group) group.push(q);
    else groups.set(key, [q]);
  }

  const out: Candidate[] = [];
  for (const group of groups.values()) detectArbs(group, s, out);
  if (anchorUp) {
    for (const group of groups.values()) detectEvs(group, s, out);
    detectMiddles(clean, s, out);
  } else if (s.anchorFallback === 0) {
    // FALL BACK TO CONSENSUS (DEFAULT): devig the best odds across ALL books.
    for (const group of groups.values()) detectEvsConsensus(group, s, out);
    detectMiddles(clean, s, out);
  }
  // anchorFallback === 1: PAUSE EV + MIDDLES, ARBS CONTINUE — nothing more.
  return out;
}
```

and add below `detectEvs`:

```ts
/**
 * Consensus EV (anchor down, fallback 0): the benchmark devigs the BEST odds per
 * selection across every book in the line group (≥ 2 selections). Only prices
 * that beat even the market's own best-price consensus qualify.
 */
function detectEvsConsensus(group: Quote[], s: Settings, out: Candidate[]): void {
  const bestBySelection = new Map<string, Quote>();
  for (const q of group) {
    const best = bestBySelection.get(q.selection);
    if (!best || q.odds > best.odds) bestBySelection.set(q.selection, q);
  }
  if (bestBySelection.size < 2) return;
  const selections = [...bestBySelection.keys()];
  const fair = devigFairProbs(selections.map((sel) => bestBySelection.get(sel)!.odds));
  const fairBySelection = new Map(selections.map((sel, i) => [sel, fair[i]!]));
  for (const q of group) {
    const fairProb = fairBySelection.get(q.selection);
    if (fairProb === undefined) continue;
    const edge = evEdge(fairProb, q.odds);
    if (edge < s.minEvEdgePct / 100) continue;
    out.push({ category: 'EV', ...base(q), legs: [toLeg(q)], edge, fairProbs: [fairProb] });
  }
}
```

In `server/src/pipeline/verify.ts`, make the recheck fallback-aware. Change `recomputeEdge`'s signature and EV branch:

```ts
// OLD signature + call site
    const recheck = recomputeEdge(t, fresh, quotes);
…
function recomputeEdge(t: Trade, fresh: Quote[], all: Quote[]): Recheck | null {
…
      const p = pinnacleFairProb(all, fresh[0]!);

// NEW signature + call site
    const recheck = recomputeEdge(t, fresh, quotes, s);
…
function recomputeEdge(t: Trade, fresh: Quote[], all: Quote[], s: Settings): Recheck | null {
…
      const p = fairProbForLeg(all, fresh[0]!, s);
```

and add below `pinnacleFairProb`:

```ts
/** Pinnacle first; consensus only under FALL BACK TO CONSENSUS; otherwise the
 *  benchmark is gone and the caller's QUOTE_STALE path handles it. */
function fairProbForLeg(all: Quote[], legQuote: Quote, s: Settings): number | null {
  const p = pinnacleFairProb(all, legQuote);
  if (p !== null) return p;
  if (s.anchorFallback !== 0) return null;
  return consensusFairProb(all, legQuote);
}

/** pinnacleFairProb without the book filter: best odds per selection across ALL books. */
function consensusFairProb(all: Quote[], legQuote: Quote): number | null {
  const group = lineGroup(legQuote);
  const bestBySelection = new Map<string, Quote>();
  for (const q of all) {
    if (q.event !== legQuote.event || q.market !== legQuote.market) continue;
    if (lineGroup(q) !== group) continue;
    const cur = bestBySelection.get(q.selection);
    if (!cur || q.odds > cur.odds) bestBySelection.set(q.selection, q);
  }
  if (bestBySelection.size < 2) return null;
  const selections = [...bestBySelection.keys()];
  const probs = devigFairProbs(selections.map((sel) => bestBySelection.get(sel)!.odds));
  const i = selections.indexOf(legQuote.selection);
  return i === -1 ? null : probs[i]!;
}
```

Create `server/src/brain/journalMin.ts`:

```ts
// Journal minimum (Plan 5, Design §7): "The brain always writes at least this
// many entries and as many more as it wants." Deterministic observations from
// live tables, riding the scan tick — no timers, no LLM, no fabrication.
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName } from './pass.js';

/** Appends observation lines until today's journal count reaches journalMinPerDay
 *  (at most 3 supplementary lines — where distinct honest observations end, so does
 *  the knob's range). Kill switch on → writes nothing (autonomy stopped). */
export function ensureJournalMinimum(deps: PipeDeps, now: number): number {
  const s = deps.s();
  if (s.brainKillSwitch !== 0) return 0;
  const day = dayKey(now);
  const existing = deps.repos.journal.all().filter((j) => dayKey(j.ts) === day).length;
  const need = Math.min(3, Math.max(0, s.journalMinPerDay - existing));
  if (need === 0) return 0;
  const lines = observationLines(deps, now, day).slice(0, need);
  for (const line of lines) deps.repos.journal.add(now, line);
  return lines.length;
}

function observationLines(deps: PipeDeps, now: number, day: string): string[] {
  const { repos } = deps;
  const s = deps.s();
  const hottest = repos.books.all()
    .filter((b) => b.sharpExempt === 0)
    .sort((a, b) => b.heat - a.heat || (a.name < b.name ? -1 : 1))
    .slice(0, 3);
  const killed = Object.values(repos.trades.killedTodayByReason(day)).reduce((sum, n) => sum + (n ?? 0), 0);
  const monthKey = day.slice(0, 7);
  const used = repos.credits.all()
    .filter((c) => dayKey(c.ts).startsWith(monthKey))
    .reduce((sum, c) => sum + c.n, 0);
  return [
    `Watch list: ${hottest.map((b) => `${displayName(b.name)} ${b.heat}`).join(' · ')}`,
    `Today so far: ${repos.trades.countToday(day)} candidates · ${repos.trades.verifiedSentToday(day)} sent · ${killed} killed`,
    `Credits used this month: ${used.toLocaleString('en-US')} of ${s.creditPlanMonthly.toLocaleString('en-US')}`,
  ];
}
```

In `server/src/scheduler/runner.ts`, add the import:

```ts
import { ensureJournalMinimum } from '../brain/journalMin.js';
```

and add one line to `doScan`, directly after the `brainPassIfDue(deps, now);` line (Plan 3's version of the function):

```ts
    ensureJournalMinimum(deps, now); // JOURNAL MINIMUM knob rides the same tick — no timers
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (8 new tests; existing gates/candidates tests untouched and green — defaults preserve old behavior), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine server/src/pipeline server/src/brain server/src/scheduler
git commit -m "feat(server): one-sport toggle, reference-pricer fallback, journal minimum on the tick"
```

---

### Task 4: Settings view read model + routes (view, books, whatsapp stub, exports)

**Files:**
- Create: `server/src/settings/report.ts`
- Modify: `server/src/api/routes.ts`, `server/src/api/api.test.ts`

**Interfaces:**
- Consumes: everything server-side above; Plan 3's `displayName`, `lastPass`, `eventsLog.byKind`.
- Produces: `buildSettingsView`, `tradesCsv`, and the five routes — the client's entire diet.

- [ ] **Step 1: Write the failing spec** — append to `server/src/api/api.test.ts`:

```ts
test('GET /api/settings/view: one payload, live derivations, sim-honest fields', async () => {
  const h = makeApp();
  await promoteSome(h); // burn credits, write scan events, make some rows
  const res = await request(h.app).get('/api/settings/view');
  expect(res.status).toBe(200);
  const v = res.body;
  expect(v.mode).toBe('SIMULATED');
  expect(v.settings.mixArbPct).toBe(47);
  expect(v.forecaster.planMonthly).toBe(100_000);
  expect(v.forecaster.usedThisMonth).toBeGreaterThan(0);
  expect(v.forecaster.dailyAllowance).toBe(3_333); // floor(100_000 / 30)
  expect(v.forecaster.remaining).toBe(100_000 - v.forecaster.usedThisMonth);
  expect(v.brain.llmSpentCents).toBe(0); // honest zero until Plan 6 spends
  expect(v.brain.llmCapCents).toBe(300);
  expect(v.brain.weightsCustom).toBe(false);
  expect(v.books).toHaveLength(16);
  expect(v.books[0]).toMatchObject({ name: 'pinnacle', sharpExempt: true, enabled: true });
  expect(v.sports.map((x: { sport: string }) => x.sport))
    .toEqual(['baseball', 'basketball', 'hockey', 'soccer', 'tennis']);
  expect(v.safetyLocked).toBe(false);
  expect(v.memory.receipts).toBeGreaterThan(0);
  expect(v.lastTickAt).not.toBeNull();
  expect(v.backups).toEqual({ lastAt: null, keep: 14 });

  await request(h.app).patch('/api/settings').send({ heatWeightLimit: 30 });
  const custom = (await request(h.app).get('/api/settings/view')).body;
  expect(custom.brain.weightsCustom).toBe(true);
  h.repos.books.update('bet365', 41, 'yellow', null);
  expect((await request(h.app).get('/api/settings/view')).body.safetyLocked).toBe(true);
});

test('PATCH /api/books/:name: toggles + sport changes journal; sharp books refuse', async () => {
  const h = makeApp();
  const off = await request(h.app).patch('/api/books/bet365').send({ enabled: 0 });
  expect(off.status).toBe(200);
  expect(off.body.book).toMatchObject({ name: 'bet365', enabled: false });
  const sport = await request(h.app).patch('/api/books/bet365').send({ sport: 'tennis' });
  expect(sport.status).toBe(200);
  expect(sport.body.book.sport).toBe('tennis');
  const texts = h.repos.journal.all().map((j) => j.text);
  expect(texts).toContain('Books: bet365 turned OFF');
  expect(texts).toContain('Books: bet365 sport basketball → tennis');

  expect((await request(h.app).patch('/api/books/pinnacle').send({ enabled: 0 })).status).toBe(409);
  expect((await request(h.app).patch('/api/books/nobody').send({ enabled: 0 })).status).toBe(404);
  expect((await request(h.app).patch('/api/books/bet365').send({ sport: 'cricket' })).status).toBe(400);
  expect((await request(h.app).patch('/api/books/bet365').send({})).status).toBe(400);
});

test('POST /api/whatsapp/test: writes the event, sends NOTHING anywhere', async () => {
  const h = makeApp();
  const res = await request(h.app).post('/api/whatsapp/test');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, simulated: true });
  const rows = h.repos.eventsLog.all().filter((e) => e.kind === 'wa_test');
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toEqual({ to: null, simulated: true }); // no number set yet
});

test('exports: complete deterministic dumps, no mutation', async () => {
  const h = makeApp();
  await promoteSome(h);
  const csv = await request(h.app).get('/api/export/trades.csv');
  expect(csv.status).toBe(200);
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.headers['content-disposition']).toContain('evil-eye-trades.csv');
  const lines = csv.text.split('\n');
  expect(lines[0]!.startsWith('id,')).toBe(true);
  expect(lines[0]!).toContain('day_key');
  expect(lines.length - 1).toBe(h.repos.trades.exportRows().length); // header + one line per trade

  const json = await request(h.app).get('/api/export/all.json');
  expect(json.status).toBe(200);
  expect(json.headers['content-disposition']).toContain('evil-eye-export.json');
  for (const table of ['settings', 'profiles', 'books', 'trades', 'journal', 'eventsLog', 'creditsUsage', 'limitsReports', 'bankrollSnapshots']) {
    expect(json.body).toHaveProperty(table);
  }
  const again = await request(h.app).get('/api/export/all.json');
  expect(again.body).toEqual(json.body); // read-only — nothing moved
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- api`
Expected: FAIL — 404 on the new routes.

- [ ] **Step 3: Implement `server/src/settings/report.ts`**

```ts
// Settings view (Plan 5): ONE deterministic serialization of everything the
// SETTINGS screen renders beyond the raw store. Read-only. Client mirror:
// client/src/lib/settings.ts. Every number names its source table.
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName, lastPass, type PassPayload } from '../brain/pass.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';
import { disabledSportSet } from '../pipeline/eligibility.js';

const DAY_MS = 86_400_000;
/** $3/month hard cap — Plan 6 enforces the spend; Plan 5 displays it honestly. */
export const LLM_CAP_CENTS = 300;

export interface SettingsBookView {
  name: string; displayName: string; sport: string; sharpExempt: boolean; enabled: boolean;
}

export interface SettingsView {
  mode: 'SIMULATED';
  settings: Settings;
  forecaster: {
    projectedPerDay: number; dailyAllowance: number; usedThisMonth: number;
    monthEndProjection: number; planMonthly: number; remaining: number; runwayDays: number;
  };
  brain: {
    lastPassAt: number | null; lastPassBooks: number | null;
    llmSpentCents: number; llmCapCents: number; weightsCustom: boolean;
  };
  books: SettingsBookView[];
  sports: { sport: string; enabled: boolean }[];
  safetyLocked: boolean;
  memory: { receipts: number; journalEntries: number };
  lastTickAt: number | null;
  backups: { lastAt: number | null; keep: 14 };
}

export function buildSettingsView(deps: PipeDeps, now: number): SettingsView {
  const { repos } = deps;
  const s = deps.s();
  const day = dayKey(now);
  const monthKey = day.slice(0, 7);

  // CREDIT FORECASTER ← credits_usage (same math family as the brain's CREDITS tile).
  const creditRows = repos.credits.all();
  const usedThisMonth = creditRows
    .filter((c) => dayKey(c.ts).startsWith(monthKey))
    .reduce((sum, c) => sum + c.n, 0);
  const used7d = creditRows.filter((c) => now - c.ts <= 7 * DAY_MS).reduce((sum, c) => sum + c.n, 0);
  const projectedPerDay = Math.round(used7d / 7);
  const remaining = Math.max(0, s.creditPlanMonthly - usedThisMonth);

  const books = repos.books.all();
  const weightsCustom =
    s.heatWeightLimit !== DEFAULT_SETTINGS.heatWeightLimit
    || s.heatWeightReject !== DEFAULT_SETTINGS.heatWeightReject
    || s.heatWeightCut !== DEFAULT_SETTINGS.heatWeightCut
    || s.heatWeightWithdrawal !== DEFAULT_SETTINGS.heatWeightWithdrawal
    || s.heatHalfLifeDays !== DEFAULT_SETTINGS.heatHalfLifeDays;

  const last = lastPass(repos);
  const llmSpentCents = repos.eventsLog.byKind('llm_spend')
    .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costCents?: number }).costCents ?? 0), 0);
  const scans = repos.eventsLog.byKind('scan');
  const backupRows = repos.eventsLog.byKind('backup'); // Plan 6 writes these
  const disabled = disabledSportSet(s);
  const sports = [...new Set(books.filter((b) => b.sport !== 'ANY').map((b) => b.sport))].sort();

  return {
    mode: 'SIMULATED',
    settings: s,
    forecaster: {
      projectedPerDay,
      dailyAllowance: Math.floor(s.creditPlanMonthly / 30),
      usedThisMonth,
      monthEndProjection: usedThisMonth + projectedPerDay * daysLeftInMonth(day),
      planMonthly: s.creditPlanMonthly,
      remaining,
      runwayDays: Math.floor(remaining / Math.max(1, used7d / 7)),
    },
    brain: {
      lastPassAt: last?.ts ?? null,
      lastPassBooks: last ? Object.keys((last.payload as PassPayload).heats).length : null,
      llmSpentCents,
      llmCapCents: LLM_CAP_CENTS,
      weightsCustom,
    },
    books: books.map((b) => ({
      name: b.name, displayName: displayName(b.name), sport: b.sport,
      sharpExempt: b.sharpExempt === 1, enabled: b.enabled === 1,
    })),
    sports: sports.map((sport) => ({ sport, enabled: !disabled.has(sport) })),
    safetyLocked: books.some((b) => b.sharpExempt === 0 && b.health !== 'green'),
    memory: { receipts: repos.trades.exportRows().length, journalEntries: repos.journal.all().length },
    lastTickAt: scans.length > 0 ? scans[scans.length - 1]!.ts : null,
    backups: { lastAt: backupRows.length > 0 ? backupRows[backupRows.length - 1]!.ts : null, keep: 14 },
  };
}

function daysLeftInMonth(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, daysInMonth - d);
}

/** RFC-4180: quote fields containing comma/quote/newline; double inner quotes. */
export function tradesCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    const raw = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','));
  return lines.join('\n');
}
```

(If Plan 3's `lastPass` return type already narrows `payload` to `PassPayload`, drop the cast — the import stays for the type.)

In `server/src/api/routes.ts`, add the imports:

```ts
import { buildSettingsView, tradesCsv } from '../settings/report.js';
```

(`displayName` from `../brain/pass.js` is already imported by Plan 3's routes; add it to that import list if not.) Register the routes after the settings handlers, before the 404 catch-all:

```ts
  app.get('/api/settings/view', (_req, res) => {
    res.json(buildSettingsView(deps, clock()));
  });

  app.patch('/api/books/:name', (req, res) => {
    const book = repos.books.byName(req.params.name);
    if (!book) return fail(res, 404, 'not_found', 'no such book');
    const { enabled, sport } = (req.body ?? {}) as { enabled?: unknown; sport?: unknown };
    if (enabled === undefined && sport === undefined) return fail(res, 400, 'bad_request', 'nothing to change');
    if (book.sharpExempt === 1) return fail(res, 409, 'conflict', 'sharp books are always on');
    if (enabled !== undefined && enabled !== 0 && enabled !== 1) {
      return fail(res, 400, 'bad_request', 'enabled must be 0 or 1');
    }
    const roster = new Set(repos.books.all().filter((b) => b.sport !== 'ANY').map((b) => b.sport));
    if (sport !== undefined && (typeof sport !== 'string' || !roster.has(sport))) {
      return fail(res, 400, 'bad_request', 'sport must be one of the roster sports');
    }
    // Changes here are written to the brain journal (§5.7 — literal).
    if (enabled !== undefined && enabled !== book.enabled) {
      repos.books.setEnabled(book.name, enabled);
      repos.journal.add(clock(), `Books: ${displayName(book.name)} turned ${enabled === 1 ? 'ON' : 'OFF'}`);
    }
    if (sport !== undefined && sport !== book.sport) {
      repos.books.setSport(book.name, sport);
      repos.journal.add(clock(), `Books: ${displayName(book.name)} sport ${book.sport} → ${sport}`);
    }
    const b = repos.books.byName(book.name)!;
    res.json({
      book: {
        name: b.name, displayName: displayName(b.name), sport: b.sport,
        sharpExempt: b.sharpExempt === 1, enabled: b.enabled === 1,
      },
    });
  });

  app.post('/api/whatsapp/test', (_req, res) => {
    // Plan 5 stub: sim sends NOTHING anywhere — the event row is the whole effect.
    // Plan 6 swaps these internals behind the same route (dev-mode seams only).
    repos.eventsLog.add(clock(), 'wa_test', JSON.stringify({ to: deps.s().whatsappNumber || null, simulated: true }));
    res.json({ ok: true, simulated: true });
  });

  app.get('/api/export/trades.csv', (_req, res) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="evil-eye-trades.csv"');
    res.send(tradesCsv(repos.trades.exportColumns(), repos.trades.exportRows()));
  });

  app.get('/api/export/all.json', (_req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="evil-eye-export.json"');
    res.json({
      exportedAt: clock(),
      settings: repos.settings.all(),
      profiles: repos.profiles.all(),
      books: repos.books.all(),
      trades: repos.trades.exportRows(),
      journal: repos.journal.all(),
      eventsLog: repos.eventsLog.all(),
      creditsUsage: repos.credits.all(),
      limitsReports: repos.limitsReports.all(),
      bankrollSnapshots: repos.profiles.all().flatMap((p) => repos.snapshots.byProfile(p.id)),
    });
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full server suite PASS (4 new API tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/settings server/src/api
git commit -m "feat(server): settings view read model, book routes, whatsapp stub, whole-table exports"
```

---

### Task 5: Client contract mirror + pure display helpers (TDD)

**Files:**
- Create: `client/src/lib/settings.ts`, `client/src/lib/settings.test.ts`, `client/src/hooks/useSettingsView.ts`
- Modify: `client/src/lib/api.ts` (append the four fetch helpers)

**Interfaces:**
- Consumes: `format.ts` (`formatCents`), type-only imports from `api.ts`.
- Produces (consumed by Tasks 6–10): the `SettingsView` mirror types and every pure helper in the contracts block; fetchers `fetchSettingsView`, `patchSettings`, `patchBook`, `sendWaTest`; hook `useSettingsView`.

- [ ] **Step 1: Write the failing spec** — `client/src/lib/settings.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  advSettingsToggle, backupsText, bookRow, cadenceText, consolidationText,
  fallbackItems, forecastRows, heatWeightsValue, journalMinText, killRuleRows,
  killSwitchValue, lastDigestText, lastTickText, llmBudgetText, memoryText,
  mixRows, planText, quietHoursText, rebalanceMix, riskRows, safetyRows,
  scanWindowText, sportCell, staleText, thresholdTexts, toleranceText,
  validWaNumber, verifyGapText,
} from './settings';

const S = {
  tolerancePct: 5, verifyGapSecs: 75, staleRemoveMin: 10, freshWindowSecs: 120,
  minArbMarginPct: 0.75, minEvEdgePct: 2.0, middleRatio: 1.5,
  kellyFraction: 0.25, kellyCapPct: 5, bankrollCents: 1_000_000,
  flatPairCents: 10_000, roundToCents: 500, minStakeCents: 1_000, dailyPickCap: 12,
  quietStartHour: 0, quietEndHour: 8, scanBaseMin: 20, scanHotMinMin: 5,
  scanHotMaxMin: 8, hotWindowHours: 2, sharpVelocityPerDayPerBook: 3,
  marketBreadthPerWeekPerBook: 2, goGentleHeat: 30, stopHeat: 60,
  heatWeightLimit: 23, heatWeightReject: 9, heatWeightCut: 14, heatWeightWithdrawal: -2,
  heatHalfLifeDays: 21, brainCadenceHours: 6, brainKillSwitch: 0, anchorIdx: 0,
  creditPlanMonthly: 100_000,
  mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,
  anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
  whatsappNumber: '', disabledSports: '',
};

test('SCAN RULES rows derive from the store — mockup strings at defaults', () => {
  expect(scanWindowText(S)).toBe('08:00 – 24:00 PT');
  expect(quietHoursText(S)).toBe('00:00 – 08:00 · NO SENDS, NO SCANS');
  expect(cadenceText(S)).toBe('BASE 20 MIN · 5–8 MIN < 2H TO START');
  expect(verifyGapText(S)).toBe('75 S');
  expect(staleText(S)).toBe('10 MIN');
  expect(scanWindowText({ ...S, quietEndHour: 9, quietStartHour: 1 })).toBe('09:00 – 01:00 PT');
});

test('CREDIT FORECASTER rows format live numbers, projection tinted yellow', () => {
  const f = {
    projectedPerDay: 2_306, dailyAllowance: 2_475, usedThisMonth: 40_000,
    monthEndProjection: 91_400, planMonthly: 100_000, remaining: 61_212, runwayDays: 19,
  };
  expect(forecastRows(f)).toEqual([
    ['PROJECTED CREDITS / DAY', '2,306 OF 2,475', 'plain'],
    ['MONTH-END PROJECTION', '91,400 / 100,000', 'yellow'],
    ['REMAINING (LIVE HEADER)', '61,212 · 19 DAYS RUNWAY', 'plain'],
  ]);
});

test('mix rows + deterministic rebalance always summing 100', () => {
  expect(mixRows(S)).toEqual([
    { key: 'ARB', pct: 47 }, { key: 'MIDDLE', pct: 24 }, { key: 'EV', pct: 29 },
  ]);
  expect(rebalanceMix({ arb: 47, middle: 24, ev: 29 }, 'arb', 60))
    .toEqual({ arb: 60, middle: 18, ev: 22 });
  expect(rebalanceMix({ arb: 100, middle: 0, ev: 0 }, 'arb', 40))
    .toEqual({ arb: 40, middle: 30, ev: 30 }); // zero others split the rest
  const r = rebalanceMix({ arb: 33, middle: 33, ev: 34 }, 'ev', 0);
  expect(r.arb + r.middle + r.ev).toBe(100);
  expect(r.ev).toBe(0);
});

test('RISK & BANKROLL rows — mockup strings at defaults', () => {
  expect(riskRows(S)).toEqual([
    ['FLAT PAIR STAKE', '$100 CAD'],
    ['KELLY FRACTION / CAP', '0.25 / 5% OF TOTAL'],
    ['TOTAL BANKROLL', '$10,000 CAD'],
    ['MIN STAKE / ROUND TO', '$10 / $5'],
    ['TRADES PER DAY CAP', '12'],
  ]);
  expect(toleranceText(S)).toBe('5% · 0–100%');
});

test('BRAIN panel rows', () => {
  expect(heatWeightsValue(S, false)).toBe('DEFAULT · EDITABLE WHILE GREEN');
  expect(heatWeightsValue(S, true)).toBe('CUSTOM · EDITABLE WHILE GREEN');
  expect(consolidationText(S)).toBe('EVERY 6 H · HAIKU');
  expect(llmBudgetText({ llmSpentCents: 0, llmCapCents: 300 })).toBe('$0.00 / $3.00 THIS MONTH');
  expect(llmBudgetText({ llmSpentCents: 84, llmCapCents: 300 })).toBe('$0.84 / $3.00 THIS MONTH');
  expect(killSwitchValue(S)).toBe('OFF');
  expect(killSwitchValue({ ...S, brainKillSwitch: 1 })).toBe('ON');
  expect(lastDigestText(null, null, Date.UTC(2026, 6, 14, 19, 0))).toBe('—');
  // 2026-07-14 19:00 UTC = 12:00 PDT, same Vancouver day as "now"
  expect(lastDigestText(Date.UTC(2026, 6, 14, 19, 0), 16, Date.UTC(2026, 6, 14, 20, 0)))
    .toBe('TODAY 12:00 · 16 BOOKS');
  expect(lastDigestText(Date.UTC(2026, 6, 13, 19, 0), 16, Date.UTC(2026, 6, 14, 20, 0)))
    .toBe('JUL 13 12:00 · 16 BOOKS');
});

test('WhatsApp number validation mirrors the server', () => {
  expect(validWaNumber('')).toBe(true); // clearing is legal
  expect(validWaNumber('+1 604 555 8112')).toBe(true);
  expect(validWaNumber('+16045558112')).toBe(true);
  expect(validWaNumber('604 555 8112')).toBe(false);
  expect(validWaNumber('+1 604 555 8112 ext 4')).toBe(false);
});

test('DATA panel rows', () => {
  expect(backupsText({ lastAt: null, keep: 14 })).toBe('14 NIGHTLY · NONE YET');
  // 2026-07-14 10:00 UTC = 03:00 PDT
  expect(backupsText({ lastAt: Date.UTC(2026, 6, 14, 10, 0), keep: 14 })).toBe('14 NIGHTLY · LAST 03:00');
});

test('advanced INPUTS derivations', () => {
  expect(planText(100_000)).toBe('PLAN 100K / MO');
  expect(planText(2_500)).toBe('PLAN 2,500 / MO');
  expect(lastTickText(null, 0)).toBe('LAST TICK —');
  expect(lastTickText(1_000, 42_000)).toBe('LAST TICK 41 S AGO');
  expect(memoryText({ receipts: 4_182, journalEntries: 47 }))
    .toBe('4,182 RECEIPTS · 47 JOURNAL ENTRIES · GROWING');
});

test('MY BOOKS + SPORTS & LEAGUES cells', () => {
  expect(bookRow({ name: 'pinnacle', displayName: 'Pinnacle', sport: 'ANY', sharpExempt: true, enabled: true }))
    .toEqual({ name: 'Pinnacle', sportLabel: 'ANY', chip: { label: 'SHARP — ALWAYS ON', tone: 'sharp' } });
  expect(bookRow({ name: 'bet365', displayName: 'bet365', sport: 'basketball', sharpExempt: false, enabled: true }))
    .toEqual({ name: 'bet365', sportLabel: 'BASKETBALL ▾', chip: { label: 'ON', tone: 'green' } });
  expect(bookRow({ name: 'bet365', displayName: 'bet365', sport: 'basketball', sharpExempt: false, enabled: false }).chip)
    .toEqual({ label: 'OFF', tone: 'muted' });
  expect(sportCell({ sport: 'basketball', enabled: true })).toBe('✓ BASKETBALL');
  expect(sportCell({ sport: 'soccer', enabled: false })).toBe('✗ SOCCER');
});

test('EDGE THRESHOLDS, fallback radios, safety rows, kill rules, journal stepper', () => {
  expect(thresholdTexts(S)).toEqual([
    ['MIN ARB MARGIN', '0.75%'],
    ['MIN EV EDGE', '2.0%'],
    ['MIN MIDDLE QUALITY', '1.5× BREAKEVEN HIT RATE'],
    ['FRESH WINDOW', '120 S'],
  ]);
  expect(fallbackItems(S)).toEqual([
    { idx: 0, label: '● FALL BACK TO CONSENSUS (DEFAULT)', active: true },
    { idx: 1, label: '○ PAUSE EV + MIDDLES, ARBS CONTINUE', active: false },
    { idx: 2, label: '○ PAUSE EVERYTHING', active: false },
  ]);
  expect(safetyRows(S)).toEqual([
    ['SHARP VELOCITY CAP', '3 / DAY / BOOK', 'plain'],
    ['MARKET BREADTH CAP', '2 / MARKET / BOOK / WEEK', 'plain'],
    ['ONE-SPORT RULE', 'ON', 'plain'],
    ['GO GENTLE AT', 'HEAT 30', 'yellow'],
    ['STOP AT', 'HEAT 60', 'red'],
    ['DEFAULT QUIT RULE', '"RETIRE ACCOUNT AFTER 2 STAKE CUTS IN 14 DAYS"', 'plain'],
  ]);
  expect(safetyRows({ ...S, oneSportRule: 0 })[2]).toEqual(['ONE-SPORT RULE', 'OFF', 'plain']);
  expect(killRuleRows()).toEqual([
    ['ARB DIES IF', 'CONFIRMED MARGIN < 60% OF QUOTED OVER 50 PAIRS'],
    ['EV DIES IF', 'CLOSING PRICE EDGE ≤ 0 AFTER 300 PICKS'],
    ['MIDDLE DIES IF', 'LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS'],
  ]);
  expect(journalMinText(S)).toBe('1 / DAY');
  expect(advSettingsToggle(false)).toBe('ADVANCED SETTINGS →');
  expect(advSettingsToggle(true)).toBe('ADVANCED SETTINGS — COLLAPSE');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- settings`
Expected: FAIL — cannot resolve module `./settings`.

- [ ] **Step 3: Implement `client/src/lib/settings.ts`**

```ts
// client/src/lib/settings.ts — SettingsView contract mirror (server:
// settings/report.ts) plus every pure display derivation for the SETTINGS
// screen. No React, no fetch. Every KV value derives from the live store —
// the mockup's numbers are demo filler (inventory §7.3).
import { formatCents } from './format';

// ---- contract mirror --------------------------------------------------------

/** Mirror of the server Settings record (numbers + the two string keys). */
export interface SettingsValues {
  tolerancePct: number; verifyGapSecs: number; staleRemoveMin: number; freshWindowSecs: number;
  minArbMarginPct: number; minEvEdgePct: number; middleRatio: number;
  kellyFraction: number; kellyCapPct: number; bankrollCents: number;
  flatPairCents: number; roundToCents: number; minStakeCents: number; dailyPickCap: number;
  quietStartHour: number; quietEndHour: number; scanBaseMin: number; scanHotMinMin: number;
  scanHotMaxMin: number; hotWindowHours: number; sharpVelocityPerDayPerBook: number;
  marketBreadthPerWeekPerBook: number; goGentleHeat: number; stopHeat: number;
  heatWeightLimit: number; heatWeightReject: number; heatWeightCut: number; heatWeightWithdrawal: number;
  heatHalfLifeDays: number; brainCadenceHours: number; brainKillSwitch: number; anchorIdx: number;
  creditPlanMonthly: number;
  mixArbPct: number; mixMiddlePct: number; mixEvPct: number;
  anchorFallback: number; oneSportRule: number; journalMinPerDay: number;
  whatsappNumber: string; disabledSports: string;
}

export interface SettingsBookView {
  name: string; displayName: string; sport: string; sharpExempt: boolean; enabled: boolean;
}

export interface ForecasterView {
  projectedPerDay: number; dailyAllowance: number; usedThisMonth: number;
  monthEndProjection: number; planMonthly: number; remaining: number; runwayDays: number;
}

export interface SettingsView {
  mode: 'SIMULATED';
  settings: SettingsValues;
  forecaster: ForecasterView;
  brain: { lastPassAt: number | null; lastPassBooks: number | null;
           llmSpentCents: number; llmCapCents: number; weightsCustom: boolean };
  books: SettingsBookView[];
  sports: { sport: string; enabled: boolean }[];
  safetyLocked: boolean;
  memory: { receipts: number; journalEntries: number };
  lastTickAt: number | null;
  backups: { lastAt: number | null; keep: 14 };
}

// ---- shared formatting -------------------------------------------------------

const group = (n: number): string => n.toLocaleString('en-US');
const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Always 2dp dollars: 84 → '$0.84' (LLM budget style). */
const money2 = (c: number): string => `$${(c / 100).toFixed(2)}`;

const HHMM = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const VAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const MON_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', month: 'short', day: '2-digit',
});

function hhmm(ts: number): string {
  return HHMM.format(ts);
}
function monthDay(ts: number): string {
  const parts = MON_DAY.formatToParts(ts);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')}`;
}

// ---- SCAN RULES · CREDIT FORECASTER (§5.2) ------------------------------------

export function scanWindowText(s: SettingsValues): string {
  const end = s.quietStartHour === 0 ? '24' : pad2(s.quietStartHour);
  return `${pad2(s.quietEndHour)}:00 – ${end}:00 PT`;
}

export function quietHoursText(s: SettingsValues): string {
  return `${pad2(s.quietStartHour)}:00 – ${pad2(s.quietEndHour)}:00 · NO SENDS, NO SCANS`;
}

export function cadenceText(s: SettingsValues): string {
  return `BASE ${s.scanBaseMin} MIN · ${s.scanHotMinMin}–${s.scanHotMaxMin} MIN < ${s.hotWindowHours}H TO START`;
}

export function verifyGapText(s: SettingsValues): string {
  return `${s.verifyGapSecs} S`;
}

export function staleText(s: SettingsValues): string {
  return `${s.staleRemoveMin} MIN`;
}

export type RowTone = 'plain' | 'yellow' | 'red';

export function forecastRows(f: ForecasterView): [string, string, RowTone][] {
  return [
    ['PROJECTED CREDITS / DAY', `${group(f.projectedPerDay)} OF ${group(f.dailyAllowance)}`, 'plain'],
    ['MONTH-END PROJECTION', `${group(f.monthEndProjection)} / ${group(f.planMonthly)}`, 'yellow'],
    ['REMAINING (LIVE HEADER)', `${group(f.remaining)} · ${f.runwayDays} DAYS RUNWAY`, 'plain'],
  ];
}

// ---- STRATEGY MIX (§5.1) --------------------------------------------------------

export interface MixValues { arb: number; middle: number; ev: number }

export function mixRows(s: SettingsValues): { key: 'ARB' | 'MIDDLE' | 'EV'; pct: number }[] {
  return [
    { key: 'ARB', pct: s.mixArbPct },
    { key: 'MIDDLE', pct: s.mixMiddlePct },
    { key: 'EV', pct: s.mixEvPct },
  ];
}

/** Move one slider; the other two absorb the delta proportionally (largest-
 *  remainder-free: round one, give the exact rest to the other). Always sums 100. */
export function rebalanceMix(mix: MixValues, key: keyof MixValues, value: number): MixValues {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = (['arb', 'middle', 'ev'] as const).filter((k) => k !== key);
  const rest = 100 - v;
  const oldSum = mix[others[0]!] + mix[others[1]!];
  const first = oldSum === 0 ? Math.ceil(rest / 2) : Math.round((mix[others[0]!] / oldSum) * rest);
  const out = { ...mix, [key]: v } as MixValues;
  out[others[0]!] = first;
  out[others[1]!] = rest - first;
  return out;
}

// ---- RISK & BANKROLL (§5.3) --------------------------------------------------------

export function riskRows(s: SettingsValues): [string, string][] {
  return [
    ['FLAT PAIR STAKE', `${formatCents(s.flatPairCents)} CAD`],
    ['KELLY FRACTION / CAP', `${s.kellyFraction} / ${s.kellyCapPct}% OF TOTAL`],
    ['TOTAL BANKROLL', `${formatCents(s.bankrollCents)} CAD`],
    ['MIN STAKE / ROUND TO', `${formatCents(s.minStakeCents)} / ${formatCents(s.roundToCents)}`],
    ['TRADES PER DAY CAP', String(s.dailyPickCap)],
  ];
}

export function toleranceText(s: SettingsValues): string {
  return `${s.tolerancePct}% · 0–100%`;
}

// ---- BRAIN (§5.4) --------------------------------------------------------------------

export function heatWeightsValue(_s: SettingsValues, custom: boolean): string {
  return `${custom ? 'CUSTOM' : 'DEFAULT'} · EDITABLE WHILE GREEN`;
}

export function consolidationText(s: SettingsValues): string {
  return `EVERY ${s.brainCadenceHours} H · HAIKU`;
}

export function llmBudgetText(b: { llmSpentCents: number; llmCapCents: number }): string {
  return `${money2(b.llmSpentCents)} / ${money2(b.llmCapCents)} THIS MONTH`;
}

export function killSwitchValue(s: SettingsValues): string {
  return s.brainKillSwitch === 0 ? 'OFF' : 'ON';
}

export function lastDigestText(lastPassAt: number | null, books: number | null, now: number): string {
  if (lastPassAt === null) return '—';
  const sameDay = VAN_DAY.format(lastPassAt) === VAN_DAY.format(now);
  const when = sameDay ? `TODAY ${hhmm(lastPassAt)}` : `${monthDay(lastPassAt)} ${hhmm(lastPassAt)}`;
  return `${when} · ${books ?? 0} BOOKS`;
}

// ---- WHATSAPP (§5.5) -------------------------------------------------------------------

/** Mirrors the server rule: empty (clearing) or '+' then 7–19 digits/spaces. */
export function validWaNumber(v: string): boolean {
  return v === '' || /^\+\d[\d ]{6,18}$/.test(v);
}

// ---- DATA (§5.6) ----------------------------------------------------------------------

export function backupsText(b: { lastAt: number | null; keep: number }): string {
  return b.lastAt === null
    ? `${b.keep} NIGHTLY · NONE YET`                 // NEW copy — no backups until Plan 6
    : `${b.keep} NIGHTLY · LAST ${hhmm(b.lastAt)}`;
}

// ---- ADVANCED — INPUTS (§5.7) -----------------------------------------------------------

export function planText(planMonthly: number): string {
  const k = planMonthly >= 1_000 && planMonthly % 1_000 === 0 ? `${planMonthly / 1_000}K` : group(planMonthly);
  return `PLAN ${k} / MO`;
}

export function lastTickText(lastTickAt: number | null, now: number): string {
  if (lastTickAt === null) return 'LAST TICK —';
  return `LAST TICK ${Math.max(0, Math.round((now - lastTickAt) / 1000))} S AGO`;
}

export function memoryText(m: { receipts: number; journalEntries: number }): string {
  return `${group(m.receipts)} RECEIPTS · ${group(m.journalEntries)} JOURNAL ENTRIES · GROWING`;
}

// ---- ADVANCED — MY BOOKS + SPORTS & LEAGUES ------------------------------------------------

export type ChipTone = 'sharp' | 'green' | 'muted';

export function bookRow(b: SettingsBookView): { name: string; sportLabel: string; chip: { label: string; tone: ChipTone } } {
  if (b.sharpExempt) return { name: b.displayName, sportLabel: 'ANY', chip: { label: 'SHARP — ALWAYS ON', tone: 'sharp' } };
  return {
    name: b.displayName,
    sportLabel: `${b.sport.toUpperCase()} ▾`,
    chip: b.enabled ? { label: 'ON', tone: 'green' } : { label: 'OFF', tone: 'muted' },
  };
}

export function sportCell(x: { sport: string; enabled: boolean }): string {
  return `${x.enabled ? '✓' : '✗'} ${x.sport.toUpperCase()}`;
}

// ---- ADVANCED — thresholds, fallback, safety, kill rules ------------------------------------

export function thresholdTexts(s: SettingsValues): [string, string][] {
  return [
    ['MIN ARB MARGIN', `${s.minArbMarginPct.toFixed(2)}%`],
    ['MIN EV EDGE', `${s.minEvEdgePct.toFixed(1)}%`],
    ['MIN MIDDLE QUALITY', `${s.middleRatio.toFixed(1)}× BREAKEVEN HIT RATE`],
    ['FRESH WINDOW', `${s.freshWindowSecs} S`],
  ];
}

const FALLBACK_LABELS = [
  'FALL BACK TO CONSENSUS (DEFAULT)',
  'PAUSE EV + MIDDLES, ARBS CONTINUE',
  'PAUSE EVERYTHING',
] as const;

export function fallbackItems(s: SettingsValues): { idx: 0 | 1 | 2; label: string; active: boolean }[] {
  return FALLBACK_LABELS.map((text, i) => ({
    idx: i as 0 | 1 | 2,
    label: `${s.anchorFallback === i ? '●' : '○'} ${text}`,
    active: s.anchorFallback === i,
  }));
}

export function safetyRows(s: SettingsValues): [string, string, RowTone][] {
  return [
    ['SHARP VELOCITY CAP', `${s.sharpVelocityPerDayPerBook} / DAY / BOOK`, 'plain'],
    ['MARKET BREADTH CAP', `${s.marketBreadthPerWeekPerBook} / MARKET / BOOK / WEEK`, 'plain'],
    ['ONE-SPORT RULE', s.oneSportRule === 0 ? 'OFF' : 'ON', 'plain'],
    ['GO GENTLE AT', `HEAT ${s.goGentleHeat}`, 'yellow'],
    ['STOP AT', `HEAT ${s.stopHeat}`, 'red'],
    ['DEFAULT QUIT RULE', '"RETIRE ACCOUNT AFTER 2 STAKE CUTS IN 14 DAYS"', 'plain'],
  ];
}

export function killRuleRows(): [string, string][] {
  return [
    ['ARB DIES IF', 'CONFIRMED MARGIN < 60% OF QUOTED OVER 50 PAIRS'],
    ['EV DIES IF', 'CLOSING PRICE EDGE ≤ 0 AFTER 300 PICKS'],
    ['MIDDLE DIES IF', 'LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS'],
  ];
}

export function journalMinText(s: SettingsValues): string {
  return `${s.journalMinPerDay} / DAY`;
}

export function advSettingsToggle(open: boolean): string {
  return open ? 'ADVANCED SETTINGS — COLLAPSE' : 'ADVANCED SETTINGS →';
}
```

- [ ] **Step 4: Append the fetch helpers to `client/src/lib/api.ts`** (type import at the top, functions at the end):

```ts
// ---- settings (Plan 5) ----------------------------------------------------------
import type { SettingsView } from './settings';

export async function fetchSettingsView(): Promise<SettingsView | null> {
  try {
    const res = await fetch('/api/settings/view');
    if (!res.ok) return null;
    return (await res.json()) as SettingsView;
  } catch {
    return null;
  }
}

export async function patchSettings(patch: Record<string, number | string>): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function patchBook(name: string, body: { enabled?: 0 | 1; sport?: string }): Promise<boolean> {
  try {
    const res = await fetch(`/api/books/${name}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const sendWaTest = (): Promise<boolean> => postAction('/api/whatsapp/test');
```

- [ ] **Step 5: Create `client/src/hooks/useSettingsView.ts`**

```ts
// client/src/hooks/useSettingsView.ts — poll GET /api/settings/view every 5s
// (same contract as useAppState/useBrain): any error → null, calm degraded form.
import { useCallback, useEffect, useState } from 'react';
import { fetchSettingsView } from '../lib/api';
import type { SettingsView } from '../lib/settings';

const POLL_MS = 5000;

export function useSettingsView(): { view: SettingsView | null; refresh: () => void } {
  const [view, setView] = useState<SettingsView | null>(null);

  const refresh = useCallback(() => {
    void fetchSettingsView().then(setView);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { view, refresh };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS (existing client tests + 10 new settings specs), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib client/src/hooks
git commit -m "feat(client): settings contract mirror, pure display helpers, useSettingsView hook"
```

---

### Task 6: Settings stylesheet + screen shell + STRATEGY MIX panel

**Files:**
- Create: `client/src/styles/settings.css`, `client/src/screens/SettingsScreen.tsx`, `client/src/components/Stepper.tsx`, `client/src/components/StrategyMixPanel.tsx`
- Modify: `client/src/main.tsx`, `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 helpers/hook/fetchers; Plan 2's `.empty-note`.
- Produces: ALL settings CSS classes, frozen here (Tasks 7–10 add no CSS): `.settings-grid .panel (.span2 .locked) .panel-head .panel-head-note .panel-body .kv .kv-key .kv-value (.yellow .red) .mix-row .mix-label .mix-pct .mix-slider .stepper .stepper-value .step-btn .toggle-chip (.on) .panel-btn .wa-input .badge-sim .btn-pair .btn-half .data-note .adv-toggle .adv-intro .adv-grid .input-row2 .input-title .input-helper .input-right .masked .mini-btn .chip-live (.sim .green) .dot (.yellow .green) .adv-footer .book-row .book-name .book-sport .book-select .chip-state (.sharp .green .muted) .add-book .sports-grid .sport-cell (.off) .radio-item (.active) .helper-note .kv-quit .journal-sub`.

- [ ] **Step 1: Create `client/src/styles/settings.css`**

```css
/* client/src/styles/settings.css — SETTINGS screen. Every value from
   design-inventory §5 unless marked "not pinned by inventory". */

/* ---------- panel grid (§5 intro) ---------- */
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
.panel { border: 2px solid var(--grey-panel); }
.panel.span2 { grid-column: span 2; }
.panel.locked { opacity: 0.6; }
.panel-head { padding: 8px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 11px; letter-spacing: 0.14em; color: #fff; font-weight: 500; }
.panel-head-note { color: var(--muted-label); font-weight: 400; margin-left: 8px; }
.panel-body { padding: 6px 14px 14px; }
.kv { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--grey-divider); font-size: 12px; }
.kv:last-child { border-bottom: none; }
.kv-key { color: var(--muted-label); letter-spacing: 0.06em; }
.kv-value { color: #fff; font-weight: 500; text-align: right; }
.kv-value.yellow { color: var(--yellow); }
.kv-value.red { color: var(--red); }

/* ---------- STRATEGY MIX (§5.1) ---------- */
.mix-row { margin-top: 14px; }
.mix-label { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.1em; color: var(--muted-label); }
.mix-pct { color: #fff; font-weight: 500; }
.mix-slider { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 12px; border: 1px solid var(--grey-panel); background: #000; margin-top: 6px; cursor: pointer; }
.mix-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 18px; background: #000; border: 2px solid #fff; }
.mix-slider::-moz-range-thumb { width: 12px; height: 18px; background: #000; border: 2px solid #fff; border-radius: 0; }

/* ---------- steppers (§5.2 anatomy) ---------- */
.stepper { display: flex; align-items: center; gap: 6px; }
.stepper-value { color: #fff; font-weight: 500; }
.step-btn { width: 22px; height: 22px; background: none; border: 1px solid var(--grey-divider); color: var(--body-text); font-size: 12px; font-family: inherit; cursor: pointer; padding: 0; }
.step-btn:hover { color: #fff; border-color: #fff; }

/* ---------- BRAIN / WHATSAPP / DATA panel controls ---------- */
.toggle-chip { background: none; border: 2px solid #fff; color: #fff; font-size: 11px; letter-spacing: 0.12em; padding: 2px 10px; font-family: inherit; cursor: pointer; }
.toggle-chip.on { border-color: var(--yellow); color: var(--yellow); }
.panel-btn { display: block; width: 100%; background: none; border: 2px solid #fff; color: #fff; font-size: 11px; letter-spacing: 0.12em; font-weight: 500; padding: 8px; margin-top: 12px; font-family: inherit; cursor: pointer; }
.panel-btn:hover { background: #fff; color: #000; }
.wa-input { width: 100%; background: #000; color: #fff; border: 2px solid var(--grey-panel); padding: 8px 10px; font-size: 13px; font-weight: 500; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; font-family: inherit; margin: 6px 0 10px; }
.wa-input:focus { border-color: var(--yellow); outline: none; } /* §5.5 — the unique yellow focus */
.badge-sim { border: 2px solid var(--yellow); color: var(--yellow); font-size: 11px; letter-spacing: 0.14em; padding: 2px 8px; }
.btn-pair { display: flex; gap: 8px; margin-top: 12px; }
.btn-half { flex: 1; display: block; background: none; border: 2px solid #fff; color: #fff; text-align: center; font-size: 11px; letter-spacing: 0.12em; font-weight: 500; padding: 8px; text-decoration: none; font-family: inherit; cursor: pointer; }
.btn-half:hover { background: #fff; color: #000; }
.data-note { font-size: 11px; letter-spacing: 0.08em; color: var(--faint); margin-top: 10px; }

/* ---------- ADVANCED SETTINGS (§5.7) ---------- */
.adv-toggle { display: block; width: 100%; text-align: left; background: none; border: none; padding: 16px 0 0; font-size: 12px; letter-spacing: 0.14em; color: var(--faint); font-family: inherit; cursor: pointer; }
.adv-toggle:hover { color: #fff; }
.adv-intro { font-size: 12px; color: var(--muted-label); margin: 8px 0; }
.adv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.input-row2 { padding: 10px 14px; border-bottom: 1px solid var(--grey-subtle-row); font-size: 12px; }
.input-row2:last-child { border-bottom: none; }
.input-title { color: #fff; font-weight: 500; letter-spacing: 0.06em; }
.input-helper { color: var(--muted-label); margin-top: 4px; }
.input-right { display: flex; gap: 10px; align-items: center; justify-content: flex-end; flex-wrap: wrap; margin-top: 6px; font-size: 11px; letter-spacing: 0.08em; color: var(--muted-label); }
.masked { color: var(--muted-label); }
.mini-btn { background: none; border: 1px solid var(--grey-divider); color: var(--body-text); font-size: 10px; letter-spacing: 0.1em; padding: 3px 8px; font-family: inherit; }
.chip-live { border: 1px solid currentColor; font-size: 11px; letter-spacing: 0.1em; padding: 2px 8px; }
.chip-live.sim { color: var(--yellow); }
.chip-live.green { color: var(--green); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; } /* the design's ONLY rounded element */
.dot.yellow { background: var(--yellow); }
.dot.green { background: var(--green); }
.adv-footer { font-size: 12px; color: var(--muted-label); padding: 10px 14px; }
.book-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--grey-subtle-row); font-size: 12px; }
.book-row.off { color: var(--muted-label); }
.book-name { color: #fff; font-weight: 500; }
.book-row.off .book-name { color: var(--muted-label); }
.book-sport { letter-spacing: 0.08em; color: #fff; background: #000; border: none; font-size: 12px; font-family: inherit; cursor: pointer; }
.chip-state { border: 1px solid currentColor; font-size: 10px; letter-spacing: 0.1em; padding: 2px 10px; background: none; font-family: inherit; cursor: pointer; }
.chip-state.sharp { color: #fff; letter-spacing: 0.08em; padding: 2px 8px; white-space: nowrap; cursor: default; }
.chip-state.green { color: var(--green); }
.chip-state.muted { color: var(--muted-label); border-color: var(--grey-divider); }
.add-book { background: none; border: none; font-size: 12px; letter-spacing: 0.14em; color: var(--faint); padding: 8px 0 0; font-family: inherit; }
.sports-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 0; }
.sport-cell { background: none; border: none; text-align: left; font-size: 12px; letter-spacing: 0.08em; color: #fff; font-family: inherit; cursor: pointer; padding: 0; }
.sport-cell.off { color: var(--faint); }
.radio-item { display: block; background: none; border: none; text-align: left; font-size: 12px; color: var(--muted-label); font-family: inherit; cursor: pointer; padding: 4px 0; }
.radio-item.active { color: #fff; }
.helper-note { font-size: 12px; color: var(--muted-label); padding: 8px 0 0; }
.journal-sub { border-top: 1px solid var(--grey-divider); margin-top: 10px; padding-top: 6px; }
```

- [ ] **Step 2: Modify `client/src/main.tsx`** — add after the last `./styles/` import:

```tsx
import './styles/settings.css';
```

- [ ] **Step 3: Create `client/src/components/Stepper.tsx`**

```tsx
interface StepperProps {
  value: string;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}

/** §5.2 stepper anatomy: value + −/+ 22×22 buttons. Steps/floors live in the caller. */
export function Stepper({ value, onDec, onInc, disabled = false }: StepperProps) {
  return (
    <span className="stepper">
      <span className="stepper-value">{value}</span>
      <button className="step-btn" onClick={onDec} disabled={disabled}>−</button>
      <button className="step-btn" onClick={onInc} disabled={disabled}>+</button>
    </span>
  );
}
```

- [ ] **Step 4: Create `client/src/components/StrategyMixPanel.tsx`**

```tsx
import { patchSettings } from '../lib/api';
import { mixRows, rebalanceMix, type SettingsValues } from '../lib/settings';

interface StrategyMixPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.1 — three sliders whose trio ALWAYS sums to 100: moving one rebalances the
 *  other two (pure rebalanceMix) and PATCHes all three together. */
export function StrategyMixPanel({ s, refresh }: StrategyMixPanelProps) {
  const move = async (key: 'arb' | 'middle' | 'ev', value: number) => {
    const next = rebalanceMix({ arb: s.mixArbPct, middle: s.mixMiddlePct, ev: s.mixEvPct }, key, value);
    await patchSettings({ mixArbPct: next.arb, mixMiddlePct: next.middle, mixEvPct: next.ev });
    refresh();
  };
  const sliderKey = { ARB: 'arb', MIDDLE: 'middle', EV: 'ev' } as const;
  return (
    <section className="panel">
      <header className="panel-head">STRATEGY MIX — LOCKED TO 100</header>
      <div className="panel-body">
        {mixRows(s).map((row) => (
          <div className="mix-row" key={row.key}>
            <div className="mix-label">
              <span>{row.key}</span>
              <span className="mix-pct">{row.pct}</span>
            </div>
            <input
              type="range" min={0} max={100} step={1} value={row.pct} className="mix-slider"
              onChange={(e) => { void move(sliderKey[row.key], Number(e.target.value)); }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `client/src/screens/SettingsScreen.tsx`** (v1 — grows in Tasks 7–10)

```tsx
import { useSettingsView } from '../hooks/useSettingsView';
import { StrategyMixPanel } from '../components/StrategyMixPanel';

export function SettingsScreen() {
  const { view, refresh } = useSettingsView();

  if (!view) {
    return (
      <main>
        <div className="empty-note">SETTINGS OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
  return (
    <main>
      <div className="settings-grid">
        <StrategyMixPanel s={view.settings} refresh={refresh} />
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Modify `client/src/App.tsx`** — exact replacement of the placeholder line:

```tsx
// OLD
      {tab === 'SETTINGS' && <PlaceholderScreen label="SETTINGS" planNumber={5} />}
// NEW
      {tab === 'SETTINGS' && <SettingsScreen />}
```

with the import:

```tsx
import { SettingsScreen } from './screens/SettingsScreen';
```

- [ ] **Step 7: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then Terminal A `npm run dev`, Terminal B `npm run dev:client`, http://localhost:5174 → SETTINGS:
- `STRATEGY MIX — LOCKED TO 100` panel with three sliders at 47/24/29; dragging ARB to 60 rebalances the others (18/22), the numbers persist across a reload (the store took the PATCH), and `curl -s localhost:4400/api/settings | python3 -m json.tool | grep mix` agrees.
- Kill the server → `SETTINGS OFFLINE — SERVER UNREACHABLE`; restart recovers.
Stop the dev servers.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "feat(client): settings shell — stylesheet, stepper, strategy mix sliders locked to 100"
```

---

### Task 7: SCAN RULES · CREDIT FORECASTER + RISK & BANKROLL panels

**Files:**
- Create: `client/src/components/ScanRulesPanel.tsx`, `client/src/components/RiskBankrollPanel.tsx`
- Modify: `client/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: Task 5 row helpers, `Stepper`, `patchSettings`.
- Produces: panels 2 and 3 of the six.

- [ ] **Step 1: Create `client/src/components/ScanRulesPanel.tsx`**

```tsx
import { patchSettings } from '../lib/api';
import {
  cadenceText, forecastRows, quietHoursText, scanWindowText, staleText,
  verifyGapText, type ForecasterView, type SettingsValues,
} from '../lib/settings';
import { Stepper } from './Stepper';

interface ScanRulesPanelProps {
  s: SettingsValues;
  forecaster: ForecasterView;
  refresh: () => void;
}

export function ScanRulesPanel({ s, forecaster, refresh }: ScanRulesPanelProps) {
  const stale = async (next: number) => {
    await patchSettings({ staleRemoveMin: Math.max(1, next) }); // − floors at 1 (§5.2)
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">SCAN RULES · CREDIT FORECASTER</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">SCAN WINDOW</span><span className="kv-value">{scanWindowText(s)}</span></div>
        <div className="kv"><span className="kv-key">QUIET HOURS</span><span className="kv-value">{quietHoursText(s)}</span></div>
        <div className="kv"><span className="kv-key">CADENCE</span><span className="kv-value">{cadenceText(s)}</span></div>
        <div className="kv"><span className="kv-key">VERIFY GAP</span><span className="kv-value">{verifyGapText(s)}</span></div>
        {forecastRows(forecaster).map(([key, value, tone]) => (
          <div className="kv" key={key}>
            <span className="kv-key">{key}</span>
            <span className={`kv-value${tone === 'plain' ? '' : ` ${tone}`}`}>{value}</span>
          </div>
        ))}
        <div className="kv">
          <span className="kv-key">REMOVE STALE TRADES AFTER</span>
          <Stepper value={staleText(s)}
            onDec={() => { void stale(s.staleRemoveMin - 1); }}
            onInc={() => { void stale(s.staleRemoveMin + 1); }} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `client/src/components/RiskBankrollPanel.tsx`**

```tsx
import { patchSettings } from '../lib/api';
import { riskRows, toleranceText, type SettingsValues } from '../lib/settings';
import { Stepper } from './Stepper';

interface RiskBankrollPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.3 — live-value rows plus the tolerance stepper (MASTER PROMPT hard rule 2:
 *  the tolerance is user-set 0–100% HERE; step 1, clamped). */
export function RiskBankrollPanel({ s, refresh }: RiskBankrollPanelProps) {
  const rows = riskRows(s);
  const tol = async (next: number) => {
    await patchSettings({ tolerancePct: Math.max(0, Math.min(100, next)) });
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">RISK & BANKROLL</header>
      <div className="panel-body">
        {rows.slice(0, 3).map(([key, value]) => (
          <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
        ))}
        <div className="kv">
          <span className="kv-key">LINE MOVE TOLERANCE</span>
          <Stepper value={toleranceText(s)}
            onDec={() => { void tol(s.tolerancePct - 1); }}
            onInc={() => { void tol(s.tolerancePct + 1); }} />
        </div>
        {rows.slice(3).map(([key, value]) => (
          <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Grow `client/src/screens/SettingsScreen.tsx`** — inside `.settings-grid`, after `<StrategyMixPanel …/>`:

```tsx
        <ScanRulesPanel s={view.settings} forecaster={view.forecaster} refresh={refresh} />
        <RiskBankrollPanel s={view.settings} refresh={refresh} />
```

with the imports:

```tsx
import { ScanRulesPanel } from '../components/ScanRulesPanel';
import { RiskBankrollPanel } from '../components/RiskBankrollPanel';
```

- [ ] **Step 4: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, SETTINGS tab:
- SCAN RULES rows render the derived strings (`08:00 – 24:00 PT`, `BASE 20 MIN · 5–8 MIN < 2H TO START`); forecaster rows show live credit numbers; MONTH-END PROJECTION value is yellow.
- REMOVE STALE stepper: `+` → `11 MIN` persists; `−` at `1 MIN` stays `1 MIN` (floor).
- LINE MOVE TOLERANCE stepper: `+` → `6% · 0–100%`; the engine reads it — `curl -s localhost:4400/api/settings | grep tolerance` shows 6.
- RISK & BANKROLL displays: `$100 CAD`, `0.25 / 5% OF TOTAL`, `$10,000 CAD`, `$10 / $5`, `12`.
Stop the dev servers.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): scan rules + credit forecaster and risk & bankroll panels"
```

---

### Task 8: BRAIN, WHATSAPP and DATA panels

**Files:**
- Create: `client/src/components/BrainPanel.tsx`, `client/src/components/WhatsappPanel.tsx`, `client/src/components/DataPanel.tsx`
- Modify: `client/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: Task 5 helpers, `patchSettings`, Plan 3's `postBrainPass`, `sendWaTest`.
- Produces: panels 4–6; the interactive KILL SWITCH; UPDATE UNDERSTANDING; the whatsapp number wiring; exports.

- [ ] **Step 1: Create `client/src/components/BrainPanel.tsx`**

```tsx
import { patchSettings, postBrainPass } from '../lib/api';
import {
  consolidationText, heatWeightsValue, killSwitchValue, lastDigestText,
  llmBudgetText, type SettingsValues, type SettingsView,
} from '../lib/settings';

interface BrainPanelProps {
  s: SettingsValues;
  brain: SettingsView['brain'];
  now: number;
  refresh: () => void;
}

export function BrainPanel({ s, brain, now, refresh }: BrainPanelProps) {
  const toggleKill = async () => {
    await patchSettings({ brainKillSwitch: s.brainKillSwitch === 0 ? 1 : 0 });
    refresh();
  };
  const updateUnderstanding = async () => {
    await postBrainPass(); // runs even under the kill switch — an explicit user ask
    refresh();
  };
  const on = s.brainKillSwitch !== 0;
  return (
    <section className="panel">
      <header className="panel-head">BRAIN</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">HEAT WEIGHTS</span><span className="kv-value">{heatWeightsValue(s, brain.weightsCustom)}</span></div>
        <div className="kv"><span className="kv-key">CONSOLIDATION PASS</span><span className="kv-value">{consolidationText(s)}</span></div>
        <div className="kv"><span className="kv-key">LLM BUDGET</span><span className="kv-value">{llmBudgetText(brain)}</span></div>
        <div className="kv">
          <span className="kv-key">KILL SWITCH</span>
          <button className={`toggle-chip${on ? ' on' : ''}`} onClick={() => { void toggleKill(); }}>
            {killSwitchValue(s)}
          </button>
        </div>
        <div className="kv"><span className="kv-key">LAST DIGEST</span><span className="kv-value">{lastDigestText(brain.lastPassAt, brain.lastPassBooks, now)}</span></div>
        <button className="panel-btn" onClick={() => { void updateUnderstanding(); }}>UPDATE UNDERSTANDING</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `client/src/components/WhatsappPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { patchSettings, sendWaTest } from '../lib/api';
import { quietHoursText, validWaNumber, type SettingsValues } from '../lib/settings';

interface WhatsappPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.5 — VALUES only; actual sending is Plan 6. The number PATCHes on blur when
 *  valid (or cleared); invalid text stays local, the store never holds junk. */
export function WhatsappPanel({ s, refresh }: WhatsappPanelProps) {
  const [number, setNumber] = useState(s.whatsappNumber);
  const [sent, setSent] = useState(false);
  useEffect(() => { setNumber(s.whatsappNumber); }, [s.whatsappNumber]);

  const commit = async () => {
    if (number !== s.whatsappNumber && validWaNumber(number)) {
      await patchSettings({ whatsappNumber: number });
      refresh();
    }
  };
  const test = async () => {
    if (await sendWaTest()) setSent(true);
  };
  return (
    <section className="panel">
      <header className="panel-head">WHATSAPP</header>
      <div className="panel-body">
        <div className="kv-key" style={{ paddingTop: 7 }}>YOUR NUMBER</div>
        <input
          className="wa-input" type="tel" placeholder="+1 604 555 0000" value={number}
          onChange={(e) => { setNumber(e.target.value); }}
          onBlur={() => { void commit(); }}
        />
        <div className="kv"><span className="kv-key">TRANSPORT</span><span className="kv-value">TWILIO · INBOUND POLL 45 S</span></div>
        <div className="kv"><span className="kv-key">REPLY CODES</span><span className="kv-value">1 SECURED · 3 LIMITED</span></div>
        <div className="kv"><span className="kv-key">DETAIL LEVEL</span><span className="kv-value">COMPACT</span></div>
        <div className="kv"><span className="kv-key">QUIET HOURS</span><span className="kv-value">{quietHoursText(s).split(' · ')[0]}</span></div>
        <button className="panel-btn" onClick={() => { setSent(false); void test(); }}>
          {sent ? 'SENT ✓' : 'SEND TEST MESSAGE'}
        </button>
      </div>
    </section>
  );
}
```

(`SENT ✓` is NEW copy; in sim the "send" is the events_log stub — Design §13.)

- [ ] **Step 3: Create `client/src/components/DataPanel.tsx`**

```tsx
import { backupsText, type SettingsView } from '../lib/settings';

interface DataPanelProps {
  backups: SettingsView['backups'];
  mode: 'SIMULATED';
}

/** §5.6 — the MODE badge stays non-interactive: the SIM/LIVE switch (with its
 *  confirm dialog) ships in Plan 6 and is never flipped by this plan. */
export function DataPanel({ backups, mode }: DataPanelProps) {
  return (
    <section className="panel">
      <header className="panel-head">DATA</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">MODE</span><span className="badge-sim">{mode}</span></div>
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

- [ ] **Step 4: Grow `client/src/screens/SettingsScreen.tsx`** — the screen needs `now` for LAST DIGEST; use `Date.now()` at render (the 5 s poll re-renders — no new interval):

```tsx
        <BrainPanel s={view.settings} brain={view.brain} now={Date.now()} refresh={refresh} />
        <WhatsappPanel s={view.settings} refresh={refresh} />
        <DataPanel backups={view.backups} mode={view.mode} />
```

with the imports:

```tsx
import { BrainPanel } from '../components/BrainPanel';
import { WhatsappPanel } from '../components/WhatsappPanel';
import { DataPanel } from '../components/DataPanel';
```

- [ ] **Step 5: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, SETTINGS tab:
- BRAIN: `LLM BUDGET $0.00 / $3.00 THIS MONTH`; KILL SWITCH chip toggles OFF↔ON (yellow when ON) — BRAIN tab's header chip follows within a poll; with the switch ON, no new consolidation passes happen on later scans (check the BRAIN tab's LAST FULL PASS freezes); UPDATE UNDERSTANDING still moves LAST DIGEST (explicit command).
- WHATSAPP: typing an invalid number and blurring changes nothing (`curl -s localhost:4400/api/settings | grep whatsapp` unchanged); a valid `+1 604 555 8112` persists; SEND TEST MESSAGE flips to `SENT ✓` and `events_log` gains a `wa_test` row — and NOTHING was sent anywhere.
- DATA: badge `SIMULATED` (not clickable); BACKUPS `14 NIGHTLY · NONE YET`; both export buttons download real files (open the CSV — header row + every trade).
Stop the dev servers.

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): brain (kill switch + update understanding), whatsapp values, data exports panels"
```

---

### Task 9: ADVANCED SETTINGS expander — INPUTS, MY BOOKS, SPORTS & LEAGUES

**Files:**
- Create: `client/src/components/AdvancedSettings.tsx`
- Modify: `client/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: Task 5 helpers, `patchBook`, `patchSettings`.
- Produces: the expander shell + the first three advanced panels (grows in Task 10).

- [ ] **Step 1: Create `client/src/components/AdvancedSettings.tsx`**

```tsx
import { useState } from 'react';
import { patchBook, patchSettings } from '../lib/api';
import {
  advSettingsToggle, bookRow, lastTickText, memoryText, planText, sportCell,
  type SettingsView,
} from '../lib/settings';

interface AdvancedSettingsProps {
  view: SettingsView;
  now: number;
  refresh: () => void;
}

export function AdvancedSettings({ view, now, refresh }: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const s = view.settings;

  const toggleBook = async (name: string, enabled: boolean) => {
    await patchBook(name, { enabled: enabled ? 0 : 1 });
    refresh();
  };
  const setSport = async (name: string, sport: string) => {
    await patchBook(name, { sport });
    refresh();
  };
  const toggleSport = async (sport: string, enabled: boolean) => {
    const cur = s.disabledSports.split(',').map((x) => x.trim()).filter(Boolean);
    const next = enabled ? [...cur, sport] : cur.filter((x) => x !== sport);
    await patchSettings({ disabledSports: [...new Set(next)].sort().join(',') });
    refresh();
  };
  const sportsRoster = view.sports.map((x) => x.sport);

  return (
    <>
      <button className="adv-toggle" onClick={() => setOpen((v) => !v)}>{advSettingsToggle(open)}</button>
      {open && (
        <>
          <p className="adv-intro">Changes here are written to the brain journal.</p>
          <div className="adv-grid">
            <section className="panel span2">
              <header className="panel-head">
                INPUTS
                <span className="panel-head-note" style={{ float: 'right' }}>
                  <span className="dot yellow" /> 5 / 5 INPUTS SIM
                </span>
              </header>
              <div className="input-row2">
                <div className="input-title">ODDS FEED · THE ODDS API</div>
                <div className="input-right">
                  <span className="masked">NO KEY — SIM</span>
                  <button className="mini-btn">EDIT</button>
                  <span>{planText(view.forecaster.planMonthly)}</span>
                  <span className="chip-live sim">SIM</span>
                  <span>{lastTickText(view.lastTickAt, now)}</span>
                </div>
              </div>
              <div className="input-row2">
                <div className="input-title">RESULTS FEED</div>
                <div className="input-right"><span className="chip-live sim">SIM</span></div>
                <div className="input-helper">Settles every receipt after games end · ~40 credits/day, already in the forecast</div>
              </div>
              <div className="input-row2">
                <div className="input-title">YOUR REPORTS — CONFIRM TAPS + LIMITED? + WHATSAPP REPLIES</div>
                <div className="input-right"><span className="chip-live green">LINKED</span></div>
                <div className="input-helper">Channel configured in the WHATSAPP panel. This is the brain's only source of truth about limits.</div>
              </div>
              <div className="input-row2">
                <div className="input-title">REFERENCE TABLES — MARGIN TABLES v2026.07 · DEEP LINKS 16/16 BOOKS</div>
                <div className="input-right"><button className="mini-btn">CHECK FOR UPDATES</button></div>
                <div className="input-helper">Ships with the app; updates rarely.</div>
              </div>
              <div className="input-row2">
                <div className="input-title">BRAIN MEMORY</div>
                <div className="input-right"><span className="kv-value">{memoryText(view.memory)}</span></div>
                <div className="input-helper">Backups live in the DATA panel.</div>
              </div>
              <div className="adv-footer">Inputs in, picks out. The brain never reads news, injuries, or stats — prices only.</div>
            </section>

            <section className="panel">
              <header className="panel-head">MY BOOKS</header>
              <div className="panel-body">
                {view.books.map((b) => {
                  const row = bookRow(b);
                  return (
                    <div className={`book-row${!b.sharpExempt && !b.enabled ? ' off' : ''}`} key={b.name}>
                      <span className="book-name">{row.name}</span>
                      {b.sharpExempt ? (
                        <>
                          <span className="book-sport" style={{ cursor: 'default' }}>ANY</span>
                          <span className="chip-state sharp">{row.chip.label}</span>
                        </>
                      ) : (
                        <>
                          <select
                            className="book-sport" value={b.sport}
                            onChange={(e) => { void setSport(b.name, e.target.value); }}
                          >
                            {sportsRoster.map((sp) => <option key={sp} value={sp}>{sp.toUpperCase()}</option>)}
                          </select>
                          <button
                            className={`chip-state ${row.chip.tone}`}
                            onClick={() => { void toggleBook(b.name, b.enabled); }}
                          >
                            {row.chip.label}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                <button className="add-book">+ ADD BOOK</button>
              </div>
            </section>

            <section className="panel">
              <header className="panel-head">SPORTS & LEAGUES</header>
              <div className="panel-body">
                <div className="sports-grid">
                  {view.sports.map((x) => (
                    <button
                      key={x.sport}
                      className={`sport-cell${x.enabled ? '' : ' off'}`}
                      onClick={() => { void toggleSport(x.sport, x.enabled); }}
                    >
                      {sportCell(x)}
                    </button>
                  ))}
                </div>
                <div className="helper-note">More leagues = more credits. The forecaster updates live.</div>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
```

(`NO KEY — SIM`, the `SIM` chips and `5 / 5 INPUTS SIM` are NEW copy — Design §12. `EDIT`, `CHECK FOR UPDATES` and `+ ADD BOOK` are deliberately inert — Design §9. The book sport control is a native `<select>` restyled flat — the `▾` affordance comes from the platform; the mockup's `▾` glyph appears in the closed label via the option text.)

- [ ] **Step 2: Grow `client/src/screens/SettingsScreen.tsx`** — after the `.settings-grid` div:

```tsx
      <AdvancedSettings view={view} now={Date.now()} refresh={refresh} />
```

with the import:

```tsx
import { AdvancedSettings } from '../components/AdvancedSettings';
```

- [ ] **Step 3: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, SETTINGS tab:
- `ADVANCED SETTINGS →` toggles to `— COLLAPSE`; intro sentence renders.
- INPUTS: yellow dot + `5 / 5 INPUTS SIM`; `LAST TICK n S AGO` counts from the last scan; BRAIN MEMORY counts live rows.
- MY BOOKS: toggling bet365 OFF greys the row; the next scan creates no bet365 candidates (TRADES tab); Pinnacle has no controls.
- Changing a book's sport journals (`Books: … sport … → …` on the BRAIN tab's journal after a refresh).
- SPORTS & LEAGUES: `✗`-ing a sport stops its candidates; the store shows it in `disabledSports`.
Stop the dev servers.

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat(client): advanced settings — sim-honest inputs, my books, sports & leagues"
```

---

### Task 10: ADVANCED SETTINGS — thresholds, fallback, safety rules, kill rules + journal

**Files:**
- Modify: `client/src/components/AdvancedSettings.tsx`

**Interfaces:**
- Consumes: Task 5's `thresholdTexts`, `fallbackItems`, `safetyRows`, `killRuleRows`, `journalMinText`; `patchSettings`.
- Produces: the remaining four advanced panels; the calm-lock UX.

- [ ] **Step 1: Grow `client/src/components/AdvancedSettings.tsx`** — add inside `.adv-grid`, after the SPORTS & LEAGUES section. First extend the imports:

```tsx
import {
  advSettingsToggle, bookRow, fallbackItems, journalMinText, killRuleRows,
  lastTickText, memoryText, planText, safetyRows, sportCell, thresholdTexts,
  type SettingsView,
} from '../lib/settings';
import { Stepper } from './Stepper';
```

add the handlers next to the others:

```tsx
  const step = async (key: string, next: number) => {
    await patchSettings({ [key]: next });
    refresh();
  };
  const locked = view.safetyLocked;
```

and append the four panels:

```tsx
            <section className="panel">
              <header className="panel-head">EDGE THRESHOLDS & FRESHNESS</header>
              <div className="panel-body">
                {(() => {
                  const t = thresholdTexts(s);
                  return (
                    <>
                      <div className="kv"><span className="kv-key">{t[0]![0]}</span>
                        <Stepper value={t[0]![1]}
                          onDec={() => { void step('minArbMarginPct', Math.max(0.05, Number((s.minArbMarginPct - 0.05).toFixed(2)))); }}
                          onInc={() => { void step('minArbMarginPct', Number((s.minArbMarginPct + 0.05).toFixed(2))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[1]![0]}</span>
                        <Stepper value={t[1]![1]}
                          onDec={() => { void step('minEvEdgePct', Math.max(0.1, Number((s.minEvEdgePct - 0.1).toFixed(1)))); }}
                          onInc={() => { void step('minEvEdgePct', Number((s.minEvEdgePct + 0.1).toFixed(1))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[2]![0]}</span>
                        <Stepper value={t[2]![1]}
                          onDec={() => { void step('middleRatio', Math.max(1.0, Number((s.middleRatio - 0.1).toFixed(1)))); }}
                          onInc={() => { void step('middleRatio', Number((s.middleRatio + 0.1).toFixed(1))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[3]![0]}</span>
                        <Stepper value={t[3]![1]}
                          onDec={() => { void step('freshWindowSecs', Math.max(30, s.freshWindowSecs - 10)); }}
                          onInc={() => { void step('freshWindowSecs', s.freshWindowSecs + 10); }} />
                      </div>
                    </>
                  );
                })()}
                <div className="helper-note">Verified cards count down from this before turning STALE.</div>
              </div>
            </section>

            <section className="panel">
              <header className="panel-head">REFERENCE PRICER FALLBACK</header>
              <div className="panel-body">
                <div className="kv-key" style={{ padding: '10px 0 4px' }}>IF THE ANCHOR GOES DOWN</div>
                {fallbackItems(s).map((item) => (
                  <button key={item.idx} className={`radio-item${item.active ? ' active' : ''}`}
                    onClick={() => { void step('anchorFallback', item.idx); }}>
                    {item.label}
                  </button>
                ))}
                <div className="helper-note">
                  The anchor itself is switched on the Brain tab. Switching starts a new measurement series — it never mixes rulers.
                </div>
              </div>
            </section>

            <section className={`panel${locked ? ' locked' : ''}`}>
              <header className="panel-head">
                ACCOUNT SAFETY RULES
                <span className="panel-head-note">□ EDITABLE WHILE GREEN</span>
              </header>
              <div className="panel-body">
                {safetyRows(s).map(([key, value, tone]) => (
                  key === 'ONE-SPORT RULE' ? (
                    <div className="kv" key={key}>
                      <span className="kv-key">{key}</span>
                      <button className={`toggle-chip${s.oneSportRule === 0 ? '' : ' on'}`} disabled={locked}
                        onClick={() => { void step('oneSportRule', s.oneSportRule === 0 ? 1 : 0); }}>
                        {value}
                      </button>
                    </div>
                  ) : (
                    <div className="kv" key={key}>
                      <span className="kv-key">{key}</span>
                      <span className={`kv-value${tone === 'plain' ? '' : ` ${tone}`}${key === 'DEFAULT QUIT RULE' ? ' kv-quit' : ''}`}>{value}</span>
                    </div>
                  )
                ))}
                <div className="helper-note">Locked while any book is amber or red — you set these when calm.</div>
              </div>
            </section>

            <section className="panel span2">
              <header className="panel-head">
                STRATEGY KILL RULES + JOURNAL
                <span className="panel-head-note">□ EDITABLE WHILE PASSING</span>
              </header>
              <div className="panel-body">
                {killRuleRows().map(([key, value]) => (
                  <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
                ))}
                <div className="helper-note">A strategy on watch locks its own rule.</div>
                <div className="journal-sub">
                  <div className="kv">
                    <span className="kv-key">JOURNAL MINIMUM</span>
                    <Stepper value={journalMinText(s)}
                      onDec={() => { void step('journalMinPerDay', Math.max(1, s.journalMinPerDay - 1)); }}
                      onInc={() => { void step('journalMinPerDay', Math.min(4, s.journalMinPerDay + 1)); }} />
                  </div>
                  <div className="helper-note">The brain always writes at least this many entries and as many more as it wants.</div>
                </div>
              </div>
            </section>
```

(GO GENTLE / STOP heats render as tinted display values; their knobs are PATCHable via API and calm-locked server-side — the mockup gives them no steppers. The ONE-SPORT chip disables client-side when locked AND the server 409s regardless.)

- [ ] **Step 2: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, SETTINGS → ADVANCED SETTINGS:
- EDGE THRESHOLDS: `+` on MIN ARB MARGIN → `0.80%`; the next scan's arb detection uses the higher bar (fewer/no ARB candidates while raised); each change writes a `Settings changed: …` journal line (BRAIN tab).
- FALLBACK radios: selecting `○ PAUSE EVERYTHING` fills its `●` and journals; sim behavior is unchanged (the anchor never goes down in sim — by design).
- ACCOUNT SAFETY: with all books green the ONE-SPORT chip toggles; force a book amber (report a limit on TRADES), the panel greys and the server 409s any safety PATCH (`curl -s -X PATCH localhost:4400/api/settings -H 'content-type: application/json' -d '{"stopHeat":70}'` → 409).
- JOURNAL MINIMUM: `+` to `3 / DAY` → after the next scan tick the journal holds ≥ 3 entries for today (Watch list / Today so far / Credits lines).
Stop the dev servers.

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "feat(client): advanced settings — thresholds, pricer fallback, calm-locked safety, journal minimum"
```

---

### Task 11: Forbidden-words sweep, full suite, end-to-end smoke

**Files:** none created — verification only (fix anything the sweeps catch).

- [ ] **Step 1: Forbidden-words sweep**

Run: `grep -rniE 'append-only|ghost|picker|grader|gatekeeper|CLV' server/src client/src`
Expected: **no output** (exit code 1). Any hit is a bug — fix before proceeding.

- [ ] **Step 2: Full-suite run**

Run: `npm test && npm run typecheck`
Expected: server suite + client suite all pass; both typechecks clean.

- [ ] **Step 3: End-to-end smoke (manual, real processes)**

Terminal A: `npm run dev` (4400). Terminal B: `npm run dev:client` (5174). Then:
1. SETTINGS renders all six panels with live values; every mockup label present verbatim.
2. Mix: drag EV to 0 → over the next scans NO EV pick ever promotes (TRADES tab); the brain rationale gains the mix clause. Restore 47/24/29.
3. `curl -s -X PATCH localhost:4400/api/settings -d '{"mixArbPct":50}' -H 'content-type: application/json'` → 400 (trio rule).
4. Toggle bet365 OFF; `curl -s -X POST localhost:4400/api/scan`; verify no bet365 legs among new pendings; toggle back ON.
5. KILL SWITCH ON → later scans write no `brain_pass` rows; UPDATE UNDERSTANDING still does. Switch OFF.
6. JOURNAL MINIMUM 3 → next tick tops the journal up to 3 today.
7. EXPORT CSV/JSON both download; `grep -c '^' export.csv` = trades + 1.
8. `curl -s localhost:4400/api/settings/view | grep -icE 'append-only|ghost|picker|grader|gatekeeper|CLV'` → `0`.
9. Kill the server → SETTINGS degrades to the single offline note; restart → recovers.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(settings): smoke-test findings"
```

---

## Self-Review Notes (done at planning time)

- **Spec coverage (Plan-5 scope):** MASTER PROMPT §4 SETTINGS fully mapped — six panels (T6–T8), advanced expander complete (T9–T10): INPUTS with masked key/EDIT/plan/status/last-tick, MY BOOKS with sport dropdowns + ON/OFF + SHARP — ALWAYS ON, SPORTS & LEAGUES grid, EDGE THRESHOLDS steppers, REFERENCE PRICER FALLBACK radios, ACCOUNT SAFETY RULES with lock semantics, STRATEGY KILL RULES + JOURNAL MINIMUM stepper. The brief's core demand — every knob observably changes engine behavior — is proven per knob: mix (T2 mixcap tests), books/sports eligibility (T2), tolerance/stale/thresholds (existing engine reads, exercised in T7/T10 smoke + Plan 1 tests), one-sport + fallback (T3 gate/candidate tests), kill switch (Plan 3's `brainPassIfDue` test + T8 smoke), journal minimum (T3 tests).
- **Copy fidelity:** every §5 label/value string renders verbatim or as its live-value derivation (exact glyphs: `–` en dashes in ranges, `×`, `✓/✗`, `●/○`, `□` in panel-head notes, `▾`). NEW copy, all flagged: `SETTINGS OFFLINE — SERVER UNREACHABLE`, `SENT ✓`, `NONE YET` (backups), `NO KEY — SIM`, `SIM` chips, `5 / 5 INPUTS SIM`. Demo numbers replaced by live derivations per the derived-data rule.
- **Discrepancies resolved:** mockup-static tolerance row → stepper (hard rule 2 wins — Design §9); mockup `LIVE` input statuses → `SIM` (never fake a live feed — Plan 3 T12 precedent); mockup league names → the engine's real sport roster (a league grid that filters nothing would fake a knob — Decision 9); `+ ADD BOOK`/`CHECK FOR UPDATES`/`EDIT` stay inert with rationale (Decision/Design §9); prefilled demo phone number → empty default (Design §2).
- **Type consistency:** `Settings` widens to numbers + strings in ONE place (defaults.ts) and the ONLY all-numbers consumer (`settingsPatch`) is rewritten wholesale in the same task; `SettingsView` defined in settings/report.ts, mirrored in client lib/settings.ts; `Book.enabled` flows repos → eligibility → view; every client class in T7–T10 exists in T6's frozen list.
- **Contract consistency:** `PATCH /api/settings` keeps every existing key's rule byte-identical (new keys only get new rules; the calm-lock adds a 409 path that cannot fire for a fresh green db); no existing endpoint's response shape changes; NO existing test is modified — Task 2 documents why the daily-cap test survives the mix cap and carries a contingency amendment if the seeded snapshot ever shifts.
- **One-timer invariant:** `ensureJournalMinimum` rides `doScan`; the settings screen adds only the standard 5 s poll; exports and the whatsapp stub are pull-only.
- **Deferred ambiguities (deliberate, documented):** (1) SIM/LIVE switch + confirm dialog is Plan 6's (the brief locks it; the badge stays display-only). (2) LLM budget displays Σ `llm_spend` events that Plan 6 will write; the $3 cap constant lives in settings/report.ts until Plan 6's enforcement module owns it. (3) Backups row reads `backup` events Plan 6 will write. (4) STRATEGY KILL RULES thresholds stay copy until a strategy-death engine exists (Plan 3 Deferred §6). (5) `+ ADD BOOK` waits for live mode — the sim provider can never quote an added book, and a book that can never quote would be a fake roster row.
- **Placeholder scan:** no TBD/TODO/"similar to task N" anywhere; every code step is complete file content or an exact old→new replacement; commands carry expected outputs.






