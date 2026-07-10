# Execution Cockpit — Design (Buildout Phase 3)

Approved 2026-07-10 (Ryan pre-approved this phase; hardening pass a66c488
landed first). The cockpit is the "phone buzzed → open link → act" surface:
a mobile-first page at `/opportunity/:id`, deep-linked from WhatsApp alerts,
where the user re-verifies prices, scales stakes to a bankroll, jumps to the
books, and records the outcome. No auto bet placement, ever.

## Deep links in alerts (the Phase-2 deferral, now due)

`formatAlertMessage` appends ` ${APP_URL}/opportunity/${id}` where
`id = opportunityIdFromFingerprint(fingerprint)` — the same fingerprint the
dedup already computes. `APP_URL` comes from `.env` (default
`http://localhost:5173`, documented in `.env.example`); it reaches
`notifyNewOpportunities` via `AlertDeps.appUrl` so the formatter stays pure.

## Client: routing arrives (deferred hardening item 1, folded in here)

- `react-router-dom`; `App.tsx` becomes a thin router shell:
  `/` → `pages/ScanPage.tsx` (today's App content, moved verbatim — state,
  effects, and the auto-scan timer keep their exact semantics) and
  `/opportunity/:id` → `pages/CockpitPage.tsx`.
- The cockpit is self-contained (WhatsAppPanel model): it fetches its own
  record, no shared context layer yet. The list↔cockpit hop re-fetches by
  id — correct-over-clever at single-user scale.
- `ArbOpportunity` gains optional `id` (filled by `detectOpportunities`
  via `opportunityFingerprint`) so scan results can link into the cockpit
  without re-querying.
- Cockpit CSS is mobile-first under a strict `.cockpit-*` namespace; the
  existing desktop-first global sheet is untouched.

## Cockpit page

- **Header**: event, sport · market, start time, status badge, live
  profit % (detection profit alongside when they differ).
- **Stake calculator**: bankroll input (default $100, persisted in
  localStorage). Legs scale linearly from the per-$100 stakes the server
  computed — display math only (client still owns zero engine math);
  payout/guaranteed-profit shown per leg and total.
- **Legs**: outcome, book, odds (fresh odds after a re-verify, with
  direction vs stored), stake, deep-link button per leg.
- **Actions**: Re-verify (≈1 credit, see below) and "Legs placed —
  mark completed". Degraded is set by re-verify, not by hand (PATCH
  supports it; the UI doesn't need it).
- **States**: loading / stale-link `not_found` ("gone — run a fresh scan")
  / loaded. `conflict` on a double action is a no-op by design.

## Re-verify: fresh fetch, not snapshot recompute

Decision recorded in CLAUDE.md (2026-07-10): the snapshot stays latest-only
and is Phase-4 territory. Re-verify answers "are MY legs still priced?"
with live data:

- `POST /api/opportunities/:id/verify` → `{ record, legOdds, creditsCharged }`.
- Commenced event → `dead` without spending a call.
- Otherwise fetch ONLY the record's sport, by the legs' bookmaker keys
  (`bookmakers` param: ≤10 books = 1 region-equivalent × 1 market ≈ 1
  credit — far cheaper than a scan; mock mode free as always).
- Re-price the exact legs (book + outcome + |point| from the fingerprint):
  - any leg no longer offered → `dead`
  - S = Σ 1/odds ≥ 1 (profit gone) → `dead`
  - profit &gt; 0 but below `profitPctAtDetection − VERIFY_PROFIT_TOLERANCE_PP`
    (0.1pp, constants.ts) → `degraded`
  - otherwise → `active` (revives degraded/dead, matching scan revival;
    `completed` is terminal → 409 `conflict`)
  - legs/profitPct/arbIndex/lastSeenAt update in place either way.
- Pure core `applyVerification(record, freshLegOdds, now)` lives in
  `opportunityLifecycle.ts`; orchestration (`verifyOpportunity`: guard →
  fetch → re-price → persist) in `opportunities/verifyService.ts`; the
  route wires them with the provider in `index.ts`. Usage meters are
  scan-scoped on purpose — verify reports its own `creditsCharged` in the
  response instead of rewriting last-scan meta.

## API summary

- `POST /api/opportunities/:id/verify` — above. 404 `not_found`, 409
  `conflict` (completed), provider errors map exactly like `/api/scan`.
- `PATCH /api/opportunities/:id` — landed in the hardening pass
  (`completed` from any state, `degraded` from active, no-op on same
  status).

## Out of scope

Realized-P&L fields on completion (Phase 5 owns the ledger), per-scan
snapshots (rejected — see CLAUDE.md), server-side schedulers of any kind,
and Advanced-Mode presets (Phase 4, which now simply calls
`detectOpportunities` against the stored snapshot).
