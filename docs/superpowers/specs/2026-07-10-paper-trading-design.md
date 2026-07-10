# Paper Trading ("shadow fund") — Design (Buildout Phase 6)

Per `docs/mission-phases-4-7.md`. Prove risk-free what acting on 100% of
alert-worthy opportunities would have earned. Everything below is labeled
SIMULATED in the UI, in API payloads (`simulated: true`), and in exports.

## Shared selection core (the refactor this phase hinges on)

`alertService.selectAlerts` couples qualification to WhatsApp
subscriptions. Extracted pure core, strategy-agnostic:

```ts
alertWorthy(opportunities, thresholdPercent, alreadySeen(fingerprint) ⇒ bool)
  → Array<{ opportunity, fingerprint }>
```

Rules unchanged and stated once: non-suspicious, non-same-book, profit ≥
threshold, fingerprint not already seen. `selectAlerts` rewires onto it
(per-subscription threshold + per-phone sent-set + rate-limit budget on
top); the existing alertService test suite must pass untouched — that is
the proof WhatsApp behavior is identical. The paper book calls the SAME
function — no duplicated selection logic anywhere.

## Entry rule

Hook: the notifier composition in `index.ts`, AFTER
`bookmakerService.filterAlertable` (limited/dead/disabled books never
alert, so they never paper-trade either) — same pipeline as a real push,
still scan-driven, no schedulers. Paper has its own `thresholdPercent`
setting (default 2, the WhatsApp connect default) because a paper fund
must work with no WhatsApp subscriber at all; when both exist they are
deliberately independent knobs. Dedup: a re-sighted fingerprint never
enters twice (the store keeps every fingerprint ever entered). Entries
capture alert-time facts only: event fields, legs (odds at entry),
profitPct at entry, enteredAt, commenceTime.

## Settlement: facts in the store, math computed on read

A two-leg arb taken at both quoted prices has outcome-independent profit,
so no scores are needed: an entry realizes `stake × profitPct/100` at its
commence time. `settlePaperBook(entries, settings, now)` is pure and
deterministic:

- Entries process in enteredAt order. Flat staking uses the configured $;
  %-of-bankroll uses the bankroll AT ENTRY = starting + profits of entries
  already commenced by that moment (that's the compounding rule, and it's
  testable to the cent).
- Not-yet-commenced entries hold stake but realize nothing yet (lazy
  settlement — computed on every read, no timers, zero credits).
- **Haircut** series: expectation-based, `ideal × (1 − haircut%/100)` per
  entry. Default **20%**: our own verification sample is still too thin to
  derive a rate from persisted degradation data (the design intent), and
  20% sits at the conservative end of published void/degraded rates for
  real arb execution. It is a setting; revisit once capture-rate data
  accumulates. Displayed alongside ideal, never instead of it.
- Changing settings (stake rule, haircut, starting bankroll) recomputes
  the whole simulation from stored facts — this is a model, not
  bookkeeping, and the store stays facts-only.

## Isolation

`data/paper.json` (own JsonStore): `{ settings, entries }`. Nothing in the
paper path touches bookmaker balances, opportunity records, WhatsApp state,
or credits. Reset zeroes entries after a confirm. Toggling paper mode off
hides the UI section; data is preserved and the API still serves it.

## API

- `GET /api/paper` → `{ simulated: true, settings, book }` where book =
  settled entries + ideal/haircut equity series + current bankrolls.
- `PATCH /api/paper/settings` (validated; partial).
- `POST /api/paper/reset` → clears entries.

## UI

A SIMULATED-badged section on `/ledger`: settings row (enable, starting
bankroll, flat-$/percent stake rule, haircut %, threshold), ideal +
haircut equity (EquityChart grows an optional dashed second series +
legend — red ideal, white dashed haircut, validated), and a monthly
ideal / haircut / real side-by-side table (real from the Phase-5 ledger).

## Acceptance mapping

Shared-logic test proves entries == would-be alerts over a scan sequence
including dedup; settlement fixtures verify flat and compounding staking
to the cent and independent ideal-vs-haircut math; isolation tests assert
the real stores are untouched by every paper operation; `simulated: true`
asserted on API payloads.
