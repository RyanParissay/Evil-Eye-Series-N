# Ledger + P&L — Design (Buildout Phase 5)

Per `docs/mission-phases-4-7.md`. One place that answers "is this making
money, where, and how fast do edges decay" — from data already persisted.

## The gap this closes first: completions carry no money

Today "completed" is a bare status flip; realized P&L is unknowable.
Changes:

- `OpportunityRecord` gains `strategy: 'arb'` (the roadmap discriminator —
  normalized default for existing files) and optional
  `execution: { filledLegs: {odds, stake}[], totalStaked, lockedProfit,
  recordedAt }`.
- `PATCH /api/opportunities/:id { status: 'completed', filledLegs? }` —
  filledLegs aligned with record.legs, each odds > 1 and stake ≥ 0. When
  present, execution is computed and stored; when absent (legacy/manual),
  the completion still counts for capture rate but is **excluded from
  realized P&L** — the dashboard reports such "unpriced completions"
  explicitly rather than inventing numbers.
- `lockedProfit(legs)` = min(stakeᵢ×oddsᵢ) − Σstakes, a pure engine
  function beside `priceLegs` (an arb's profit locks at placement; the
  min() stays honest when filled stakes deviate from the ideal split).
- Cockpit: "mark completed" opens a per-leg odds/stake form prefilled
  from the record's odds and the current bankroll scaling — confirming is
  one tap, editing is possible, and what you confirm is what's booked.

## Ledger read model (`server/src/ledger/ledgerService.ts`)

Sources: the active records file + every `data/opportunity-archive/
YYYY-MM.jsonl`, streamed line-by-line (readline over a file stream —
never a whole-file read; the 10k-record acceptance test runs against a
real temp archive). One pass computes:

- **Equity**: cumulative lockedProfit ordered by `execution.recordedAt`.
- **Monthly totals**: locked profit + completion counts per UTC month.
- **By sport**: locked profit, completions.
- **By book**: stake-weighted attribution — an arb's profit isn't truly
  per-book, so each book gets `lockedProfit × (its stake / totalStaked)`,
  labeled "stake-weighted" in the UI, plus total staked there.
- **Capture rate**: completed ÷ alerted (counts; unpriced completions
  count as captured).
- **Decay**: detection profit vs latest evidence — realized % for priced
  completions, `profitPct` for records re-sighted/verified after
  detection. Records never seen again after detection are excluded (their
  decay is unknown, not zero). Overall and per book (a record contributes
  its decay to each leg book).

Endpoints: `GET /api/ledger/summary` (all aggregates + unpriced count),
`GET /api/ledger/export.csv` (streamed; one row per opportunity, wide
per-leg columns up to 3 legs: book/outcome/last odds/per-$100 stake/
filled odds/filled stake; strings quoted, `"` doubled, cells starting
with `=+-@` prefixed with `'` — Excel-safe; round-trip parse test
recovers the summary total to the cent).

## Dashboard (`/ledger`, existing design system)

Equity line is a hand-rolled inline SVG (no new dependencies), one line,
tabular-figure axis labels; tables for monthly / by book / by sport /
decay; capture rate and unpriced-completions stat words. All dollars from
server-computed numbers — the client does zero money arithmetic.

## Out of scope

Paper-trading series (Phase 6 lands them on this page), CLV (roadmap),
score-based settlement (arbs don't need scores).
