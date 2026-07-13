# PHASE 18 — CLV capture (closing line value, zero credits)

Authored by Claude (Fable), approved by Ryan 2026-07-13. Read
`docs/HANDOFF_PROTOCOL.md` first. Grading stays Phase 13's job; scheduling
stays Phase 16's.

## Why
P&L needs weeks to beat variance; CLV answers "are we picking real edges?"
in days. Beating the closing line consistently is the strongest known
predictor of long-term winning. The scheduler already scans frequently, so
the last scan before an event commences approximates its closing line at
ZERO extra credits.

## Deliverables

1. **Closing capture (zero credits, structural).** Piggybacking on every
   scan (same fire-and-forget discipline as leaderboards/backups): for every
   persisted record whose event appears in the fresh snapshot and has not
   commenced, overwrite `record.closing` — per-leg odds at each leg's OWN
   book for the exact outcome+line, per-leg benchmark (Pinnacle) odds and
   de-vigged fair probability where available, capturedAt, minutes-to-
   commence. Once commence passes, the last write is frozen (never
   overwritten). ALL records participate — confirmed, gate-filtered,
   single_sighting, legacy — the gates' quality is exactly what CLV must
   measure.
2. **Bet-basis stamping.** At the confirmation transition, stamp
   `confirmation.confirmedLegOdds` (scan B's fresh odds — what a bettor
   acting on the alert gets). Execution basis already exists
   (execution.filledLegs odds).
3. **CLV math (pure, engine/).** Per leg: raw CLV% = (basisOdds ÷
   closingOdds − 1) × 100. Where benchmark closing exists: true CLV% =
   basisOdds × devigged fair closing probability − 1, in %. Per record:
   stake-weighted across legs. Signal CLV uses confirmedLegOdds; execution
   CLV uses filledLegs. Missing closing legs are EXCLUDED, never zeroed.
4. **Summary + evidence UI.** GET /api/clv/summary: by strategy × gate
   outcome (alerted / safety-filtered / single_sighting) and by book —
   count, mean/median CLV, % beating close, signal vs execution split, plus
   capture coverage (records-with-closing %, median minutes-to-commence of
   frozen closings). Ledger evidence panel gains a CLV section; the cockpit
   shows the record's own CLV line once its closing freezes.

## Out of scope
No new provider calls anywhere in the clv dependency graph. No Kelly, no
threshold auto-tuning, no changes to grading/scheduling/safety.

## Acceptance
- [ ] Zero credits structural (no provider import in the clv graph)
- [ ] Fixture: scan closer to commence overwrites the candidate; a
      post-commence scan does NOT (frozen)
- [ ] Golden CLV math tests, hand-computed, incl. a de-vigged benchmark
      case and excluded-null legs
- [ ] confirmedLegOdds stamped at confirmation (fixture through the real
      pair pipeline)
- [ ] Summary segments match a hand-built fixture population exactly
- [ ] Coverage stats shown; records without closing excluded, never zeroed
- [ ] Full suite green; PROGRESS.md + HANDOFF.md updated
