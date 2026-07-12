# PHASE 17 — Safety Score (account-longevity filter)

Read `docs/GRADING_RULES.md` and `docs/HANDOFF_PROTOCOL.md` first. This phase adds a
deterministic filter that gates BOTH alert delivery and profile auto-purchase on an
opportunity "Safety Score" — a measure of how likely acting on it is to get a bookmaker
account limited. No ML, no LLM calls: countable rules only, every score explainable.

## Gate 0
Confirm Phase 16 (confirmation scanning + Analytics Hub) is merged and green. The Safety
gate sits AFTER confirmation in the pipeline: scan → 60 s confirmation → Safety gate →
alert + auto-purchase.

## Core principle
Filtered opportunities are still PERSISTED to history with their score and itemized
rejection reasons — only alerting and purchasing are gated. We must always be able to
measure what safety costs in forgone edge.

## Deliverables

### 1. Safety Score engine (0–100, deterministic)
Compute per confirmed opportunity, from data already on hand:

a) **Edge cap — hard reject.** Arb edge > `maxSafeEdge` (default 4.5%, settings) → score 0,
   reason `suspicious_edge`. Rationale: likely palpable error or trap line; voided legs
   and instant flags live here.

b) **Consensus outlier — heaviest weight.** For each leg, compute the median implied
   probability for that outcome across ALL books in the current snapshot (~49). Deviation
   of the leg's price from consensus, in percent:
   ≤2% → no penalty; 2–4% → −15; 4–6% → −30; >6% → hard reject (`off_consensus`).
   Zero API credits — snapshots already exist.

c) **Sharp anchor.** Settings list `neverLimitBooks` (seed: Pinnacle, betting exchanges).
   One leg on the list → +20. Both legs on it → +25. Neither → 0 (not a rejection).

d) **Market popularity.** Settings-editable tiers. Tier 1 (NFL/NBA/NHL/MLB/major-soccer
   h2h + totals) → +10. Tier 2 (secondary leagues, spreads) → 0. Tier 3 (obscure
   leagues/markets) → −20.

e) **Per-book exposure budget.** Settings per soft book: `maxArbsPerDay` (default 3) and
   `maxArbsPerWeek` (default 12), counting only alerted/purchased opportunities. Book over
   budget → hard reject (`book_exposure`). Cooldown: a soft book on the winning side of
   ≥ `hotStreakCount` (default 5) arbs within 7 days is rested for `cooldownDays`
   (default 3) → hard reject (`book_cooldown`). Books on `neverLimitBooks` are exempt
   from budgets and cooldowns.

f) **Camouflage stake check.** Compute stakes rounded to the nearest $5 (each leg),
   recompute guaranteed profit post-rounding. If post-rounding edge < the profile/alert
   min-edge threshold → hard reject (`rounding_kills_edge`). Rounded stakes become the
   primary displayed/alerted numbers; exact-optimal stakes shown secondary in the cockpit.

Score = 50 base + bonuses − penalties, clamped 0–100; any hard reject → 0. Persist per
opportunity: final score, every component with its contribution, and reasons. Weights and
thresholds live in one config object, settings-editable, with the defaults above.

### 2. The gate
- Settings: `safeMode` toggle (default ON) and `safetyThreshold` slider 0–100 (default 55).
- When ON: only opportunities with score ≥ threshold are alerted (WhatsApp + in-app) or
  auto-purchased into Analytics Hub profiles. One gate, both paths, identical behavior.
- When OFF: everything flows as before, but scores are still computed and persisted.

### 3. Rotation telemetry (inform, don't block)
Track per soft book: count of times it held each side (arb leg A vs B) over trailing 30
days. Surface an imbalance hint in the cockpit ("BookX has taken the same side 9 of last
10 arbs — consider rotating") — advisory only, no auto-rejection.

### 4. UI
- Cockpit + opportunity rows: score badge with expandable breakdown (each component and
  its ± contribution — "−30: leg 2 is 5.1% off consensus").
- WhatsApp alert gains one line: `Safety NN/100`, and uses rounded stakes as the amounts.
- Analytics Hub gains a **Cost of Safety** readout: this week and lifetime — number of
  confirmed opportunities filtered, their summed hypothetical edge/profit at default
  stake, broken down by rejection reason. This is the evidence for tuning the threshold.

### 5. Tests (fixture-driven, no live API)
- Each component: at least one pass and one reject/penalty case (12+ cases total),
  including: 5% edge → hard reject; 6.5% off-consensus leg → hard reject; Pinnacle-anchored
  arb scores ≥ soft-soft twin; book at daily cap → reject; hot-streak cooldown fires and
  expires; rounding-kills-edge reject; rounded stakes recompute profit to the cent.
- Gate parity test: an opportunity below threshold is neither alerted nor purchased, but
  IS persisted with reasons; above threshold it is both.
- Determinism: same snapshot + config → identical scores.

## Out of scope
Anything involving identity, location masking, VPNs, or multi-accounting — never build,
suggest, or support these. No ML scoring. No changes to grading or scheduling. No
auto-tuning of the threshold (the Cost of Safety readout informs the human).

## Acceptance checklist
- [ ] Gate 0 verified; pipeline order is confirmation → safety gate
- [ ] All fixture tests green; determinism test green
- [ ] Filtered opportunities visible in history with itemized reasons
- [ ] WhatsApp alert shows safety line + rounded stakes (test alert rendered)
- [ ] Cost of Safety readout matches a hand-computed fixture week
- [ ] Settings expose toggle, threshold, weights, book lists, budgets with stated defaults
- [ ] Full suite green; `docs/PROGRESS.md` + `docs/HANDOFF.md` updated
