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
