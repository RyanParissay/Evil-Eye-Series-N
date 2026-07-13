# HANDOFF — 2026-07-13 (Phase 18 COMPLETE: server + CLV UI)

## For the incoming agent: read first, in order
1. CLAUDE.md (the `clv/` layering entry + the CLV capture gotcha)
2. docs/prompts/phase-18.md (Ryan-approved spec, binding)
3. shared/types.ts — RecordClosing, ClvCell, ClvSummary, confirmedLegOdds
4. docs/PROGRESS.md  5. this section

## Phase 18 UI — DONE this session (Fable, on main)
- **Ledger CLV section** (client/src/components/ClvPanel.tsx, rendered by
  EvidencePanel between the scoreboard and the evidence tables), reading
  order = honesty order:
  1. Coverage header ("41 of 47 records carry a closing line · median
     capture 45 min before start"; frozen-only median, "first freeze
     pending" while null). recordsWithClosing === 0 → ONE directive empty
     line ("Closing lines start freezing with tonight's games"), nothing else.
  2. Headline tiles: ALERTED signal CLV per strategy. Where trueClv exists
     it is the authoritative big number ("vs sharp close") and own-book raw
     drops to a secondary line; execution (fills basis) appends as a final
     line where completed fills exist.
  3. The gate ledger — THE differentiator: alerted / safety-filtered /
     single-sighting per strategy on ONE structural grid (.clv-gates is the
     grid; groups and rows are display:contents), so every diverging bar
     shares one zero axis. Positive mean CLV runs right in red (the app's
     money-up ink), negative left in grey. Margin line per strategy in pp;
     a challenger cell whose mean ≥ alerted at n≥10 gets a red "≥ alerted"
     chip + "the gate may be discarding value" note. Small-N challengers
     can NEVER trigger the flag.
  4. byBook table, top 8 rows by LEG count (byBook cell.records = legs),
     with a "sharp" column where the benchmark quoted.
  - Small-N honesty app-wide: any cell with n<10 renders muted grey with an
    "n<10" chip (chip-mock, not warn — honesty, not danger).
- **Cockpit CLV readout** (/opportunity/:id): shown ONLY when
  record.closing exists AND the event commenced (a rolling closing shows
  nothing — the close hasn't frozen). Basis label (fills basis when
  execution.filledLegs exist, else alert basis) + capture lead, the
  stake-weighted record figure raw + true, per-leg "got 2.10 / closed
  1.95 → +7.69% · sharp +3.95%"; unpriced legs read "closed — · excluded,
  not priced at the freeze" with a renormalization note.
- **client/src/clv.ts** — pure display helpers, 31 hand-computed tests.
  cockpitClv is the ONE place the client computes CLV: a display-grade
  mirror of server engine/clv.ts (excluded null legs, renormalized
  weights, degenerate equal-weight fallback; the ENGINE is the authority —
  one deliberate divergence: zero-usable-legs returns per-leg rows so the
  cockpit can explain WHY it's unmeasured instead of going silent).
- **Display semantics pinned in tests**: meanClvPct is a percentage value
  (5 → "+5.00%"); beat shares are fractions ×100 ("62%"); differences
  between cells are pp ("+1.80pp"). CLV is measured evidence: is-up red /
  is-down grey, NEVER yellow, no "guaranteed" language.
- Verified visually (temp-copy repo on :8814/:5175, seeded fixtures) at
  1280 + 390: healthy story (alerted +2.1 / filtered +0.3 / single
  −0.5), the ≥-alerted warn state, small-N cells, missing trueClv,
  zero-coverage empty state, cockpit frozen/excluded-leg/rolling records.
  No page-level horizontal scroll at 390 (probe-checked).
- Tests: 686 server + 99 client (68 + 31), root typecheck green.
- NOTE (pre-existing, not this session's): routes/clv.test.ts's 500-path
  test emits an unhandled 'archive read failed' rejection that can
  NONDETERMINISTICALLY fail an unrelated test in full-suite runs (seen
  once; reruns green 686). Worth pinning down in a hardening pass.

## Where we are — Phase 18 (CLV capture), SERVER done this session (Opus)
- Zero-credit closing capture is LIVE: clv/clvCapture.ts (PURE, no provider)
  builds record.closing from the raw snapshot each scan already fetched —
  per-leg own-book price, benchmark (Pinnacle) price, de-vigged fair prob —
  for every not-yet-commenced record whose event is in the snapshot; it rides
  runScan's notifier fire-and-forget (like leaderboards/backups). ROLLING
  OVERWRITE + FREEZE at commence, enforced structurally in BOTH captureClosings
  and OpportunityService.applyClosings. It ONLY writes record.closing fields —
  safe on the hot-reloading :8787 (it will start populating closings on the
  live server's next scans).
- Signal-CLV basis: confirmation.confirmedLegOdds is stamped in
  matchConfirmationPair from scan B's fresh legs for every RE-SIGHTED record
  (confirmed AND drifted single_sighting; vanished ones get none). Verified
  fresh via applyScanToRecords' leg refresh; persisted through applyConfirmations.
- CLV math: engine/clv.ts (PURE) — per-leg raw + de-vigged true CLV%,
  per-record stake-weighted (signal weights = the stored equal-risk split;
  execution weights = filledLegs stakes), missing closing legs EXCLUDED +
  renormalized, null when zero usable legs. Goldens hand-computed.
- Read model: GET /api/clv/summary (clv/clvSummary.ts, routes/clv.ts).
  Shape = ClvSummary: `coverage` {recordsWithClosing, recordsTotal,
  medianCaptureMins (FROZEN closings only; null when none)}; `signal[]`
  {strategy, gateOutcome:'alerted'|'filtered'|'single_sighting', cell};
  `execution[]` {strategy, cell}; `byBook[]` {bookmakerKey, title, cell}.
  Each `cell` is a ClvCell {records, meanClvPct, medianClvPct, beatClosePct,
  trueClv?}. **beatClosePct / trueClv.beatPct are FRACTIONS 0..1 (share),
  multiply by 100 for display.** meanClvPct/medianClvPct are percentage
  POINTS (5 = +5%), rounded to 2 dp; shares rounded to 4 dp. Absent strategy/
  book/outcome combos simply don't appear (only-present rule). trueClv is
  omitted when no benchmarked legs.
- Cells are OBSERVATION-counted: signal/execution `records` = records;
  byBook `records` = LEGS (each leg is one observation attributed to its book).
- gate outcome classification (priority): alerted (alerted===true) → filtered
  (safety present AND fails the LIVE passesSafetyGate) → single_sighting
  (confirmation.status). A confirmed+gate-passed+unalerted record is NOT a
  measured gate outcome → excluded from signal (still feeds byBook + coverage).
- Records without a closing are surfaced ONLY in coverage — never zeroed into
  a cell. Honest numbers, unchanged Phase-18 posture.

## Phase 18 UI — built (see the section at the top of this file)
- GET /api/clv/summary was the only new endpoint; the client does no
  aggregate CLV math (cockpitClv is the one sanctioned display mirror).
  YELLOW is NOT a CLV color — CLV is neither speculative nor simulated;
  it's a measurement.

---
# HANDOFF — 2026-07-12 (Phase 17 WP-B complete; WP-C UI next)

## For the incoming agent: read these first, in order
1. CLAUDE.md  2. docs/prompts/phase-17.md (Ryan's spec, verbatim, binding)
3. docs/superpowers/specs/2026-07-12-phase-17-safety-design.md
4. docs/PROGRESS.md  5. this file

## Where we are
- Phases 1–16 COMPLETE except Phase 11 (Kelly — deliberately parked).
- Phase 17 (Safety Score) on branch `phase-17-safety` (merge at close-out):
  - WP-A DONE (Opus): pure engine/safety.ts (components a–f, hard rejects,
    passesSafetyGate), ops/safetyStore.ts settings, safety/exposure.ts +
    rotation.ts, routes for settings + rotation.
  - WP-B DONE (Fable, this session): score-at-confirmation
    (safety/scoring.ts, persisted via applyConfirmations BEFORE the
    fan-out), the gate in BOTH consumers (dispatchConfirmedAlerts +
    hub-purchases — one function), WhatsApp `Safety NN/100` line + rounded
    primary stakes (Phase 15 pins AMENDED), GET /api/safety/cost with a
    hand-computed fixture week, gate-parity/safeMode-OFF/scoring-failure
    acceptance fixtures (safety/gateParity.test.ts).
  - WP-C NEXT (Sonnet): UI — score badge + expandable breakdown (cockpit +
    opportunity rows), safety settings panel (Advanced page), Hub Cost of
    Safety readout, rotation hint. Endpoints ready:
    GET/PATCH /api/safety/settings, GET /api/safety/rotation,
    GET /api/safety/cost (simulated: true; byStrategy split exists so EV
    dollars are labeled EXPECTED and middles show count-but-$0).
- Tests: 644 server + 49 client, typecheck green, tree clean.

## Post-P17 hardening (2026-07-12/13, live-data-confirmed bug + fix)
- **Bug:** a confirmation scan B ran CONCURRENTLY with a manual scan
  (2026-07-12 ~23:19–23:20Z, and an earlier ~20:17Z instance); The Odds API
  rate-limited the overlapping requests, so B successfully fetched ~5 of 22
  sports. matchConfirmationPair judged ALL pendings against B's post-scan
  store → every candidate whose sport B never fetched was ruled absent →
  TERMINAL single_sighting. Healthy active records were permanently muted
  (stable fingerprints; no alert could ever fire). Bonus hazard found on the
  way: runScan handed persistence its ATTEMPTED sport list, so the lifecycle
  kill-pass could also kill/mute records of a merely-failed sport.
- **Fix 1 (coverage-aware judgment):** matchConfirmationPair now requires
  the set of sports scan B SUCCESSFULLY fetched (meta.sportsScanned minus
  meta.sportsFailed; runConfirmScan in index.ts builds it). Uncovered
  candidates are excluded — stay pending, B re-fires on a later tick, the
  5×-interval lapse rule stays the honest terminal. Covered-but-absent is
  single_sighting exactly as before. runScan's persistence scope
  (recordScan/snapshot/scan-history) now carries successful sports only.
- **Fix 2 (scan serialization):** runScan queues every invocation (manual
  route, scheduler scan, scan B) through one in-module promise chain — no
  two provider scans can overlap; a scan during a scan waits seconds, never
  errors. CLAUDE.md gotcha added.
- **Data repair (one-off, script deleted after running):** 11 records with
  confirmation.status='single_sighting' AND status='active' AND scanBAt in
  2026-07-12T23:15–23:25Z had the confirmation field deleted via the
  OpportunityStore class (before=11 → after=0, 75 records total, verified
  through the live :8787 API). NOTE: deleted-confirmation records behave as
  pre-P16 legacy records (only NEW records get the pending stamp), so they
  are honest-but-unalertable until their events age out — the 10
  single_sighting records stamped ~20:17:36Z were OUTSIDE the sanctioned
  repair window and were left untouched (same incident shape, decide
  separately). Their events commence within days either way.

## Live operations (the part that spends money)
- :8787 runs tsx watch with the REAL key; :5173 Vite. Untouched.
- scheduler.enabled = FALSE (dormant); the safety gate only affects FUTURE
  confirmations, so WP-B is inert in live ops until pairs run.
- safeMode defaults ON, threshold 55 (data/safety.json seeds on first read).
- Quiet hours 01:00–08:00 America/Vancouver block everything, manual scans
  included. Dense week caps unchanged (4,500/day, 30,000/week).

## Field semantics WP-C must respect
- record.safety: present only on records confirmed after Phase 17 —
  including gate-filtered ones (badge them; 0 = REJECTED). Absent = never
  scored (pre-P17 or scoring failure) → ungated, show nothing.
- safety.roundedStakes are the PRIMARY dollars; exact-optimal (planStakes)
  is the cockpit's secondary line.
- SafetyCostReport is simulated/hypothetical — label it; EV forgone profit
  is EXPECTED (model), middles contribute count but $0 unless freeMiddle.
- With safeMode OFF the cost report is honestly zero (nothing is filtered).

## Traps for the incoming agent
- Vitest from server/ dir (repo root loses @shared) — unchanged.
- The Phase 15 alert-format pins were AMENDED by the Phase 17 spec: scored
  records add exactly one `Safety NN/100` line (arb: between Profit and
  "odds as of"; EV/middle: trailing line) and rounded stakes; unscored
  records must stay byte-identical to the old pin. Don't "fix" either.
- A scoring failure must never block confirmation — scoreConfirmedRecords
  never throws; keep it that way (gateParity.test.ts pins the fallback).
- The paper fund deliberately stays on the UNGATED stream; alerts + Hub
  purchases are the only gated consumers. Exposure/rotation derive from
  records (alerted OR hub-purchased) — no new mutable state.
- setTimeout is legal ONLY in server/src/scheduler/realTimer.ts; no test
  may sleep — inject the clock (gateParity shows the harness pattern).

## Open questions saved for Ryan
1. arbMinEdgePct for the rounding check = LOWEST verified+active WhatsApp
   subscription threshold (0 when none) — confirm that reading of "the
   alert min-profit threshold".
2. Cost of Safety uses the gate at CURRENT settings, so safeMode OFF →
   zero report. If he wants "what WOULD the threshold filter" while OFF,
   that's a one-line change in safety/cost.ts.
3. Carried over: quiet hours block manual scans; premade Hub defaults;
   dense-week override semantics; Phase 14 series stakes.

## First prompt to paste into a new agent
"Read CLAUDE.md, docs/prompts/phase-17.md, the 2026-07-12 design doc, and
docs/HANDOFF.md. Phase 17 WP-A + WP-B are complete on phase-17-safety;
build WP-C (UI only) per the design doc. Never touch :8787's real data."
