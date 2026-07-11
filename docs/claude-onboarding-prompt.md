# Prompt: onboard Claude onto Evil Eye Arbitrage

Copy everything below the line into a fresh Claude conversation.

---

You are helping me build **Evil Eye Arbitrage**, a personal sports-betting
arbitrage finder at `~/evil-eye-arbitrage`. Read this whole brief before
answering; it contains the architecture, the current state, the invariants
you must not break, and excerpts of the load-bearing code.

## What it is

One button → scan live odds via The Odds API → show guaranteed-profit stake
splits across bookmakers, with WhatsApp alerts and a mobile "execution
cockpit" page for acting on an alert. Information tool only: it **never
places bets** or touches bookmaker accounts. Single user (me), Canadian
bookmaker focus.

Stack: Express + TypeScript server (`server/`), React 19 + Vite client
(`client/`), shared domain types (`shared/`, zero dependencies, imported by
both sides). Persistence is deliberately JSON files + monthly JSONL
archives (chosen over SQLite) via a crash-safe write-then-rename store with
a serialized update queue (`server/src/lib/jsonStore.ts`).

## Where the build is (July 2026)

Five-phase buildout, one phase per session, design doc committed before
each phase (`docs/superpowers/specs/`):

1. ✅ Bookmaker configuration (per-book enabled/balance/status/notes;
   registry self-populates from each scan's raw feed)
2. ✅ Opportunity persistence (stable fingerprint IDs, lifecycle,
   alerted tracking, raw snapshot per scan)
2.5 ✅ Hardening pass (lifecycle write path + PATCH route, `not_found` /
   `conflict` error codes, detection slice extracted for reuse, client
   tests wired into `npm test`, supertest boundary tests, provider
   401-disambiguation tests)
3. ✅ Execution cockpit (react-router shell; mobile-first
   `/opportunity/:id` with bankroll scaler, per-leg bet tickets,
   re-verify, mark-completed; WhatsApp alerts carry the deep link)
4. ✅ Advanced mode (`/advanced`): presets (static + dynamic All-enabled/
   Funded-only) recomputing the stored raw snapshot via
   `POST /api/advanced/recompute` — zero credits structurally (no
   provider in the dependency graph), never writes records, cockpit
   links only for known record ids.
5. ✅ Ledger + P&L (`/ledger`): completions capture actual filled
   odds/stakes (`execution.lockedProfit` = worst-leg payout − staked;
   unpriced completions counted but never summed), streaming JSONL read
   model, equity/monthly/by-book (stake-weighted)/by-sport/decay/capture
   rate, Excel-safe CSV export. `strategy: 'arb'` discriminator on records.
6. ✅ Paper trading: `alertWorthy` extracted as the one selection core
   (WhatsApp + paper share it), entries at alert-time odds on the
   post-filterAlertable stream, pure lazy settlement at commence time
   (compounding %-staking), ideal + haircut curves — everything labeled
   SIMULATED (`simulated: true` in payloads), own store, reset action.
7. ✅ Fund position: `shared/stakePlanning.ts` planStakes (THE single
   cap-aware stake implementation, used by alert dollars AND cockpit —
   whole-position rescale to the binding book's balance), fund settings
   (bankroll/default stake/unallocated), position panel with low/stale
   balance warnings, apply-to-balances with exact revert.

8. ✅ Evidence instrumentation + peak-cadence ops: per-scan history log
   (`data/scan-history/`, the one new persistence primitive), client-only
   scan windows (weekday/weekend, in/out cadence) with a credit-budget
   projection + hard auto-scan stop at 95%, funded-book feed coverage
   audit, arb survival-at-next-scan + gone-lifetime stats feeding a
   MEASURED paper haircut (qualified at ≥14d + ≥50 samples, else
   ASSUMED), reaction-funnel telemetry (alert → open → verify → fills →
   completed, first-write-wins), and the proving-month scoreboard on the
   Ledger. Everything zero-credit and client-timer-driven.

9. ✅ Speculative Mode phase 9 — benchmark ingestion + de-vig engine:
   Pinnacle rides every fetch as a DUAL-ROLE benchmark (bettability
   unchanged — Ryan's explicit decision; planFetch unions benchmark keys
   with the strictly-cheaper rule on the union, zero marginal credits at
   ≤10 books), coverage audit gains benchmark reach (per-sport
   "speculative detection impossible" flags), and engine/fairProbability
   lands multiplicative de-vig with typed rejections. Nothing consumes
   fair probabilities yet — Phase 10 (EV detection + % EDGE tab) does.

10. ✅ Risk Mode (bright-yellow tab, Ryan's UI direction): EV detection
    rides every scan (edge = fair × odds − 1 with maxOdds/freshness/
    threshold guards), strategy:'ev' records on the shared rails, the
    /risk board sorted by edge, honest opt-in alerts ("Not guaranteed",
    evEnabled default false), single-leg cockpit with WON/LOST/VOID
    grading → realized P&L, EXPECTED (model) ledger line, grade-driven
    apply-to-balances. Yellow = speculative, reserved. Paper stays
    arb-only. Kelly + stochastic models are Phase 11 (next).

12. ✅ Middles (strategy 'middle'): totals/spreads market toggles
    (default OFF, each multiplies scan credits; /api/ops/cost-estimate
    shows the number pre-scan; Ryan chose the plan-upgrade path — flip
    toggles + raise the budget setting when the tier lands), pure
    middles engine with unconstructable reverse pairings and S−1
    breakeven math, MIDDLES segment inside Risk Mode, opt-in honest
    alerts (free middles bypass and may say "guaranteed"), per-leg
    grading → realized P&L → grade-driven apply-to-balances, paper
    FLOOR inclusion with actual-adoption by fingerprint.

The governing specs are **`docs/mission-phases-4-7.md`** (phases 4–7),
the Phase 8 design doc, the Phases 9–11 Speculative Mode mission
(phase 11 — RISK models + Kelly — remains unbuilt), and the Phase 12
middles design doc. Remaining roadmap (CLV, auto-grading, power/Shin
de-vig, live middles, props) deliberately unbuilt.

Health: **181 tests green** (164 server, 17 client — Vitest), `tsc` clean
in both workspaces. `.env` has a live `ODDS_API_KEY`; no `TWILIO_*` vars
yet so WhatsApp runs in dev mode (messages log to the server console).
`DEV_MODE=true` env forces mock odds + console WhatsApp for free testing.

```bash
npm test               # server + client suites, from repo root
npm run typecheck      # tsc for both workspaces
npm run dev:server     # Express :8787 (mock mode without ODDS_API_KEY)
npm run dev:client     # Vite :5173 (proxies /api → :8787)
```

## Layering (strictly one-way)

```
shared/          domain types + region-tab config. Zero imports.
server/src/
  engine/        PURE functions: arb math, filters, credit math. No I/O.
  providers/     OddsProvider interface + TheOddsApi (live) / Mock adapters.
  scan/          scanRequest (validation) · scanService (orchestration) ·
                 detection.ts (reusable filter→detect→links slice) ·
                 scanStore / snapshotStore (JSON persistence)
  bookmakers/    per-book config + fetch-plan credit optimization
  opportunities/ opportunityId (fingerprint = identity) · opportunityLifecycle
                 (pure transitions) · opportunityService · verifyService
                 (cockpit re-verify) · opportunityStore (JSON + JSONL archive)
  notifications/ WhatsApp: alertService (select/dedup/rate-limit/dispatch),
                 twilio-or-console sender, verification, subscription store
  routes/        Express boundary only: parse → service → JSON
  config/        constants.ts (every tunable) + bookmaker homepage fallbacks
client/src/      App.tsx = react-router shell → pages/ScanPage.tsx (dashboard)
                 + pages/CockpitPage.tsx (mobile-first). api.ts is the one
                 typed fetch seam. cockpit.ts = pure display math only.
```

## Invariants — do not break

- The Odds API key and Twilio credentials never leave the server process;
  the client only knows `/api/*`.
- The engine stays pure — no Express/fetch/fs/env inside `engine/`.
- Bookmaker allowlist filtering happens BEFORE arb detection, so no leg
  can point at a book I can't register at.
- **Line groups are sacred**: outcomes only combine within the same
  |point| group (Over/Under 220.5 together; −3.5 with +3.5; never across
  lines). Mixing lines fabricates "arbs" that can lose both legs.
- **Credits are real money**: every odds call costs markets × regions
  credits; anything adding calls/regions must update the usage math.
- Scans are on-demand only — no server-side polling/schedulers, ever
  (client auto-scan drives repetition; alerts piggyback on scans).
- Suspicious/same-book arbs are flagged, never hidden — but never pushed
  to WhatsApp.
- The alert fingerprint hashes event + market + legs but NOT profit/odds —
  that's the debounce AND the record identity (`id` = first 16 hex chars).
- 404s use error code `not_found`, invalid transitions use `conflict`
  (409) — the cockpit distinguishes stale links from validation errors.
- Snapshot addressing (decided): `last-snapshot.json` stays LATEST-ONLY,
  raw/pre-filter. Cockpit re-verify does a fresh legs-only fetch instead;
  snapshot recompute is Phase-4 advanced mode, valid only for events still
  in the latest snapshot. Accepted limitation — don't "fix" it.

## Key code

### shared/types.ts (the domain core, trimmed)

```ts
/** One leg of an arbitrage: the bet to place at one bookmaker. */
export interface ArbLeg {
  outcome: string;
  point?: number;              // the line (−3.5, 220.5); absent for h2h
  bookmakerKey: string;
  bookmakerTitle: string;
  odds: number;                // decimal, best price found
  stake: number;               // suggested stake out of a nominal $100
  link: string | null;
}

export interface ArbOpportunity {
  id?: string;                 // persisted-record id, filled by detection
  eventId: string;
  sportKey: string;
  sportTitle: string;
  eventName: string;
  commenceTime: string;
  marketKey: string;
  arbIndex: number;            // S = Σ 1/best_odds; < 1.0 = guaranteed profit
  profitPct: number;           // (1/S − 1) × 100
  legs: ArbLeg[];
  sameBookmaker: boolean;      // flagged, never hidden, never alerted
  suspicious: boolean;         // > ~15% profit — usually stale odds
}

/** Scans set active/dead; the cockpit sets degraded/completed. */
export type OpportunityStatus = 'active' | 'degraded' | 'dead' | 'completed';

export interface OpportunityRecord {
  id: string;                  // fingerprint.slice(0, 16) — stable, URL-safe
  fingerprint: string;
  // …event/market/legs fields as above, plus:
  profitPctAtDetection: number;
  profitPct: number;           // as of the most recent sighting
  status: OpportunityStatus;
  regionTab: string;           // scopes the dead-by-absence rule
  detectedAt: string;
  lastSeenAt: string;
  statusChangedAt: string;
  alerted: boolean;
  alertedAt: string | null;
}

export type ApiErrorCode =
  | 'invalid_api_key' | 'quota_exhausted' | 'network' | 'provider_error'
  | 'bad_request' | 'not_found' | 'conflict' | 'internal';
```

### server/src/scan/detection.ts (the reusable detection slice — Phase 4's entry point)

```ts
export function detectOpportunities(
  rawEvents: OddsEvent[],
  allowedBookmakers: readonly string[],
  options: DetectionOptions,          // { topN, now, marketKeys, …thresholds }
): ArbOpportunity[] {
  const events = filterEventsToBookmakers(rawEvents, allowedBookmakers);
  const opportunities = findArbitrageOpportunities(events, { …options });
  fillLinkFallbacks(opportunities);   // API links win; else book homepage
  for (const arb of opportunities) {
    arb.id = opportunityIdFromFingerprint(opportunityFingerprint(arb));
  }
  return opportunities;
}
```

`runScan` (scan/scanService.ts) is the only place provider, engine, and
persistence meet: catalogue call (free, usage baseline) → slider picks N
sports → optional cheaper fetch-by-books plan → concurrent per-sport odds
fetches (one failure doesn't sink the scan; all failing rethrows the real
cause) → `detectOpportunities` → persist raw snapshot + opportunity records
(non-fatal) → fire-and-forget WhatsApp notifier → usage report cross-checked
against `x-requests-used` header deltas.

### server/src/engine/arbitrage.ts (stake math lives exactly once)

```ts
export function priceLegs(odds: number[]): LegPricing {
  const arbIndex = odds.reduce((sum, o) => sum + 1 / o, 0);
  return {
    arbIndex,
    profitPct: (1 / arbIndex - 1) * 100,
    stakes: odds.map((o) => Math.round(((100 * (1 / o)) / arbIndex) * 100) / 100),
  };
}
```

### server/src/opportunities/opportunityLifecycle.ts (pure transitions)

```ts
/** Cockpit-driven: completing always allowed (even dead — the bets were
 *  placed while it lived); degrading is active-only; re-setting the same
 *  status is a no-op success so double-taps never error. */
export function applyStatusChange(record, target: 'degraded' | 'completed', now): StatusChange;

/** Re-verify: fold fresh odds for the record's EXACT legs back in.
 *  null odds (leg gone) or commenced → dead, numbers left as last seen.
 *  All legs priced → update odds/stakes/profit via priceLegs, then:
 *  profit ≤ 0 → dead · shrunk > 0.1pp below detection → degraded ·
 *  else active (revives degraded/dead, like scan re-detection). */
export function applyVerification(record, legOdds: Array<number | null>, now): 'active' | 'degraded' | 'dead';
```

`applyScanToRecords` (same file) is the scan-driven path: upsert by
fingerprint (re-detection revives dead/degraded, never completed), then
kill by proof — same tab + rescanned sport + fingerprint gone, or event
commenced. Settled records age into `data/opportunity-archive/YYYY-MM.jsonl`
after 7 days.

### server/src/opportunities/verifyService.ts (cockpit re-verify orchestration)

```ts
export async function verifyOpportunity(deps, id): Promise<VerifyOutcome> {
  const record = await deps.opportunities.get(id);
  if (!record) return { ok: false, reason: 'not_found', … };
  if (record.status === 'completed') return { ok: false, reason: 'conflict', … };

  let legOdds, creditsCharged = 0;
  if (commenced(record)) {
    legOdds = record.legs.map(() => null);        // dead, no API spend
  } else {
    // ONLY the record's sport, its market, the legs' books —
    // ≤10 books = 1 region-equivalent ⇒ ~1 credit.
    const books = [...new Set(record.legs.map((l) => l.bookmakerKey))];
    const { events, usage } = await deps.provider.fetchOdds(record.sportKey,
      { regions: [], markets: [record.marketKey], bookmakers: books });
    legOdds = repriceLegs(record, events);         // pure: match book+outcome+|line|
    creditsCharged = usage.creditsCharged;
  }
  const outcome = await deps.opportunities.applyVerification(id, legOdds);
  return outcome.ok ? { ok: true, record: outcome.record, legOdds, creditsCharged } : outcome;
}
```

### API surface

```
POST  /api/scan                      run a scan {topN, regionTab}
GET   /api/last-scan                 persisted usage meta
GET   /api/opportunities?status=     persisted records, newest first
GET   /api/opportunities/:id         404 not_found on stale links
POST  /api/opportunities/:id/verify  → { record, legOdds, creditsCharged }
PATCH /api/opportunities/:id         { status: 'degraded' | 'completed' }
GET/PATCH /api/bookmakers[/:key]     registry + manual config
POST/… /api/whatsapp/*               connect/verify/threshold/test/disconnect
```

Provider errors map centrally (`routes/api.ts`): `invalid_api_key`→401,
`quota_exhausted`→429, `network`/`provider_error`→502, else 500. Gotcha:
The Odds API signals quota exhaustion with **401** (OUT_OF_USAGE_CREDITS),
same status as a bad key — `toProviderError` disambiguates by message text
and has regression tests. Don't "simplify" it.

### client/src/App.tsx (whole file — the client philosophy in one screen)

```tsx
/** Pages own their own state and fetching (the WhatsAppPanel model) —
 *  there is deliberately no shared store above this level yet. */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CockpitPage } from './pages/CockpitPage';
import { ScanPage } from './pages/ScanPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ScanPage />} />
        <Route path="/opportunity/:id" element={<CockpitPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

The client computes **zero** arb math. The one client math module is pure
display scaling (`cockpit.ts`): stakes ship per-$100 from the server, so a
bankroll multiplies them linearly; guaranteed profit = worst leg payout
minus total staked. Design system: pure black, white, one red (#ff2b2b),
zero radius, uppercase micro-labels; green means exactly one thing
(auto-surveillance live); cockpit status renders typographically —
completed is the app's single inverted white block.

## Known open items (deliberate, don't re-discover)

- A Pinnacle-benchmark second odds source will be a MERGE, not a provider
  swap: `runScan` orchestration and credit accounting are
  single-provider-coupled and need a fan-out/merge step when that lands.
- If opportunity persistence fails but a WhatsApp send succeeds,
  `markAlerted` silently no-ops — accepted at single-user scale.
- No shared client state layer — pages self-fetch; revisit only when
  cross-page state actually appears.

## How I work

TDD (failing test first, always), design doc committed before each phase,
plan + approval before implementing a phase unless I say otherwise. Verify
claims by running `npm test` / `npm run typecheck` and driving the real app
(mock mode is free: `DEV_MODE=true npm run dev:server`). The repo's
`CLAUDE.md` is the canonical working map — read it first if you have file
access; this brief is its portable summary.

My first question for you: [ASK YOUR QUESTION HERE]
