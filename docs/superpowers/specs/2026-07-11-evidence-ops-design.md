# Phase 15 — Evidence quality pack + ops hardening (design)

Spec: docs/prompts/phase-15.md. Approved by Ryan 2026-07-11 ("go for it").
Build order (per docs/HANDOFF.md): #4 → #5 → #7 → #6 → #3 → #2 → #1.
Zero live Odds API calls anywhere in this phase except the existing scan path.

## Decisions (binding for implementation)

### #4 WhatsApp arb copy — exact format
`formatAlertMessage` (arb alerts only; EV/middle formats from Phases 10/12 are
already pinned by tests and stay unchanged) produces EXACTLY:

```
<Book> | <side> @ <odds> | $<amount>
<Book> | <side> @ <odds> | $<amount>
Profit: $X.XX (Y.YY%)
odds as of HH:MM
<APP_URL>/opportunity/<id>
```

Nothing else — no emoji, no event line, no sport. `$<amount>` comes from the
existing planStakes dollars (unchanged logic). `HH:MM` is 24h local server
time of the odds snapshot: `lastSeenAt ?? detectedAt`. Omit the APP_URL line
when APP_URL is unset (current behavior). Pin with an exact-string test.

### #5 Delivery-failure detection
- Twilio send path: on failure, retry the same message up to 2 times within
  the same async dispatch (small awaited backoff; NOT a scheduler — it lives
  inside the existing fire-and-forget notifier call).
- After final failure: persist `lastDeliveryFailure { at, detail }` in the
  whatsapp store (detail sanitized — no SIDs/tokens/full numbers), log via
  console.warn. Any subsequent successful send clears it.
- `/api/whatsapp/status` exposes `deliveryFailure` (nullable).
- Client: persistent banner on ScanPage while `deliveryFailure` is set:
  delivery is failing, most likely fix is re-joining the Twilio sandbox
  (send the join code to the sandbox number), with the failure timestamp.
  Existing per-subscription failure deactivation stays as is.

### #7 Credit-spend widget
- ScanPage widget fed by existing accounting only: scoreboard credits
  (used, budget, projected month-end) + grading status scoresSpendToday.
- Shows: spent / budget, projected month-end, scores share today.
- Amber styling when projected ≥ 80% of budget, red when ≥ 100%. Red here is
  numeric danger state per Ryan's spec — allowed; it is not the arb red.
- No new server code unless a field is missing; prefer reusing
  /api/ops/scoreboard + /api/grading/status.

### #6 Backup + export
- `server/src/ops/backupService.ts`. Destination `BACKUP_DIR` env, default
  `server/data/backups`. One backup per calendar day into
  `BACKUP_DIR/YYYY-MM-DD/`: copy everything under server/data/ EXCEPT the
  backups dir itself. Prune to the newest 14 dailies.
- Triggers (no server timers, ever): on server startup, and fire-and-forget
  after each scan — both check "does today's dir exist?" first and no-op.
- CSV exports (Excel-safe, quoted, formula-defanged, like ledger CSV):
  - `GET /api/grading/export.csv` — graded records: id, strategy, sport,
    event/teams, commence, result, pnlPer100, source, flags, gradedAt.
  - `GET /api/portfolios/export.csv` — per-series P&L: series id, entries,
    settled count, realized P&L, ending bankroll, skipped-insufficient count.

### #3 Second-sighting alert confirmation
- OpsSettings gains `confirmSecondSighting: boolean`, default false.
- Semantics when ON: an alert may fire only for a record sighted in ≥2 scans
  (`lastSeenAt > detectedAt`, strict). Applies to ALL strategies (arb, EV,
  middle — free middles included: "delays every alert" is the spec).
- Plumbing note: today the notifier only receives newly-detected records.
  With the toggle ON the candidate set must be records SEEN THIS SCAN that
  are not yet alerted — so a record gated at first sighting gets its alert on
  the second. Fingerprint dedup (alerted flag) still guarantees at-most-once.
  The gate itself is a pure function in alertService; index.ts wires it from
  ops settings.
- Fixture test: scan1 detect → no alert; scan2 re-sight → exactly one alert;
  ghost that vanishes before scan2 → never alerted.
- UI: toggle in the windows & budget panel with EXACT copy: "delays every
  alert by one scan interval (~5 min); filters ghosts", with the survival
  readout beside it (existing /api/ops/survival: "X% survive one scan
  interval · N samples").

### #2 Scan history browser
- `GET /api/ops/scans?lastN=` reads scanHistoryStore JSONL (newest first):
  time, region tab, sports, markets/credits, counts. Drill-down: match
  opportunity records by detection/sighting timestamps falling in that
  scan's slot (or scan-line fingerprints if the log already carries them —
  use what's stored, don't add live calls). Phase-13 gap indicators render
  inline between rows (reuse gapDetector).
- Client: new `/scans` page, linked from Scanner + Ledger nav lines. Rows
  expand to show that scan's opportunities; cards deep-link to the cockpit
  only for known record ids (Advanced-mode rule).

### #1 Book leaderboards (accruing store — decided, per HANDOFF design note)
- The snapshot is latest-only, so historic re-detection is impossible.
  Counts ACCRUE per scan going forward: `server/src/ops/leaderboardStore.ts`
  (JsonStore, `data/leaderboard.json`) updated by runScan alongside scanLog:
  per book — appearances (scans carrying the book), opportunity-leg counts
  by strategy (arb/ev/middle), firstSeenAt/lastSeenAt; plus totalScans and
  store createdAt ("since <date>" in the UI — NOT "since paper start").
- Zero credits structurally: no provider in the dependency graph; fed only
  from data the scan already fetched.
- `GET /api/ops/leaderboard`; UI table in the Ledger evidence area: book,
  seen share, arb/EV/middle counts, first/last sighting.

## Out of scope
Kelly, props, live betting, CLV, server-side scheduler, compounding,
grading-rule changes (docs/prompts/phase-15.md).

## Workflow
TDD per deliverable (vitest from server/ — repo root loses @shared).
Gates before each commit: server vitest green, root typecheck green.
Commit per deliverable. Finish with: DEV_MODE walkthrough (incl. the
outstanding /portfolios + grading UI check), CLAUDE.md layering update
(grading/, portfolios/, plus new ops pieces), PROGRESS.md, HANDOFF.md.
