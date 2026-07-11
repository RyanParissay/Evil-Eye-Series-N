# Evidence Instrumentation + Peak-Cadence Ops — Design (Buildout Phase 8)

Per Ryan's Phase 8 spec. Scope test applied to every piece: speeds the
loop or sharpens the evidence, nothing else. No new strategies, markets,
or providers. All invariants hold — repetition stays client-timer-driven,
credits stay accounted, simulated stays labeled, numbers stay honest
(missing data is excluded, never zero-filled).

Status: AWAITING APPROVAL — implementation does not start until Ryan
signs off on this doc and the open questions.

## The one new persistence primitive: the scan log

Several requirements (coverage §2, survival-at-next-scan §3, budget
projection §1) need per-scan history that nothing currently persists —
the snapshot is latest-only (invariant, untouched) and last-scan.json
holds one record. So Phase 8 adds ONE append-only log and derives
everything from it:

`data/scan-history/YYYY-MM.jsonl` (monthly files, the opportunity-archive
pattern; streamed line-by-line, never whole-file reads). One line per
completed scan, written by a new optional `scanLog` dep in `runScan`
(books/opportunityLog pattern — non-fatal, after step 5):

```ts
{ scannedAt, regionTab, sportsScanned: string[],
  creditsComputed, requestsUsedTotal,          // budget history
  distinctBooks: string[], eventCount }         // coverage history
```

~200 bytes/scan; a heavy proving month is a few MB. Zero API calls.

## §1 Peak-hours cadence (client timers only)

**Settings** (server-persisted, `data/ops.json`, standard JsonStore;
`GET/PATCH /api/ops/settings`):

```ts
{ weekday: { startMinutes, endMinutes },   // default 18:30–22:30
  weekend: { startMinutes, endMinutes },   // default 12:00–22:30
  inWindowMins: 5,
  outWindowMins: null | number,            // null = off (default); 30 selectable
  monthlyCreditBudget: 20_000,
  autoStopPct: 95 }
```

Windows are minutes-from-local-midnight, evaluated on the client that
runs the timers (single user; if the laptop travels, the windows travel
— see open question 5). `endMinutes < startMinutes` spans midnight.
Weekend = Sat/Sun local.

**Pure client logic** `client/src/cadence.ts` (autoScan.ts pattern,
fully unit-tested): `windowState(settings, now) → { inWindow,
cadenceMins | null, label }` and `effectiveDelay(...)` feeding the
existing ScanPage timer effect. The existing auto-update toggle stays
the master switch (localStorage, per-browser); the old fixed interval is
superseded by window cadences when ops settings exist. Auto-scan off →
ScanPage behavior byte-identical to today (acceptance).

**Mode line** on the scan page: `IN WINDOW — next scan 0:47` /
`OUT OF WINDOW — next scan 27:12` / `OUT OF WINDOW — sleeping` /
`AUTO-SCAN OFF`, plus the budget state.

**Budget guard** (client-side, manual scans never blocked):
- Month-to-date burn = `requestsUsedTotal` from the latest scan meta
  (the provider's own month counter), historical shape from the scan log.
- Projection = used ÷ elapsed-fraction-of-calendar-month; WARNING state
  when projection > budget.
- HARD STOP of auto-scan when used ≥ autoStopPct% × budget; releases on
  calendar-month rollover, a budget raise, or the provider counter
  resetting (usedTotal drops).
- Honest defaults note: 5-min cadence over the default windows ≈
  20.6k credits/month — deliberately just past budget so the guard is
  load-bearing, not decorative (open question 2).

## §2 Funded-book coverage audit (zero credits)

`GET /api/ops/coverage?lastN=50` derives from the scan log + registry:
per enabled book — appearances in the last N scans, share, last seen;
plus the distinct-book-count-per-scan series. Flags: **MISSING** (balance
> 0, zero appearances in last N) — unmissable red; **THIN** (balance > 0,
share < 50%) — amber. Rendered as a "Feed coverage" section on the
Ledger page (open question 4), with the distinct-book sparkline table.

## §3 Arb lifetime & survival (zero credits)

Computed from opportunity records (active + archives, the ledger
streaming pattern) joined with the scan log:

- **Survival-at-next-scan**: for each record, find the first scan after
  `detectedAt` covering its scope (same tab, sport rescanned). Survived
  iff `lastSeenAt ≥` that scan's time. Records with no subsequent
  covering scan are EXCLUDED (unknown ≠ dead). Overall, per book pair
  (sorted leg keys), and by time of day (six 4-hour local bands — hour
  granularity would shred the sample sizes).
- **Lifetime**: `deadAt − detectedAt` for records that died by absence.
  Commencement-killed records are right-censored → reported separately
  as "outlived the market window", never mixed into the gone-lifetime
  distribution. Median + quartiles.

**Haircut from survival** — the exact mapping (spec requirement):

```
measuredHaircutPct = 100 × (1 − survivalAtNextScan_overall)
```

Rationale: acting on an alert costs roughly one scan interval of
latency, so P(edge gone before you act) ≈ 1 − P(survives one interval).
Conservative and transparent. Qualification: ≥14 days of scan-log span
AND ≥50 survival samples. `PaperSettings` gains
`haircutSource: 'manual' | 'measured'` (default 'manual'):

- 'measured' + qualified → settlement uses the measured number,
  recomputed deterministically on read (the paper book is already a
  model recomputed from facts); UI shows **MEASURED** with the
  derivation ("61% of 84 arbs survived one scan → 39% haircut").
- 'measured' + not yet qualified → falls back to the manual value,
  labeled **ASSUMED (unmeasured)** — same label 'manual' always gets.

## §4 Reaction-time telemetry

`OpportunityRecord` gains first-write-wins funnel timestamps and a
verify outcomes list (both age into the archive with the record):

```ts
funnel?: { cockpitOpenedAt?, verifyPressedAt?, fillsOpenedAt? }
verifies?: Array<{ at, outcome: 'active'|'degraded'|'dead', profitPct }>
```

- `cockpitOpenedAt` / `fillsOpenedAt`: the cockpit fires
  `POST /api/opportunities/:id/funnel { step }` (idempotent — first
  write wins, later calls no-op; 404 not_found on stale ids).
- `verifyPressedAt` + the verifies entry: stamped server-side inside the
  existing verify flow — no client trust needed for the headline number.
- `alertedAt` (exists) and `execution.recordedAt` (exists) complete the
  funnel: alert → opened → verified → fills → completed.
- Aggregation (`GET /api/ops/telemetry`): delta distributions with
  missing steps EXCLUDED; **median alert→verify is the headline**.
  Re-verify outcome stats: green/degraded/dead fractions and mean
  profit delta vs detection, overall and per book, computed from
  `verifies` on alerted records. No lifecycle changes of any kind.

## §5 Proving-month scoreboard

`GET /api/ops/scoreboard` assembles the decision view (all fields
server-computed): ideal equity (SIMULATED), haircut equity (SIMULATED +
MEASURED/ASSUMED), real P&L, capture rate, median arb lifetime, median
alert→verify, credit burn (used / budget / projection / stop state).
Rendered as the top block of the Ledger page. CSV export gains funnel
timestamps, verify count, first/last verify outcome, and lifetime
fields; Excel-safe; round-trip test extended.

## Module map

```
server/src/ops/    scanHistoryStore.ts (JSONL append + streaming read)
                   opsStore.ts (settings JsonStore)
                   coverageService.ts · survivalService.ts ·
                   telemetryService.ts (pure aggregation, fixture-tested)
routes/ops.ts      settings / coverage / telemetry / scoreboard
client/cadence.ts  pure window/budget logic + tests
CadencePanel       mode line + windows/budget settings (scan page)
Ledger sections    scoreboard · coverage · survival
Cockpit            two funnel pings (open, fills)
```

## Acceptance mapping (from the spec)

- Window/cadence unit tests: boundary entry/exit, midnight-spanning,
  weekday↔weekend transition, cadence switching, warning threshold,
  hard stop engage/release (rollover + budget raise + counter reset).
- Coverage & survival reconcile to hand-computed fixtures exactly.
- Telemetry verified by driving the full cockpit funnel in mock mode,
  plus a partial-funnel case (alert → completed with no cockpit open).
- Zero credits: every ops endpoint's dependency graph is provider-free
  (structural, like advanced recompute) — asserted in route tests.
- No server-side scheduling: the diff's only timers are in client code;
  grep review recorded in the phase summary.
- Auto-scan-off ScanPage behavior unchanged (existing tests untouched).

## Deliberately out of scope

New markets/providers/strategies; CLV (roadmap); alert-channel changes;
any server-side timer; retroactive backfill of history that was never
recorded (the scan log starts at deploy — early coverage/survival views
say "insufficient history" honestly).
