# Evil Eye V2 — Plan 1: Simulated Core Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless Evil Eye V2 server that runs the full pipeline end-to-end in SIMULATED mode with zero API keys: scheduled scans generate candidates, the kill battery filters them, the 75s double-verification promotes survivors with exact stakes, sim WhatsApp "sends" are logged, trades confirm/settle, and everything persists to SQLite — all observable via a small Express API.

**Architecture:** Pure engine functions (no I/O) under `server/src/engine/`; SQLite (better-sqlite3, synchronous) behind small repo modules; one scheduler tick with injectable clock/timer (no test ever sleeps); providers behind an `OddsProvider` interface with the sim implementation first. The Express layer only parses/serializes.

**Tech Stack:** Node 20+, TypeScript strict, better-sqlite3, Express 4, Vitest, tsx. No ORM, no DI framework.

## Global Constraints

- Money is **integer cents** everywhere in code and DB; dollars only at display/serialization edges.
- Odds are **decimal** (e.g. `2.10`).
- **One total bankroll** (default $10,000.00 = 1_000_000 cents), never per book. Kelly fraction 0.25, cap 5% of total.
- Stakes: round to nearest $5 (500¢), minimum $10 (1000¢), max 12 verified sends/day.
- Statuses exactly: `PENDING | VERIFIED | CONFIRMED | UNCONFIRMED | EXPIRED | KILLED | SETTLED`.
- Kill reasons exactly: `ONE_SPORT_RULE | HEAT_GATE | SHARP_VELOCITY_CAP | MARKET_BREADTH_CAP | ROUNDING_DESTROYS_MARGIN | QUOTE_STALE | FAILED_VERIFICATION`.
- **No prices/stakes until verification**: `stakeCents` on legs is null until status ≥ VERIFIED.
- Verify gap 75s; line-move tolerance default 5% with promotion rule `recheckEdge ≥ initialEdge / (1 + tolerancePct/100)` (so 100% ⇒ edge may halve — matches DECISIONS.md exactly).
- Quiet hours **00:00–08:00 America/Vancouver**, DST-safe via `Intl` (never a fixed UTC offset): no scans, no rechecks, no sends.
- Scan cadence: base 20 min; 5–8 min (rng in range) when any tracked event starts < 2h from now.
- FRESH window 120s from verification; VERIFIED-and-stale trades auto-EXPIRE after `staleRemoveMin` (default 10).
- One sport per book; book `pinnacle` is `sharp_exempt` (any sport, no heat gate).
- Thresholds: min arb margin 0.75%, min EV edge 2.0%, middle ratio 1.5×.
- Soccer arbs may have 3 legs (home/draw/away); other sports 2.
- Sim mode must run with **zero env vars**. Never read V1's `.env` in this plan (that's Plan 6).
- Server port **4400**. DB file `server/data/evil-eye.db` (gitignored); tests use `:memory:`.
- Never render the words "append-only", "ghost", "picker", "grader", "CLV", "gatekeeper" in any string the API returns.
- TDD every task; commit after every task.

## Interface Contracts (referenced by all tasks)

```ts
// shared/types.ts — the single source of truth
export type Strategy = 'ARB' | 'MIDDLE' | 'EV';
export type TradeStatus = 'PENDING' | 'VERIFIED' | 'CONFIRMED' | 'UNCONFIRMED' | 'EXPIRED' | 'KILLED' | 'SETTLED';
export type KillReason = 'ONE_SPORT_RULE' | 'HEAT_GATE' | 'SHARP_VELOCITY_CAP' | 'MARKET_BREADTH_CAP' | 'ROUNDING_DESTROYS_MARGIN' | 'QUOTE_STALE' | 'FAILED_VERIFICATION';
export interface Leg { book: string; selection: string; odds: number; stakeCents: number | null; }
export interface Trade {
  id: string; profileId: number; category: Strategy; event: string; sport: string;
  legs: Leg[]; marginInitial: number; marginRecheck: number | null; marginFinal: number | null;
  status: TradeStatus; killReason: KillReason | null; resultCents: number | null;
  createdAt: number; verifyDueAt: number; verifiedAt: number | null; freshUntil: number | null;
  settledAt: number | null; eventStartsAt: number;
}
export interface Quote { book: string; sport: string; event: string; market: string;
  selection: string; odds: number; line: number | null; fetchedAt: number; eventStartsAt: number; }
export interface OddsProvider { fetchQuotes(now: number): Quote[]; }
export interface AlertSender { sendVerified(trade: Trade): void; } // sim: events_log row
```

Margins/edges are **fractions** (0.012 = 1.2%) inside the engine; formatted to % only at the API edge.

---

### Task 1: Repo scaffold + toolchain

**Files:**
- Create: `package.json` (root, workspaces `["server"]`), `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `.gitignore`, `server/src/smoke.test.ts`

**Interfaces:** Produces the build/test commands every later task runs: `npm test`, `npm run typecheck`, `npm run dev` (all from repo root).

- [ ] **Step 1: Write the scaffold**

Root `package.json`:
```json
{
  "name": "evil-eye-v2", "private": true, "workspaces": ["server"],
  "scripts": {
    "test": "npm run test -w server",
    "typecheck": "npm run typecheck -w server",
    "dev": "npm run dev -w server"
  }
}
```
`server/package.json`:
```json
{
  "name": "server", "private": true, "type": "module",
  "scripts": {
    "test": "vitest run", "typecheck": "tsc --noEmit",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": { "better-sqlite3": "^11.0.0", "express": "^4.19.0" },
  "devDependencies": { "@types/better-sqlite3": "^7.6.0", "@types/express": "^4.17.0",
    "@types/node": "^20.0.0", "@types/supertest": "^6.0.0", "supertest": "^7.0.0",
    "tsx": "^4.0.0", "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```
`server/tsconfig.json`: `strict: true`, `module: "NodeNext"`, `target: "ES2022"`, `noUncheckedIndexedAccess: true`, include `src`.
`.gitignore`: `node_modules/`, `server/data/`, `*.log`.
`server/src/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('toolchain runs', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 2: Install and verify**

Run: `cd ~/evil-eye-v2 && npm install && npm test && npm run typecheck`
Expected: 1 test passes; tsc clean.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "chore: scaffold V2 server workspace (TS strict + vitest + better-sqlite3)"`

---

### Task 2: Shared types + default settings

**Files:**
- Create: `server/src/shared/types.ts` (the Interface Contracts block above, verbatim), `server/src/shared/defaults.ts`, `server/src/shared/defaults.test.ts`

**Interfaces:** Produces `DEFAULT_SETTINGS` consumed by the settings repo (Task 3) and every engine function.

- [ ] **Step 1: Failing test**
```ts
import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
test('locked defaults match MASTER PROMPT', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    tolerancePct: 5, verifyGapSecs: 75, staleRemoveMin: 10, freshWindowSecs: 120,
    minArbMarginPct: 0.75, minEvEdgePct: 2.0, middleRatio: 1.5,
    kellyFraction: 0.25, kellyCapPct: 5, bankrollCents: 1_000_000,
    flatPairCents: 10_000, roundToCents: 500, minStakeCents: 1_000, dailyPickCap: 12,
    quietStartHour: 0, quietEndHour: 8, scanBaseMin: 20, scanHotMinMin: 5,
    scanHotMaxMin: 8, hotWindowHours: 2, sharpVelocityPerDayPerBook: 3,
    marketBreadthPerWeekPerBook: 2, goGentleHeat: 30, stopHeat: 60,
  });
});
```
- [ ] **Step 2: Run** `npm test -- defaults` — Expected: FAIL (module missing)
- [ ] **Step 3: Implement** `types.ts` verbatim from contracts; `defaults.ts` exporting exactly the object above as `const DEFAULT_SETTINGS` with an exported `Settings` type (`typeof DEFAULT_SETTINGS`).
- [ ] **Step 4: Run** `npm test` — Expected: PASS
- [ ] **Step 5: Commit** — `feat: shared types and locked default settings`

---

### Task 3: SQLite schema, migration-on-open, repos

**Files:**
- Create: `server/src/db/schema.sql`, `server/src/db/db.ts`, `server/src/db/repos.ts`, `server/src/db/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Db` (runs schema idempotently; seeds on first open); `Repos(db)` returning `{ trades, settings, books, journal, eventsLog, credits, snapshots, profiles, limitsReports }`.
- Key methods later tasks call:
  `trades.insert(t: Trade): void` · `trades.update(t: Trade): void` · `trades.byId(id): Trade | null` · `trades.byStatus(s: TradeStatus): Trade[]` · `trades.verifiedSentToday(dayKey: string): number` · `trades.countByBookToday(book, dayKey): number` · `trades.countByBookMarketSince(book, market, sinceMs): number`
  `settings.all(): Settings` · `settings.set(patch: Partial<Settings>): Settings`
  `books.all(): Book[]` · `books.byName(n): Book | null` (`Book = { name, sport, sharpExempt: 0|1, heat, health, maxBeliefCents }`)
  `journal.add(ts, text)` · `eventsLog.add(ts, kind, payloadJson)` · `credits.add(ts, n)` · `snapshots.writeDaily(profileId, dayKey, bankrollCents)` · `profiles.all()/create(name, startingCashCents, createdDate)`
- `schema.sql` tables exactly per MASTER PROMPT §5: `profiles, books, trades, limits_reports, journal, events_log, settings, credits_usage, bankroll_snapshots` (settings as k/v JSON; trades.legs as JSON column; all money columns `*_cents INTEGER`).

- [ ] **Step 1: Failing test** — `db.test.ts`:
```ts
import { expect, test } from 'vitest';
import { openDb, Repos } from './db';
test('opens in-memory db, seeds defaults, round-trips a trade', () => {
  const r = Repos(openDb(':memory:'));
  expect(r.settings.all().tolerancePct).toBe(5);
  expect(r.books.all().length).toBe(16);
  expect(r.books.byName('pinnacle')?.sharpExempt).toBe(1);
  expect(r.profiles.all()[0]?.name).toBe('RYAN');
  const t: Trade = { id: 't1', profileId: 1, category: 'ARB', event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'A ML', odds: 2.1, stakeCents: null }],
    marginInitial: 0.012, marginRecheck: null, marginFinal: null, status: 'PENDING',
    killReason: null, resultCents: null, createdAt: 1000, verifyDueAt: 76_000,
    verifiedAt: null, freshUntil: null, settledAt: null, eventStartsAt: 9_999_999 };
  r.trades.insert(t);
  expect(r.trades.byId('t1')).toEqual(t);
  expect(r.trades.byStatus('PENDING')).toHaveLength(1);
});
test('opening twice is idempotent', () => {
  const db = openDb(':memory:'); Repos(db); Repos(db); // no throw
});
```
- [ ] **Step 2: Run** — Expected: FAIL (module missing)
- [ ] **Step 3: Implement** — `schema.sql` with `CREATE TABLE IF NOT EXISTS` for all nine tables; `openDb` executes it, then seeds iff empty: settings = `DEFAULT_SETTINGS` (k/v rows), profile `RYAN` starting_cash_cents 1_000_000 created_date today, and these 16 books (name/sport, heat 0, health `green`): pinnacle/ANY(sharp_exempt=1), bet365/basketball, fanduel/basketball, draftkings/baseball, betmgm/baseball, caesars/hockey, bet99/hockey, sportsinteraction/soccer, betway/soccer, pointsbet/basketball, bwin/soccer, unibet/tennis, bodog/tennis, betvictor/soccer, leovegas/hockey, betrivers/baseball. Repos = thin prepared-statement wrappers, JSON (de)serialization for legs/settings only.
- [ ] **Step 4: Run** `npm test` — Expected: PASS
- [ ] **Step 5: Commit** — `feat: sqlite schema, seed data, repositories`

---

### Task 4: Odds math (de-vig, arb margin, EV edge, middle metrics)

**Files:**
- Create: `server/src/engine/odds.ts`, `server/src/engine/odds.test.ts`

**Interfaces:** Produces pure functions (all fractions, not %):
`devigFairProbs(odds: number[]): number[]` · `arbMargin(odds: number[]): number` · `evEdge(fairProb: number, odds: number): number` · `middleMetrics(oddsA: number, oddsB: number): { sumInv: number; costFrac: number; bothWinPayoutFrac: number; ratio: number; free: boolean }`

- [ ] **Step 1: Failing tests**
```ts
import { expect, test } from 'vitest';
import { arbMargin, devigFairProbs, evEdge, middleMetrics } from './odds';
test('devig: multiplicative normalization of implied probs', () => {
  const [p1, p2] = devigFairProbs([1.9, 1.9]);
  expect(p1).toBeCloseTo(0.5, 10); expect(p2).toBeCloseTo(0.5, 10);
  const probs = devigFairProbs([2.5, 3.4, 2.9]);
  expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
});
test('arbMargin = 1 - sum(1/odds); positive means guaranteed profit', () => {
  expect(arbMargin([2.1, 2.1])).toBeCloseTo(1 - (1/2.1 + 1/2.1), 12); // ≈ +4.76%
  expect(arbMargin([1.9, 1.9])).toBeLessThan(0);
  expect(arbMargin([3.2, 3.6, 3.1])).toBeCloseTo(1 - (1/3.2 + 1/3.6 + 1/3.1), 12); // 3-leg soccer
});
test('evEdge = fairProb*odds - 1', () => {
  expect(evEdge(0.5, 2.2)).toBeCloseTo(0.10, 12);
  expect(evEdge(0.4, 2.4)).toBeCloseTo(-0.04, 12);
});
test('middleMetrics: cost, both-win payout, ratio, free flag', () => {
  const m = middleMetrics(2.0, 2.1); // S = 0.97619 → free middle
  expect(m.free).toBe(true);
  const c = middleMetrics(1.9, 1.95); // S = 1.0391
  expect(c.free).toBe(false);
  expect(c.costFrac).toBeCloseTo(c.sumInv - 1, 12);
  expect(c.bothWinPayoutFrac).toBeCloseTo(2 / c.sumInv - 1, 12);
  expect(c.ratio).toBeCloseTo(c.bothWinPayoutFrac / c.costFrac, 12);
});
```
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** exactly those formulas (`sumInv = Σ 1/odds`; `free = sumInv <= 1`; for free middles `ratio = Infinity`, `costFrac = sumInv - 1` (≤ 0)).
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: engine odds math (devig, arb margin, ev edge, middle metrics)`

**Note (locked interpretation):** "middle 1.5×" qualifies a costed middle when `ratio ≥ settings.middleRatio`; free middles always qualify. This is deliberately permissive — the kill battery and double verification do the real filtering. The formula lives ONLY here. Design-inventory finding (2026-07-14): the mockup contains NO middle formula (demo numbers hardcoded); its settings copy is "MIN MIDDLE QUALITY: 1.5× BREAKEVEN HIT RATE", where breakeven hit rate = costFrac / bothWinPayoutFrac — so `ratio ≥ 1.5` is equivalent to "breakeven ≤ 1/1.5". The interpretation stands.

---

### Task 5: Staking (Kelly, arb split, rounding)

**Files:**
- Create: `server/src/engine/stakes.ts`, `server/src/engine/stakes.test.ts`

**Interfaces:** Produces:
`roundStake(cents: number, s: Settings): number` (nearest `roundToCents`; result < `minStakeCents` → `minStakeCents`)
`kellyStakeCents(fairProb: number, odds: number, s: Settings): number` (quarter-Kelly vs TOTAL bankroll, capped at `kellyCapPct`% of bankroll, then rounded)
`arbStakesCents(odds: number[], s: Settings): { stakes: number[]; roundedMargin: number }` (equal-payout split of the flat pair total `flatPairCents` scaled so no stake exceeds cap; stakes rounded; `roundedMargin` recomputed from ROUNDED stakes = `(minPayout - totalStaked) / totalStaked`)

- [ ] **Step 1: Failing tests**
```ts
import { expect, test } from 'vitest';
import { arbStakesCents, kellyStakeCents, roundStake } from './stakes';
import { DEFAULT_SETTINGS as S } from '../shared/defaults';
test('rounding: nearest $5, min $10', () => {
  expect(roundStake(3720, S)).toBe(3500);
  expect(roundStake(3760, S)).toBe(4000);
  expect(roundStake(300, S)).toBe(1000);
});
test('kelly: f* = (p·o − 1)/(o − 1), quarter, capped 5% of total, rounded', () => {
  // p=0.55 o=2.0 → f*=0.10 → quarter=0.025 → $250 → rounded $250
  expect(kellyStakeCents(0.55, 2.0, S)).toBe(25_000);
  // huge edge hits the 5% cap → $500
  expect(kellyStakeCents(0.9, 3.0, S)).toBe(50_000);
});
test('arb split: equal payout, margin survives rounding on a fat arb', () => {
  const { stakes, roundedMargin } = arbStakesCents([2.1, 2.1], S);
  expect(stakes[0]).toBe(stakes[1]);
  expect(stakes[0]! % 500).toBe(0);
  expect(roundedMargin).toBeGreaterThan(0);
});
test('arb split: 3-leg soccer', () => {
  const { stakes } = arbStakesCents([3.2, 3.6, 3.1], S);
  expect(stakes).toHaveLength(3);
  const payouts = stakes.map((st, i) => st! * [3.2, 3.6, 3.1][i]!);
  const spread = Math.max(...payouts) - Math.min(...payouts);
  expect(spread / Math.min(...payouts)).toBeLessThan(0.15); // rounding-limited equality
});
```
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** — Kelly `f* = (p·o − 1)/(o − 1)`; **if `f* ≤ 0` return 0 — "no stake" is not a stake, so the min-$10 floor does not apply** (amended 2026-07-14 after review; pin with `expect(kellyStakeCents(0.4, 2.0, S)).toBe(0)`); else × `kellyFraction`, cap `kellyCapPct/100 × bankrollCents`, round. Arb: leg i gets `total × (1/oᵢ)/Σ(1/o)` with `total = flatPairCents` (2-leg) or `flatPairCents × 1.5` (3-leg), each leg capped/rounded, margin recomputed from rounded stakes.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: staking (quarter-kelly vs total bankroll, arb split, $5 rounding)`

---

### Task 6: Line-move tolerance gate

**Files:**
- Create: `server/src/engine/tolerance.ts`, `server/src/engine/tolerance.test.ts`

**Interfaces:** Produces `passesToleranceGate(initialEdge: number, recheckEdge: number, tolerancePct: number): boolean` with rule `recheckEdge ≥ initialEdge / (1 + tolerancePct/100)`.

- [ ] **Step 1: Failing tests** (acceptance cases straight from DECISIONS.md)
```ts
import { expect, test } from 'vitest';
import { passesToleranceGate } from './tolerance';
test('5% default: small weakening passes, big weakening fails', () => {
  expect(passesToleranceGate(0.0100, 0.0096, 5)).toBe(true);  // −4% relative
  expect(passesToleranceGate(0.0100, 0.0094, 5)).toBe(false); // −6% relative
});
test('100% ⇒ edge may get up to twice as weak (halve), not more', () => {
  expect(passesToleranceGate(0.0100, 0.0050, 100)).toBe(true);
  expect(passesToleranceGate(0.0100, 0.0049, 100)).toBe(false);
});
test('0% ⇒ no weakening allowed; improvement always passes', () => {
  expect(passesToleranceGate(0.0100, 0.0099, 0)).toBe(false);
  expect(passesToleranceGate(0.0100, 0.0130, 0)).toBe(true);
});
```
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** (one line) → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: line-move tolerance gate (1/(1+tol) rule per DECISIONS)`

---

### Task 7: Kill battery

**Files:**
- Create: `server/src/engine/gates.ts`, `server/src/engine/gates.test.ts`

**Interfaces:**
- Consumes: `Book`, `Settings`, `arbStakesCents`/`kellyStakeCents` (for ROUNDING_DESTROYS_MARGIN).
- Produces: `runKillBattery(c: Candidate, ctx: GateContext): { verdict: 'pass' } | { verdict: 'kill'; reason: KillReason }` where
```ts
interface Candidate { category: Strategy; sport: string; event: string; market: string;
  legs: { book: string; selection: string; odds: number; fetchedAt: number }[];
  edge: number; fairProbs: number[] | null; eventStartsAt: number; }
interface GateContext { now: number; books: Map<string, Book>; s: Settings;
  sentTodayByBook(book: string): number; sentThisWeekByBookMarket(book: string, market: string): number; }
```
Gate order (first failure wins, matching pipeline §3): ONE_SPORT_RULE → HEAT_GATE → SHARP_VELOCITY_CAP → MARKET_BREADTH_CAP → ROUNDING_DESTROYS_MARGIN → QUOTE_STALE.

- [ ] **Step 1: Failing tests** — one per gate, plus pass-through and sharp exemption:
```ts
// helpers: mkCtx() builds books map {bet365: basketball heat 0, pinnacle: ANY sharp, fanduel: basketball heat 70}
test('ONE_SPORT_RULE: leg on a book assigned another sport → kill', ...);      // bet365 + sport 'soccer'
test('pinnacle is exempt from ONE_SPORT_RULE and HEAT_GATE', ...);             // pinnacle any sport, heat 99 → pass
test('HEAT_GATE: any non-exempt leg book heat ≥ stopHeat(60) → kill', ...);    // fanduel heat 70
test('SHARP_VELOCITY_CAP: sentTodayByBook ≥ 3 → kill', ...);
test('MARKET_BREADTH_CAP: sentThisWeekByBookMarket ≥ 2 → kill', ...);
test('ROUNDING_DESTROYS_MARGIN: thin ARB whose rounded-stake margin ≤ 0 → kill', ...); // odds [1.98, 2.035] margin ≈ +0.36% pre-rounding
test('QUOTE_STALE: any leg fetchedAt older than freshWindowSecs → kill', ...);
test('clean candidate passes', ...);
```
Write these as real vitest tests with the concrete numbers shown; assert the exact `reason` string for each kill.
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** gates in the exact order above; ROUNDING gate: ARB only — compute `arbStakesCents(legOdds, s).roundedMargin ≤ 0`.
- [ ] **Step 4: Run** — PASS → **Step 5: Commit** — `feat: kill battery (six gates, ordered, sharp-exempt aware)`

---

### Task 8: Vancouver clock + scheduler planner

**Files:**
- Create: `server/src/scheduler/vancouverTime.ts`, `server/src/scheduler/plan.ts`, tests for both.

**Interfaces:** Produces:
`isQuietHours(epochMs: number, s: Settings): boolean` (00:00–08:00 America/Vancouver via `Intl.DateTimeFormat` parts) · `nextQuietEnd(epochMs: number): number` · `dayKey(epochMs): string` ("YYYY-MM-DD" Vancouver-local)
`planNext(st: PlanState, now: number, s: Settings, rng: () => number): PlanAction` where
```ts
interface PlanState { lastScanAt: number | null; pendingVerifyDueAts: number[]; anyEventWithinHotWindow: boolean; }
type PlanAction = { kind: 'scan'; at: number } | { kind: 'verify'; at: number } | { kind: 'sleepUntil'; at: number };
```
Rules: quiet hours ⇒ `sleepUntil nextQuietEnd`; else earliest of (due verify recheck) and (next scan = lastScan + cadence, cadence = 20min base, or 5–8min via rng when `anyEventWithinHotWindow`); verify wins ties.

- [ ] **Step 1: Failing tests** — pin: a 03:00 Vancouver timestamp is quiet and sleeps to 08:00 exactly (compute both instants IN THE TEST with Intl, don't hardcode UTC offsets); verify due beats scan; hot window uses rng∈[5,8] min (`rng: () => 0` ⇒ 5min, `() => 0.999` ⇒ ~8min); dayKey rolls at Vancouver midnight not UTC.
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: DST-safe vancouver clock and pure scheduler planner`

---

### Task 9: Sim odds provider

**Files:**
- Create: `server/src/providers/simOdds.ts`, `server/src/providers/simOdds.test.ts`

**Interfaces:** Produces `SimOddsProvider(rng: () => number): OddsProvider`. Each `fetchQuotes(now)` emits quotes for ~10 events across the seeded books' sports, always including `pinnacle` benchmark quotes per event, with event starts spread 30min–48h out, and — crucially — *plants* opportunities so the pipeline always has work: per fetch, roughly 2 arbs (one a 3-leg soccer home/draw/away arb), 2 EV spots (soft book price above pinnacle fair), 1 middle pair. Quotes drift ±2% between consecutive fetches so verification sometimes fails naturally.

- [ ] **Step 1: Failing tests**
```ts
test('deterministic under a seed', ...);            // same seeded rng twice → identical quotes
test('every event has pinnacle quotes', ...);
test('plants at least one 3-leg soccer arb (margin > 0.75% after devig check)', ...);
test('consecutive fetches drift but keep event identity', ...);
```
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** (deterministic event names like `SIM-EVT-<n>`; odds derived from rng; arb planting = pick fair probs then quote each side slightly above fair across two books) → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: sim odds provider planting arbs, EVs and middles`

---

### Task 10: Candidate detection

**Files:**
- Create: `server/src/pipeline/candidates.ts`, `server/src/pipeline/candidates.test.ts`

**Interfaces:**
- Consumes: `Quote[]`, odds math (Task 4), `Settings`.
- Produces: `detectCandidates(quotes: Quote[], s: Settings): Candidate[]` — groups quotes by event+market+line; ARB = best odds per outcome across books, `arbMargin ≥ minArbMarginPct/100` (2-outcome, or 3-outcome for soccer h2h); EV = soft-book odds vs pinnacle devig `fairProb`, `evEdge ≥ minEvEdgePct/100` (pinnacle must quote BOTH sides of the same line — else no fair prob, no candidate); MIDDLE = opposite selections on different lines, `middleMetrics` qualification (Task 4 note). Line groups are sacred: outcomes only combine within the same |line| for ARB; middles REQUIRE different lines by construction. `edge` = margin (ARB) / evEdge (EV) / `bothWinPayoutFrac − max(costFrac, 0)` (MIDDLE, used only for tolerance comparison).

- [ ] **Step 1: Failing tests** — hand-built quote fixtures: a clean 2-leg arb detected with best-price legs; a 3-leg soccer arb; same-line-only grouping (over 220.5 never pairs with under 219.5 for ARB); EV found only when pinnacle quotes both sides; middle detected across different lines; sub-threshold everything → `[]`.
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: candidate detection (arb/ev/middle, line-group discipline)`

---

### Task 11: Scan + verify pipeline (the core loop)

**Files:**
- Create: `server/src/pipeline/scan.ts`, `server/src/pipeline/verify.ts`, `server/src/pipeline/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
`runScan(deps: PipeDeps, now: number): { created: number; killed: number }` — fetch quotes → detect → kill battery → surviving candidates become PENDING trades (`verifyDueAt = now + verifyGapSecs·1000`, legs WITHOUT stakes) → `credits.add`, `eventsLog.add('scan', …)`. Also: quotes cached on deps for the recheck.
`runVerifyDue(deps: PipeDeps, now: number): { promoted: number; killed: number; expired: number }` — for every PENDING with `verifyDueAt ≤ now`: refetch (sim: provider called again), recompute edge for the SAME legs; missing quote → KILLED `QUOTE_STALE`; tolerance gate fail → KILLED `FAILED_VERIFICATION`; pass → stakes computed (ARB split / Kelly for EV+MIDDLE), dailyPickCap check (cap reached → EXPIRED + journal "held back"), status VERIFIED, `verifiedAt=now`, `freshUntil=now+freshWindowSecs·1000`, `marginFinal` set, `AlertSender.sendVerified` fired (sim sender → events_log). ALSO sweeps: VERIFIED trades older than `staleRemoveMin` past `freshUntil` → EXPIRED; PENDING trades whose event started → EXPIRED.
`PipeDeps = { repos: Repos; provider: OddsProvider; sender: AlertSender; s(): Settings; rng: () => number }`

- [ ] **Step 1: Failing tests** — in-memory db + seeded sim provider + fake now; assertions:
```ts
test('scan creates PENDING trades with null stakes and 75s verifyDueAt', ...);
test('verify: edge held → VERIFIED with rounded stakes, fresh window, alert logged', ...);
test('verify: edge collapsed beyond tolerance → KILLED FAILED_VERIFICATION', ...); // force by monkeypatching provider drift
test('daily pick cap: 13th promotion of the day → EXPIRED, journal notes held back', ...);
test('stale sweep: VERIFIED past freshUntil+10min → EXPIRED', ...);
test('no stakes ever appear on PENDING serializations', ...);
```
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: scan + double-verification pipeline with stake computation and alerts`

---

### Task 12: Trade actions + sim settlement

**Files:**
- Create: `server/src/pipeline/actions.ts`, `server/src/pipeline/actions.test.ts`

**Interfaces:** Produces:
`confirmTrade(repos, id, now)` (VERIFIED→CONFIRMED) · `unconfirmTrade(repos, id, now)` (CONFIRMED→VERIFIED; the UI cycle) · `reportLimited(repos, id, book, maxAllowedCents, now)` (writes `limits_reports`, journal entry; trade stays in its status) · `settleTrade(repos, id, result: 'WON'|'LOST', amountCents, now)` (CONFIRMED/UNCONFIRMED→SETTLED, `resultCents` signed) · `runSimSettlement(deps, now)` — sim only: CONFIRMED/UNCONFIRMED trades whose `eventStartsAt + 3h < now` auto-settle via rng (ARB always WON with `resultCents = round(totalStaked × marginFinal)`; EV/MIDDLE win with prob 0.55/0.30, amounts from odds and stakes); CONFIRMED-check: VERIFIED trades never settle (they expire via Task 11's sweep). Invalid transitions throw `ConflictError` (409 at the API); re-applying the current status is a no-op success (double-taps never error).

- [ ] **Step 1: Failing tests** — each transition, the no-op double-tap, one invalid transition (PENDING→confirm throws), sim settlement of an ARB paying exactly its rounded margin.
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** → **Step 4: Run** — PASS
- [ ] **Step 5: Commit** — `feat: trade actions (confirm cycle, limited reports, settlement)`

---

### Task 13: Scheduler runner + Express API + boot

**Files:**
- Create: `server/src/scheduler/runner.ts`, `server/src/api/routes.ts`, `server/src/index.ts`, `server/src/api/api.test.ts`

**Interfaces:**
- `startScheduler(deps, planDeps, timer: { setTimeout: (fn, ms) => unknown }, clock: () => number)` — single self-rescheduling timeout chain executing `planNext` actions (scan → `runScan`+`runVerifyDue`+`runSimSettlement`+`snapshots.writeDaily`; verify → `runVerifyDue`); injectable timer/clock so tests never sleep. The ONLY real `setTimeout` in the codebase lives in `index.ts`'s timer argument.
- Routes (all JSON; errors `{ error: { code, message } }`, 404 `not_found`, 409 `conflict`, 400 `bad_request`):
  `GET /api/state` → `{ mode: 'SIMULATED', now, nextScanAt, quietHours: boolean, trades: { verified: TradeView[], pending: TradeView[] }, counts: { verifiedToday, killedToday } }` — `TradeView` = Trade plus display fields `marginPct`/`edgePct` (numbers, 2dp) and NO `stakeCents` on legs unless status ≥ VERIFIED.
  `GET /api/trades?view=all|history` → all: every non-settled trade newest-first; history: SETTLED/EXPIRED/KILLED with kill reasons.
  `POST /api/scan` → manual scan (also allowed in sim quiet hours? NO — 503 `quiet_hours`, matching "no scans" absolutism).
  `POST /api/trades/:id/confirm` · `/unconfirm` · `/limited {book, maxAllowedCents}` · `/settle {result, amountCents}`.
  `GET /api/settings` / `PATCH /api/settings` (partial; validates `tolerancePct` ∈ [0,100], steppers positive).
- `index.ts`: opens `server/data/evil-eye.db`, wires `SimOddsProvider(Math.random)`, console+events_log AlertSender, starts Express on **4400** and the scheduler with the real timer. Log line: `Evil Eye V2 — SIMULATED mode — listening on http://localhost:4400`.

- [ ] **Step 1: Failing tests** — supertest against an app wired to `:memory:` + seeded rng + fake clock:
```ts
test('boot → POST /api/scan → pending appear without stakes', ...);
test('advance fake clock 76s → verify runs → GET /api/state shows verified WITH stakes', ...);
test('confirm → unconfirm cycle via API', ...);
test('PATCH settings tolerance 101 → 400', ...);
test('quiet-hours scan → 503 quiet_hours', ...);
test('no response body ever contains the forbidden words', ...); // regex over JSON of every route above
```
- [ ] **Step 2: Run** — FAIL → **Step 3: Implement** → **Step 4: Run** — PASS
- [ ] **Step 4b: End-to-end smoke (manual, real process)**

Run: `npm run dev` then `curl -s localhost:4400/api/state | head -c 400`, `curl -s -X POST localhost:4400/api/scan`, wait ~80s, `curl -s localhost:4400/api/state` — Expected: pending trades appear, then verified trades with `BET`-able stakes; server log shows sim WhatsApp sends.
- [ ] **Step 5: Commit** — `feat: scheduler runner, express api, simulated-mode boot`

---

## Self-Review Notes (done at planning time)

- **Spec coverage (Plan-1 scope):** pipeline §3 fully covered (Tasks 7–13); §2 rules 1,2,4,5,7,9 + thresholds covered; §5 schema covered (Task 3); §6 sim-side covered (sim provider, sim sender, credits table). Screens (§4), Brain model detail, analytics aggregation, live integrations are explicitly LATER plans per the roadmap.
- **Type consistency:** `Candidate`/`GateContext` defined once (Task 7) and consumed by Task 10/11; `PipeDeps` defined in Task 11 and consumed by Task 13; settings keys in Task 2 match every consumer.
- **Known deferred ambiguity:** middle qualification formula (Task 4 note) is a locked-but-isolated interpretation pending the design inventory; the seam is one function.
