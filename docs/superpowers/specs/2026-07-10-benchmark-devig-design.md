# Benchmark Ingestion + Fair-Probability Engine — Design (Speculative Mode, Phase 9)

Per the Phases 9–11 mission. Status: **AWAITING RYAN'S APPROVAL** — no
implementation until the plan and open questions below are signed off.

Hard constraint restated: Arbitrage Mode is finished. Nothing here may
change arb detection, alerts, cockpit, ledger semantics, or their tests.

## Grounding facts (from the code, they reshape the spec)

1. **Pinnacle is already a first-class bettable book in this app.** It
   sits in `CA_CORE` in `shared/regionTabs.ts` ("Ontario licensed"), so
   it is in every tab's allowlist — today it can carry arb legs, and the
   mock feed regularly prices it.
2. **Every tab's `apiRegions` already includes `eu`** — the region that
   carries Pinnacle — so region-path fetches already receive Pinnacle
   odds. The snapshot (raw, pre-filter) already stores them.
3. `planFetch` (bookmakers/effectiveBookmakers.ts) fetches by the
   `bookmakers` param only when strictly cheaper than the tab's regions;
   `regionEquivalentsForBookmakers` = ⌈n/10⌉.

Consequence: the mission's "benchmark books are excluded from arb legs"
would CHANGE arb behavior (Pinnacle legs exist today), contradicting the
mission's own do-not-touch-arb rule and the byte-identical acceptance.
The design resolves this with a **dual-role model** (open question 1).

## Benchmark role: dual-role, constant-driven

- `config/constants.ts` gains `BENCHMARK_BOOKS = ['pinnacle']`.
- `BookmakerConfig` gains `benchmark: boolean`, derived from the
  constant at registry read (not user-editable; UI shows a BENCHMARK
  badge). It marks a *role*, not a prohibition:
  - **Bettability is unchanged.** Pinnacle stays exactly as bettable as
    the user's enabled flag says — arb detection, stake suggestions,
    and balance warnings all follow today's rules untouched. Arb
    outputs stay byte-identical by construction.
  - **Feed guarantee is new.** Benchmark books are ALWAYS carried in
    the fetch, even when the user disables them for betting: fetch-by-
    books plans append them to `bookmakersParam` (deduped); region
    plans already reach Pinnacle via `eu` on every tab.
- If Ryan prefers not to bet at Pinnacle, he disables it in the panel
  exactly as today — arb legs stop, the benchmark feed keeps flowing.
  That is the whole "benchmarkOnly" behavior, achieved without a
  second bettability mechanism.

## Fetch-plan and credit math (`planFetch` change)

`planFetch(configs, tab)` → `planFetch(configs, tab, benchmarkKeys)`:

- `bookmakersParam = dedupe([...enabledAllowlist, ...benchmarkKeys])`
  when fetching by books; the strictly-cheaper comparison uses the
  UNION count (⌈(enabled+benchmark)/10⌉ vs tab regions) — the
  strictness rule stays sacred.
- `allowedKeys` (the arb-detection filter) is untouched — benchmark
  keys enter it only under today's rules (enabled + in tab allowlist).
- **Zero-marginal-cost assertion (tests):** with enabled ≤ 9 books,
  appending one benchmark key keeps ⌈n/10⌉ = 1 — identical credits.
  With Pinnacle already enabled (today's default), the union is a
  no-op — literally zero change.
- **Cost visibility:** the scanner's pre-scan credit estimate derives
  from the plan; when the union crosses a 10-boundary the estimate
  rises accordingly — the number the user already sees moves, and the
  usage-accounting tests pin it. Never silent.
- Explicit non-behavior: we never auto-add the `eu` region anywhere
  (regions multiply every call's cost; tabs already include it anyway).

## Coverage audit extension (zero credits)

`CoverageReport` gains a `benchmark` block:

- **Overall reach:** share of the last-N scans whose `distinctBooks`
  include each benchmark key (scan-history log, existing primitive).
- **Per-sport reach (the "silently impossible" guard):** from the
  LATEST snapshot — for each scanned sport, the fraction of its events
  carrying benchmark odds. Latest-only is the accepted snapshot
  invariant; per-sport history would need new persistence and Phase 9
  doesn't require it (design decision, revisit only if Phase 10's data
  shows it matters).
- Ledger "Feed coverage" section renders it with an unmissable flag
  when a scanned sport has zero benchmark presence: "Speculative
  detection impossible for X — benchmark absent."

## De-vig engine (`engine/fairProbability.ts`, pure)

```ts
export type DevigMethod = 'multiplicative'; // enum seam: | 'power' | 'shin'

export interface FairLine {
  method: DevigMethod;
  overround: number;             // M = Σ 1/oᵢ (must be > 1 in practice)
  probabilities: number[];       // pᵢ = (1/oᵢ)/M, aligned with input
}

/** Rejections are typed, never guessed around. */
export type DevigResult =
  | { ok: true; fair: FairLine }
  | { ok: false; reason: 'missing_outcome' | 'line_mismatch' | 'invalid_odds' };

export function devig(odds: number[], method?: DevigMethod): DevigResult;

/**
 * Fair probabilities for one |point| line group from a benchmark
 * bookmaker's market: the benchmark must quote EVERY side of the group
 * at the SAME |point| line — the arb line-group invariant extended to
 * benchmark comparison, unchanged in spirit.
 */
export function fairForLineGroup(
  benchmarkOutcomes: Array<{ name: string; point?: number; price: number }>,
  groupSides: Array<{ name: string; point?: number }>,
  method?: DevigMethod,
): DevigResult;
```

- Handles 2-outcome (h2h, totals) and 3-outcome (h2h with draw) groups.
- Rejects: any side missing from the benchmark (`missing_outcome`); any
  |point| disagreement (`line_mismatch`); odds ≤ 1 (`invalid_odds`).
- Fixtures (hand-computed): 2-way 1.95/1.95 → M=1.02564, p=0.5/0.5 ·
  2-way 1.87/2.05 → M≈1.02253, p≈0.52302/0.47698 · 3-way
  2.50/3.30/3.10 → M≈1.02563, p≈0.39005/0.29548/0.31456 ·
  line-mismatch and missing-outcome rejections · a totals group at
  ±220.5 accepted, 220.5-vs-221.5 rejected.
- Phase 9 builds and tests the engine; nothing consumes it until
  Phase 10 (detection). No UI this phase beyond the coverage audit row.

## Test/acceptance mapping

- `planFetch` union math + zero-marginal-cost at ≤10 union books +
  cost-estimate movement at 11 (usage-accounting fixtures).
- Benchmark-kept-when-disabled: disable pinnacle → bookmakersParam still
  contains it, allowedKeys does not.
- Arb byte-identity: existing scanService/detection fixtures run with
  the benchmark flag present and produce identical outputs (the
  allowlist path is untouched by construction; the test proves it).
- Snapshots carry benchmark odds (already true via raw feed; pinned by
  a fixture asserting a benchmark book's odds survive into the stored
  snapshot).
- De-vig fixtures as above; coverage-audit benchmark block reconciles
  to hand-computed shares.

## Open questions for Ryan (blocking)

1. **Dual-role vs forced benchmark-only.** Recommendation: dual-role as
   designed — Pinnacle stays bettable (it's Ontario-licensed and
   currently carries arb legs); disable it in the panel if you'd rather
   not bet there, and the benchmark feed keeps flowing either way.
   Forcing benchmark-only would change today's arb outputs, which the
   mission forbids. Confirm dual-role, or overrule.
2. **Your enabled-book count vs the free path.** You currently have 14
   of 47 books enabled; a 14-book union fetches at 2 region-equivalents
   either way (benchmark changes nothing), but the fetch-by-books path
   only activates when strictly cheaper than the tab. Nothing breaks at
   any count — but if you want the guaranteed-cheapest configuration,
   trimming to ≤9 enabled (+pinnacle) makes every scan 1 region-
   equivalent per sport. Fine to leave as-is; flagging the economics.
3. **Per-sport benchmark reach from the latest snapshot only** (no new
   persistence) — acceptable for Phase 9? Recommendation: yes; the
   overall share already comes from full scan history.

## Deliberately out of scope (this phase)

EV detection/edges (Phase 10), any Speculative UI beyond the coverage
row, power/Shin de-vig (enum seam only), scores/grading, auto-adding
regions, any change to arb-mode behavior or tests.
