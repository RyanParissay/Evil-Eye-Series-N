# HANDOFF_PROTOCOL.md — Seamless agent transition (Fable → Codex / Opus)

This protocol guarantees that at any moment, a fresh agent (Codex, Claude Opus, or a new
Claude Code session) can resume work with zero verbal briefing. The mechanism is a single
always-current file: `docs/HANDOFF.md`.

## Standing instructions to the working agent (Claude Code / Codex)

1. **Continuous maintenance.** Update `docs/HANDOFF.md` after completing each deliverable
   item, before starting any risky/multi-file change, and at the end of every session.
   It must never be more than one task stale.

2. **Emergency dump triggers.** Immediately rewrite `docs/HANDOFF.md` in full — before
   doing anything else — when ANY of these occur:
   - You receive a context-window-low or auto-compact warning
   - You receive any rate-limit / usage-limit warning from the platform
   - The user types `handoff` (alone, as a message)
   Then commit it: `git add -A && git commit -m "handoff: <phase> <task> state dump"`.

3. **Never leave the repo broken at handoff.** If mid-change when a trigger fires: either
   finish the smallest coherent piece and commit, or stash/revert to last green state and
   record exactly what was reverted in HANDOFF.md.

## Required HANDOFF.md template

```markdown
# HANDOFF — <date time>
## For the incoming agent (Codex or Claude): read these first, in order
1. AGENTS.md / CLAUDE.md  2. docs/GRADING_RULES.md  3. docs/prompts/<current phase>.md  4. this file

## Where we are
- Current phase & task: <e.g., Phase 13, deliverable 3: auto-grading engine>
- Last commit: <hash + message>  |  Tests: <green / failing: which>
- Done since last handoff: <bullets>

## In flight RIGHT NOW
- <files mid-edit, approach being taken, what's half-done, anything reverted>

## Next actions (exact order)
1. <specific next step, file paths included>
2. ...

## Decisions made this session (and why)
- <anything not yet reflected in the docs>

## Traps for the incoming agent
- <gotchas: fixture quirks, env vars, "don't touch X", credit-spend warnings>

## First prompt to paste into the new agent
"Read AGENTS.md, docs/GRADING_RULES.md, docs/prompts/<phase>.md, and docs/HANDOFF.md,
then continue from 'Next actions' step 1. Do not re-plan completed work."
```

## Optional automation (user setup, 5 min)
Claude Code supports hooks. Adding a `PreCompact` hook that runs a reminder (or a script
that flags HANDOFF.md as stale) makes the emergency dump automatic even if the model
forgets. See Claude Code hooks docs. Not required — the standing instructions above are
the primary mechanism.
