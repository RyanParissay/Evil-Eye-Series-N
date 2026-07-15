# Evil Eye V2 — Plan 4: ANALYTICS (read model + screen)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money-truth layer — profiles, the two profit charts, the monthly table, the TIME TO ACT funnel and every ADVANCED ANALYTICS section — derived deterministically from the existing SQLite tables (bankroll_snapshots, trades, limits_reports, events_log) plus one new column (`trades.confirmed_at`), and an ANALYTICS screen pixel-faithful to design inventory §4: profile box + dropdown + inline add-profile form (§4.1–4.2), range chips (§4.3), the two hand-rolled SVG charts `CONFIRMED — PROFIT ($)` and `ALL (CONFIRMED + UNCONFIRMED) — IF EVERY PICK WAS FOLLOWED ($)` with their stats rows (§4.4–4.5), the monthly table (§4.6), the TIME TO ACT funnel (§4.7), the blue ADVANCED ANALYTICS expander with OPEN BETS / LEADERBOARDS / COST OF SAFETY / LIMITS REPORTED / OPPORTUNITY LEADERBOARDS (§4.8), and the sim-mode footnote (§4.9).

**Architecture:** Pure math under `server/src/analytics/` (series.ts, rollups.ts — no I/O), one read model (`report.ts`) serialized by one GET route, plus two profile routes, all in the existing Express app. The confirmed chart reads `bankroll_snapshots` (Plan 1's daily write, corrected in Task 1 to count confirmed money only and to snapshot every profile); the "if every pick was followed" chart shadow-settles unfollowed sent picks AT READ TIME with a per-trade deterministic rng — nothing is ever written back. Client: `AnalyticsScreen` composed of small components, with every display derivation in pure functions in `client/src/lib/analytics.ts` (the ONLY unit-tested client layer, per Plan 2's convention), one `useAnalytics` polling hook, and one new stylesheet `analytics.css`. Charts are hand-rolled inline SVG — the stack is LOCKED; no chart/graphing dependency may be added.

**Tech Stack:** unchanged from Plans 1–2 — Node 20+/TS strict/NodeNext + better-sqlite3 ^12 + Express 4 + Vitest 2 (server); Vite 5 + React 18 + plain CSS custom properties (client). Server port 4400, Vite dev port 5174.

## Design (locked — every derived number decided here)

1. **One payload, one poll** — `GET /api/analytics?profileId&range` returns everything the screen renders (`AnalyticsView`); the client polls it every 5 s (`useAnalytics`, same contract as Plan 3's `useBrain`) and derives all display strings in pure functions. Building the view NEVER mutates state — shadow results are computed, not stored.
2. **`trades.confirmed_at` is the new source of truth for "followed"** (Task 1): `confirmTrade` stamps it, `unconfirmTrade` clears it, and it survives settlement (status alone loses the CONFIRMED→SETTLED history). It feeds the TIME TO ACT buckets (`confirmedAt − verifiedAt`), the monthly CONF column and the confirmed/unfollowed split. Migration is an idempotent `ALTER TABLE` guard in `openDb`; existing rows stay NULL — no timestamps are ever fabricated (pre-migration settled rows therefore count only in the ALL chart, an honest one-time note, sim paper money).
3. **Chart 1 (`CONFIRMED — PROFIT ($)`) = bankroll_snapshots.** Task 1 corrects Plan 1's `writeDailySnapshot` to write, for EVERY profile, `startingCash + Σ result_cents of SETTLED trades with confirmed_at NOT NULL and profile_id = p.id`. Real money only moves on picks you actually confirmed — the footnote's "shadow position" is chart 2's job. Day values are carry-forward: a day with no snapshot shows the latest snapshot before it (profile start before the first snapshot).
4. **Chart 2 (`ALL (CONFIRMED + UNCONFIRMED) — IF EVERY PICK WAS FOLLOWED ($)`) = real settled results + read-time shadow results.** Sim never creates UNCONFIRMED (unactioned VERIFIED trades expire), so "every pick followed" = confirmed results as-is PLUS a shadow outcome for every SENT pick that expired unconfirmed (`verified_at NOT NULL AND status = 'EXPIRED'`) whose event is ≥ 3 h past start (the sim settle cutoff). The shadow outcome reuses `simOutcome`'s exact payout math (Task 1 exports it) with `mulberry32(fnv1a32(trade.id))` — per-trade deterministic, identical on every poll, forever, and NEVER written to the database. Shadow settle day = Vancouver day of `eventStartsAt + 3 h`.
5. **Ranges are trailing Vancouver-day windows ending today**: `1D` 1, `5D` 5, `30D` 30, `1Y` 365, `MAX` since the profile's `createdDate`. The axis is the list of day keys in the window clipped to the creation date; both charts share it (mockup shares one date row). One-day axes render a single ringed point, no line (honest degenerate).
6. **Stats row per chart**: `PROFIT` = value at the axis' last day − baseline, where baseline = the value carried into the day BEFORE the window (profile start when none). `RETURN (RANGE)` = profit ÷ the `bankrollCents` SETTING (the footnote is literal: returns measure against the ONE total bankroll, not the profile's fund). `ANNUALIZED` = range return × 365 ÷ axis days ("EXTRAPOLATED TO 365 DAYS" is linear extrapolation). Formatting: return 2 dp, annualized 1 dp, profit signed whole dollars — negative always U+2212.
7. **Chart geometry is fixed by the mockup** (client pure fn): plot box x∈[60,940] y∈[25,205]; the vertical gridlines are the mockup's exact decorative positions (majors x 207/354/500/647/794, minors x 133/280/427/574/720/867) independent of data; the horizontal scale is a deterministic nice-scale — step = smallest of $10·{1,2,5}×10^k such that the span `[floor(min⁻/step)·step, ceil(max⁺/step)·step]` (always spanning $0) needs ≤ 6 steps; equal bounds widen by one step. Points spread evenly x = 60 + i·880/(n−1); bullets r=4 at every point only when n ≤ 60 (365 bullets is soup), last point always r=5.5 + ink ring; 6 date labels sampled evenly from the axis, format `JUL 5` (unpadded day — mockup) rendered space-between.
8. **Monthly table definitions** (per Vancouver month of `day_key`, newest first, every month with data): CAND = trades inserted; VERIF = passed the recheck (`sent + heldBack`, i.e. `verified_at NOT NULL` plus EXPIRED-with-recheck-never-verified); SENT = `verified_at NOT NULL`; CONF = `confirmed_at NOT NULL`; UNCONF = status UNCONFIRMED (honest zero until Plan 6 wires no-reply); EXP = status EXPIRED; KILLED = status KILLED; FOLLOW-THRU = round(100·CONF/SENT) or `—` when SENT 0; P/L = Σ `result_cents` of confirmed settled trades whose SETTLE day falls in the month.
9. **TIME TO ACT funnel**: population = sent picks with a known confirmation outcome — confirmed ones bucket on `confirmedAt − verifiedAt` (`< 2 MIN`, `2–5 MIN`, `5–10 MIN`, plus a `CONFIRMED > 10 MIN` row (NEW copy) rendered only when non-zero — the mockup's three buckets can't hold a slow confirm honestly), dead = sent and EXPIRED. Still-live VERIFIED cards are excluded (no outcome yet). Percentages are plain `Math.round` of share (may sum to 99/101 — accepted); empty population renders `—` values over zero-width fills.
10. **Profiles**: the scanner keeps attributing every trade to the seeded profile (id 1, `RYAN`) — Plan 4 adds no active-profile concept (that would be a SETTINGS knob, out of scope). New profiles chart flat at their starting cash from their creation date — honest, and exactly what "starts the day you create it" promises. `POST /api/profiles` validates name (non-empty after trim) and startingCashCents (positive integer); duplicate names → 409 (the column is UNIQUE). Names render uppercased in the dropdown; stored as typed.
11. **ADVANCED ANALYTICS sources**: OPEN BETS = CONFIRMED not-yet-settled trades (money actually at stake), `STARTS h:mm PM` before start, `LIVE` after (NEW copy — sim can't know the quarter). LEADERBOARDS = confirmed-trade leg counts per book per category since the profile's fund start (the `▾` chip renders that date, non-interactive — no spec defines its behavior). COST OF SAFETY: ROUNDING COST = Σ over confirmed ARB pairs of (ideal margin profit − actual rounded worst-case profit), recomputed from each trade's own stored legs; MARGIN RETENTION = median recheck/initial with note `PROMOTION THRESHOLD {100−tolerancePct}% · {x}% OF CANDIDATES DIE AT RECHECK` (the mockup's "80%" contradicts the locked 5% default — inventory §8.2, the setting wins); GATE COST = per battery reason, Σ `round(max(0, marginInitial) × flatPairCents)` over its kills (the flat-pair stake is the deterministic EV proxy for never-staked candidates), bars normalized to the max row which tints yellow; the closing-price tile reuses Plan 3's `closingEdge` and is HEADED `CLOSING PRICE EDGE VS PINNACLE CLOSE` — the mockup's "CLV" heading violates MASTER PROMPT rule 6 (inventory §8.1) and is renamed. LIMITS REPORTED = `limits_reports` joined to trades, newest first. OPPORTUNITY LEADERBOARDS = ALL candidates (every status, kills included — opportunity is what the scanner FOUND) per book per category since the first trade's day; COUNT/MARGIN·EDGE sort and the 5-row cap are client-side; `SEE ALL →` expands to every book, collapse label `SHOW FEWER ←` (NEW copy).
12. **Demo values are not test expectations** (inventory §7.3/§8): every chart point, stat, monthly cell, funnel %, tile and board row in the mockup is hardcoded filler; this plan derives everything from live tables and keeps only LABELS and fixed prose verbatim (exact glyphs: `—`, `·`, `▾`, `→`, `−` U+2212, `–` U+2013 in `2–5 MIN`, `Σ`).

## Global Constraints

- Money is **integer cents** in every variable, column and API payload; dollars only inside format functions' return strings.
- Server files use NodeNext — **relative imports carry `.js` extensions**; client uses Bundler resolution (no extension). Consumers copy `DEFAULT_SETTINGS`, never alias it.
- **One timer invariant**: the only real `setTimeout` lives in `server/src/index.ts`. Analytics adds NO timers server-side — the read model is pull-only; the only new client interval is `useAnalytics`'s 5 s poll (the established hook pattern).
- **No new dependencies** — charts are hand-rolled inline SVG styled by CSS custom properties. Adding any chart/graphing library is a plan violation.
- Never render the words: **append-only, ghost, picker, grader, CLV, gatekeeper** — in any UI string or API response (MASTER PROMPT hard rule 6; the mockup's "CLV VS PINNACLE CLOSE" tile is renamed, Design §11).
- ALL UI copy verbatim from `docs/handoff/design-inventory.md` §4 (exact glyphs: `—`, `·`, `▾`, `●`, `→`, `−` U+2212, `–` U+2013). New copy not in the inventory is flagged `(NEW copy)` where it appears.
- **One total bankroll** — RETURN/ANNUALIZED measure against the `bankrollCents` setting, never per book, never per profile. No skip feature; no promo strategy.
- Data kept forever — analytics never deletes trades, snapshots, limits or events rows; the shadow settlement writes nothing.
- Quiet hours 00:00–08:00 America/Vancouver; all wall-clock and day-key rendering via `Intl.DateTimeFormat` with `timeZone: 'America/Vancouver'` (never a fixed UTC offset).
- Ports: server **4400**, Vite dev **5174**. All commands run from the repo root.
- TDD every task; commit after every task. The full suite must stay green throughout (server 117 + client 20 at this plan's authoring baseline, plus whatever Plan 3 landed — Plan 4 executes after Plan 3 merges, Decision note 1).

## Interface Contracts (referenced by all tasks)

```ts
// server/src/shared/types.ts — Trade gains ONE optional field (Task 1)
export interface Trade {
  /* …existing fields unchanged… */
  confirmedAt?: number | null;   // stamped by confirmTrade, cleared by unconfirmTrade, survives settlement
}

// server/src/db/repos.ts additions (Task 1)
export interface AnalyticsTradeRow {
  id: string; category: Strategy; event: string; sport: string; legs: Leg[];
  marginInitial: number; marginRecheck: number | null; marginFinal: number | null;
  status: TradeStatus; killReason: KillReason | null; resultCents: number | null;
  createdAt: number; verifiedAt: number | null; confirmedAt: number | null;
  settledAt: number | null; eventStartsAt: number; dayKey: string; market: string | null;
}
trades.analyticsRows(profileId: number): AnalyticsTradeRow[]   // ORDER BY created_at ASC, id ASC
trades.settledConfirmedCents(profileId: number): number        // Σ result_cents, SETTLED + confirmed_at NOT NULL

// server/src/pipeline/actions.ts (Task 1)
export function simOutcome(t: Trade, rng: () => number): { won: boolean; resultCents: number }  // export only — body unchanged

// server/src/analytics/series.ts (pure — Task 2)
export type RangeKey = '1D' | '5D' | '30D' | '1Y' | 'MAX';
export interface SeriesPoint { day: string; profitCents: number }        // day = Vancouver 'YYYY-MM-DD'
export interface ChartStats { profitCents: number; returnPct: number; annualizedPct: number }
dayAxis(now: number, range: RangeKey, createdDate: string): string[]
fnv1a32(s: string): number
mulberry32(seed: number): () => number
shadowResults(rows: AnalyticsTradeRow[], now: number): { day: string; resultCents: number }[]
confirmedSeries(snapshots: BankrollSnapshot[], axis: string[], startCents: number): SeriesPoint[]
allSeries(rows: AnalyticsTradeRow[], axis: string[], now: number): SeriesPoint[]
chartStats(points: SeriesPoint[], baselineCents: number, bankrollCents: number): ChartStats
baselineFor(snapshots: BankrollSnapshot[], axis: string[], startCents: number): number           // confirmed chart
allBaseline(rows: AnalyticsTradeRow[], axis: string[], now: number): number                       // all chart

// server/src/analytics/rollups.ts (pure — Task 3)
export interface MonthlyRow { month: string; cand: number; verif: number; sent: number; conf: number;
  unconf: number; exp: number; killed: number; followThruPct: number | null; plCents: number }
export interface FunnelCounts { under2: number; from2to5: number; from5to10: number; over10: number; dead: number; total: number }
export interface OpenBetView { category: Strategy; event: string; legsText: string;
  stakeCents: number; startsAt: number; live: boolean }   // money stays cents — the client formats
export interface BoardRow { book: string; count: number; pct: number }
export interface GateCostRow { reason: KillReason; costCents: number; note: string }
export interface OppRow { book: string; count: number; avgPct: number }
monthlyRows(rows: AnalyticsTradeRow[]): MonthlyRow[]                          // newest month first
funnelCounts(rows: AnalyticsTradeRow[]): FunnelCounts
openBets(rows: AnalyticsTradeRow[], now: number, label: (book: string) => string): OpenBetView[]
leaderboards(rows: AnalyticsTradeRow[], label: (book: string) => string):
  { title: 'ARB' | 'EV' | 'MIDDLES' | 'ALL CATEGORIES'; rows: BoardRow[] }[]  // top 3 each
roundingCost(rows: AnalyticsTradeRow[]): { costCents: number; pairs: number } | null
retention(rows: AnalyticsTradeRow[]): { medianPct: number; dieAtRecheckPct: number } | null
gateCost(rows: AnalyticsTradeRow[], s: Settings, label: (book: string) => string): GateCostRow[]
opportunities(rows: AnalyticsTradeRow[], label: (book: string) => string):
  { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] }           // unsorted, ALL books

// server/src/analytics/report.ts → GET /api/analytics response (client mirror in client/src/lib/analytics.ts)
interface ProfileView { id: number; name: string; startingCashCents: number; createdDate: string }
interface ChartView { points: SeriesPoint[]; stats: ChartStats }
interface AnalyticsView {
  simulated: boolean;                       // sim-mode footnote gate (Plan 6 flips it)
  today: string;                            // Vancouver day key — the add-profile form's date note
  profile: ProfileView;
  range: RangeKey;
  bankrollCents: number;                    // the ONE total bankroll (returns denominator + footnote)
  confirmed: ChartView;
  all: ChartView;
  monthly: MonthlyRow[];
  funnel: FunnelCounts;
  advanced: {
    openBets: OpenBetView[];
    leaderboards: { since: string; boards: { title: string; rows: BoardRow[] }[] };
    costOfSafety: {
      rounding: { costCents: number; pairs: number } | null;
      retention: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null;
      gateCost: GateCostRow[];
      closingEdge: { avgPct: number; beatClosePct: number; legs: number } | null;   // Plan 3's closes.closingEdge
    };
    limits: { when: number; book: string; sport: string; event: string; maxCents: number }[];  // newest first
    opportunities: { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] };
  };
}

// Routes added to server/src/api/routes.ts (Task 4)
GET  /api/profiles                  → { profiles: ProfileView[] }
POST /api/profiles                  → { profile: ProfileView }   body { name: string, startingCashCents: int > 0 }
                                      (400 bad body · 409 duplicate name)
GET  /api/analytics                 → AnalyticsView               query ?profileId (default first) ?range (default 30D)
                                      (400 bad range · 404 unknown profile)

// client/src/lib/analytics.ts — mirror types + pure helpers (Task 5; exhaustive list)
rangeKeys: RangeKey[]                                              // ['1D','5D','30D','1Y','MAX']
formatDateCaps(day: string): string                                // '2026-05-01' → 'MAY 01 2026'
chartDate(day: string): string                                     // '2026-07-05' → 'JUL 5'
monthLabel(month: string): string                                  // '2026-07' → 'JUL'
formatSignedDollars(c: number): string                             // 43_812 → '+$438' (rounded, U+2212)
formatReturn(pct: number): string                                  // 2.7412 → '+2.74%'
formatAnnualized(pct: number): string                              // 38.91 → '+38.9%'
fundStartText(p: ProfileView): { amount: string; date: string }
profileItems(profiles: ProfileView[], currentId: number): { id: number; label: string; current: boolean }[]
createEnabled(name: string, amount: string): boolean
startsNote(today: string): string                                  // 'STARTS THE DAY YOU CREATE IT — JUL 14 2026'
chartGeometry(points: SeriesPoint[]): ChartGeo | null              // null when 0 points
statsTexts(stats: ChartStats): { ret: string; ann: string; profit: string; retTone: 'pos' | 'neg' }
bankrollFootnote(bankrollCents: number): string
monthlyCells(r: MonthlyRow): string[]                              // 10 strings, table order
funnelRows(f: FunnelCounts): { label: string; pct: number | null; value: string; dead: boolean }[]
openBetStatus(b: OpenBetView): string                              // 'STARTS 7:10 PM' | 'LIVE'
sortOpp(rows: OppRow[], by: 'COUNT' | 'EDGE'): OppRow[]
oppToggle(open: boolean): string                                   // 'SEE ALL →' | 'SHOW FEWER ←'
limitRow(l: AnalyticsView['advanced']['limits'][number]): { left: string; right: string }
gateBar(rows: GateCostRow[]): { reason: string; widthPct: number; cost: string; note: string; top: boolean }[]
closingEdgeTile(t): { value: string; note: string }
retentionTile(t): { value: string; note: string }
roundingTile(t): { value: string; note: string }

// client/src/hooks/useAnalytics.ts (Task 5)
useAnalytics(profileId: number | null, range: RangeKey): { view: AnalyticsView | null; refresh: () => void }

// client/src/lib/api.ts additions (Task 5)
fetchProfiles(): Promise<ProfileView[] | null>
createProfile(name: string, startingCashCents: number): Promise<ProfileView | null>
fetchAnalytics(profileId: number, range: RangeKey): Promise<AnalyticsView | null>
```

## Decision notes (locked product calls — bake in, do not re-litigate)

1. **Plan 4 executes after Plan 3 merges** (the roadmap's "after 2" is a dependency floor, not the executed order): the read model reuses Plan 3's `closingEdge` (`brain/closes.js`) and `displayName` (`brain/pass.js`). If Plan 3 were somehow absent the build would fail loudly at import — never silently fake the closing-edge tile.
2. **No backfill of `confirmed_at`** — pre-migration settled rows keep NULL and count only in the ALL chart (Design §2). Fabricating confirm timestamps would poison the TIME TO ACT funnel.
3. **`App.tsx` is patched surgically** — only the ANALYTICS placeholder line changes, so the task works whether or not Plan 3's `BrainScreen` line is present.
4. **Charts render live data only** — no seeded demo curves. A brand-new database shows a flat line at $0 profit with today's single ringed point; the range chips still work. Honest empty is the spec (Plan 2/3 precedent).
5. **The two charts share the axis and the geometry function**; only the input series and titles differ. `ProfitChart` is ONE component rendered twice.
6. **The profile dropdown lists live profiles** (uppercased), current one prefixed `● `; `+ ADD NEW PROFILE` opens the §4.2 form; CREATE stays grey until name is non-empty AND the amount parses (`parseDollarsToCents` — digits required, mockup regex `/\d/` is subsumed); on success the new profile is selected, the form closes and the fund box follows. Amount input placeholder `$5,000`, name placeholder `Name` — both verbatim.
7. **Range chips are the §0.4 joined-chip group** (reused CSS pattern from Plan 2's nav), default `30D` — active chip white-filled. Clicking re-queries the server (unlike the static mockup — derived-data rule).
8. **The monthly table has a header row** (`MONTH CAND VERIF SENT CONF UNCONF EXP KILLED FOLLOW-THRU P/L` — §4.6 grid), rows newest-first, all months with any trade. No pagination — data kept forever, the table grows (the screen scrolls).
9. **Funnel adds `CONFIRMED > 10 MIN` only when non-zero** (NEW copy, Design §9) — the three mockup buckets + dead row otherwise render exactly, including the grey dead fill.
10. **OPEN BETS rows** = `{CAT} · {event} · {book label + selection @ odds, ' / ' joined} · {total staked}` with `STARTS {h:mm PM}` (Vancouver, via Plan 3's `formatTimeShort`) flipping to `LIVE` at start (NEW copy — the mockup's `LIVE — Q2` quarter is unknowable). Empty → `NO OPEN BETS` note (NEW copy).
11. **Leaderboards pct** = round(100 × book's confirmed-leg count ÷ confirmed trades in that category) — a 3-leg arb credits three books. Top 3 rows per board; a board with no data renders `—` (NEW copy: single `—` row).
12. **The since-date chip (`MAY 01 2026 ▾`) renders the selected profile's fund start and stays non-interactive** — no spec anywhere defines a date picker for it; making it dynamic satisfies the derived-data rule (inventory lists it inert).
13. **OPPORTUNITY sort + reveal are client-side** (`sortOpp`, `oppToggle`) exactly like the mockup's `advLbSort`; the server sends every book's aggregate once. `MARGIN / EDGE` sorts by `avgPct` desc; ties break by count desc then name asc (deterministic render).
14. **`AnalyticsScreen` owns its data** via `useAnalytics()` + a one-shot `fetchProfiles()` (re-fetched after create); server down → single calm note `ANALYTICS OFFLINE — SERVER UNREACHABLE` (NEW copy, `.empty-note` style), no banner.
15. **The sim footnote renders only on this screen and only when `simulated`** (`AnalyticsView.simulated` — the server says so; Plan 6 flips it with live mode). Text verbatim §4.9.
16. **The bankroll footnote is dynamic**: `RETURNS MEASURED AGAINST TOTAL BANKROLL ({formatCents(bankrollCents)}). ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.` — renders the mockup string exactly at the default $10,000.

## File Map

```
server/src/shared/types.ts                        (Modify T1 — Trade.confirmedAt)
server/src/db/schema.sql                          (Modify T1 — confirmed_at column for fresh dbs)
server/src/db/db.ts                               (Modify T1 — idempotent ALTER migration)
server/src/db/repos.ts                            (Modify T1 — column plumbing + analytics queries)
server/src/db/repos.analytics.test.ts             (Create T1)
server/src/pipeline/actions.ts                    (Modify T1 — stamp/clear confirmedAt; export simOutcome)
server/src/scheduler/runner.ts                    (Modify T1 — snapshot every profile, confirmed money only)
server/src/analytics/series.ts + series.test.ts   (Create T2)
server/src/analytics/rollups.ts + rollups.test.ts (Create T3)
server/src/analytics/report.ts                    (Create T4)
server/src/api/routes.ts                          (Modify T4 — three routes)
server/src/api/api.test.ts                        (Modify T4 — route specs)
client/src/lib/analytics.ts + analytics.test.ts   (Create T5)
client/src/lib/api.ts                             (Modify T5 — fetch helpers)
client/src/hooks/useAnalytics.ts                  (Create T5)
client/src/styles/analytics.css                   (Create T6)
client/src/main.tsx                               (Modify T6 — import analytics.css)
client/src/App.tsx                                (Modify T6 — AnalyticsScreen replaces the placeholder)
client/src/screens/AnalyticsScreen.tsx            (Create T6; grows T7, T8, T9)
client/src/components/ProfileBar.tsx              (Create T6)
client/src/components/RangeChips.tsx              (Create T6)
client/src/components/ProfitChart.tsx             (Create T7)
client/src/components/MonthlyTable.tsx            (Create T8)
client/src/components/TimeToActFunnel.tsx         (Create T8)
client/src/components/AdvancedAnalytics.tsx       (Create T9)
```

---

### Task 1: `confirmed_at` column, analytics repo queries, honest snapshots

**Files:**
- Modify: `server/src/shared/types.ts`, `server/src/db/schema.sql`, `server/src/db/db.ts`, `server/src/db/repos.ts`, `server/src/pipeline/actions.ts`, `server/src/scheduler/runner.ts`
- Create: `server/src/db/repos.analytics.test.ts`

**Interfaces:**
- Consumes: existing `Repos`, `transition` core, `writeDailySnapshot`.
- Produces: `Trade.confirmedAt`, `trades.analyticsRows`, `trades.settledConfirmedCents`, exported `simOutcome`, per-profile confirmed-only snapshots — everything Tasks 2–4 read.

- [ ] **Step 1: Write the failing spec** — `server/src/db/repos.analytics.test.ts`:

```ts
import { expect, test } from 'vitest';
import { Repos, openDb } from './db.js';
import { createApp } from '../api/routes.js';
import { confirmTrade, unconfirmTrade } from '../pipeline/actions.js';
import type { Trade } from '../shared/types.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT — awake hours

function mkTrade(over: Partial<Trade>): Trade {
  return {
    id: 'x', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.02, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1_000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: 9_999_999,
    confirmedAt: null,
    ...over,
  };
}

test('confirmed_at round-trips through insert and update', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'CONFIRMED', confirmedAt: 123 }), '2026-07-14', 'moneyline');
  expect(r.trades.byId('a')!.confirmedAt).toBe(123);
  const t = r.trades.byId('a')!;
  t.confirmedAt = null;
  r.trades.update(t);
  expect(r.trades.byId('a')!.confirmedAt).toBeNull();
});

test('confirmTrade stamps confirmedAt; unconfirm clears; re-confirm re-stamps; double-tap keeps the first', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'VERIFIED', verifiedAt: 100 }), '2026-07-14', 'moneyline');
  confirmTrade(r, 'a', 500);
  expect(r.trades.byId('a')!.confirmedAt).toBe(500);
  confirmTrade(r, 'a', 900); // no-op double-tap — first stamp stands
  expect(r.trades.byId('a')!.confirmedAt).toBe(500);
  unconfirmTrade(r, 'a', 1_000);
  expect(r.trades.byId('a')!.confirmedAt).toBeNull();
  confirmTrade(r, 'a', 2_000);
  expect(r.trades.byId('a')!.confirmedAt).toBe(2_000);
});

test('analyticsRows: one query feeds every rollup — mapped columns, insert order', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', createdAt: 1 }), '2026-07-13', 'moneyline');
  r.trades.insert(mkTrade({ id: 'b', createdAt: 2, status: 'SETTLED', resultCents: 220, settledAt: 9, confirmedAt: 5, verifiedAt: 4, marginFinal: 0.02 }), '2026-07-14', 'total');
  const rows = r.trades.analyticsRows(1);
  expect(rows.map((x) => x.id)).toEqual(['a', 'b']);
  expect(rows[1]).toMatchObject({
    id: 'b', category: 'ARB', status: 'SETTLED', resultCents: 220, settledAt: 9,
    confirmedAt: 5, verifiedAt: 4, marginFinal: 0.02, dayKey: '2026-07-14', market: 'total',
  });
  expect(rows[0]!.legs[0]!.book).toBe('bet365'); // legs come back parsed
  expect(r.trades.analyticsRows(2)).toEqual([]); // other profiles see nothing
});

test('settledConfirmedCents sums confirmed settled money only', () => {
  const r = Repos(openDb(':memory:'));
  r.trades.insert(mkTrade({ id: 'a', status: 'SETTLED', resultCents: 200, settledAt: 9, confirmedAt: 5 }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'b', status: 'SETTLED', resultCents: -500, settledAt: 9, confirmedAt: null }), '2026-07-14', null);
  r.trades.insert(mkTrade({ id: 'c', status: 'CONFIRMED', confirmedAt: 5 }), '2026-07-14', null);
  expect(r.trades.settledConfirmedCents(1)).toBe(200);
  expect(r.trades.settledConfirmedCents(99)).toBe(0);
});

test('the scan tick snapshots EVERY profile with confirmed money only', () => {
  let now = NOW;
  const h = createApp({
    dbPath: ':memory:',
    clock: () => now,
    timer: { setTimeout: () => 0 },
    rng: () => 0.5,
    provider: { fetchQuotes: () => [] }, // empty market — the snapshot is the whole story
    sender: { sendVerified: () => {} },
  });
  h.repos.profiles.create('LEA', 500_000, '2026-07-14');
  h.repos.trades.insert(mkTrade({ id: 'won', status: 'SETTLED', resultCents: 4_200, settledAt: NOW - 1, confirmedAt: NOW - 2 }), '2026-07-13', null);
  h.repos.trades.insert(mkTrade({ id: 'unfollowed', status: 'SETTLED', resultCents: 9_999, settledAt: NOW - 1, confirmedAt: null }), '2026-07-13', null);
  h.scheduler.scanNow(now);
  const p1 = h.repos.snapshots.byProfile(1);
  expect(p1[p1.length - 1]).toEqual({ profileId: 1, dayKey: '2026-07-14', bankrollCents: 1_004_200 });
  expect(h.repos.snapshots.byProfile(2)).toEqual([{ profileId: 2, dayKey: '2026-07-14', bankrollCents: 500_000 }]);
});
```

(The Task 13-style sweep greps ALL of `server/src` — keep even test-local identifiers clear of the six forbidden words.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- repos.analytics`
Expected: FAIL — `confirmedAt` unknown on `Trade` (typecheck) / missing repo methods.

- [ ] **Step 3: Implement**

In `server/src/shared/types.ts`, replace the `Trade` interface with (one added field + comment; everything else byte-identical):

```ts
export interface Trade {
  id: string; profileId: number; category: Strategy; event: string; sport: string;
  legs: Leg[]; marginInitial: number; marginRecheck: number | null; marginFinal: number | null;
  status: TradeStatus; killReason: KillReason | null; resultCents: number | null;
  createdAt: number; verifyDueAt: number; verifiedAt: number | null; freshUntil: number | null;
  settledAt: number | null; eventStartsAt: number;
  /** Plan 4: when the user confirmed (survives settlement — status alone forgets).
   *  Optional so pre-plan fixtures compile; undefined ≡ null at the db boundary. */
  confirmedAt?: number | null;
}
```

In `server/src/db/schema.sql`, inside `CREATE TABLE IF NOT EXISTS trades`, add one column after `settled_at INTEGER,`:

```sql
  settled_at      INTEGER,
  confirmed_at    INTEGER,
```

In `server/src/db/db.ts`, replace the `openDb` body's schema line and add the migration helper:

```ts
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // no-op for :memory:, durable-fast for file dbs
  db.exec(schemaSql);
  migrate(db);
  seedIfEmpty(db);
  return db;
}

/** Idempotent column migrations for databases created before Plan 4 (data kept forever —
 *  never recreate, never drop). CREATE TABLE IF NOT EXISTS ignores new columns on old dbs,
 *  so each addition needs its own guarded ALTER. */
function migrate(db: Db): void {
  const cols = (db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('confirmed_at')) db.exec('ALTER TABLE trades ADD COLUMN confirmed_at INTEGER');
}
```

In `server/src/db/repos.ts`:

1. Add to the type imports: `KillReason`, `Strategy` (the file already imports `Leg, Trade, TradeStatus` type-only from `../shared/types.js`).

2. Replace the `TradeRow` interface (one field added):

```ts
interface TradeRow {
  id: string; profile_id: number; category: Trade['category']; event: string; sport: string;
  market: string | null; legs: string; margin_initial: number; margin_recheck: number | null;
  margin_final: number | null; status: TradeStatus; kill_reason: Trade['killReason'];
  result_cents: number | null; created_at: number; verify_due_at: number; verified_at: number | null;
  fresh_until: number | null; settled_at: number | null; event_starts_at: number; day_key: string;
  confirmed_at: number | null;
}
```

3. Add below `BankrollSnapshot`:

```ts
/** The analytics read model's single query row: a Trade plus the insert-stamped
 *  day_key/market the shared Trade type deliberately omits. */
export interface AnalyticsTradeRow {
  id: string; category: Trade['category']; event: string; sport: string; legs: Leg[];
  marginInitial: number; marginRecheck: number | null; marginFinal: number | null;
  status: TradeStatus; killReason: Trade['killReason']; resultCents: number | null;
  createdAt: number; verifiedAt: number | null; confirmedAt: number | null;
  settledAt: number | null; eventStartsAt: number; dayKey: string; market: string | null;
}
```

4. In `rowToTrade`, add `confirmedAt: r.confirmed_at,` after `settledAt: r.settled_at,`.

5. Replace the `tradeInsert` and `tradeUpdate` prepared statements:

```ts
    tradeInsert: db.prepare(`INSERT INTO trades (
        id, profile_id, category, event, sport, market, legs, margin_initial, margin_recheck, margin_final,
        status, kill_reason, result_cents, created_at, verify_due_at, verified_at, fresh_until, settled_at,
        confirmed_at, event_starts_at, day_key)
      VALUES (@id, @profileId, @category, @event, @sport, @market, @legs, @marginInitial, @marginRecheck,
        @marginFinal, @status, @killReason, @resultCents, @createdAt, @verifyDueAt, @verifiedAt, @freshUntil,
        @settledAt, @confirmedAt, @eventStartsAt, @dayKey)`),
    tradeUpdate: db.prepare(`UPDATE trades SET
        profile_id = @profileId, category = @category, event = @event, sport = @sport, legs = @legs,
        margin_initial = @marginInitial, margin_recheck = @marginRecheck, margin_final = @marginFinal,
        status = @status, kill_reason = @killReason, result_cents = @resultCents, created_at = @createdAt,
        verify_due_at = @verifyDueAt, verified_at = @verifiedAt, fresh_until = @freshUntil,
        settled_at = @settledAt, confirmed_at = @confirmedAt, event_starts_at = @eventStartsAt
      WHERE id = @id`), // market + day_key are stamped at insert and immutable
```

6. Add two prepared statements to the `st` map:

```ts
    tradeAnalyticsRows: db.prepare('SELECT * FROM trades WHERE profile_id = ? ORDER BY created_at ASC, id ASC'),
    tradeSettledConfirmedCents: db.prepare(`SELECT COALESCE(SUM(result_cents), 0) AS c FROM trades
      WHERE profile_id = ? AND status = 'SETTLED' AND confirmed_at IS NOT NULL`),
```

7. In `bindTrade`, add `confirmedAt: t.confirmedAt ?? null,` after `settledAt: t.settledAt,`.

8. Add to the `trades` object:

```ts
    /** Every trade of one profile with its insert-stamped day_key/market — the analytics read model's diet. */
    analyticsRows(profileId: number): AnalyticsTradeRow[] {
      return (st.tradeAnalyticsRows.all(profileId) as TradeRow[]).map((r) => ({
        id: r.id, category: r.category, event: r.event, sport: r.sport,
        legs: JSON.parse(r.legs) as Leg[],
        marginInitial: r.margin_initial, marginRecheck: r.margin_recheck, marginFinal: r.margin_final,
        status: r.status, killReason: r.kill_reason, resultCents: r.result_cents,
        createdAt: r.created_at, verifiedAt: r.verified_at, confirmedAt: r.confirmed_at,
        settledAt: r.settled_at, eventStartsAt: r.event_starts_at, dayKey: r.day_key, market: r.market,
      }));
    },
    /** Real money: Σ settled results the user actually confirmed — the snapshot writer's sum. */
    settledConfirmedCents(profileId: number): number {
      return (st.tradeSettledConfirmedCents.get(profileId) as { c: number }).c;
    },
```

(If `KillReason`/`Strategy` end up unused as named imports because `Trade['killReason']`/`Trade['category']` cover them, drop the import additions — `noUnusedLocals` rules.)

In `server/src/pipeline/actions.ts`, replace `confirmTrade` and `unconfirmTrade`:

```ts
/** VERIFIED → CONFIRMED — stamps confirmedAt (Plan 4: the followed-pick timestamp;
 *  a no-op double-tap keeps the first stamp). */
export function confirmTrade(repos: Repos, id: string, now: number): Trade {
  const t = transition(repos, id, 'VERIFIED', 'CONFIRMED', 'confirm');
  if (t.confirmedAt == null) {
    t.confirmedAt = now;
    repos.trades.update(t);
  }
  return t;
}

/** CONFIRMED → VERIFIED — the UI cycle back when a confirm was a mis-tap. Clears the stamp. */
export function unconfirmTrade(repos: Repos, id: string, now: number): Trade {
  void now;
  const t = transition(repos, id, 'CONFIRMED', 'VERIFIED', 'unconfirm');
  if (t.confirmedAt != null) {
    t.confirmedAt = null;
    repos.trades.update(t);
  }
  return t;
}
```

and export the sim outcome math (declaration line only — the body is untouched):

```ts
// OLD
function simOutcome(t: Trade, rng: () => number): { won: boolean; resultCents: number } {
// NEW — Plan 4's ALL chart reuses this exact payout math for read-time shadow outcomes
export function simOutcome(t: Trade, rng: () => number): { won: boolean; resultCents: number } {
```

In `server/src/scheduler/runner.ts`, replace `writeDailySnapshot`:

```ts
  /** One bankroll snapshot per profile per Vancouver day: starting cash + settled
   *  CONFIRMED money (real actions only — Plan 4's ALL chart shadow-settles the rest
   *  at read time and never writes back). */
  function writeDailySnapshot(now: number): void {
    const day = dayKey(now);
    for (const p of deps.repos.profiles.all()) {
      deps.repos.snapshots.writeDaily(p.id, day, p.startingCashCents + deps.repos.trades.settledConfirmedCents(p.id));
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full suite PASS (every pre-existing test still green — `confirmedAt` is optional, so no fixture changes; 5 new tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/shared server/src/db server/src/pipeline server/src/scheduler
git commit -m "feat(server): confirmed_at column, analytics repo queries, per-profile confirmed-only snapshots"
```

---

### Task 2: Series math — day axis, carry-forward, shadow settlement, stats (TDD)

**Files:**
- Create: `server/src/analytics/series.ts`, `server/src/analytics/series.test.ts`

**Interfaces:**
- Consumes: `dayKey`, `simOutcome`, `AnalyticsTradeRow`, `BankrollSnapshot`. Pure — no I/O, no `Date.now`.
- Produces: `RangeKey`, `SeriesPoint`, `ChartStats`, `dayAxis`, `fnv1a32`, `mulberry32`, `shadowResults`, `confirmedSeries`, `allSeries`, `baselineFor`, `allBaseline`, `chartStats` — consumed by Task 4.

- [ ] **Step 1: Write the failing spec** — `server/src/analytics/series.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { AnalyticsTradeRow, BankrollSnapshot } from '../db/repos.js';
import {
  allBaseline, allSeries, baselineFor, chartStats, confirmedSeries, dayAxis,
  fnv1a32, mulberry32, shadowResults,
} from './series.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const HOUR = 3_600_000;

function mkRow(over: Partial<AnalyticsTradeRow>): AnalyticsTradeRow {
  return {
    id: 'x', category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [
      { book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 },
      { book: 'pinnacle', selection: 'away', odds: 2.2, stakeCents: 5_000 },
    ],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02,
    status: 'PENDING', killReason: null, resultCents: null,
    createdAt: NOW, verifiedAt: null, confirmedAt: null, settledAt: null,
    eventStartsAt: NOW, dayKey: '2026-07-14', market: 'moneyline',
    ...over,
  };
}

test('dayAxis: trailing Vancouver windows, clipped to the fund start', () => {
  expect(dayAxis(NOW, '1D', '2026-05-01')).toEqual(['2026-07-14']);
  expect(dayAxis(NOW, '5D', '2026-05-01')).toEqual([
    '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14',
  ]);
  expect(dayAxis(NOW, '5D', '2026-07-13')).toEqual(['2026-07-13', '2026-07-14']); // clipped
  expect(dayAxis(NOW, 'MAX', '2026-07-12')).toEqual(['2026-07-12', '2026-07-13', '2026-07-14']);
  expect(dayAxis(NOW, '30D', '2026-05-01')).toHaveLength(30);
  expect(dayAxis(NOW, 'MAX', '2026-07-14')).toEqual(['2026-07-14']); // created today
  expect(dayAxis(NOW, 'MAX', '2026-08-01')).toEqual(['2026-07-14']); // future-dated profile degrades to today
});

test('fnv1a32/mulberry32: stable, distinct, reproducible', () => {
  expect(fnv1a32('')).toBe(2_166_136_261); // FNV-1a offset basis
  expect(fnv1a32('trade-1')).toBe(fnv1a32('trade-1'));
  expect(fnv1a32('trade-1')).not.toBe(fnv1a32('trade-2'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test('shadowResults: unfollowed sent picks settle in imagination only, deterministically', () => {
  const expiredSent = mkRow({
    id: 'shadow-1', status: 'EXPIRED', verifiedAt: NOW - 10 * HOUR,
    eventStartsAt: NOW - 5 * HOUR, // +3h cutoff passed
  });
  const first = shadowResults([expiredSent], NOW);
  expect(first).toEqual([{ day: '2026-07-14', resultCents: 200 }]); // ARB: round(10000 × 0.02)
  expect(shadowResults([expiredSent], NOW)).toEqual(first); // same forever
  // never-verified EXPIRED (pending swept) and not-yet-finished events produce nothing
  expect(shadowResults([mkRow({ status: 'EXPIRED', verifiedAt: null, eventStartsAt: NOW - 5 * HOUR })], NOW)).toEqual([]);
  expect(shadowResults([mkRow({ status: 'EXPIRED', verifiedAt: NOW, eventStartsAt: NOW - 2 * HOUR })], NOW)).toEqual([]);
  expect(shadowResults([mkRow({ status: 'SETTLED', verifiedAt: NOW, settledAt: NOW, eventStartsAt: NOW - 5 * HOUR })], NOW)).toEqual([]);
});

test('confirmedSeries: carry-forward over gap days; baseline is the value walking in', () => {
  const snaps: BankrollSnapshot[] = [
    { profileId: 1, dayKey: '2026-07-11', bankrollCents: 1_000_500 },
    { profileId: 1, dayKey: '2026-07-13', bankrollCents: 1_004_200 },
  ];
  const axis = ['2026-07-12', '2026-07-13', '2026-07-14'];
  expect(confirmedSeries(snaps, axis, 1_000_000)).toEqual([
    { day: '2026-07-12', profitCents: 500 },   // carried from the 11th
    { day: '2026-07-13', profitCents: 4_200 },
    { day: '2026-07-14', profitCents: 4_200 }, // no snapshot yet today — carry
  ]);
  expect(baselineFor(snaps, axis, 1_000_000)).toBe(500); // the 11th walked in
  expect(baselineFor(snaps, ['2026-07-11'], 1_000_000)).toBe(0); // nothing before the first day
  expect(confirmedSeries([], axis, 1_000_000).map((p) => p.profitCents)).toEqual([0, 0, 0]);
});

test('allSeries: real settled + shadow, cumulative along the axis', () => {
  const rows = [
    mkRow({ id: 'real', status: 'SETTLED', resultCents: 4_200, settledAt: Date.UTC(2026, 6, 13, 19, 0), verifiedAt: 1, confirmedAt: 2 }),
    mkRow({ id: 'shadow-1', status: 'EXPIRED', verifiedAt: 1, eventStartsAt: NOW - 5 * HOUR }), // +200 today
  ];
  const axis = ['2026-07-12', '2026-07-13', '2026-07-14'];
  expect(allSeries(rows, axis, NOW)).toEqual([
    { day: '2026-07-12', profitCents: 0 },
    { day: '2026-07-13', profitCents: 4_200 },
    { day: '2026-07-14', profitCents: 4_400 },
  ]);
  expect(allBaseline(rows, axis, NOW)).toBe(0);
  expect(allBaseline(rows, ['2026-07-14'], NOW)).toBe(4_200); // the 13th's real result walked in
});

test('chartStats: profit vs baseline, return vs the ONE bankroll, annualized ×365/days', () => {
  const points = [
    { day: '2026-07-13', profitCents: 1_000 },
    { day: '2026-07-14', profitCents: 4_000 },
  ];
  const s = chartStats(points, 1_000, 1_000_000);
  expect(s.profitCents).toBe(3_000);
  expect(s.returnPct).toBeCloseTo(0.3, 10);
  expect(s.annualizedPct).toBeCloseTo(0.3 * (365 / 2), 10);
  expect(chartStats([], 0, 1_000_000)).toEqual({ profitCents: 0, returnPct: 0, annualizedPct: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- series`
Expected: FAIL — cannot find module `./series.js`.

- [ ] **Step 3: Implement `server/src/analytics/series.ts`**

```ts
// Analytics series (Plan 4, Design §3–7): pure folds from snapshots/trades to the
// two charts' day series and stats. No I/O, no Date.now, no mutation. The ALL
// chart's shadow outcomes come from a per-trade seeded rng (fnv1a32 → mulberry32)
// reusing simOutcome's exact payout math — identical on every poll, forever, and
// never written to the database ("a shadow position, not a live promise").
import type { AnalyticsTradeRow, BankrollSnapshot } from '../db/repos.js';
import type { Trade } from '../shared/types.js';
import { simOutcome } from '../pipeline/actions.js';
import { dayKey } from '../scheduler/vancouverTime.js';

export type RangeKey = '1D' | '5D' | '30D' | '1Y' | 'MAX';
export interface SeriesPoint { day: string; profitCents: number }
export interface ChartStats { profitCents: number; returnPct: number; annualizedPct: number }

const DAY_MS = 86_400_000;
const SETTLE_CUTOFF_MS = 3 * 3_600_000; // mirrors pipeline/actions.ts — shadows settle at the sim cutoff
const MAX_AXIS_DAYS = 4_000;            // hard stop ≈ 11 years of MAX

export const RANGE_DAYS: Record<RangeKey, number | null> = { '1D': 1, '5D': 5, '30D': 30, '1Y': 365, MAX: null };

/** Trailing Vancouver-day axis ending today, clipped to the profile's creation date.
 *  Epoch −24h steps never skip a Vancouver day (DST days are 23/25h); repeats dedupe. */
export function dayAxis(now: number, range: RangeKey, createdDate: string): string[] {
  const wanted = RANGE_DAYS[range];
  const days: string[] = [];
  for (let i = 0; i < MAX_AXIS_DAYS; i += 1) {
    if (wanted !== null && days.length >= wanted) break;
    const d = dayKey(now - i * DAY_MS);
    if (days[days.length - 1] === d) continue; // 25h fall-back day hit twice
    if (d < createdDate) break;                // clip at the fund start
    days.push(d);
  }
  if (days.length === 0) days.push(dayKey(now)); // created today under clipping, or future-dated
  return days.reverse();
}

/** FNV-1a 32-bit — the stable per-trade shadow seed. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — the suite's deterministic PRNG, reused for shadow outcomes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "If every pick was followed": each SENT pick that expired unconfirmed and whose
 * event is past the settle cutoff gets the outcome sim settlement WOULD have given
 * it, from its own seeded rng. Read-time only — nothing is stored.
 */
export function shadowResults(rows: AnalyticsTradeRow[], now: number): { day: string; resultCents: number }[] {
  const out: { day: string; resultCents: number }[] = [];
  for (const r of rows) {
    if (r.status !== 'EXPIRED' || r.verifiedAt === null) continue;
    const settleAt = r.eventStartsAt + SETTLE_CUTOFF_MS;
    if (settleAt >= now) continue; // event not over — nothing to imagine yet
    const t = { id: r.id, category: r.category, legs: r.legs, marginFinal: r.marginFinal } as Trade;
    const { resultCents } = simOutcome(t, mulberry32(fnv1a32(r.id)));
    out.push({ day: dayKey(settleAt), resultCents });
  }
  return out;
}

/** Chart 1: snapshots carry forward across gap days; profit is relative to the fund start. */
export function confirmedSeries(snapshots: BankrollSnapshot[], axis: string[], startCents: number): SeriesPoint[] {
  let i = 0;
  let carried = startCents;
  const points: SeriesPoint[] = [];
  for (const day of axis) {
    while (i < snapshots.length && snapshots[i]!.dayKey <= day) {
      carried = snapshots[i]!.bankrollCents;
      i += 1;
    }
    points.push({ day, profitCents: carried - startCents });
  }
  return points;
}

/** The confirmed value carried into the day BEFORE the window (fund start when none). */
export function baselineFor(snapshots: BankrollSnapshot[], axis: string[], startCents: number): number {
  const first = axis[0] ?? '';
  let carried = startCents;
  for (const s of snapshots) {
    if (s.dayKey < first) carried = s.bankrollCents;
    else break;
  }
  return carried - startCents;
}

/** Real settled results + shadow results, as (day, cents) events in day order. */
function allEvents(rows: AnalyticsTradeRow[], now: number): { day: string; cents: number }[] {
  const events: { day: string; cents: number }[] = [];
  for (const r of rows) {
    if (r.status === 'SETTLED' && r.settledAt !== null) {
      events.push({ day: dayKey(r.settledAt), cents: r.resultCents ?? 0 });
    }
  }
  for (const s of shadowResults(rows, now)) events.push({ day: s.day, cents: s.resultCents });
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Chart 2: cumulative all-follow profit along the axis (starts at 0 profit before any event). */
export function allSeries(rows: AnalyticsTradeRow[], axis: string[], now: number): SeriesPoint[] {
  const events = allEvents(rows, now);
  let i = 0;
  let cum = 0;
  const points: SeriesPoint[] = [];
  for (const day of axis) {
    while (i < events.length && events[i]!.day <= day) {
      cum += events[i]!.cents;
      i += 1;
    }
    points.push({ day, profitCents: cum });
  }
  return points;
}

/** The all-follow profit carried into the day before the window. */
export function allBaseline(rows: AnalyticsTradeRow[], axis: string[], now: number): number {
  const first = axis[0] ?? '';
  let cum = 0;
  for (const e of allEvents(rows, now)) {
    if (e.day < first) cum += e.cents;
    else break;
  }
  return cum;
}

/** PROFIT vs the baseline; RETURN vs the ONE total bankroll; ANNUALIZED ×365/axis-days. */
export function chartStats(points: SeriesPoint[], baselineCents: number, bankrollCents: number): ChartStats {
  if (points.length === 0) return { profitCents: 0, returnPct: 0, annualizedPct: 0 };
  const last = points[points.length - 1]!.profitCents;
  const profitCents = last - baselineCents;
  const returnPct = bankrollCents > 0 ? (profitCents / bankrollCents) * 100 : 0;
  const annualizedPct = returnPct * (365 / points.length);
  return { profitCents, returnPct, annualizedPct };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- series && npm run typecheck -w server`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/analytics
git commit -m "feat(server): analytics series math (day axis, carry-forward, read-time shadow settlement, stats)"
```

---

### Task 3: Rollups — monthly table, funnel, boards, cost of safety (TDD)

**Files:**
- Create: `server/src/analytics/rollups.ts`, `server/src/analytics/rollups.test.ts`

**Interfaces:**
- Consumes: `AnalyticsTradeRow`, `Settings`, `dayKey`, `arbMargin` (engine). Pure — no I/O.
- Produces: `MonthlyRow`, `FunnelCounts`, `OpenBetView`, `BoardRow`, `GateCostRow`, `OppRow`, `monthlyRows`, `funnelCounts`, `openBets`, `leaderboards`, `roundingCost`, `retention`, `gateCost`, `opportunities` — consumed by Task 4.

- [ ] **Step 1: Write the failing spec** — `server/src/analytics/rollups.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { AnalyticsTradeRow } from '../db/repos.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import {
  funnelCounts, gateCost, leaderboards, monthlyRows, openBets, opportunities,
  retention, roundingCost,
} from './rollups.js';

const NOW = Date.UTC(2026, 6, 14, 19, 0); // 2026-07-14 12:00 PDT
const MIN = 60_000;
const label = (b: string): string => (b === 'bet365' ? 'bet365' : b === 'pinnacle' ? 'Pinnacle' : b);

function mkRow(over: Partial<AnalyticsTradeRow>): AnalyticsTradeRow {
  return {
    id: 'x', category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [
      { book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 },
      { book: 'pinnacle', selection: 'away', odds: 2.2, stakeCents: 5_000 },
    ],
    marginInitial: 0.02, marginRecheck: 0.02, marginFinal: 0.02,
    status: 'PENDING', killReason: null, resultCents: null,
    createdAt: NOW, verifiedAt: null, confirmedAt: null, settledAt: null,
    eventStartsAt: NOW + 3_600_000, dayKey: '2026-07-14', market: 'moneyline',
    ...over,
  };
}

test('monthlyRows: definitions per Design §8, newest month first', () => {
  const rows = [
    mkRow({ id: 'a', dayKey: '2026-06-30' }),                                                        // JUN cand
    mkRow({ id: 'b', dayKey: '2026-07-01', verifiedAt: 1 }),                                          // sent
    mkRow({ id: 'c', dayKey: '2026-07-02', status: 'EXPIRED', marginRecheck: 0.019 }),                // held back (passed, never sent)
    mkRow({ id: 'd', dayKey: '2026-07-03', status: 'KILLED', killReason: 'HEAT_GATE' }),
    mkRow({ id: 'e', dayKey: '2026-07-04', status: 'EXPIRED', verifiedAt: 1 }),                       // sent, died at confirm
    mkRow({
      id: 'f', dayKey: '2026-07-05', verifiedAt: 1, confirmedAt: 2, status: 'SETTLED',
      resultCents: 4_200, settledAt: Date.UTC(2026, 6, 6, 19, 0),
    }),
  ];
  const m = monthlyRows(rows);
  expect(m.map((r) => r.month)).toEqual(['2026-07', '2026-06']);
  expect(m[0]).toEqual({
    month: '2026-07', cand: 5, verif: 4, sent: 3, conf: 1, unconf: 0, exp: 2, killed: 1,
    followThruPct: 33, plCents: 4_200,
  });
  expect(m[1]).toEqual({
    month: '2026-06', cand: 1, verif: 0, sent: 0, conf: 0, unconf: 0, exp: 0, killed: 0,
    followThruPct: null, plCents: 0,
  });
});

test('monthlyRows: P/L lands in the SETTLE month, confirmed money only', () => {
  const rows = [
    mkRow({
      id: 'jun', dayKey: '2026-06-28', verifiedAt: 1, confirmedAt: 2, status: 'SETTLED',
      resultCents: 1_000, settledAt: Date.UTC(2026, 6, 2, 19, 0),                 // settles in July
    }),
    mkRow({
      id: 'shadow', dayKey: '2026-06-28', verifiedAt: 1, status: 'SETTLED',
      resultCents: 9_999, settledAt: Date.UTC(2026, 6, 2, 19, 0), confirmedAt: null, // never followed
    }),
  ];
  const m = monthlyRows(rows);
  expect(m.find((r) => r.month === '2026-07')!.plCents).toBe(1_000);
  expect(m.find((r) => r.month === '2026-06')!.plCents).toBe(0);
});

test('funnelCounts: buckets on confirm latency; dead = sent and gone; live cards excluded', () => {
  const v = NOW;
  const rows = [
    mkRow({ id: 'a', verifiedAt: v, confirmedAt: v + 1 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'b', verifiedAt: v, confirmedAt: v + 3 * MIN, status: 'SETTLED', settledAt: v, resultCents: 1 }),
    mkRow({ id: 'c', verifiedAt: v, confirmedAt: v + 7 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'd', verifiedAt: v, confirmedAt: v + 12 * MIN, status: 'CONFIRMED' }),
    mkRow({ id: 'e', verifiedAt: v, status: 'EXPIRED' }),
    mkRow({ id: 'f', verifiedAt: v, status: 'VERIFIED' }),          // still live — no outcome yet
    mkRow({ id: 'g', status: 'KILLED', killReason: 'QUOTE_STALE' }), // never sent
  ];
  expect(funnelCounts(rows)).toEqual({ under2: 1, from2to5: 1, from5to10: 1, over10: 1, dead: 1, total: 5 });
  expect(funnelCounts([])).toEqual({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
});

test('openBets: confirmed unsettled money, live flag flips at start', () => {
  const rows = [
    mkRow({ id: 'a', status: 'CONFIRMED', confirmedAt: 1, verifiedAt: 1, eventStartsAt: NOW + 3_600_000 }),
    mkRow({ id: 'b', status: 'CONFIRMED', confirmedAt: 1, verifiedAt: 1, eventStartsAt: NOW - 60_000 }),
    mkRow({ id: 'c', status: 'SETTLED', confirmedAt: 1, settledAt: 1, resultCents: 1 }),
    mkRow({ id: 'd', status: 'VERIFIED', verifiedAt: 1 }),
  ];
  const bets = openBets(rows, NOW, label);
  expect(bets).toHaveLength(2);
  expect(bets[0]).toEqual({
    category: 'ARB', event: 'A vs B',
    legsText: 'bet365 home @ 2.10 / Pinnacle away @ 2.20',
    stakeCents: 10_000, startsAt: NOW + 3_600_000, live: false,
  });
  expect(bets[1]!.live).toBe(true);
});

test('leaderboards: confirmed legs credit their books; four boards, top 3, share of category', () => {
  const rows = [
    mkRow({ id: 'a', confirmedAt: 1, status: 'CONFIRMED' }),
    mkRow({ id: 'b', confirmedAt: 1, status: 'CONFIRMED' }),
    mkRow({
      id: 'c', category: 'EV', confirmedAt: 1, status: 'CONFIRMED',
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: 2_000 }],
    }),
    mkRow({ id: 'd', category: 'EV' }), // not confirmed — invisible here
  ];
  const boards = leaderboards(rows, label);
  expect(boards.map((b) => b.title)).toEqual(['ARB', 'EV', 'MIDDLES', 'ALL CATEGORIES']);
  expect(boards[0]!.rows).toEqual([
    { book: 'bet365', count: 2, pct: 100 },   // 2 legs over 2 confirmed ARB trades
    { book: 'Pinnacle', count: 2, pct: 100 },
  ]);
  expect(boards[1]!.rows).toEqual([{ book: 'fanduel', count: 1, pct: 100 }]);
  expect(boards[2]!.rows).toEqual([]);
  expect(boards[3]!.rows[0]!.count).toBe(2);
});

test('roundingCost: ideal equal-payout profit minus the rounded worst case, confirmed ARB pairs only', () => {
  const rows = [
    mkRow({ id: 'a', status: 'SETTLED', confirmedAt: 1, settledAt: 1, resultCents: 500 }),
    mkRow({ id: 'b' }), // not confirmed — excluded
  ];
  // margin(2.1, 2.2) = 1 − (1/2.1 + 1/2.2) = 0.0692641…; ideal = round(10000 × m) = 693
  // payouts 10500 / 11000 → worst-case profit 500; cost = 693 − 500 = 193
  expect(roundingCost(rows)).toEqual({ costCents: 193, pairs: 1 });
  expect(roundingCost([mkRow({ id: 'b' })])).toBeNull();
});

test('retention: median recheck/initial and the recheck death rate', () => {
  const rows = [
    mkRow({ id: 'a', marginRecheck: 0.018, status: 'VERIFIED', verifiedAt: 1 }),
    mkRow({ id: 'b', marginRecheck: 0.001, status: 'KILLED', killReason: 'FAILED_VERIFICATION' }),
    mkRow({ id: 'c', marginRecheck: 0.02, status: 'CONFIRMED', verifiedAt: 1, confirmedAt: 2 }),
    mkRow({ id: 'd', marginRecheck: null }), // never rechecked — excluded
  ];
  expect(retention(rows)).toEqual({ medianPct: 90, dieAtRecheckPct: 33 });
  expect(retention([mkRow({ marginRecheck: null })])).toBeNull();
});

test('gateCost: flat-pair EV proxy per battery reason, cap notes verbatim, top-book note elsewhere', () => {
  const rows = [
    mkRow({ id: 'a', status: 'KILLED', killReason: 'ONE_SPORT_RULE', marginInitial: 0.03 }),
    mkRow({
      id: 'b', status: 'KILLED', killReason: 'ONE_SPORT_RULE', marginInitial: 0.01,
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: null }],
    }),
    mkRow({ id: 'c', status: 'KILLED', killReason: 'SHARP_VELOCITY_CAP', marginInitial: 0.02 }),
    mkRow({ id: 'd', status: 'KILLED', killReason: 'FAILED_VERIFICATION' }), // recheck death — not a battery rule
  ];
  const g = gateCost(rows, DEFAULT_SETTINGS, label);
  expect(g).toEqual([
    { reason: 'ONE_SPORT_RULE', costCents: 400, note: '75% OF LINE ITEM IS BET365' },  // 300 + 100; top book bet365
    { reason: 'SHARP_VELOCITY_CAP', costCents: 200, note: '3/DAY PER BOOK' },
  ]);
  expect(gateCost([], DEFAULT_SETTINGS, label)).toEqual([]);
});

test('opportunities: every candidate counts, legs credit books, since = first trade day', () => {
  const rows = [
    mkRow({ id: 'a', dayKey: '2026-07-11' }),
    mkRow({ id: 'b', dayKey: '2026-07-12', status: 'KILLED', killReason: 'HEAT_GATE', marginInitial: 0.04 }),
    mkRow({
      id: 'c', category: 'EV', dayKey: '2026-07-13', marginInitial: 0.03,
      legs: [{ book: 'fanduel', selection: 'home', odds: 2.0, stakeCents: null }],
    }),
  ];
  const o = opportunities(rows, label);
  expect(o.since).toBe('2026-07-11');
  expect(o.arb).toEqual([
    { book: 'bet365', count: 2, avgPct: 3 },   // (2% + 4%) / 2
    { book: 'Pinnacle', count: 2, avgPct: 3 },
  ]);
  expect(o.ev).toEqual([{ book: 'fanduel', count: 1, avgPct: 3 }]);
  expect(o.middles).toEqual([]);
  expect(opportunities([], label).since).toBe('');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- rollups`
Expected: FAIL — cannot find module `./rollups.js`.

- [ ] **Step 3: Implement `server/src/analytics/rollups.ts`**

```ts
// Analytics rollups (Plan 4, Design §8–11): monthly table, TIME TO ACT funnel and
// every ADVANCED ANALYTICS aggregation. Pure folds over AnalyticsTradeRow — no I/O.
// Every derived number names its source columns; demo mockup values are filler,
// never expectations.
import type { AnalyticsTradeRow } from '../db/repos.js';
import type { KillReason, Strategy } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import { arbMargin } from '../engine/odds.js';
import { dayKey } from '../scheduler/vancouverTime.js';

const MIN_MS = 60_000;

export interface MonthlyRow {
  month: string; cand: number; verif: number; sent: number; conf: number;
  unconf: number; exp: number; killed: number; followThruPct: number | null; plCents: number;
}

const sent = (r: AnalyticsTradeRow): boolean => r.verifiedAt !== null;
/** Passed the recheck but never promoted (daily cap / zero stake) — Plan 3's held-back signature. */
const heldBack = (r: AnalyticsTradeRow): boolean =>
  r.status === 'EXPIRED' && r.verifiedAt === null && r.marginRecheck !== null;
const confirmedMoney = (r: AnalyticsTradeRow): boolean =>
  r.status === 'SETTLED' && r.confirmedAt !== null && r.settledAt !== null;

/** Newest month first; a month exists if any trade was created OR settled in it. */
export function monthlyRows(rows: AnalyticsTradeRow[]): MonthlyRow[] {
  const months = new Set<string>();
  for (const r of rows) {
    months.add(r.dayKey.slice(0, 7));
    if (confirmedMoney(r)) months.add(dayKey(r.settledAt!).slice(0, 7));
  }
  return [...months].sort().reverse().map((month) => {
    const inMonth = rows.filter((r) => r.dayKey.slice(0, 7) === month);
    const sentN = inMonth.filter(sent).length;
    const confN = inMonth.filter((r) => r.confirmedAt !== null).length;
    const plCents = rows
      .filter((r) => confirmedMoney(r) && dayKey(r.settledAt!).slice(0, 7) === month)
      .reduce((sum, r) => sum + (r.resultCents ?? 0), 0);
    return {
      month,
      cand: inMonth.length,
      verif: sentN + inMonth.filter(heldBack).length,
      sent: sentN,
      conf: confN,
      unconf: inMonth.filter((r) => r.status === 'UNCONFIRMED').length, // honest zero until Plan 6
      exp: inMonth.filter((r) => r.status === 'EXPIRED').length,
      killed: inMonth.filter((r) => r.status === 'KILLED').length,
      followThruPct: sentN > 0 ? Math.round((100 * confN) / sentN) : null,
      plCents,
    };
  });
}

export interface FunnelCounts {
  under2: number; from2to5: number; from5to10: number; over10: number; dead: number; total: number;
}

/** Population = sent picks with a KNOWN confirmation outcome; live VERIFIED cards wait. */
export function funnelCounts(rows: AnalyticsTradeRow[]): FunnelCounts {
  const f = { under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 };
  for (const r of rows) {
    if (!sent(r)) continue;
    if (r.confirmedAt !== null) {
      const dt = r.confirmedAt - r.verifiedAt!;
      if (dt < 2 * MIN_MS) f.under2 += 1;
      else if (dt < 5 * MIN_MS) f.from2to5 += 1;
      else if (dt < 10 * MIN_MS) f.from5to10 += 1;
      else f.over10 += 1;
      f.total += 1;
    } else if (r.status === 'EXPIRED' || r.status === 'UNCONFIRMED') {
      f.dead += 1;
      f.total += 1;
    }
  }
  return f;
}

export interface OpenBetView {
  category: Strategy; event: string; legsText: string; stakeCents: number; startsAt: number; live: boolean;
}

/** Money actually at stake: CONFIRMED, not yet settled. */
export function openBets(rows: AnalyticsTradeRow[], now: number, label: (book: string) => string): OpenBetView[] {
  return rows
    .filter((r) => r.status === 'CONFIRMED')
    .map((r) => ({
      category: r.category,
      event: r.event,
      legsText: r.legs.map((l) => `${label(l.book)} ${l.selection} @ ${l.odds.toFixed(2)}`).join(' / '),
      stakeCents: r.legs.reduce((sum, l) => sum + (l.stakeCents ?? 0), 0),
      startsAt: r.eventStartsAt,
      live: r.eventStartsAt <= now,
    }));
}

export interface BoardRow { book: string; count: number; pct: number }
type BoardTitle = 'ARB' | 'EV' | 'MIDDLES' | 'ALL CATEGORIES';

/** Confirmed legs credit their books; pct = share of the category's confirmed trades. */
export function leaderboards(
  rows: AnalyticsTradeRow[], label: (book: string) => string,
): { title: BoardTitle; rows: BoardRow[] }[] {
  const confirmed = rows.filter((r) => r.confirmedAt !== null);
  const board = (subset: AnalyticsTradeRow[]): BoardRow[] => {
    const counts = new Map<string, number>();
    for (const r of subset) for (const l of r.legs) counts.set(l.book, (counts.get(l.book) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([book, count]) => ({
        book: label(book), count, pct: Math.round((100 * count) / subset.length),
      }));
  };
  const byCat = (c: Strategy): AnalyticsTradeRow[] => confirmed.filter((r) => r.category === c);
  return [
    { title: 'ARB', rows: board(byCat('ARB')) },
    { title: 'EV', rows: board(byCat('EV')) },
    { title: 'MIDDLES', rows: board(byCat('MIDDLE')) },
    { title: 'ALL CATEGORIES', rows: board(confirmed) },
  ];
}

/** Σ (ideal equal-payout profit − rounded worst-case profit) over confirmed ARB pairs,
 *  recomputed from each trade's own stored legs — nothing extra is persisted. */
export function roundingCost(rows: AnalyticsTradeRow[]): { costCents: number; pairs: number } | null {
  const pairs = rows.filter(
    (r) => r.category === 'ARB' && r.confirmedAt !== null && r.legs.every((l) => typeof l.stakeCents === 'number'),
  );
  if (pairs.length === 0) return null;
  let costCents = 0;
  for (const r of pairs) {
    const stakes = r.legs.map((l) => l.stakeCents!);
    const total = stakes.reduce((a, b) => a + b, 0);
    const ideal = Math.round(total * arbMargin(r.legs.map((l) => l.odds)));
    const worst = Math.min(...r.legs.map((l, i) => Math.round(l.odds * stakes[i]!))) - total;
    costCents += Math.max(0, ideal - worst);
  }
  return { costCents, pairs: pairs.length };
}

/** Median recheck/initial retention and the share of rechecked candidates the gate killed. */
export function retention(rows: AnalyticsTradeRow[]): { medianPct: number; dieAtRecheckPct: number } | null {
  const rechecked = rows.filter((r) => r.marginRecheck !== null && r.marginInitial > 0);
  if (rechecked.length === 0) return null;
  const ratios = rechecked.map((r) => r.marginRecheck! / r.marginInitial).sort((a, b) => a - b);
  const mid = ratios.length % 2 === 1
    ? ratios[(ratios.length - 1) / 2]!
    : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2;
  const died = rechecked.filter((r) => r.status === 'KILLED' && r.killReason === 'FAILED_VERIFICATION').length;
  return {
    medianPct: Math.round(mid * 100),
    dieAtRecheckPct: Math.round((100 * died) / rechecked.length),
  };
}

export interface GateCostRow { reason: KillReason; costCents: number; note: string }

/** Battery order (engine/gates.ts); FAILED_VERIFICATION is the recheck's, not the battery's. */
const BATTERY_ORDER: KillReason[] = [
  'ONE_SPORT_RULE', 'HEAT_GATE', 'SHARP_VELOCITY_CAP', 'MARKET_BREADTH_CAP',
  'ROUNDING_DESTROYS_MARGIN', 'QUOTE_STALE',
];

/** Estimated EV of killed candidates: round(max(0, marginInitial) × flatPairCents) —
 *  the flat pair is the deterministic stake proxy for candidates that never got stakes.
 *  Each kill's cost attributes to its FIRST leg's book for the top-book note. */
export function gateCost(
  rows: AnalyticsTradeRow[], s: Settings, label: (book: string) => string,
): GateCostRow[] {
  const est = (r: AnalyticsTradeRow): number => Math.round(Math.max(0, r.marginInitial) * s.flatPairCents);
  const out: GateCostRow[] = [];
  for (const reason of BATTERY_ORDER) {
    const kills = rows.filter((r) => r.status === 'KILLED' && r.killReason === reason);
    if (kills.length === 0) continue;
    const costCents = kills.reduce((sum, r) => sum + est(r), 0);
    let note: string;
    if (reason === 'SHARP_VELOCITY_CAP') note = `${s.sharpVelocityPerDayPerBook}/DAY PER BOOK`;
    else if (reason === 'MARKET_BREADTH_CAP') note = `${s.marketBreadthPerWeekPerBook} / MARKET / BOOK / WEEK`;
    else {
      const byBook = new Map<string, number>();
      for (const r of kills) {
        const book = r.legs[0]?.book ?? '';
        byBook.set(book, (byBook.get(book) ?? 0) + est(r));
      }
      const top = [...byBook.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      note = top && costCents > 0
        ? `${Math.round((100 * top[1]) / costCents)}% OF LINE ITEM IS ${label(top[0]).toUpperCase()}`
        : '—';
    }
    out.push({ reason, costCents, note });
  }
  return out;
}

export interface OppRow { book: string; count: number; avgPct: number }

/** Every candidate the scanner FOUND (kills included); legs credit books; avg = mean
 *  initial margin/edge %. Unsorted, uncapped — the client owns sort + reveal. */
export function opportunities(
  rows: AnalyticsTradeRow[], label: (book: string) => string,
): { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] } {
  const byCat = (c: Strategy): OppRow[] => {
    const agg = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      if (r.category !== c) continue;
      for (const l of r.legs) {
        const cur = agg.get(l.book) ?? { count: 0, sum: 0 };
        cur.count += 1;
        cur.sum += r.marginInitial * 100;
        agg.set(l.book, cur);
      }
    }
    return [...agg.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)) // stable name order; the client re-sorts
      .map(([book, a]) => ({ book: label(book), count: a.count, avgPct: a.sum / a.count }));
  };
  return {
    since: rows[0]?.dayKey ?? '',
    arb: byCat('ARB'),
    ev: byCat('EV'),
    middles: byCat('MIDDLE'),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- rollups && npm run typecheck -w server`
Expected: PASS (9 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/analytics
git commit -m "feat(server): analytics rollups (monthly table, funnel, boards, cost of safety, opportunities)"
```

---

### Task 4: Analytics read model + API routes

**Files:**
- Create: `server/src/analytics/report.ts`
- Modify: `server/src/api/routes.ts`, `server/src/api/api.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, Plan 3's `displayName` (`brain/pass.js`) and `closingEdge` (`brain/closes.js`).
- Produces: `buildAnalyticsView(deps, profile, range, now)`, `profileView`, `RANGE_KEYS`, and the three routes — the client's entire diet.

- [ ] **Step 1: Write the failing spec** — append to `server/src/api/api.test.ts` (reuse the file's existing `makeApp`/`promoteSome` harness and `NOW` constant; the assertions are the spec):

```ts
test('GET /api/profiles lists the seeded profile; POST validates, creates, 409s duplicates', async () => {
  const h = makeApp();
  const list = await request(h.app).get('/api/profiles');
  expect(list.status).toBe(200);
  expect(list.body.profiles[0]).toMatchObject({ id: 1, name: 'RYAN', startingCashCents: 1_000_000 });

  const bad = await request(h.app).post('/api/profiles').send({ name: '', startingCashCents: 500_000 });
  expect(bad.status).toBe(400);
  const badCash = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 0 });
  expect(badCash.status).toBe(400);

  const ok = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 500_000 });
  expect(ok.status).toBe(200);
  expect(ok.body.profile).toMatchObject({ id: 2, name: 'LEA', startingCashCents: 500_000, createdDate: '2026-07-13' });

  const dup = await request(h.app).post('/api/profiles').send({ name: 'LEA', startingCashCents: 100 });
  expect(dup.status).toBe(409);
});

test('GET /api/analytics: defaults, structure, honest empty charts', async () => {
  const h = makeApp();
  const res = await request(h.app).get('/api/analytics');
  expect(res.status).toBe(200);
  const v = res.body;
  expect(v.simulated).toBe(true);
  expect(v.range).toBe('30D');
  expect(v.today).toBe('2026-07-13');
  expect(v.profile.name).toBe('RYAN');
  expect(v.bankrollCents).toBe(1_000_000);
  expect(v.confirmed.points.length).toBeGreaterThan(0);
  expect(v.confirmed.points.every((p: { profitCents: number }) => p.profitCents === 0)).toBe(true);
  expect(v.confirmed.stats).toEqual({ profitCents: 0, returnPct: 0, annualizedPct: 0 });
  expect(v.all.points[v.all.points.length - 1]).toMatchObject({ day: '2026-07-13' });
  expect(v.funnel).toEqual({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
  expect(v.advanced.openBets).toEqual([]);
  expect(v.advanced.costOfSafety.rounding).toBeNull();
  expect(v.advanced.costOfSafety.closingEdge).toBeNull();

  const badRange = await request(h.app).get('/api/analytics?range=7D');
  expect(badRange.status).toBe(400);
  const badProfile = await request(h.app).get('/api/analytics?profileId=99');
  expect(badProfile.status).toBe(404);
});

test('analytics reflects the driven pipeline: confirm → monthly/funnel/leaderboards move', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  expect(verified.length).toBeGreaterThan(0);
  await request(h.app).post(`/api/trades/${verified[0]!.id}/confirm`).expect(200);

  const v = (await request(h.app).get('/api/analytics?range=MAX')).body;
  const jul = v.monthly.find((m: { month: string }) => m.month === '2026-07');
  expect(jul.cand).toBeGreaterThan(0);
  expect(jul.sent).toBeGreaterThanOrEqual(1);
  expect(jul.conf).toBe(1);
  expect(jul.followThruPct).toBe(Math.round((100 * jul.conf) / jul.sent));
  expect(v.funnel.under2).toBe(1); // confirmed 76s after promotion? — no: confirm at +76s of verify; still < 2 min
  expect(v.funnel.total).toBe(1);
  expect(v.advanced.openBets.length).toBe(1);
  expect(v.advanced.openBets[0].stakeCents).toBeGreaterThan(0);
  const all = v.advanced.leaderboards.boards.find((b: { title: string }) => b.title === 'ALL CATEGORIES');
  expect(all.rows.length).toBeGreaterThan(0);
  expect(v.advanced.costOfSafety.retention.thresholdPct).toBe(95); // 100 − default tolerance 5
});

test('a limited report surfaces in the analytics limits log with display names', async () => {
  const h = makeApp();
  const verified = await promoteSome(h);
  const target = verified
    .flatMap((t: { id: string; legs: { book: string }[] }) => t.legs.map((l) => ({ id: t.id, book: l.book })))
    .find((x: { book: string }) => x.book !== 'pinnacle')!;
  await request(h.app).post(`/api/trades/${target.id}/limited`)
    .send({ book: target.book, maxAllowedCents: 2_500 }).expect(200);
  const v = (await request(h.app).get('/api/analytics')).body;
  expect(v.advanced.limits).toHaveLength(1);
  expect(v.advanced.limits[0]).toMatchObject({ maxCents: 2_500 });
  expect(v.advanced.limits[0].event).not.toBe(''); // joined through the trade
  expect(v.advanced.limits[0].when).toBe(NOW + 76_000);
});

test('the analytics payload is deterministic between polls and forbidden-word-free', async () => {
  const h = makeApp();
  await promoteSome(h);
  const a = (await request(h.app).get('/api/analytics')).body;
  const b = (await request(h.app).get('/api/analytics')).body;
  expect(b).toEqual(a); // shadow settlement never drifts between reads
  expect(/append-only|ghost|picker|grader|gatekeeper|CLV/i.test(JSON.stringify(a))).toBe(false);
});
```

Note on the funnel assertion: `promoteSome` verifies at `NOW + 76 s` and the confirm lands immediately after — the latency is well under 2 minutes, so `under2` is exact. The limits assertion checks the display-name mapping loosely because the promoted book varies with the seeded rng; the exact-name mapping is pinned by Plan 3's tests.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- api`
Expected: FAIL — 404 on `/api/profiles` and `/api/analytics`.

- [ ] **Step 3: Implement `server/src/analytics/report.ts`**

```ts
// Analytics read model (Plan 4): ONE deterministic serialization of everything the
// ANALYTICS screen renders. Read-only — building the view never mutates state; the
// shadow chart recomputes identically on every poll. Client mirror:
// client/src/lib/analytics.ts. Every number names its source table.
import type { PipeDeps } from '../pipeline/scan.js';
import type { Profile } from '../db/db.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName } from '../brain/pass.js';
import { closingEdge } from '../brain/closes.js';
import {
  allBaseline, allSeries, baselineFor, chartStats, confirmedSeries, dayAxis,
  type ChartStats, type RangeKey, type SeriesPoint,
} from './series.js';
import {
  funnelCounts, gateCost, leaderboards, monthlyRows, openBets, opportunities,
  retention, roundingCost,
  type BoardRow, type FunnelCounts, type GateCostRow, type MonthlyRow, type OpenBetView, type OppRow,
} from './rollups.js';

export const RANGE_KEYS: readonly RangeKey[] = ['1D', '5D', '30D', '1Y', 'MAX'];

export interface ProfileView { id: number; name: string; startingCashCents: number; createdDate: string }
export interface ChartView { points: SeriesPoint[]; stats: ChartStats }

export interface AnalyticsView {
  simulated: boolean;
  today: string;
  profile: ProfileView;
  range: RangeKey;
  bankrollCents: number;
  confirmed: ChartView;
  all: ChartView;
  monthly: MonthlyRow[];
  funnel: FunnelCounts;
  advanced: {
    openBets: OpenBetView[];
    leaderboards: { since: string; boards: { title: string; rows: BoardRow[] }[] };
    costOfSafety: {
      rounding: { costCents: number; pairs: number } | null;
      retention: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null;
      gateCost: GateCostRow[];
      closingEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
    };
    limits: { when: number; book: string; sport: string; event: string; maxCents: number }[];
    opportunities: { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] };
  };
}

export function profileView(p: Profile): ProfileView {
  return { id: p.id, name: p.name, startingCashCents: p.startingCashCents, createdDate: p.createdDate };
}

export function buildAnalyticsView(deps: PipeDeps, profile: Profile, range: RangeKey, now: number): AnalyticsView {
  const { repos } = deps;
  const s = deps.s();
  const rows = repos.trades.analyticsRows(profile.id);
  const snaps = repos.snapshots.byProfile(profile.id);
  const axis = dayAxis(now, range, profile.createdDate);

  const confirmedPts = confirmedSeries(snaps, axis, profile.startingCashCents);
  const allPts = allSeries(rows, axis, now);

  const ret = retention(rows);
  const limits = repos.limitsReports.all().map((l) => {
    const t = repos.trades.byId(l.tradeId);
    return {
      when: l.sentAt,
      book: displayName(l.book),
      sport: t?.sport ?? '',
      event: t?.event ?? '',
      maxCents: l.maxAllowedCents,
    };
  }).reverse(); // newest first — TRADE LIMITED? reports prepend live (inventory §2.2)

  return {
    simulated: true, // Plan 6 flips this with live mode
    today: dayKey(now),
    profile: profileView(profile),
    range,
    bankrollCents: s.bankrollCents,
    confirmed: {
      points: confirmedPts,
      stats: chartStats(confirmedPts, baselineFor(snaps, axis, profile.startingCashCents), s.bankrollCents),
    },
    all: {
      points: allPts,
      stats: chartStats(allPts, allBaseline(rows, axis, now), s.bankrollCents),
    },
    monthly: monthlyRows(rows),
    funnel: funnelCounts(rows),
    advanced: {
      openBets: openBets(rows, now, displayName),
      leaderboards: { since: profile.createdDate, boards: leaderboards(rows, displayName) },
      costOfSafety: {
        rounding: roundingCost(rows),
        retention: ret === null ? null : { ...ret, thresholdPct: Math.round(100 - s.tolerancePct) },
        gateCost: gateCost(rows, s, displayName),
        closingEdge: closingEdge(repos, now),
      },
      limits,
      opportunities: opportunities(rows, displayName),
    },
  };
}
```

In `server/src/api/routes.ts`:

1. Add the imports (and make sure `dayKey` is in the `vancouverTime.js` import list — it already is if `/api/state` uses it; otherwise add it):

```ts
import { RANGE_KEYS, buildAnalyticsView, profileView } from '../analytics/report.js';
import type { RangeKey } from '../analytics/series.js';
```

2. Register the three routes directly after the brain routes (before the 404 catch-all):

```ts
  app.get('/api/profiles', (_req, res) => {
    res.json({ profiles: repos.profiles.all().map(profileView) });
  });

  app.post('/api/profiles', (req, res) => {
    const { name, startingCashCents } = (req.body ?? {}) as { name?: unknown; startingCashCents?: unknown };
    if (typeof name !== 'string' || name.trim() === '') {
      return fail(res, 400, 'bad_request', 'name must be a non-empty string');
    }
    if (typeof startingCashCents !== 'number' || !Number.isInteger(startingCashCents) || startingCashCents <= 0) {
      return fail(res, 400, 'bad_request', 'startingCashCents must be a positive integer');
    }
    try {
      // STARTS THE DAY YOU CREATE IT — the created date is the Vancouver day of the click.
      const p = repos.profiles.create(name.trim(), startingCashCents, dayKey(clock()));
      res.json({ profile: profileView(p) });
    } catch {
      return fail(res, 409, 'conflict', 'a profile with that name already exists'); // profiles.name UNIQUE
    }
  });

  app.get('/api/analytics', (req, res) => {
    const rangeRaw = typeof req.query.range === 'string' ? req.query.range : '30D';
    if (!(RANGE_KEYS as readonly string[]).includes(rangeRaw)) {
      return fail(res, 400, 'bad_request', 'range must be one of 1D, 5D, 30D, 1Y, MAX');
    }
    const profiles = repos.profiles.all();
    const wanted = typeof req.query.profileId === 'string' ? Number(req.query.profileId) : profiles[0]?.id;
    const profile = profiles.find((p) => p.id === wanted);
    if (!profile) return fail(res, 404, 'not_found', 'no such profile');
    res.json(buildAnalyticsView(deps, profile, rangeRaw as RangeKey, clock()));
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server && npm run typecheck -w server`
Expected: full server suite PASS (5 new API tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/analytics server/src/api
git commit -m "feat(server): analytics API (profiles list/create, one-poll analytics read model)"
```

---

### Task 5: Client contract mirror + pure display helpers (TDD)

**Files:**
- Create: `client/src/lib/analytics.ts`, `client/src/lib/analytics.test.ts`, `client/src/hooks/useAnalytics.ts`
- Modify: `client/src/lib/api.ts` (append the three analytics fetch helpers)

**Interfaces:**
- Consumes: `format.ts` (`formatCents`, `formatSignedCents`, `parseDollarsToCents`), Plan 3's `formatTimeShort` (`lib/brain.ts`), type-only `Strategy`/`KillReason` from `api.ts`.
- Produces (consumed by Tasks 6–9): the `AnalyticsView` mirror types and the pure helpers in the contracts block; fetchers `fetchProfiles`, `createProfile`, `fetchAnalytics`; hook `useAnalytics`.

- [ ] **Step 1: Write the failing spec** — `client/src/lib/analytics.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  bankrollFootnote, chartDate, chartGeometry, closingEdgeTile, createEnabled,
  formatDateCaps, formatSignedDollars, formatAnnualized, formatReturn, fundStartText,
  funnelRows, gateBar, limitRow, monthLabel, monthlyCells, openBetStatus, openBetText,
  oppToggle, profileItems, retentionTile, roundingTile, sortOpp, startsNote, statsTexts,
} from './analytics';

test('date words: caps date, unpadded chart date, month label', () => {
  expect(formatDateCaps('2026-05-01')).toBe('MAY 01 2026');
  expect(formatDateCaps('2026-07-14')).toBe('JUL 14 2026');
  expect(chartDate('2026-07-05')).toBe('JUL 5');
  expect(chartDate('2026-06-13')).toBe('JUN 13');
  expect(monthLabel('2026-07')).toBe('JUL');
});

test('money words: signed whole dollars, returns 2dp, annualized 1dp — U+2212 minus', () => {
  expect(formatSignedDollars(43_812)).toBe('+$438');
  expect(formatSignedDollars(-2_000_000)).toBe('−$20,000');
  expect(formatSignedDollars(0)).toBe('+$0');
  expect(formatReturn(2.7412)).toBe('+2.74%');
  expect(formatReturn(-0.5)).toBe('−0.50%');
  expect(formatAnnualized(38.91)).toBe('+38.9%');
  expect(formatAnnualized(-12.34)).toBe('−12.3%');
});

test('top row: fund box, dropdown items, create gating, starts note', () => {
  const p = { id: 1, name: 'Ryan', startingCashCents: 1_000_000, createdDate: '2026-05-01' };
  expect(fundStartText(p)).toEqual({ amount: '$10,000', date: 'MAY 01 2026' });
  expect(profileItems([p, { ...p, id: 2, name: 'lea' }], 1)).toEqual([
    { id: 1, label: '● RYAN', current: true },
    { id: 2, label: 'LEA', current: false },
  ]);
  expect(createEnabled('', '$5,000')).toBe(false);
  expect(createEnabled('  ', '$5,000')).toBe(false);
  expect(createEnabled('LEA', '')).toBe(false);
  expect(createEnabled('LEA', '$0')).toBe(false);
  expect(createEnabled('LEA', '$5,000')).toBe(true);
  expect(startsNote('2026-07-14')).toBe('STARTS THE DAY YOU CREATE IT — JUL 14 2026');
});

test('chartGeometry: the mockup scale reproduces at $0–$600', () => {
  const points = [
    { day: '2026-07-13', profitCents: 0 },
    { day: '2026-07-14', profitCents: 60_000 },
  ];
  const g = chartGeometry(points)!;
  expect(g.yLabels.map((l) => l.text)).toEqual(['$0', '$100', '$200', '$300', '$400', '$500', '$600']);
  expect(g.yLabels.map((l) => l.y)).toEqual([205, 175, 145, 115, 85, 55, 25]);
  expect(g.xMajors).toEqual([207, 354, 500, 647, 794]);
  expect(g.xMinors).toEqual([133, 280, 427, 574, 720, 867]);
  expect(g.line).toBe('60,205 940,25');
  expect(g.bullets).toEqual([{ x: 60, y: 205 }, { x: 940, y: 25 }]);
  expect(g.last).toEqual({ x: 940, y: 25 });
  expect(g.dates).toEqual(['JUL 13', 'JUL 14']);
});

test('chartGeometry: losses extend the scale below zero', () => {
  const g = chartGeometry([
    { day: '2026-07-13', profitCents: -25_000 },
    { day: '2026-07-14', profitCents: 50_000 },
  ])!;
  expect(g.yLabels.map((l) => l.text)).toEqual(['−$400', '−$200', '$0', '$200', '$400', '$600']);
  expect(g.line).toBe('60,178 940,43');
});

test('chartGeometry: degenerate cases stay honest', () => {
  expect(chartGeometry([])).toBeNull();
  const single = chartGeometry([{ day: '2026-07-14', profitCents: 0 }])!;
  expect(single.line).toBeNull();
  expect(single.last).toEqual({ x: 940, y: 205 });
  expect(single.dates).toEqual(['JUL 14']);
  const flat = chartGeometry([
    { day: '2026-07-13', profitCents: 0 },
    { day: '2026-07-14', profitCents: 0 },
  ])!;
  expect(flat.yLabels.map((l) => l.text)).toEqual(['$0', '$1']); // widened by one smallest step
});

test('chartGeometry: long ranges drop per-point bullets and sample 6 dates', () => {
  const points = Array.from({ length: 90 }, (_, i) => ({
    day: `2026-04-${String((i % 30) + 1).padStart(2, '0')}`, profitCents: i * 100,
  }));
  const g = chartGeometry(points)!;
  expect(g.bullets).toEqual([]); // >60 points — line + last ring only
  expect(g.dates).toHaveLength(6);
  expect(g.line!.split(' ')).toHaveLength(90);
});

test('stats row + bankroll footnote', () => {
  expect(statsTexts({ profitCents: 43_812, returnPct: 2.7412, annualizedPct: 38.91 }))
    .toEqual({ ret: '+2.74%', ann: '+38.9%', profit: '+$438', retTone: 'pos' });
  expect(statsTexts({ profitCents: -100, returnPct: -0.01, annualizedPct: -0.1 }).retTone).toBe('neg');
  expect(bankrollFootnote(1_000_000))
    .toBe('RETURNS MEASURED AGAINST TOTAL BANKROLL ($10,000). ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.');
});

test('monthly cells render the 10 columns in table order', () => {
  expect(monthlyCells({
    month: '2026-07', cand: 214, verif: 96, sent: 88, conf: 61, unconf: 6, exp: 7,
    killed: 118, followThruPct: 69, plCents: 18_800,
  })).toEqual(['JUL', '214', '96', '88', '61', '6', '7', '118', '69%', '+$188']);
  expect(monthlyCells({
    month: '2026-06', cand: 1, verif: 0, sent: 0, conf: 0, unconf: 0, exp: 0,
    killed: 0, followThruPct: null, plCents: 0,
  })[8]).toBe('—');
});

test('funnel rows: verbatim labels, >10 min appears only when non-zero, honest empty', () => {
  const rows = funnelRows({ under2: 31, from2to5: 46, from5to10: 14, over10: 0, dead: 9, total: 100 });
  expect(rows.map((r) => r.label)).toEqual([
    'CONFIRMED < 2 MIN', 'CONFIRMED 2–5 MIN', 'CONFIRMED 5–10 MIN', 'EXPIRED / DEAD AT CONFIRM',
  ]);
  expect(rows.map((r) => r.value)).toEqual(['31%', '46%', '14%', '9%']);
  expect(rows[3]!.dead).toBe(true);
  const withSlow = funnelRows({ under2: 1, from2to5: 0, from5to10: 0, over10: 1, dead: 0, total: 2 });
  expect(withSlow.map((r) => r.label)).toContain('CONFIRMED > 10 MIN');
  const empty = funnelRows({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
  expect(empty.every((r) => r.value === '—' && r.pct === null)).toBe(true);
});

test('open bets: composed row + status flip', () => {
  const bet = {
    category: 'ARB' as const, event: 'Blue Jays @ Mariners',
    legsText: 'DraftKings over @ 2.04 / Pinnacle under @ 2.02',
    stakeCents: 10_000, startsAt: Date.UTC(2026, 6, 15, 2, 10), live: false,
  };
  expect(openBetText(bet))
    .toBe('ARB · Blue Jays @ Mariners · DraftKings over @ 2.04 / Pinnacle under @ 2.02 · $100');
  expect(openBetStatus(bet)).toBe('STARTS 7:10 PM'); // 2026-07-15 02:10 UTC = 19:10 PDT
  expect(openBetStatus({ ...bet, live: true })).toBe('LIVE');
});

test('opportunity sort + reveal toggle', () => {
  const rows = [
    { book: 'Coolbet', count: 103, avgPct: 2.4 },
    { book: '1xBet', count: 139, avgPct: 2.9 },
    { book: 'Pinnacle', count: 139, avgPct: 2.1 },
  ];
  expect(sortOpp(rows, 'COUNT').map((r) => r.book)).toEqual(['1xBet', 'Pinnacle', 'Coolbet']);
  expect(sortOpp(rows, 'EDGE').map((r) => r.book)).toEqual(['1xBet', 'Coolbet', 'Pinnacle']);
  expect(oppToggle(false)).toBe('SEE ALL →');
  expect(oppToggle(true)).toBe('SHOW FEWER ←');
});

test('limits row: date · book · SPORT — event | MAX $x', () => {
  expect(limitRow({
    when: Date.UTC(2026, 6, 13, 5, 0), // JUL 12 22:00 PDT
    book: 'bet365', sport: 'soccer', event: 'Arsenal vs Chelsea', maxCents: 2_500,
  })).toEqual({ left: 'JUL 12 · bet365 · SOCCER — Arsenal vs Chelsea', right: 'MAX $25' });
});

test('gate bars: widths vs the max row, which tints yellow', () => {
  const bars = gateBar([
    { reason: 'ONE_SPORT_RULE', costCents: 21_200, note: '87% OF LINE ITEM IS 1XBET' },
    { reason: 'HEAT_GATE', costCents: 6_400, note: '50% OF LINE ITEM IS FANDUEL' },
  ]);
  expect(bars[0]).toEqual({
    reason: 'ONE_SPORT_RULE', widthPct: 100, cost: '−$212', note: '87% OF LINE ITEM IS 1XBET', top: true,
  });
  expect(bars[1]!.widthPct).toBe(30);
  expect(bars[1]!.top).toBe(false);
  expect(gateBar([])).toEqual([]);
});

test('cost tiles: honest em-dashes when empty', () => {
  expect(roundingTile({ costCents: 1_840, pairs: 41 })).toEqual({
    value: '−$18.40', note: 'Σ (UNROUNDED − ROUNDED WORST-CASE) OVER 41 CONFIRMED PAIRS',
  });
  expect(roundingTile(null)).toEqual({ value: '—', note: 'NO CONFIRMED PAIRS YET' });
  expect(retentionTile({ medianPct: 81, dieAtRecheckPct: 23, thresholdPct: 95 })).toEqual({
    value: '81% MEDIAN', note: 'PROMOTION THRESHOLD 95% · 23% OF CANDIDATES DIE AT RECHECK',
  });
  expect(retentionTile(null)).toEqual({ value: '—', note: 'NO RECHECKS YET' });
  expect(closingEdgeTile({ avgPct: 1.1, beatClosePct: 62, legs: 40 })).toEqual({
    value: '+1.1% MEAN · 62% POSITIVE', note: 'FROM LAST CACHED PRE-START SWEEP',
  });
  expect(closingEdgeTile({ avgPct: -0.4, beatClosePct: 41, legs: 3 }).value).toBe('−0.4% MEAN · 41% POSITIVE');
  expect(closingEdgeTile(null)).toEqual({ value: '—', note: 'NO CLOSES CAPTURED YET' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- analytics`
Expected: FAIL — cannot resolve module `./analytics`.

- [ ] **Step 3: Implement `client/src/lib/analytics.ts`**

```ts
// client/src/lib/analytics.ts — AnalyticsView contract mirror (server:
// analytics/report.ts) plus every pure display derivation for the ANALYTICS
// screen. No React, no fetch. Charts are hand-rolled SVG: chartGeometry maps a
// cents series onto the mockup's fixed 960×220 plate (inventory §4.4–4.5).
import { formatCents, parseDollarsToCents } from './format';
import { formatTimeShort } from './brain';
import type { KillReason, Strategy } from './api';

// ---- contract mirror --------------------------------------------------------

export type RangeKey = '1D' | '5D' | '30D' | '1Y' | 'MAX';
export const RANGE_KEYS: RangeKey[] = ['1D', '5D', '30D', '1Y', 'MAX'];

export interface ProfileView { id: number; name: string; startingCashCents: number; createdDate: string }
export interface SeriesPoint { day: string; profitCents: number }
export interface ChartStats { profitCents: number; returnPct: number; annualizedPct: number }
export interface ChartViewData { points: SeriesPoint[]; stats: ChartStats }
export interface MonthlyRow {
  month: string; cand: number; verif: number; sent: number; conf: number;
  unconf: number; exp: number; killed: number; followThruPct: number | null; plCents: number;
}
export interface FunnelCounts {
  under2: number; from2to5: number; from5to10: number; over10: number; dead: number; total: number;
}
export interface OpenBetView {
  category: Strategy; event: string; legsText: string; stakeCents: number; startsAt: number; live: boolean;
}
export interface BoardRow { book: string; count: number; pct: number }
export interface GateCostRow { reason: KillReason; costCents: number; note: string }
export interface OppRow { book: string; count: number; avgPct: number }
export interface AnalyticsView {
  simulated: boolean;
  today: string;
  profile: ProfileView;
  range: RangeKey;
  bankrollCents: number;
  confirmed: ChartViewData;
  all: ChartViewData;
  monthly: MonthlyRow[];
  funnel: FunnelCounts;
  advanced: {
    openBets: OpenBetView[];
    leaderboards: { since: string; boards: { title: string; rows: BoardRow[] }[] };
    costOfSafety: {
      rounding: { costCents: number; pairs: number } | null;
      retention: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null;
      gateCost: GateCostRow[];
      closingEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
    };
    limits: { when: number; book: string; sport: string; event: string; maxCents: number }[];
    opportunities: { since: string; arb: OppRow[]; ev: OppRow[]; middles: OppRow[] };
  };
}

// ---- date words -----------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** '2026-05-01' → 'MAY 01 2026' (fund box, add-form note — day stays 2-digit). */
export function formatDateCaps(day: string): string {
  const [y, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${d} ${y}`;
}

/** '2026-07-05' → 'JUL 5' (chart date row — mockup days are unpadded). */
export function chartDate(day: string): string {
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** '2026-07' → 'JUL'. */
export function monthLabel(month: string): string {
  return MONTHS[Number(month.slice(5)) - 1] ?? month;
}

const DAY_SHORT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', month: 'short', day: '2-digit',
});

/** Epoch ms → 'JUL 12' (limits log dates), Vancouver. */
export function formatDayShort(epochMs: number): string {
  const parts = DAY_SHORT.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')}`;
}

// ---- money words ------------------------------------------------------------------

const group = (n: number): string => n.toLocaleString('en-US');

/** Signed whole dollars: 43_812 → '+$438' (chart PROFIT, monthly P/L). U+2212. */
export function formatSignedDollars(c: number): string {
  const sign = c < 0 ? '−' : '+';
  return `${sign}$${group(Math.round(Math.abs(c) / 100))}`;
}

export function formatReturn(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(2)}%`;
}

export function formatAnnualized(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`;
}

// ---- top row ------------------------------------------------------------------------

export function fundStartText(p: ProfileView): { amount: string; date: string } {
  return { amount: formatCents(p.startingCashCents), date: formatDateCaps(p.createdDate) };
}

export function profileItems(
  profiles: ProfileView[], currentId: number,
): { id: number; label: string; current: boolean }[] {
  return profiles.map((p) => ({
    id: p.id,
    label: p.id === currentId ? `● ${p.name.toUpperCase()}` : p.name.toUpperCase(),
    current: p.id === currentId,
  }));
}

/** CREATE PROFILE stays grey until the name is real and the cash parses positive. */
export function createEnabled(name: string, amount: string): boolean {
  const cents = parseDollarsToCents(amount);
  return name.trim() !== '' && cents !== null && cents > 0;
}

export function startsNote(today: string): string {
  return `STARTS THE DAY YOU CREATE IT — ${formatDateCaps(today)}`;
}

// ---- chart geometry ---------------------------------------------------------------
// Plate: viewBox 0 0 960 220; plot x∈[60,940], y∈[25,205] (baseline 205, top 25).
// Vertical gridlines are the mockup's fixed decoration; the y-scale adapts to data.

export interface ChartGeo {
  yLabels: { y: number; text: string }[];
  yMinors: number[];
  xMajors: number[];
  xMinors: number[];
  line: string | null;
  bullets: { x: number; y: number }[];
  last: { x: number; y: number };
  dates: string[];
}

const X_MAJORS = [207, 354, 500, 647, 794];
const X_MINORS = [133, 280, 427, 574, 720, 867];
const MAX_BULLETS = 60;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Whole-dollar axis label (steps are ≥ $1 so cents never appear). U+2212 for losses. */
function axisDollar(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${group(Math.abs(cents) / 100)}`;
}

export function chartGeometry(points: SeriesPoint[]): ChartGeo | null {
  const n = points.length;
  if (n === 0) return null;

  const values = points.map((p) => p.profitCents);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  let step = 100;
  outer: for (let k = 0; k < 12; k += 1) {
    for (const m of [1, 2, 5]) {
      step = m * 10 ** k * 100;
      if (Math.ceil(maxV / step) - Math.floor(minV / step) <= 6) break outer;
    }
  }
  const lo = Math.floor(minV / step) * step;
  let hi = Math.ceil(maxV / step) * step;
  if (hi === lo) hi = lo + step; // flat-at-a-line series still gets a scale

  const y = (v: number): number => r1(205 - ((v - lo) / (hi - lo)) * 180);
  const yLabels: { y: number; text: string }[] = [];
  for (let v = lo; v <= hi; v += step) yLabels.push({ y: y(v), text: axisDollar(v) });
  const yMinors = yLabels.slice(0, -1).map((l, i) => r1((l.y + yLabels[i + 1]!.y) / 2));

  const x = (i: number): number => (n === 1 ? 940 : r1(60 + (i / (n - 1)) * 880));
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.profitCents) }));

  const dateIdx = n <= 6
    ? points.map((_, i) => i)
    : Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  return {
    yLabels,
    yMinors,
    xMajors: X_MAJORS,
    xMinors: X_MINORS,
    line: n >= 2 ? pts.map((p) => `${p.x},${p.y}`).join(' ') : null,
    bullets: n <= MAX_BULLETS ? pts : [],
    last: pts[pts.length - 1]!,
    dates: [...new Set(dateIdx)].map((i) => chartDate(points[i]!.day)),
  };
}

// ---- stats + footnotes ------------------------------------------------------------------

export function statsTexts(stats: ChartStats): { ret: string; ann: string; profit: string; retTone: 'pos' | 'neg' } {
  return {
    ret: formatReturn(stats.returnPct),
    ann: formatAnnualized(stats.annualizedPct),
    profit: formatSignedDollars(stats.profitCents),
    retTone: stats.profitCents < 0 ? 'neg' : 'pos',
  };
}

export function bankrollFootnote(bankrollCents: number): string {
  return `RETURNS MEASURED AGAINST TOTAL BANKROLL (${formatCents(bankrollCents)}).`
    + ' ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.';
}

// ---- monthly table ------------------------------------------------------------------------

export const MONTHLY_HEADERS = [
  'MONTH', 'CAND', 'VERIF', 'SENT', 'CONF', 'UNCONF', 'EXP', 'KILLED', 'FOLLOW-THRU', 'P/L',
];

export function monthlyCells(r: MonthlyRow): string[] {
  return [
    monthLabel(r.month), String(r.cand), String(r.verif), String(r.sent), String(r.conf),
    String(r.unconf), String(r.exp), String(r.killed),
    r.followThruPct === null ? '—' : `${r.followThruPct}%`,
    formatSignedDollars(r.plCents),
  ];
}

// ---- TIME TO ACT funnel ---------------------------------------------------------------------

export interface FunnelRowView { label: string; pct: number | null; value: string; dead: boolean }

export function funnelRows(f: FunnelCounts): FunnelRowView[] {
  const pct = (n: number): number | null => (f.total > 0 ? Math.round((100 * n) / f.total) : null);
  const row = (label: string, n: number, dead = false): FunnelRowView => {
    const p = pct(n);
    return { label, pct: p, value: p === null ? '—' : `${p}%`, dead };
  };
  return [
    row('CONFIRMED < 2 MIN', f.under2),
    row('CONFIRMED 2–5 MIN', f.from2to5),
    row('CONFIRMED 5–10 MIN', f.from5to10),
    ...(f.over10 > 0 ? [row('CONFIRMED > 10 MIN', f.over10)] : []), // NEW copy — honest slow confirms
    row('EXPIRED / DEAD AT CONFIRM', f.dead, true),
  ];
}

// ---- advanced sections -------------------------------------------------------------------------

export function openBetText(b: OpenBetView): string {
  return `${b.category} · ${b.event} · ${b.legsText} · ${formatCents(b.stakeCents)}`;
}

export function openBetStatus(b: OpenBetView): string {
  return b.live ? 'LIVE' : `STARTS ${formatTimeShort(b.startsAt)}`; // LIVE is NEW copy (no quarter in sim)
}

export function sortOpp(rows: OppRow[], by: 'COUNT' | 'EDGE'): OppRow[] {
  return [...rows].sort((a, b) =>
    by === 'COUNT'
      ? b.count - a.count || b.avgPct - a.avgPct || (a.book < b.book ? -1 : 1)
      : b.avgPct - a.avgPct || b.count - a.count || (a.book < b.book ? -1 : 1));
}

export function oppToggle(open: boolean): string {
  return open ? 'SHOW FEWER ←' : 'SEE ALL →'; // SHOW FEWER ← is NEW copy (mockup button is inert)
}

export function limitRow(
  l: AnalyticsView['advanced']['limits'][number],
): { left: string; right: string } {
  return {
    left: `${formatDayShort(l.when)} · ${l.book} · ${l.sport.toUpperCase()} — ${l.event}`,
    right: `MAX ${formatCents(l.maxCents)}`,
  };
}

export interface GateBarView { reason: string; widthPct: number; cost: string; note: string; top: boolean }

export function gateBar(rows: GateCostRow[]): GateBarView[] {
  const max = Math.max(0, ...rows.map((r) => r.costCents));
  return rows.map((r) => ({
    reason: r.reason,
    widthPct: max > 0 ? Math.round((100 * r.costCents) / max) : 0,
    cost: `−$${group(Math.round(r.costCents / 100))}`,
    note: r.note,
    top: r.costCents === max && max > 0,
  }));
}

export function roundingTile(t: { costCents: number; pairs: number } | null): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO CONFIRMED PAIRS YET' }; // NEW copy
  const dollars = Math.floor(t.costCents / 100);
  const cents = String(t.costCents % 100).padStart(2, '0');
  return {
    value: `−$${group(dollars)}.${cents}`,
    note: `Σ (UNROUNDED − ROUNDED WORST-CASE) OVER ${t.pairs} CONFIRMED PAIRS`,
  };
}

export function retentionTile(
  t: { medianPct: number; dieAtRecheckPct: number; thresholdPct: number } | null,
): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO RECHECKS YET' }; // NEW copy
  return {
    value: `${t.medianPct}% MEDIAN`,
    note: `PROMOTION THRESHOLD ${t.thresholdPct}% · ${t.dieAtRecheckPct}% OF CANDIDATES DIE AT RECHECK`,
  };
}

export function closingEdgeTile(
  t: { avgPct: number; beatClosePct: number; legs: number } | null,
): { value: string; note: string } {
  if (t === null) return { value: '—', note: 'NO CLOSES CAPTURED YET' }; // NEW copy
  const sign = t.avgPct < 0 ? '−' : '+';
  return {
    value: `${sign}${Math.abs(t.avgPct).toFixed(1)}% MEAN · ${t.beatClosePct}% POSITIVE`,
    note: 'FROM LAST CACHED PRE-START SWEEP',
  };
}
```

- [ ] **Step 4: Append the fetch helpers to `client/src/lib/api.ts`** (type import at the top of the file with the other imports, functions at the end):

```ts
// ---- analytics (Plan 4) ----------------------------------------------------------
import type { AnalyticsView, ProfileView, RangeKey } from './analytics';

export async function fetchProfiles(): Promise<ProfileView[] | null> {
  try {
    const res = await fetch('/api/profiles');
    if (!res.ok) return null;
    const data = (await res.json()) as { profiles?: ProfileView[] };
    return Array.isArray(data.profiles) ? data.profiles : null;
  } catch {
    return null;
  }
}

export async function createProfile(name: string, startingCashCents: number): Promise<ProfileView | null> {
  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, startingCashCents }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { profile: ProfileView }).profile;
  } catch {
    return null;
  }
}

export async function fetchAnalytics(profileId: number, range: RangeKey): Promise<AnalyticsView | null> {
  try {
    const res = await fetch(`/api/analytics?profileId=${profileId}&range=${range}`);
    if (!res.ok) return null;
    return (await res.json()) as AnalyticsView;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Create `client/src/hooks/useAnalytics.ts`**

```ts
// client/src/hooks/useAnalytics.ts — poll GET /api/analytics every 5s (same
// contract as useAppState/useBrain): any error → null, the screen renders its
// calm degraded form. Re-fetches immediately when the profile or range changes.
import { useCallback, useEffect, useState } from 'react';
import { fetchAnalytics } from '../lib/api';
import type { AnalyticsView, RangeKey } from '../lib/analytics';

const POLL_MS = 5000;

export function useAnalytics(
  profileId: number | null, range: RangeKey,
): { view: AnalyticsView | null; refresh: () => void } {
  const [view, setView] = useState<AnalyticsView | null>(null);

  const refresh = useCallback(() => {
    if (profileId === null) return;
    void fetchAnalytics(profileId, range).then(setView);
  }, [profileId, range]);

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
Expected: PASS (existing client tests + 14 new analytics specs), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib client/src/hooks
git commit -m "feat(client): analytics contract mirror, chart geometry, pure display helpers, useAnalytics hook"
```

---

### Task 6: Analytics stylesheet + screen shell (top row, profiles, range chips)

**Files:**
- Create: `client/src/styles/analytics.css`, `client/src/screens/AnalyticsScreen.tsx`, `client/src/components/ProfileBar.tsx`, `client/src/components/RangeChips.tsx`
- Modify: `client/src/main.tsx`, `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 helpers/hook/fetchers; Plan 2's `.page`/`.empty-note`/`.cta` classes.
- Produces: ALL analytics CSS classes, frozen here (Tasks 7–9 add no CSS): `.an-top .profile-group .profile-chip .profile-btn .profile-menu .profile-item (.current) .profile-add .fund-box .fund-strong .add-form .field .field-label .add-input .create-btn (.ready) .add-note .chip-group .chip (.active) .chart-title .chart-plate .chart-svg .grid-minor .grid-major .grid-base .axis-label .trend .bullet .bullet-last .date-row .chart-empty .stats-row .stat-label .stat-value (.pos .neg .plain) .bankroll-note .monthly .monthly-head .monthly-row .m-month .m-pl .funnel .funnel-title .funnel-row .funnel-label .funnel-track .funnel-fill (.dead) .funnel-value .funnel-foot .cta-blue .adv-section-head .adv-box .ob-row .ob-status .lb-sub .since-chip .lb-grid .board .board-title .board-row .board-count .board-pct .cost-grid .cost-tile (.span2) .cost-label .cost-value .cost-note .gate-row .gate-label .gate-track .gate-fill (.top) .gate-cost .gate-note .limits-box .limits-head .limits-row .limits-right .opp-box .opp-head .opp-toggle .opp-chip (.active) .opp-grid .opp-col .opp-col-title .opp-subhead .opp-row .opp-count .opp-avg .see-all .sim-footnote`.

- [ ] **Step 1: Create `client/src/styles/analytics.css`**

```css
/* client/src/styles/analytics.css — ANALYTICS screen. Every value from
   design-inventory §4 unless marked "not pinned by inventory". */

/* ---------- top row (§4.1) ---------- */
.an-top { display: flex; gap: 26px; margin-top: 18px; align-items: baseline; flex-wrap: wrap; }
.profile-group { position: relative; display: flex; }
.profile-chip { background: #fff; color: #000; font-size: 13px; font-weight: 600; letter-spacing: 0.14em; padding: 7px 14px; }
.profile-btn { background: none; border: 2px solid #fff; border-left: none; color: #fff; padding: 5px 12px; letter-spacing: 0.1em; font-size: 13px; font-family: inherit; cursor: pointer; }
.profile-btn:hover { background: var(--raised-bg); }
.profile-menu { position: absolute; top: calc(100% + 4px); left: 0; background: #000; border: 2px solid var(--grey-panel); min-width: 200px; z-index: 10; }
.profile-item { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--muted-label); font-size: 12px; letter-spacing: 0.1em; padding: 9px 12px; font-family: inherit; cursor: pointer; }
.profile-item.current { color: #fff; }
.profile-add { display: block; width: 100%; text-align: left; background: none; border: none; border-top: 1px solid var(--grey-subtle-row); color: #fff; font-size: 12px; letter-spacing: 0.1em; padding: 9px 12px; font-family: inherit; cursor: pointer; }
.fund-box { margin-left: auto; border: 2px solid var(--grey-panel); padding: 6px 12px; font-size: 14px; letter-spacing: 0.1em; color: var(--muted-label); white-space: nowrap; }
.fund-strong { color: #fff; font-weight: 600; }

/* ---------- add-profile form (§4.2) ---------- */
.add-form { border: 2px solid var(--grey-panel); margin-top: 12px; padding: 14px; display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 11px; letter-spacing: 0.14em; color: var(--muted-label); }
.add-input { background: #000; color: #fff; border: 2px solid var(--grey-divider); padding: 8px 10px; font-size: 13px; font-weight: 500; font-family: inherit; font-variant-numeric: tabular-nums; }
.add-input:focus { border-color: #fff; outline: none; }
.add-input.name { width: 160px; }
.add-input.cash { width: 120px; }
.create-btn { background: var(--faint); color: var(--hover-bg); border: none; padding: 10px 16px; font-size: 11px; letter-spacing: 0.12em; font-weight: 500; font-family: inherit; cursor: default; }
.create-btn.ready { background: #fff; color: #000; cursor: pointer; }
.add-note { font-size: 11px; letter-spacing: 0.08em; color: var(--faint); }

/* ---------- range chips (§4.3 — the §0.4 joined-chip group) ---------- */
.chip-group { display: flex; gap: 0; border: 2px solid #fff; width: max-content; margin-top: 18px; }
.chip { background: none; border: none; border-left: 2px solid #fff; color: var(--muted-label); padding: 8px 18px; font-size: 12px; font-weight: 500; letter-spacing: 0.14em; font-family: inherit; cursor: pointer; }
.chip:first-child { border-left: none; }
.chip.active { background: #fff; color: #000; }

/* ---------- charts (§4.4–4.5) ---------- */
.chart-title { margin: 22px 0 8px; font-size: 13px; letter-spacing: 0.16em; color: var(--body-text); font-weight: 400; }
.chart-plate { background: var(--chart-bg); border: 3px solid var(--blue); padding: 14px 14px 10px; }
.chart-svg { width: 100%; height: 210px; display: block; }
.grid-minor { stroke: var(--chart-minor); stroke-width: 1; }
.grid-major { stroke: var(--chart-ink); stroke-width: 1.5; }
.grid-base { stroke: var(--chart-ink); stroke-width: 2; }
.axis-label { fill: var(--chart-ink); font-size: 12px; font-weight: 700; font-family: inherit; }
.trend { fill: none; stroke: var(--blue); stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: round; }
.bullet { fill: var(--blue); }
.bullet-last { fill: var(--blue); stroke: var(--chart-ink); stroke-width: 1.5; }
.date-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--chart-ink); padding: 4px 0 2px 50px; }
.chart-empty { font-size: 12px; letter-spacing: 0.1em; color: var(--chart-ink); padding: 40px 0; text-align: center; }
.stats-row { display: flex; gap: 28px; margin-top: 10px; font-size: 14px; letter-spacing: 0.12em; flex-wrap: wrap; }
.stat-label { color: var(--body-text); }
.stat-value { font-weight: 500; }
.stat-value.pos { color: var(--green-money); }
.stat-value.neg { color: var(--red); }
.stat-value.plain { color: #fff; }
.bankroll-note { margin: 18px 0 0; font-size: 11px; letter-spacing: 0.1em; line-height: 1.7; color: var(--faint); }

/* ---------- monthly table (§4.6) ---------- */
.monthly { border: 2px solid var(--grey-divider); margin-top: 22px; font-size: 12px; }
.monthly-head { display: grid; grid-template-columns: 0.8fr repeat(7, 0.7fr) 1fr 0.8fr; gap: 6px; padding: 9px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 10px; letter-spacing: 0.12em; color: var(--faint); }
.monthly-row { display: grid; grid-template-columns: 0.8fr repeat(7, 0.7fr) 1fr 0.8fr; gap: 6px; padding: 9px 14px; border-bottom: 1px solid var(--grey-subtle-row); }
.monthly-row:last-child { border-bottom: none; }
.m-month { color: #fff; font-weight: 500; letter-spacing: 0.08em; }
.m-pl { color: #fff; font-weight: 500; }

/* ---------- TIME TO ACT funnel (§4.7) ---------- */
.funnel { border: 2px solid var(--grey-panel); padding: 14px; margin-top: 8px; }
.funnel-title { font-size: 11px; letter-spacing: 0.14em; color: var(--muted-label); margin-bottom: 12px; }
.funnel-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.funnel-label { font-size: 11px; letter-spacing: 0.1em; min-width: 190px; color: var(--muted-label); }
.funnel-track { flex: 1; height: 14px; border: 1px solid var(--grey-divider); }
.funnel-fill { height: 100%; background: #fff; }
.funnel-fill.dead { background: var(--faint); }
.funnel-value { font-size: 12px; font-weight: 500; color: #fff; min-width: 44px; text-align: right; }
.funnel-foot { font-size: 11px; letter-spacing: 0.08em; color: var(--faint); margin-top: 12px; }

/* ---------- ADVANCED ANALYTICS (§4.8) ---------- */
.cta-blue { background: var(--blue); }
.adv-section-head { margin: 18px 0 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.14em; color: var(--blue); }
.adv-box { border: 2px solid var(--grey-divider); }
.ob-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 12px; color: var(--body-text); }
.ob-row:last-child { border-bottom: none; }
.ob-status { color: var(--muted-label); letter-spacing: 0.08em; white-space: nowrap; }
.lb-sub { display: flex; gap: 10px; align-items: center; font-size: 11px; letter-spacing: 0.14em; color: var(--muted-label); margin-bottom: 8px; }
.since-chip { border: 1px solid var(--muted-label); color: var(--body-text); padding: 2px 8px; font-size: 11px; letter-spacing: 0.1em; }
.lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.board { border: 2px solid var(--grey-panel); }
.board-title { padding: 8px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 11px; letter-spacing: 0.14em; color: #fff; font-weight: 500; }
.board-row { display: flex; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 12px; }
.board-row:last-child { border-bottom: none; }
.board-row .book { color: var(--body-text); flex: 1; }
.board-count { color: #fff; }
.board-pct { color: var(--muted-label); min-width: 40px; text-align: right; }
.cost-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cost-tile { border: 2px solid var(--grey-panel); padding: 12px 14px; }
.cost-tile.span2 { grid-column: span 2; }
.cost-label { font-size: 10px; letter-spacing: 0.14em; color: var(--muted-label); }
.cost-value { font-size: 20px; font-weight: 500; color: #fff; margin-top: 6px; }
.cost-note { font-size: 11px; color: var(--faint); letter-spacing: 0.04em; margin-top: 4px; }
.gate-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.gate-label { font-size: 11px; letter-spacing: 0.08em; color: var(--body-text); min-width: 200px; }
.gate-track { flex: 1; height: 14px; border: 1px solid var(--grey-divider); }
.gate-fill { height: 100%; background: #fff; }
.gate-fill.top { background: var(--yellow); }
.gate-cost { font-size: 12px; font-weight: 500; color: #fff; min-width: 56px; text-align: right; }
.gate-note { font-size: 11px; color: var(--faint); min-width: 150px; }
.limits-box { border: 2px solid var(--blue); }
.limits-head { padding: 10px 14px; border-bottom: 1px solid var(--blue-dim-border); font-size: 13px; font-weight: 600; letter-spacing: 0.14em; color: var(--blue); }
.limits-row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--grey-divider); font-size: 12px; color: var(--body-text); }
.limits-row:last-child { border-bottom: none; }
.limits-right { color: var(--blue); letter-spacing: 0.08em; font-weight: 500; white-space: nowrap; }
.opp-box { border: 2px solid var(--blue); margin-top: 18px; }
.opp-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--blue-dim-border); font-size: 13px; font-weight: 600; letter-spacing: 0.14em; color: var(--blue); }
.opp-toggle { display: flex; border: 1px solid var(--blue); }
.opp-chip { background: none; border: none; color: var(--blue); padding: 4px 10px; font-size: 10px; letter-spacing: 0.12em; font-family: inherit; cursor: pointer; }
.opp-chip.active { background: var(--blue); color: #000; }
.opp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
.opp-col { border-right: 1px solid var(--blue-dim-border); padding: 10px 14px; }
.opp-col:last-child { border-right: none; }
.opp-col-title { font-size: 11px; letter-spacing: 0.12em; color: var(--muted-label); }
.opp-subhead { display: grid; grid-template-columns: 1.3fr 0.6fr 0.9fr; font-size: 10px; letter-spacing: 0.12em; color: var(--faint); border-bottom: 1px solid var(--grey-subtle-row); padding: 6px 0; margin-top: 6px; }
.opp-subhead .right { text-align: right; }
.opp-row { display: grid; grid-template-columns: 1.3fr 0.6fr 0.9fr; font-size: 12px; padding: 5px 0; }
.opp-row .book { color: #fff; }
.opp-count { color: var(--body-text); text-align: right; }
.opp-avg { color: var(--blue); text-align: right; font-weight: 500; }
.see-all { background: none; border: none; font-size: 12px; letter-spacing: 0.14em; color: var(--faint); padding: 10px 14px; font-family: inherit; cursor: pointer; text-align: left; }
.see-all:hover { color: #fff; }

/* ---------- sim footnote (§4.9) ---------- */
.sim-footnote { margin: 26px auto 0; max-width: 560px; font-size: 12px; letter-spacing: 0.12em; line-height: 1.7; color: var(--muted-label); text-align: center; }
```

- [ ] **Step 2: Modify `client/src/main.tsx`** — add the stylesheet import after the last `./styles/` import (after `brain.css` if Plan 3 landed, else after `global.css`):

```tsx
import './styles/analytics.css';
```

- [ ] **Step 3: Create `client/src/components/RangeChips.tsx`**

```tsx
import { RANGE_KEYS, type RangeKey } from '../lib/analytics';

interface RangeChipsProps {
  range: RangeKey;
  onSelect: (r: RangeKey) => void;
}

export function RangeChips({ range, onSelect }: RangeChipsProps) {
  return (
    <div className="chip-group">
      {RANGE_KEYS.map((r) => (
        <button key={r} className={`chip${r === range ? ' active' : ''}`} onClick={() => onSelect(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/components/ProfileBar.tsx`**

```tsx
import { useState } from 'react';
import { createProfile } from '../lib/api';
import { parseDollarsToCents } from '../lib/format';
import {
  createEnabled, profileItems, startsNote, type ProfileView,
} from '../lib/analytics';

interface ProfileBarProps {
  profiles: ProfileView[];
  currentId: number;
  today: string;
  onSelect: (id: number) => void;
  onCreated: (p: ProfileView) => void;
}

export function ProfileBar({ profiles, currentId, today, onSelect, onCreated }: ProfileBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const ready = createEnabled(name, amount);
  const create = async () => {
    if (!ready) return;
    const p = await createProfile(name.trim(), parseDollarsToCents(amount)!);
    if (p) {
      setAdding(false);
      setName('');
      setAmount('');
      onCreated(p);
    }
  };

  return (
    <>
      <div className="profile-group">
        <span className="profile-chip">PROFILE</span>
        <button className="profile-btn" onClick={() => setMenuOpen((v) => !v)}>
          {(profiles.find((p) => p.id === currentId)?.name ?? '').toUpperCase()} ▾
        </button>
        {menuOpen && (
          <div className="profile-menu">
            {profileItems(profiles, currentId).map((item) => (
              <button
                key={item.id}
                className={`profile-item${item.current ? ' current' : ''}`}
                onClick={() => { onSelect(item.id); setMenuOpen(false); }}
              >
                {item.label}
              </button>
            ))}
            <button
              className="profile-add"
              onClick={() => { setAdding(true); setMenuOpen(false); }}
            >
              + ADD NEW PROFILE
            </button>
          </div>
        )}
      </div>
      {adding && (
        <div className="add-form">
          <label className="field">
            <span className="field-label">NAME</span>
            <input className="add-input name" placeholder="Name" value={name}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">STARTING CASH</span>
            <input className="add-input cash" placeholder="$5,000" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button className={`create-btn${ready ? ' ready' : ''}`} onClick={() => { void create(); }}>
            CREATE PROFILE
          </button>
          <span className="add-note">{startsNote(today)}</span>
        </div>
      )}
    </>
  );
}
```

(Note: the add form renders inside the top-row fragment; the screen places `ProfileBar` first so the form's `margin-top: 12px` box lands under the row, per §4.2. `flex-wrap` on `.an-top` lets it take the full width.)

- [ ] **Step 5: Create `client/src/screens/AnalyticsScreen.tsx`** (v1 — grows in Tasks 7–9)

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';
import { fetchProfiles } from '../lib/api';
import { fundStartText, type ProfileView, type RangeKey } from '../lib/analytics';
import { ProfileBar } from '../components/ProfileBar';
import { RangeChips } from '../components/RangeChips';

export function AnalyticsScreen() {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>('30D');

  const loadProfiles = useCallback(() => {
    void fetchProfiles().then((ps) => {
      if (ps === null) return;
      setProfiles(ps);
      setProfileId((cur) => cur ?? ps[0]?.id ?? null);
    });
  }, []);
  useEffect(loadProfiles, [loadProfiles]);

  const { view } = useAnalytics(profileId, range);

  if (!view) {
    return (
      <main>
        <div className="empty-note">ANALYTICS OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
  const fund = fundStartText(view.profile);
  return (
    <main>
      <div className="an-top">
        <ProfileBar
          profiles={profiles}
          currentId={view.profile.id}
          today={view.today}
          onSelect={setProfileId}
          onCreated={(p) => { loadProfiles(); setProfileId(p.id); }}
        />
        <div className="fund-box">
          FUND START <span className="fund-strong">{fund.amount}</span>
          {' · '}
          <span className="fund-strong">{fund.date}</span>
        </div>
      </div>
      <RangeChips range={range} onSelect={setRange} />
    </main>
  );
}
```

- [ ] **Step 6: Modify `client/src/App.tsx`** — exact replacement of the placeholder line (works whether or not Plan 3's BrainScreen line is present):

```tsx
// OLD
      {tab === 'ANALYTICS' && <PlaceholderScreen label="ANALYTICS" planNumber={4} />}
// NEW
      {tab === 'ANALYTICS' && <AnalyticsScreen />}
```

and add the import:

```tsx
import { AnalyticsScreen } from './screens/AnalyticsScreen';
```

- [ ] **Step 7: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then Terminal A `npm run dev`, Terminal B `npm run dev:client`, open http://localhost:5174 → ANALYTICS tab:
- Top row: white `PROFILE` chip joined to `RYAN ▾`; clicking opens the dropdown with `● RYAN` and `+ ADD NEW PROFILE`.
- Add form: CREATE PROFILE grey until name + parseable cash; creating `LEA` / `$5,000` selects LEA, fund box flips to `FUND START $5,000 · JUL 14 2026` (today's date), note reads `STARTS THE DAY YOU CREATE IT — …`.
- Duplicate name: CREATE silently fails (button stays, API 409) — form remains open. Select RYAN again via the dropdown.
- Range chips render `1D 5D 30D 1Y MAX`, default `30D` filled white; clicking re-fetches (network tab shows `?range=`).
- Kill the server: within ~5 s the tab degrades to `ANALYTICS OFFLINE — SERVER UNREACHABLE`; restart recovers.
Stop the dev servers.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "feat(client): analytics screen shell — stylesheet, profile bar, add-profile form, range chips"
```

---

### Task 7: The two profit charts — SVG plate, trendline, stats, bankroll footnote

**Files:**
- Create: `client/src/components/ProfitChart.tsx`
- Modify: `client/src/screens/AnalyticsScreen.tsx`

**Interfaces:**
- Consumes: Task 5's `chartGeometry`, `statsTexts`, `bankrollFootnote`; Task 6's frozen chart classes.
- Produces: `ProfitChart` — ONE component, rendered once per chart (Decision note 5).

- [ ] **Step 1: Create `client/src/components/ProfitChart.tsx`**

```tsx
import { chartGeometry, statsTexts, type ChartViewData } from '../lib/analytics';

interface ProfitChartProps {
  title: string;
  data: ChartViewData;
}

/** §4.4–4.5: light plate, 3px blue border, ink majors + grey minors, thick blue
 *  zigzag with a bullet at every point and the last point ringed. All geometry
 *  from chartGeometry — this component only places shapes. */
export function ProfitChart({ title, data }: ProfitChartProps) {
  const geo = chartGeometry(data.points);
  const s = statsTexts(data.stats);
  return (
    <section>
      <h3 className="chart-title">{title}</h3>
      <div className="chart-plate">
        {geo ? (
          <>
            <svg className="chart-svg" viewBox="0 0 960 220" preserveAspectRatio="none" role="img">
              {geo.yMinors.map((y) => (
                <line key={`ym${y}`} x1={60} x2={940} y1={y} y2={y} className="grid-minor" />
              ))}
              {geo.xMinors.map((x) => (
                <line key={`xm${x}`} x1={x} x2={x} y1={25} y2={205} className="grid-minor" />
              ))}
              {geo.xMajors.map((x) => (
                <line key={`xM${x}`} x1={x} x2={x} y1={25} y2={205} className="grid-major" />
              ))}
              {geo.yLabels.map((l) => (
                <line key={`yM${l.y}`} x1={60} x2={940} y1={l.y} y2={l.y}
                  className={l.y === 205 ? 'grid-base' : 'grid-major'} />
              ))}
              {geo.yLabels.map((l) => (
                <text key={`yt${l.y}`} x={50} y={l.y + 4} textAnchor="end" className="axis-label">
                  {l.text}
                </text>
              ))}
              {geo.line !== null && <polyline points={geo.line} className="trend" />}
              {geo.bullets.map((b, i) => (
                <circle key={`b${i}`} cx={b.x} cy={b.y} r={4} className="bullet" />
              ))}
              <circle cx={geo.last.x} cy={geo.last.y} r={5.5} className="bullet-last" />
            </svg>
            <div className="date-row">
              {geo.dates.map((d) => <span key={d}>{d}</span>)}
            </div>
          </>
        ) : (
          <div className="chart-empty">NO DATA YET</div>
        )}
      </div>
      <div className="stats-row">
        <span className="stat-label">
          RETURN (RANGE) <span className={`stat-value ${s.retTone}`}>{s.ret}</span>
        </span>
        <span className="stat-label">
          ANNUALIZED <span className={`stat-value ${s.retTone}`}>{s.ann}</span>
        </span>
        <span className="stat-label">
          PROFIT <span className="stat-value plain">{s.profit}</span>
        </span>
      </div>
    </section>
  );
}
```

(`NO DATA YET` is NEW copy for the unreachable 0-point case — the axis always has today, so it should never render; it exists so the component can never crash.)

- [ ] **Step 2: Grow `client/src/screens/AnalyticsScreen.tsx`** — add after `<RangeChips …/>`:

```tsx
      <ProfitChart title="CONFIRMED — PROFIT ($)" data={view.confirmed} />
      <ProfitChart
        title="ALL (CONFIRMED + UNCONFIRMED) — IF EVERY PICK WAS FOLLOWED ($)"
        data={view.all}
      />
      <p className="bankroll-note">{bankrollFootnote(view.bankrollCents)}</p>
```

with the import additions:

```tsx
import { bankrollFootnote, fundStartText, type ProfileView, type RangeKey } from '../lib/analytics';
import { ProfitChart } from '../components/ProfitChart';
```

- [ ] **Step 3: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, ANALYTICS tab:
- Both charts render: light `#d9d9d9` plates, 3px blue borders, bold ink axis labels starting `$0`, fixed vertical grid, blue trendline with bullets, last point ringed.
- A fresh db shows flat `$0`-anchored lines and `RETURN (RANGE) +0.00% · ANNUALIZED +0.0% · PROFIT +$0` — honest zeros.
- `curl -s -X POST localhost:4400/api/scan`, wait ~80 s, confirm a card on TRADES, then (sim time) let settlement land on a later scan — the CONFIRMED chart steps up on the settle day; the ALL chart also carries shadow money from unconfirmed expiries.
- Footnote reads `RETURNS MEASURED AGAINST TOTAL BANKROLL ($10,000). ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.`
- Switch ranges — the date row re-samples (`1D` shows a single ringed point).
Stop the dev servers.

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat(client): hand-rolled SVG profit charts with stats rows and bankroll footnote"
```

---

### Task 8: Monthly table + TIME TO ACT funnel

**Files:**
- Create: `client/src/components/MonthlyTable.tsx`, `client/src/components/TimeToActFunnel.tsx`
- Modify: `client/src/screens/AnalyticsScreen.tsx`

**Interfaces:**
- Consumes: Task 5's `MONTHLY_HEADERS`, `monthlyCells`, `funnelRows`; Task 6's frozen classes.
- Produces: the two sections between the charts and the ADVANCED ANALYTICS CTA.

- [ ] **Step 1: Create `client/src/components/MonthlyTable.tsx`**

```tsx
import { MONTHLY_HEADERS, monthlyCells, type MonthlyRow } from '../lib/analytics';

export function MonthlyTable({ rows }: { rows: MonthlyRow[] }) {
  if (rows.length === 0) return null; // no months yet — the table simply isn't there
  return (
    <div className="monthly">
      <div className="monthly-head">
        {MONTHLY_HEADERS.map((h) => <span key={h}>{h}</span>)}
      </div>
      {rows.map((r) => {
        const cells = monthlyCells(r);
        return (
          <div className="monthly-row" key={r.month}>
            {cells.map((c, i) => (
              <span key={MONTHLY_HEADERS[i]}
                className={i === 0 ? 'm-month' : i === cells.length - 1 ? 'm-pl' : undefined}>
                {c}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/components/TimeToActFunnel.tsx`**

```tsx
import { funnelRows, type FunnelCounts } from '../lib/analytics';

export function TimeToActFunnel({ funnel }: { funnel: FunnelCounts }) {
  return (
    <div className="funnel">
      <div className="funnel-title">TIME TO ACT — SENT → CONFIRMED</div>
      {funnelRows(funnel).map((r) => (
        <div className="funnel-row" key={r.label}>
          <span className="funnel-label">{r.label}</span>
          <span className="funnel-track">
            <span className={`funnel-fill${r.dead ? ' dead' : ''}`} style={{ width: `${r.pct ?? 0}%`, display: 'block' }} />
          </span>
          <span className="funnel-value">{r.value}</span>
        </div>
      ))}
      <div className="funnel-foot">
        % OF VERIFIED PICKS STILL ALIVE AT CONFIRMATION — THE REFERENDUM ON THE NOTIFICATION ARCHITECTURE
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Grow `client/src/screens/AnalyticsScreen.tsx`** — add after the bankroll footnote:

```tsx
      <MonthlyTable rows={view.monthly} />
      <TimeToActFunnel funnel={view.funnel} />
```

with the imports:

```tsx
import { MonthlyTable } from '../components/MonthlyTable';
import { TimeToActFunnel } from '../components/TimeToActFunnel';
```

- [ ] **Step 4: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, ANALYTICS tab:
- Monthly table shows the header row and `JUL` with live counts (`CAND ≥ SENT ≥ CONF`), `—` follow-thru until something is sent, `+$0` P/L until something settles.
- Funnel: `—` values on a fresh db; after confirming a card quickly, `CONFIRMED < 2 MIN` shows `100%` with a full white bar; the footer sentence renders verbatim.
Stop the dev servers.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): monthly table and TIME TO ACT funnel"
```

---

### Task 9: ADVANCED ANALYTICS expander + sim-mode footnote

**Files:**
- Create: `client/src/components/AdvancedAnalytics.tsx`
- Modify: `client/src/screens/AnalyticsScreen.tsx`

**Interfaces:**
- Consumes: Task 5's advanced-section helpers; Plan 2's `.cta` (+ Task 6's `.cta-blue`, `.open` variant).
- Produces: the blue expander with its five sections, and the §4.9 footnote.

- [ ] **Step 1: Create `client/src/components/AdvancedAnalytics.tsx`**

```tsx
import { useState } from 'react';
import {
  closingEdgeTile, gateBar, limitRow, openBetStatus, openBetText, oppToggle,
  retentionTile, roundingTile, sortOpp,
  type AnalyticsView, type BoardRow, type OppRow,
} from '../lib/analytics';

type Advanced = AnalyticsView['advanced'];

function Board({ title, rows }: { title: string; rows: BoardRow[] }) {
  return (
    <div className="board">
      <div className="board-title">{title}</div>
      {rows.length === 0 && <div className="board-row"><span className="book">—</span></div>}
      {rows.map((r) => (
        <div className="board-row" key={r.book}>
          <span className="book">{r.book}</span>
          <span className="board-count">{r.count}</span>
          <span className="board-pct">{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function OppColumn({ title, metric, rows, sort, open }: {
  title: string; metric: string; rows: OppRow[]; sort: 'COUNT' | 'EDGE'; open: boolean;
}) {
  const sorted = sortOpp(rows, sort);
  const shown = open ? sorted : sorted.slice(0, 5);
  return (
    <div className="opp-col">
      <div className="opp-col-title">{title}</div>
      <div className="opp-subhead">
        <span>BOOK</span><span className="right">COUNT</span><span className="right">{metric}</span>
      </div>
      {shown.length === 0 && <div className="opp-row"><span className="book">—</span></div>}
      {shown.map((r) => (
        <div className="opp-row" key={r.book}>
          <span className="book">{r.book}</span>
          <span className="opp-count">{r.count}</span>
          <span className="opp-avg">{r.avgPct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function AdvancedAnalytics({ adv, since }: { adv: Advanced; since: string }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<'COUNT' | 'EDGE'>('COUNT');
  const [oppOpen, setOppOpen] = useState(false);

  const rounding = roundingTile(adv.costOfSafety.rounding);
  const ret = retentionTile(adv.costOfSafety.retention);
  const cpe = closingEdgeTile(adv.costOfSafety.closingEdge);
  const bars = gateBar(adv.costOfSafety.gateCost);

  return (
    <>
      {open && (
        <>
          <h3 className="adv-section-head">OPEN BETS</h3>
          <div className="adv-box">
            {adv.openBets.length === 0 && <div className="ob-row"><span>NO OPEN BETS</span></div>}
            {adv.openBets.map((b, i) => (
              <div className="ob-row" key={i}>
                <span>{openBetText(b)}</span>
                <span className="ob-status">{openBetStatus(b)}</span>
              </div>
            ))}
          </div>

          <h3 className="adv-section-head">LEADERBOARDS</h3>
          <div className="lb-sub">
            TOP BOOKS BY CONFIRMED COUNT · SINCE
            <span className="since-chip">{since} ▾</span>
          </div>
          <div className="lb-grid">
            {adv.leaderboards.boards.map((b) => <Board key={b.title} title={b.title} rows={b.rows} />)}
          </div>

          <h3 className="adv-section-head">COST OF SAFETY</h3>
          <div className="cost-grid">
            <div className="cost-tile">
              <div className="cost-label">ROUNDING COST</div>
              <div className="cost-value">{rounding.value}</div>
              <div className="cost-note">{rounding.note}</div>
            </div>
            <div className="cost-tile">
              <div className="cost-label">MARGIN RETENTION — INITIAL → RECHECK → FINAL</div>
              <div className="cost-value">{ret.value}</div>
              <div className="cost-note">{ret.note}</div>
            </div>
            <div className="cost-tile span2">
              <div className="cost-label">GATE COST — ESTIMATED EV OF KILLED CANDIDATES, PER BATTERY RULE</div>
              {bars.length === 0 && <div className="cost-note">NO GATE KILLS YET</div>}
              {bars.map((b) => (
                <div className="gate-row" key={b.reason}>
                  <span className="gate-label">{b.reason}</span>
                  <span className="gate-track">
                    <span className={`gate-fill${b.top ? ' top' : ''}`} style={{ width: `${b.widthPct}%`, display: 'block' }} />
                  </span>
                  <span className="gate-cost">{b.cost}</span>
                  <span className="gate-note">{b.note}</span>
                </div>
              ))}
            </div>
            <div className="cost-tile span2">
              <div className="cost-label">CLOSING PRICE EDGE VS PINNACLE CLOSE</div>
              <div className="cost-value">{cpe.value}</div>
              <div className="cost-note">{cpe.note}</div>
            </div>
          </div>

          <h3 className="adv-section-head">LIMITS REPORTED — SENT TO MODEL</h3>
          <div className="limits-box">
            <div className="limits-head">LIMITS REPORTED — SENT TO MODEL</div>
            {adv.limits.length === 0 && <div className="limits-row"><span>NO REPORTS YET</span></div>}
            {adv.limits.map((l, i) => {
              const row = limitRow(l);
              return (
                <div className="limits-row" key={i}>
                  <span>{row.left}</span>
                  <span className="limits-right">{row.right}</span>
                </div>
              );
            })}
          </div>

          <div className="opp-box">
            <div className="opp-head">
              OPPORTUNITY LEADERBOARDS — SINCE {adv.opportunities.since === '' ? '—' : adv.opportunities.since}
              <span className="opp-toggle">
                <button className={`opp-chip${sort === 'COUNT' ? ' active' : ''}`} onClick={() => setSort('COUNT')}>
                  COUNT
                </button>
                <button className={`opp-chip${sort === 'EDGE' ? ' active' : ''}`} onClick={() => setSort('EDGE')}>
                  MARGIN / EDGE
                </button>
              </span>
            </div>
            <div className="opp-grid">
              <OppColumn title="ARB" metric="AVG MARGIN" rows={adv.opportunities.arb} sort={sort} open={oppOpen} />
              <OppColumn title="EV" metric="AVG EDGE" rows={adv.opportunities.ev} sort={sort} open={oppOpen} />
              <OppColumn title="MIDDLES" metric="AVG EDGE" rows={adv.opportunities.middles} sort={sort} open={oppOpen} />
            </div>
            <button className="see-all" onClick={() => setOppOpen((v) => !v)}>{oppToggle(oppOpen)}</button>
          </div>
        </>
      )}
      <button className={`cta cta-blue${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        ADVANCED ANALYTICS
      </button>
      <div className="cta-caption">BOOKS THAT LIMITED YOU — LOGGED AND SENT TO THE MODEL</div>
    </>
  );
}
```

(Adopt Plan 2's exact CTA caption class name if it differs from `.cta-caption` — reuse, don't duplicate. The opportunity header renders the raw `since` day-key restyled? No: keep `SINCE {formatDateCaps(...)}` — replace the plain interpolation with `formatDateCaps(adv.opportunities.since)` when non-empty, import it; the leaderboards chip likewise renders `formatDateCaps(since)`. Both dates arrive as `YYYY-MM-DD` day keys.)

Concretely, the two date renders are:

```tsx
<span className="since-chip">{formatDateCaps(since)} ▾</span>
…
OPPORTUNITY LEADERBOARDS — SINCE {adv.opportunities.since === '' ? '—' : formatDateCaps(adv.opportunities.since)}
```

- [ ] **Step 2: Grow `client/src/screens/AnalyticsScreen.tsx`** — add after `<TimeToActFunnel …/>`:

```tsx
      <AdvancedAnalytics adv={view.advanced} since={view.advanced.leaderboards.since} />
      {view.simulated && (
        <p className="sim-footnote">
          EVERY FIGURE ON THIS PAGE IS SIMULATED PAPER MONEY — A SHADOW POSITION, NOT A LIVE PROMISE.
        </p>
      )}
```

with the import:

```tsx
import { AdvancedAnalytics } from '../components/AdvancedAnalytics';
```

- [ ] **Step 3: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then dev servers up, ANALYTICS tab:
- Blue `ADVANCED ANALYTICS` CTA at the bottom with its caption; clicking greys it (`#6a6a6a`) and reveals the five sections ABOVE it in order: OPEN BETS, LEADERBOARDS, COST OF SAFETY, LIMITS REPORTED — SENT TO MODEL, OPPORTUNITY LEADERBOARDS.
- Confirm a trade on TRADES → OPEN BETS grows a row (`… · $100` style) with `STARTS h:mm PM`.
- Report a limit (TRADE LIMITED?) → the LIMITS box prepends `JUL 14 · {Book} · {SPORT} — {event} | MAX $25`.
- COST OF SAFETY: `CLOSING PRICE EDGE VS PINNACLE CLOSE` (never "CLV"); empty tiles show `—` with their NEW-copy notes.
- Opportunity boards fill as scans run; `COUNT`/`MARGIN / EDGE` re-sorts; `SEE ALL →` ↔ `SHOW FEWER ←`.
- Sim footnote centered at the very bottom, verbatim.
Stop the dev servers.

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat(client): advanced analytics sections and sim-mode footnote"
```

---

### Task 10: Forbidden-words sweep, full suite, end-to-end smoke

**Files:** none created — verification only (fix anything the sweeps catch).

- [ ] **Step 1: Forbidden-words sweep**

Run: `grep -rniE 'append-only|ghost|picker|grader|gatekeeper|CLV' server/src client/src`
Expected: **no output** (exit code 1). Any hit is a bug — fix before proceeding. (The renamed closing-price tile is the likely regression site.)

- [ ] **Step 2: Full-suite run**

Run: `npm test && npm run typecheck`
Expected: server suite + client suite all pass; both typechecks clean.

- [ ] **Step 3: End-to-end smoke (manual, real processes)**

Terminal A: `npm run dev` (4400). Terminal B: `npm run dev:client` (5174). Then:
1. Open http://localhost:5174 → ANALYTICS. Fund box shows the seeded profile; charts render flat honest zeros on a fresh db.
2. `curl -s -X POST localhost:4400/api/scan`, wait ~80 s; TRADES tab → confirm one verified card, leave another to expire.
3. `curl -s 'localhost:4400/api/analytics?range=MAX' | python3 -m json.tool | head -40` — `monthly[0]` counts move; `funnel.total` ≥ 1; two consecutive curls byte-identical (shadow determinism).
4. Create a profile (`LEA` / `$5,000`) → dropdown gains it, fund box follows, its charts flatline at $0 profit — honest.
5. Report a TRADE LIMITED? on a verified card → ADVANCED ANALYTICS → LIMITS REPORTED shows the row with the display-name book.
6. `curl -s localhost:4400/api/analytics | grep -icE 'append-only|ghost|picker|grader|gatekeeper|CLV'` → `0`.
7. Kill the server → ANALYTICS degrades to the single offline note; restart → recovers on the next poll.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(analytics): smoke-test findings"
```

---

## Self-Review Notes (done at planning time)

- **Spec coverage (Plan-4 scope):** MASTER PROMPT §4 ANALYTICS fully mapped — profile box/dropdown/add form (T4/T6), fund box (T6), range chips (T6), the two charts with stats + returns footnote (T2/T5/T7), monthly table (T3/T8), TIME TO ACT funnel (T1/T3/T8), ADVANCED ANALYTICS: OPEN BETS / LEADERBOARDS / COST OF SAFETY / LIMITS REPORTED / OPPORTUNITY LEADERBOARDS (T3/T4/T9), sim footnote (T9). `bankroll_snapshots` drives chart 1 per MASTER PROMPT §5 (corrected to confirmed money, T1).
- **Copy fidelity:** every §4 label/prose string is verbatim (including `–` U+2013 in `2–5 MIN`, `Σ` in the rounding note, `▾` chips, unpadded chart dates like `JUL 5`). NEW copy, all flagged where they appear: `ANALYTICS OFFLINE — SERVER UNREACHABLE`, `CONFIRMED > 10 MIN`, `LIVE` (no quarter), `NO OPEN BETS`, `NO REPORTS YET`, `NO GATE KILLS YET`, `NO DATA YET`, `NO CONFIRMED PAIRS YET`, `NO RECHECKS YET`, `NO CLOSES CAPTURED YET`, `SHOW FEWER ←`. Dynamic numbers replace demo literals per the derived-data rule (Plan 2 note 16m / Plan 3 §12 precedent).
- **Discrepancies resolved:** mockup `CLV VS PINNACLE CLOSE` → `CLOSING PRICE EDGE VS PINNACLE CLOSE` (rule 6 wins; inventory §8.1); the retention note's `PROMOTION THRESHOLD 80%` demo contradiction → dynamic `100 − tolerancePct` (inventory §8.2); static demo charts → live series with a deterministic nice-scale reproducing the mockup's exact $0–$600 geometry at those values (T5 test pins it); `LIVE — Q2` → `LIVE`; the mockup's static since-chip stays non-interactive but renders live data (Decision note 12).
- **Type consistency:** `AnalyticsTradeRow` defined once in repos.ts, consumed by series/rollups/report; `AnalyticsView` defined in report.ts and mirrored (not imported — separate workspaces) in client lib/analytics.ts; `RangeKey` defined server-side in series.ts, mirrored client-side; every client class used in T7–T9 exists in T6's frozen list; `Trade.confirmedAt` is optional so every existing fixture compiles unchanged.
- **Contract consistency:** no changes to any existing endpoint's response shape; the ONLY behavioral changes to existing code are `confirmTrade`/`unconfirmTrade` stamping (their transition semantics are untouched — no existing test asserts `confirmedAt`) and `writeDailySnapshot` (no existing test pins its formula; api.test's `byProfile(1).length === 1` still holds). `simOutcome` gains only an `export` keyword.
- **Determinism audit:** the shadow chart never consumes the shared `deps.rng` (per-trade `fnv1a32` seeds), never writes, and is pinned byte-identical across polls by an API test; `dayAxis` dedupes DST double-days and hard-stops at 4000 days; sorts break ties deterministically (count → avg → name).
- **Deferred ambiguities (deliberate, documented):** (1) UNCONFIRMED stays an honest zero column until Plan 6's no-reply flow creates the status; the funnel and chart 2 already handle it. (2) Pre-migration settled rows lack `confirmed_at` (no backfill — Decision note 2). (3) Trade→profile attribution stays "everything is profile 1" until a future active-profile knob (Design §10). (4) The leaderboards since-chip is display-only (Decision note 12). (5) `AnalyticsView.simulated` is hardcoded `true` until Plan 6 wires live mode.
- **Placeholder scan:** no TBD/TODO/"similar to task N"/"adapt as needed" anywhere; every code step is complete file content or an exact old→new replacement; commands carry expected outputs.





