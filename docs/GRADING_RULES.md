# GRADING_RULES.md — Settlement rules of record

These rules are binding for all auto-grading code. Any agent (Claude Code, Codex) working on
grading, portfolios, or P&L must read this file first. If a situation is not covered here,
flag the record `needs_rules` and surface it in the UI — never guess.

## 1. Sports rules table (seed data)

Grading is driven by a per-sport rules table, not hardcoded logic. Seed entries:

| Sport            | Totals/Spreads include OT? | Typical duration (for score polling) |
|------------------|----------------------------|--------------------------------------|
| NBA              | Yes                        | 2.5 h                                |
| NFL              | Yes                        | 3.5 h                                |
| NCAAF            | Yes                        | 3.5 h                                |
| NCAAB            | Yes                        | 2.5 h                                |
| NHL              | Yes (incl. OT/SO for ML; totals per book standard: 3-way excluded, 2-way included) | 3 h |
| MLB              | Yes (extra innings)        | 3.5 h                                |
| Soccer (all leagues) | **No — regulation only (90' + stoppage)**. ET/pens excluded. | 2.5 h |

- A sport appearing in recorded opportunities with no rules entry: records flagged `needs_rules`,
  excluded from P&L, counted in a visible "ungradeable" bucket.
- Per-market overrides are allowed in the table (e.g., a specific market keyed to regulation time).

## 2. Result taxonomy

Every graded record gets exactly one of: `win`, `loss`, `push`, `void`, plus flags.

- **Push**: line lands exactly on a whole-number spread/total → stake refunded, P&L = 0.
  Excluded from win-rate calculations; included in total record counts.
- **Void**: game cancelled/postponed beyond re-schedule window, or market voided → stake refunded, P&L = 0.
- **Broken arb** (one leg voided, other stands): surviving leg grades at its REAL result.
  Record flagged `broken_arb`. The paper P&L must show the true outcome, including losses.
  Never mark the whole opportunity void when one leg stood.
- **Half-points** never push. Whole and half lines must both be covered by tests.

## 3. Manual override

- Any record can be manually graded from its row: result + optional note.
- Sets flag `manually_graded`. Manual grade ALWAYS wins — auto-grading and score re-polls
  must never overwrite it.
- Every override appends to an audit log: timestamp, old value, new value, note.

## 4. Score polling policy (credits discipline)

- Poll scores ONLY for games with at least one open (ungraded) recorded position.
- First poll: scheduled start + typical duration (table above) + 30 min buffer.
- Retry every 45 min until final score obtained.
- Give up after 24 h past scheduled start → flag `ungraded_stale`, surface in UI, stop polling.
- Hard cap: 500 credits/day for the scores endpoint. When hit: stop polling, show warning
  banner, resume next day. All scores-endpoint spend goes through the existing credit accounting.

## 5. Paper series semantics (Phase 14 depends on these)

- Every series starts with a $10,000 paper bankroll.
- Flat staking. No compounding in v1 (comparability across the 13 series is the point).
- EV risk tiers: High = 3%, Med = 2%, Low = 1% of series bankroll per trade.
- If a series cannot afford a signal's stake: skip the trade, log a
  `skipped_insufficient_bankroll` event (visible and counted per series).
- Arbs remain deterministic: graded from fills/odds math, not scores, except broken-arb
  handling above.

## 6. Schema versioning

- All persisted opportunity/record JSONL gets a `schemaVersion` field from Phase 13 onward.
- Historical records lacking grading fields (game ID, scores): excluded from graded P&L,
  counted in a visible "ungradeable (pre-v13)" bucket. Never silently dropped.
