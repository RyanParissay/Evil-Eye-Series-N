# Advanced Mode — Design (Buildout Phase 4)

Per `docs/mission-phases-4-7.md`. Ryan pre-approved execution of phases 4–7
in one arc ("build the app, execute"); decisions below follow the
recommendations he reviewed in the chunked plan. Goal: recompute
opportunities for any book set from the stored latest raw snapshot, zero
API cost, without touching the default scan experience.

## Preset representation (decision)

Static presets carry explicit keys; dynamic presets carry a rule resolved
against the bookmaker registry at evaluation time:

```ts
export type BookPresetRule = 'all_enabled' | 'funded';
export interface BookPreset {
  id: string;            // random, URL-safe
  name: string;
  kind: 'static' | 'dynamic';
  bookmakerKeys: string[];   // static only; [] for dynamic
  rule?: BookPresetRule;     // dynamic only
  createdAt: string;
  lastUsedAt: string | null;
}
```

Seeds (created on first read, dynamic): **All enabled** (`all_enabled` =
every enabled book) and **Funded only** (`funded` = enabled AND balance
> 0 — a disabled book can't be staked, so bare "balance > 0" would lie).
Dynamic seeds can be renamed but not re-keyed; deleting a seed is allowed
(recreated only on a fresh data file). Saving from the UI always creates
static presets.

## Server

- `presets/presetStore.ts` — `JsonStore<{ presets: BookPreset[] }>` at
  `data/presets.json` (gitignored, like every store).
- `presets/presetService.ts` — list (seeding on empty), create/rename/
  delete, `touch(id)` for lastUsedAt, and pure
  `resolvePresetKeys(preset, books): string[]`.
- `POST /api/advanced/recompute` body `{ presetId?: string,
  bookmakerKeys?: string[] }` (exactly one required):
  1. Resolve keys (404 `not_found` for unknown preset; touch lastUsedAt).
  2. Read the latest snapshot; none → `{ snapshot: null, opportunities: [],
     knownRecordIds: [] }` (client renders "run a scan" — never an error).
  3. `detectOpportunities(snapshot.events, keys, { now, marketKeys:
     snapshot.markets })` — no topN cap (engine default keeps all).
  4. Join opportunity ids against persisted records →
     `knownRecordIds: string[]` so the client only deep-links cards whose
     record actually exists. **No records are written** (the mission's
     no-fabrication rule), and there is no provider anywhere in the
     dependency graph — zero credits is structural, not just asserted.
  5. Response `{ snapshot: { fetchedAt, regionTab, sportsScanned },
     opportunities, knownRecordIds }`.
- Routes: `/api/presets` GET/POST/PATCH(:id rename)/DELETE(:id) +
  `/api/advanced/recompute`, one router file (`routes/advanced.ts`).

## Client

New route `/advanced` (AdvancedPage, self-contained per the pages-own-
their-state model): searchable book list with chips for selected keys,
select-all/clear, preset picker + save/rename/delete, opens on the most
recently used preset (falls back to "All enabled" resolution). Recompute
fires on every selection change (a snapshot recompute is local and cheap;
an in-flight guard prevents overlap). "As of scan Xm ago" is rendered
prominently from `fetchedAt`. Cards reuse `OpportunityCard` with a new
optional `cockpitLink` prop (default true — ScanPage unchanged): in
advanced mode it is true only when the id is in `knownRecordIds`.
ScanPage masthead gains an "Advanced →" link; AdvancedPage links back.

## Alert scope (mission's design-doc decision #5)

**Deferred to Phase 6** (recommended option). Rationale: alerts fire on
the scan path, where allowlist filtering happens pre-detection; scoping
alerts to a preset would mean recomputing per-preset inside the notifier.
Phase 6 already refactors alertService selection into a shared
strategy-agnostic core — that's the natural seam to add scope without
doing the refactor twice. No subscription-state migration needed now.

## Acceptance mapping

- Zero credits: recompute deps = snapshot store + preset service +
  opportunity service only (test asserts router builds without any
  provider; usage fields absent from response).
- Subset-drops-arb and line-group discipline: fixture snapshot with a
  cross-book arb and a mismatched-|point| pair; full set finds exactly the
  legal arb, subset lacking one leg's book finds none, no cross-line
  combination ever appears.
- Preset CRUD survives restart: exercised against a real temp-dir
  JsonStore (subscriptionStore.test.ts pattern).
- ScanPage untouched: no ScanPage/ControlBar edits beyond the nav link;
  existing tests unchanged.
