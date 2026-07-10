# Fund Position & Bankroll Ops — Design (Buildout Phase 7)

Per `docs/mission-phases-4-7.md`. The cash pool becomes a first-class
citizen: exact dollars in alerts and cockpit from persisted bankroll
state, balance-aware caps, and reconciliation after execution.

## Fund settings

`data/fund.json` (JsonStore): `{ totalBankroll, defaultStake,
unallocatedCash }`, all manual-entry dollars. `GET/PATCH
/api/fund/settings`. The cockpit's bankroll input now defaults to
`defaultStake` (per-visit override stays; localStorage is the fallback
when no settings exist yet).

## Stake planning — one implementation, used by everything (decision)

`shared/stakePlanning.ts` — pure, dependency-free `planStakes(legs{odds},
targetTotal, balances)`:

- Ideal shares from odds: shareᵢ = (1/oddsᵢ)/S.
- A leg's stake may never exceed its book's recorded balance. When one
  would, the WHOLE position rescales down to the binding book
  (totalStaked = min(target, minᵢ balanceᵢ/shareᵢ)) — proportions stay
  intact, so the profit stays guaranteed; `capped`/`cappedBy` report it.
  Unknown (null) balances don't constrain.
- Returns stakes (cents), totalStaked, guaranteedProfit (worst-leg payout
  − total, same math as engine lockedProfit), capped, cappedBy.

This deliberately amends "the client computes no arb math": the cockpit
now *runs the same single tested function* the alert path uses, which is
the point — cap math must not exist twice. It lives in `shared/` because
both sides need it and `shared/` is the only dependency-free layer both
import. Tests live in the server workspace beside the engine tests.
`client/src/cockpit.ts#scaleLegStakes` is deleted in favor of it.

## Alerts carry exact dollars

`AlertDeps` gains `planStakes?: (arb) => StakePlan | null` (wired in
index.ts from fund settings + registry balances). When present,
`formatAlertMessage` renders per-leg dollars ("Bet365: Lakers @2.1 →
$244.05"), a total + guaranteed line, and "(capped by X balance)" when
capped. Without settings it falls back to today's per-$100 format.

## Fund position & warnings

`GET /api/fund/position`: settings, totalFloat (Σ registry balances),
real cumulative P&L (LedgerService total), paper equity alongside
(`simulated: true`), and warnings — `lowBalance` (enabled book with
balance < defaultStake) and `staleBalance` (balance last touched ≥ 14
days ago; `BookmakerConfig` gains `balanceUpdatedAt`, stamped by PATCH
whenever the balance value changes). Rendered as a compact panel on the
scanner page — no new page.

## Reconciliation: apply-to-balances with exact revert (decision: undo)

Completing books the money; after the event, the user knows the winner:

- `POST /api/opportunities/:id/apply-balances { winningLegIndex }` —
  requires completed + execution + not yet applied. Each leg's book:
  balance − filledStake; the winning leg's book: + filledStake ×
  filledOdds. What was applied is stored on the execution
  (`balancesAppliedAt`, `winningLegIndex`), and
- `POST /api/opportunities/:id/revert-balances` applies the exact
  inverse and clears the marker. An exact stored inverse beats a free-
  form correction path: balances remain manual-entry (the bookmaker
  panel edits anything), so the only bookkeeping this feature owns is
  its own reversible delta. We never touch bookmaker accounts.

Cockpit UI on a completed record: winning-leg selector + "Apply to
balances" / "Applied ✓ · Revert".

## Acceptance mapping

planStakes hand fixtures (uncapped, capped-rescale keeps guaranteed
profit positive and proportional, cappedBy, null balances); message
format tests incl. capped; balanceUpdatedAt stamping; warnings fire at
thresholds and not otherwise; apply/revert round-trip leaves balances
byte-identical; balances survive restart via the existing JsonStore.
