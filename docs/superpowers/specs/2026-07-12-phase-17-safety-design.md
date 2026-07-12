# Phase 17 — Safety Score (design)

Spec: docs/prompts/phase-17.md (Ryan, verbatim, binding). Gate 0 passed
2026-07-12: Phase 16 merged, 578+49 green, pipeline order confirmed
(scan → confirmation → onConfirmed fan-out → alert + Hub purchase).

## Core placement (decided)

Scoring happens ONCE, at the confirmation transition: when WP2's resolver
flips a record to 'confirmed', it computes and PERSISTS `record.safety`
(score, itemized components, reasons, rounded stakes) before the fan-out
runs. The GATE is a single pure function `passesSafetyGate(record,
settings)` applied inside exactly two consumers — WhatsApp alerts and Hub
purchases ("one gate, both paths"). The paper fund and every telemetry
surface stay ungated. Filtered records keep status/confirmation untouched
and remain fully persisted — Cost of Safety must be able to price what
safety declined.

## Engine (pure): server/src/engine/safety.ts

`scoreSafety(input) → RecordSafety` where input carries the record, the
per-outcome snapshot prices (assembled by the caller — the engine never
reads fs), the config object, and a pre-assembled ExposureView. Engine-grade:
no fs/env/Express/provider imports. Score = 50 base + Σ components, clamped
0–100; ANY hard reject → 0 with its reason.

Components (weights/thresholds all live in ONE settings object, defaults
per spec):
- a) `suspicious_edge` hard reject: strategy 'arb' && profitPct > maxSafeEdge
  (4.5). Arb-only per spec's own words (EV/middles have their own semantics).
- b) Consensus outlier, per leg, heaviest weight: median implied probability
  (1/odds) for that outcome+line across ALL books in last-snapshot.json
  (raw pre-filter feed — that's why it exists). Deviation = |legProb −
  median| / median × 100. ≤2 → 0; 2–4 → −15; 4–6 → −30; >6 → hard reject
  `off_consensus`. A leg whose outcome has <MIN_CONSENSUS_BOOKS (5) priced
  books scores −15 (`thin_consensus`, penalty not reject — honesty about
  unknowable consensus). Zero credits: snapshot already on disk.
- c) Sharp anchor: neverLimitBooks (seed: pinnacle + exchange keys present
  in the feed: betfair_ex_uk, betfair_ex_eu, betfair_ex_au, matchbook,
  smarkets). One leg +20, both +25, none 0.
- d) Market popularity: settings-editable tier map (matcher: sportKey
  prefix + marketKey). Seed Tier 1 (+10): NFL/NBA/NHL/MLB + EPL/UCL/La
  Liga/Serie A/Bundesliga on h2h+totals. Tier 3 (−20): explicit obscure
  list. Everything unlisted = Tier 2 (0).
- e) Exposure budgets + cooldown, DERIVED FROM RECORDS (no new mutable
  state; deterministic + replayable): per soft book, count records acted on
  (alerted=true OR a Hub purchase exists) touching that book — >
  maxArbsPerDay (3, Vancouver-local day) or > maxArbsPerWeek (12, trailing
  7d) → hard reject `book_exposure`. Cooldown: a soft book on the WINNING
  side (its leg graded 'win') of ≥ hotStreakCount (5) acted-on records
  within trailing 7d is rejected (`book_cooldown`) until nth-win time +
  cooldownDays (3). neverLimitBooks exempt from both. NOTE: budgets count
  acted-on records of ANY strategy (exposure is exposure); the settings
  keep the spec's maxArbsPerDay/Week names.
- f) Camouflage stakes: round each planned leg stake (the same planStakes
  dollars alerts already carry) to the nearest $5, recompute the position's
  guaranteed profit post-rounding (engine lockedProfit math); if
  post-rounding edge < the alert min-profit threshold → hard reject
  `rounding_kills_edge`. Rounded stakes persist in record.safety and become
  the PRIMARY displayed/alerted amounts; exact-optimal stakes stay
  secondary in the cockpit. EV single-leg: rounding can't kill edge —
  round for display only, component contributes 0.

Determinism: same snapshot + config + exposure inputs → identical output
(acceptance test, byte-identical).

## Settings: server/src/ops/safetyStore.ts (JsonStore, data/safety.json)

One config object, GET/PATCH /api/safety/settings: safeMode (default ON),
safetyThreshold (55), maxSafeEdge (4.5), consensus bands + weights, sharp
bonuses, tier map + tier weights, neverLimitBooks, budgets {maxArbsPerDay 3,
maxArbsPerWeek 12, hotStreakCount 5, cooldownDays 3}, roundTo (5). PATCH
validates shapes; all defaults exactly as the spec states.

## The gate

`passesSafetyGate(record, settings)`: safeMode OFF → always true (scores
still computed + persisted); ON → record.safety.score ≥ safetyThreshold.
Applied in dispatchConfirmedAlerts AND hubService's consumer — via the one
exported function, no restatement. Gate parity acceptance test: below
threshold → neither alerted nor purchased but persisted with reasons;
above → both.

## Rotation telemetry (advisory)

Pure computation over trailing-30d acted-on records: per soft book, which
outcome-side its legs held (e.g. Over vs Under, home vs away). Cockpit hint
when one side ≥ 80% of ≥5 samples: "BookX has taken the same side N of
last M — consider rotating". No rejection, no score effect.

## UI

- Cockpit + opportunity rows (Scan results, Risk Mode boards): score badge
  (NN/100; 0 = REJECTED) with expandable itemized breakdown ("−30: leg 2 is
  5.1% off consensus"). Filtered-but-persisted records visibly badged.
- WhatsApp arb alert gains EXACTLY one line `Safety NN/100` (position:
  after the Profit line, before "odds as of") and uses ROUNDED stakes as
  the leg amounts. The Phase 15 pinned-format test is AMENDED by this spec
  — update the pin, keep "nothing else" discipline otherwise. EV/middle
  alerts gain the same Safety line.
- Hub gains a Cost of Safety readout (server-computed endpoint, e.g.
  GET /api/safety/cost): this week + lifetime — confirmed-but-filtered
  count, summed hypothetical edge/profit at the profile default stake,
  broken down by rejection reason. Fixture-verified against a hand-computed
  week.
- Safety settings panel (threshold slider 0–100, safeMode toggle, book
  lists, budgets) — lives on the Advanced page.

## Shared contracts (committed with this doc)

`RecordSafety` on OpportunityRecord + `SafetySettings` + `SafetyCostReport`
in shared/types.ts — builders implement to them, never redefine.

## Out of scope (spec-verbatim)

Identity/location masking, VPNs, multi-accounting — never. No ML. No
grading/scheduling changes. No threshold auto-tuning.

## Build plan (model mix per Ryan's standing directive)

- WP-A (Opus): engine/safety.ts + safetyStore + settings routes + exposure/
  cooldown derivation + rotation computation + all component fixtures
  (12+ cases incl. every spec-named scenario).
- WP-B (Fable): pipeline integration — score-at-confirmation, the gate in
  both consumers, WhatsApp line + rounded stakes (amend pinned tests),
  Cost of Safety endpoint, gate-parity + determinism acceptance tests.
- WP-C (Sonnet): UI — badges/breakdown, settings panel, Hub Cost of Safety,
  rotation hint. DEV_MODE screenshots.
- Close-out (Fable): acceptance checklist, CLAUDE.md/PROGRESS/HANDOFF.
Sequential (A → B → C): each layer builds on the previous one's surface.
