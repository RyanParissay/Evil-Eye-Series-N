# Bookmaker Configuration — Design (Buildout Phase 1)

Approved 2026-07-09. Per-bookmaker operational config: enabled flag, manual
balance, status (active / limited / dead), notes — driving cheaper odds
fetches, defensive detection filtering, and alert suppression.

## Decisions

- **Registry is derived from the feed.** Each scan upserts every bookmaker
  seen in the raw odds response (key + title, first/last seen). New books
  default to enabled + active. Nothing hardcoded.
- **Provider-level filter, only when strictly cheaper.** The Odds API's
  `bookmakers` param (verified in their v4 docs) takes priority over
  `regions` and bills every 10 bookmakers as one region-equivalent. The scan
  passes `bookmakers = tab allowlist − disabled books` iff
  `ceil(n/10) < tab.apiRegions.length`; otherwise it fetches regions as
  before. Effect today: the CA tab (9 allowlisted books, 2 regions) halves
  its odds-call credits by default. Trade-off, documented: while the param
  is active the feed only contains those books, so the registry won't
  discover non-allowlisted books — acceptable; region tabs remain the outer
  accessibility boundary.
- **Defensive filter**: detection input = tab allowlist − disabled books,
  applied in scanService before the engine regardless of how the fetch was
  made.
- **Limited/dead semantics**: still fetched and shown in results with a
  warning badge on the affected leg ("flagged, never hidden"), but
  opportunities containing such a leg are dropped from WhatsApp alerts
  (filtered in the notifier composition, ahead of notifyNewOpportunities)
  and will be blocked from stake suggestions in the Phase 3 cockpit.
  Balance is recorded now, enforced against stakes in Phase 3.
- **Storage**: JSON file store (`server/data/bookmakers.json`), same
  write-then-rename + serialized-update pattern. The pattern is now used by
  three stores, so it's extracted to a generic `lib/jsonStore.ts`;
  WhatsAppStore becomes a subclass (behavior unchanged, existing tests
  prove it).
- **DEV_MODE umbrella**: `DEV_MODE=true` ⇒ mock odds provider + console
  WhatsApp sender, regardless of other vars. Granular switches remain.
- Mock fixtures extended to ~15 bookmakers (added books carry non-best
  odds so the designed arbs are undisturbed).

## Modules

- `server/src/lib/jsonStore.ts` — generic `JsonStore<T>`: read / serialized
  update / write-then-rename.
- `server/src/bookmakers/bookmakerStore.ts` — `BookmakerConfig` persistence.
- `server/src/bookmakers/effectiveBookmakers.ts` — pure: upsert-seen merge,
  fetch plan (bookmakers param vs regions + allowed set), alertable check.
- `server/src/bookmakers/bookmakerService.ts` — store-backed façade used by
  scanService, routes, and the notifier: list / patch / recordSeen /
  fetchPlan / filterAlertable.
- `server/src/bookmakers/bookmakerRequests.ts` — PATCH body validation.
- `server/src/routes/bookmakers.ts` — `GET /api/bookmakers`,
  `PATCH /api/bookmakers/:key`.
- Provider: `FetchOddsParams.bookmakers?`; both providers honor it; credit
  math via `creditCost.regionEquivalentsForBookmakers = ceil(n/10)`.
- Client: `BookmakerPanel.tsx` (collapsible list: enabled toggle, balance,
  status select, notes, last seen), leg warning badges in
  `OpportunityCard.tsx` via a status map owned by `App.tsx`.

## Shared types

`BookmakerConfig { key, title, enabled, balance: number|null, status:
'active'|'limited'|'dead', notes, firstSeenAt, lastSeenAt }` in
`shared/types.ts` (client renders it verbatim).

## Tests

Store normalize/round-trip, upsert-seen merge, fetch-plan rule (strictly
cheaper, disabled exclusion, empty registry), ceil(n/10) credit math, mock
provider param filtering, scanService integration (param passed, seen
recorded, defensive filter), alertable filtering, PATCH validation.
