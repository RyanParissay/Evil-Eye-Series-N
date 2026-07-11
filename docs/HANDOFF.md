# HANDOFF — 2026-07-11 (Fable session, Ryan away)
## For the incoming agent (Codex or Claude): read these first, in order
1. CLAUDE.md  2. docs/GRADING_RULES.md  3. docs/prompts/phase-13.md  4. this file

## Where we are
- Current phase & task: Phase 13 COMPLETE (committed). Next: Phase 14 (delegated to Sonnet subagent)
- Last commit: see git log | Tests: 319 green (300 prior + 19 golden)
- Done since last handoff: protocol docs committed; shared types (RecordGrading,
  schemaVersion, homeTeam/awayTeam); config/gradingRules.ts (rules table §1 + poll policy
  constants §4); engine/grading.ts (pure, gradeRecord); 19 golden tests green.

## In flight RIGHT NOW
- Phase 14 delegation in flight: scenario engine (13 series) + portfolio views + Markowitz optimizer per docs/prompts/phase-14.md.

## Next actions (exact order)
1. Verify subagent output: npm test + npm run typecheck green from repo root.
2. DEV_MODE=true walkthrough: scan → fixture scores → auto-grade → manual override survives.
3. Commit Phase 13; update docs/PROGRESS.md (13 done, next 14).
4. Phase 14 per docs/prompts/phase-14.md (scenario engine is pure — good Sonnet delegation).

## Decisions made this session (and why)
- Signal-level grading (record.grading) is SEPARATE from execution grading (real fills) —
  Phase 14 series need every signal graded regardless of whether Ryan bet it.
- No server-side scheduler (CLAUDE.md invariant): score polling = server-side due-time
  bookkeeping executed on client ticks + scan completions. §4 timings are "due" rules.
- Pre-v13 records with eventId+legs remain gradeable if scores still available (better than
  spec minimum); scores endpoint only reaches ~3 days back so older history lands in the
  ungradeable (pre-v13) bucket naturally.
- Arb signal = deterministic win at profitPct per §5; broken-arb via voidLegs input.
- 2-way h2h tie with no draw leg → push (stake back).
- Soccer regulation-only: The Odds API reports one final score; ingestion treats it as
  regulation (API can't distinguish ET) — TRAP, documented.

## Traps for the incoming agent
- Run vitest from server/ (repo root loses @shared alias — known gotcha).
- Never call live scores endpoint in tests; MockOddsProvider needs fetchScores fixtures.
- Credits are real; scores calls cost credits — 500/day cap per §4 is binding.
- data/ is Ryan's runtime state — clean any test artifacts you create.

## First prompt to paste into the new agent
"Read CLAUDE.md, docs/GRADING_RULES.md, docs/prompts/phase-13.md, and docs/HANDOFF.md,
then continue from 'Next actions' step 1. Do not re-plan completed work."
