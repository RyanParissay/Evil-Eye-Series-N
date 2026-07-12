# HANDOFF — 2026-07-11 (Phase 15 complete — Fable Gate 0, then Opus WP1 next)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/PROGRESS.md
3. docs/superpowers/specs/2026-07-11-phase-16-design.md (the next phase's design)
4. this file

## Where we are
- Current phase & task: Phase 15 (docs/prompts/phase-15.md) COMPLETE — all 7
  deliverables landed and committed. Next per the Phase 16 design doc's build
  order: step 0, Gate 0 report (Fable) verifying this handoff, THEN WP1 (Opus) —
  scheduler foundation. Not started.
- Last commits (this session, in order): #2 scan history browser, #1 book
  leaderboards, this wrap-up (CLAUDE.md + PROGRESS.md + HANDOFF.md). #4/#5/#7/#6/#3
  landed in the prior session (see git log for exact hashes).
- Tests: 411 server + 34 client green (was 394 + 34 at session start — this
  session added 8 server tests for #2, 9 for #1). Typecheck green. No server
  timers introduced.

## In flight RIGHT NOW
- Nothing in flight. Tree clean once this commit lands.

## Done this session
- **#2 scan history browser**: `GET /api/ops/scans?lastN=` (`server/src/ops/scanBrowser.ts`,
  pure `buildScanBrowser`) reads scanHistoryStore JSONL newest-first and attaches
  each scan's opportunities by matching detection/sighting timestamps into that
  scan's SLOT — `(previous scan's timestamp, this scan's timestamp]`, scoped to
  the same region tab and a sport the scan actually covered (same scoping
  discipline as the existing "provenGone" dead-detection rule). Phase-13 gap
  indicators are reused from `gapDetector.ts` verbatim, rendered inline between
  rows. Client: new `/scans` page, linked from Scanner and Ledger nav lines; rows
  expand via `OpportunityCard` (which already gates cockpit deep-links on a known
  record id — no new logic needed there).
- **#1 book leaderboards**: `server/src/ops/leaderboardStore.ts` (JsonStore at
  `data/leaderboard.json`) accrues, PER SCAN inside `runScan` alongside scanLog —
  per book: appearances in the raw feed, opportunity-leg counts by strategy
  (arb/ev/middle), first/lastSeenAt; plus `totalScans` and a `createdAt` stamped
  once on first accrual ("since `<date>`" in the UI, explicitly NOT "since paper
  start"). No provider anywhere in that file's import graph — zero credits is
  structural. `GET /api/ops/leaderboard`; table added to the Ledger evidence
  panel (`EvidencePanel.tsx`).
- **Wrap-up**: CLAUDE.md layering updated (new `grading/` and `portfolios/`
  module sections — previously undocumented despite existing since Phases 13/14
  — plus `ops/gapDetector.ts`, `scanBrowser.ts`, `leaderboardStore.ts`,
  `backupService.ts` added to the `ops/` entry) and three new Gotchas bullets
  (backupService never times, leaderboard accrues forward only + share
  recomputed at read time, /scans regionTab scoping is intentional).
- **DEV_MODE walkthrough**: separate mock stack, `PORT=8790 DEV_MODE=true` server
  + a Vite instance on `:5190` via a throwaway `client/vite.mock-walkthrough.config.ts`
  (deleted after use, never committed) proxying to it — driven with
  `playwright-core` + system Chrome headless (`npm install playwright-core
  --no-save` into the scratchpad, not this repo's package.json). Screenshotted and
  eyeballed: Scanner (credit widget), `/scans` (collapsed + expanded drill-down),
  Ledger (grading section + the new leaderboard table), all 4 `/portfolios` tabs.
  Found and fixed one real bug: the `/scans` Sports column had no length limit,
  so scans covering 20+ leagues produced unreadably tall rows — now summarized to
  the first 3 + "+N more" with the full list on hover (`summarizeSports` in
  `ScanHistoryPage.tsx`).

  **Data touched and restored** (mock server shares `server/data/` with the real
  `:8787` process — no env override for that path exists): before starting the
  mock server, took a full `cp -a server/data` snapshot to the scratchpad.
  Triggered exactly one mock scan (`POST /api/scan {topN:3, regionTab:"ca"}`) to
  populate real-looking data for the leaderboard/scan-browser screenshots. That
  scan (and its fire-and-forget notifier/backup hooks) touched: `bookmakers.json`
  (recordSeen), `last-scan.json`, `last-snapshot.json`, `opportunities.json`
  (re-detected two pre-existing ca_us records), `scan-history/2026-07.jsonl`
  (appended a line), and `whatsapp.json` (dev-mode alert dispatch recorded a
  sentAlerts entry) — plus created `leaderboard.json` fresh (didn't exist before).
  `BACKUP_DIR` was pointed at a scratchpad temp dir, so `server/data/backups/`
  was never touched (verified). After screenshots: killed both mock processes,
  confirmed the real `:8787`/`:5173` listeners were untouched, restored the six
  changed files byte-for-byte from the snapshot, and deleted `leaderboard.json`
  (it didn't exist pre-walkthrough). Final `diff -r` against the snapshot came
  back identical — verified, not just asserted.

## Next actions (exact order, per the Phase 16 design doc's build order)
1. Gate 0 report (Fable) — verify this handoff and the two Phase 15 landings
   against docs/prompts/phase-15.md's acceptance checklist before WP1 starts.
2. WP1 (Opus): scheduler foundation — `server/src/scheduler/` module, pure
   `plan.ts`, quiet hours (01:00–08:00 America/Vancouver, DST-safe via Intl/IANA,
   never a fixed UTC offset), server-side `enabled` toggle + quota self-disable,
   gap-detector rewire (compare actual history against the scheduler's own plan),
   client auto-scan timer retirement, and the CLAUDE.md invariant rewrite ("no
   server-side schedulers" → "all wall-clock scheduling lives in
   server/src/scheduler/, exactly one self-rescheduling tick"). DST-safe
   simulated-24h test required.
3. WP2–WP4 follow per the design doc's build order (confirmation pairs, dense
   week + weekly optimizer, then the Analytics Hub server + client).

## Traps for the incoming agent
- Run vitest from `server/` (repo root loses the `@shared` alias — standing gotcha).
- The live dev server on `:8787` runs `tsx watch` against Ryan's REAL data and
  REAL API key — never `POST /api/scan` there. For any live-process testing,
  launch a separate instance on its own port, same as this session's walkthrough.
- `server/data/` has no env override for its path (`DATA_DIR` is a hardcoded
  relative constant) — any second server instance shares it with the real one.
  If you need to exercise a scan end-to-end, snapshot first, restore after, and
  say so in the handoff (see "Data touched and restored" above for the pattern).
- Phase 16 WP1's invariant flip is a big deal: CLAUDE.md's "scans are on-demand
  only / no server-side schedulers" line is being RETIRED, not just amended —
  read the design doc's exact replacement wording before touching it.
- Phase 15's `confirmSecondSighting` ops toggle is SUPERSEDED by Phase 16 WP2's
  scan-A/scan-B confirmation — don't extend the old toggle, and don't leave it
  live in the UI once WP2 lands.

## First prompt to paste into the new agent
"Read CLAUDE.md, docs/PROGRESS.md, docs/superpowers/specs/2026-07-11-phase-16-design.md,
and docs/HANDOFF.md, then continue from 'Next actions' step 1 (Gate 0) or step 2
(WP1) depending on which agent you are. Do not re-plan completed work."
