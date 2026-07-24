# EXEC-LOG P6B — LEAD-PLAN6 Phase B integration — UNTRACKED, never commit
Worktree: /Users/ryanparissay/evil-eye-v2-wt-p6b · branch p6b-integration · base mainline 8654ab5 (Plans 1-5+Demo).
Phase A source: plan-6-exec @ 8f10300. Rails: STAYS SIMULATED; no real .env (EE_ENV_PATH=/nonexistent); no real
network (throwing-fetch proof stays green); no new deps; NodeNext .js; one-timer; integer cents. Report to PM
(peer 'general-purpose'/'main') at milestones. Money/live/flip ambiguity -> STOP + SendMessage.

## STEP 1 — MERGE (DONE) commit cc1ed3f "Merge branch 'plan-6-exec' into p6b-integration"
Conflicts (4) resolved as additive unions:
  defaults.ts       — union Plan5 mix/string keys + Plan6 liveMode:0 (mainline tolerance8/verifyGap60 kept).
  defaults.test.ts  — keep BOTH tests (Plan5 settings-screen + Plan6 live-mode default).
  routes.ts         — imports: HookTask on runner import + keep seedDemo. settingsPatch: liveMode-refusal FIRST
                      then Plan5 STRING_RULES. routes: keep ALL Plan4/5/Demo routes (profiles/analytics/settings
                      view/books/whatsapp/exports/demo-seed) + ADD POST /api/mode before 404.
  api.test.ts       — keep BOTH test sets (Plan4/5/Demo api tests + Plan6 PATCH-liveMode/mode-refusal/no-network).
Clean auto-merges VERIFIED semantically correct:
  runner.ts  — PERFECT union: doScan calls runScan/verify/runSimSettlement/captureCloses/brainPassIfDue +
               ensureJournalMinimum(Plan5) + writeDailySnapshot(Plan4 confirmed-only multi-profile). My
               HookTask/pump/pumpHooks/finishTick/D1-onTimer intact. One-timer held.
  actions.ts — runSimSettlement §13 liveMode gate present atop original body.
  types.ts   — OddsProvider.refresh? present.
  routes.ts createApp wiring block (fetchImpl/env/writer/hooks[inbound+backup+brain-digest]/wireMode/startScheduler
             hooks) intact; makeApp keeps injected provider+sender + throwing fetchImpl + env:{} (wireMode stays
             out of sim suite; no-network proof binding across 254 server tests).
Merged suites GREEN: server 254/254 (37 files), client 60/60 (8 files). Both typechecks EXIT 0.

## STEP 2 — B0-B5 worklist (Plan 4/5 files now exist in merged tree)
  [ ] B0 remove whatsappNumber casts (twilio.ts:~51, twilio.test.ts:~46) — Settings.whatsappNumber exists now.
  [ ] B1 settings/report.ts llmSpentCents -> Math.ceil(Σ costMicro / 10_000).
  [ ] B2 settings/report.ts mode -> modeLabel(s); import modeLabel; widen SettingsView['mode'] 'SIMULATED'|'LIVE'.
  [ ] B3 analytics/report.ts simulated -> s.liveMode !== 1.
  [ ] B4 T9 client: settings.ts helpers+tests, api.ts setMode, DataPanel armed switch, AdvancedSettings +
        AdvancedBrainSettings INPUTS follow mode, App/BrainScreen live prop threading.
  [ ] B5 full client-inclusive hard-gate grep audit + SIM-only smoke (port>=4499, EE_ENV_PATH=/nonexistent,
        never flip live).

## PROGRESS
- STEP 1 merge cc1ed3f: DONE, green. Reported milestone 1 to PM (via 'main').
- STEP 2 B0-B3 (server) commit df3f277: whatsappNumber casts removed; settings/report llmSpentCents=Math.ceil(Σ
  costMicro/10_000); settings/report mode=modeLabel(s) + SettingsView['mode'] widened + import; analytics/report
  simulated=s.liveMode!==1. server 254/254, tc clean. (No test seeds costCents -> B1 safe; api.test:695 expects
  llmSpentCents 0, holds.)
- STEP 2 B4 (client T9) commit 0b7905b: settings.ts widen mode + modeSwitchLabel/missingText/inputStatus (+3
  tests); api.ts setMode; DataPanel armed two-click switch; SettingsScreen refresh prop; App live={modeLabel===
  'LIVE'}; BrainScreen threads live; AdvancedBrainSettings + AdvancedSettings INPUTS follow mode; settings.css
  +.badge-sim.live/.armed +.chip-live.muted (muted needed for POLL 45S tone; not in plan — additive). client
  63/63, tc clean.
- STEP 3 VALIDATION (B5): full suite server 254/254 (37 files) + client 63/63 (8 files); both tc exit 0;
  forbidden-words clean in production source; hostnames confined to 4 sanctioned; no process.env live-name
  mutation; .env path read only in env.ts (index.ts comment only); ONE real setTimeout (index.ts); no-network
  proof intact (throwing fetchImpl across 254 server tests + 7 throwing stubs). SIM SMOKE (port 4503,
  EE_ENV_PATH=/nonexistent, reverted): state SIMULATED; settings/view mode SIMULATED + llmSpentCents 0; analytics
  simulated true; POST /api/mode{live:1} -> 409 all-4-names-absent, STAYS SIMULATED (never flipped). Tree clean.

## FLAGS FOR PM (in MERGE-READY report)
- FLAKE (pre-existing, NOT a Plan 6 regression): "confirm → unconfirm cycle via API" (api.test.ts) failed 1/~10
  full-server runs (sim promoteSome: verified[0] occasionally undefined under parallel load). My changes don't
  touch confirm/unconfirm (sync tick/scanNow). Passes 9/10 + 37/37 in isolation x3. Likely parallel-load timing.
  Controller CI should retry-on-flake.
- §13 HONESTY NUANCE (flag, not blocked): implemented literal plan — RESULTS FEED (AdvancedSettings) + SETTLED
  RESULTS (AdvancedBrainSettings) INPUTS chips flip to LIVE via inputStatus('feed') when live. But Design §13 says
  the results feed is NOT wired in Plan 6 (SIM->LIVE journal: "results feed not wired"). So in live those 2 chips
  would show LIVE despite no live results feed. MOOT in sim (show SIM). Followed plan + flagged; one-line each to
  keep SIM-in-live if PM prefers.

## ===== PHASE B MERGE-READY ===== HEAD (was) 0b7905b. PM review PASSED (not landing tonight; supervised morning landing).

## ===== FINALIZATION PASS (F1-F7) on p6b-integration =====
Order: F7 first (safety), then F6/F3/F4/F5/F2, F1 last. Serialized (LC3). Two-layer on F1/F5/F6/F7. Rails held.
- F7 ddd5d7f PASS (two-layer): SIM structurally network-inert — brain-digest hook nextAt gated on liveMode!==1
  (was gated only on writer.available()/key presence). Seam audit: provider.refresh (LIVE-only via wireMode),
  sender (sim sender in SIM), inbound (liveMode nextAt), backup (pure fs) — all inert in SIM; digest was the gap.
  Proof test (api.test.ts): fake ANTHROPIC key + throwing fetch + pump in SIM → no llm_error/spend/digest.
  TDD-verified (fails without gate, passes with). makeApp gained an env param. server 255.
- F6 44857f5 PASS (two-layer): RESULTS FEED (AdvancedSettings) + SETTLED RESULTS (AdvancedBrainSettings) chips
  hardcoded SIM even in LIVE (§13 results feed not wired); odds/pinnacle/whatsapp still flip. client 63.
- F3 cf93b51: .kv-quit CSS (max-width:62%) so DEFAULT QUIT RULE quote wraps (was referenced, unstyled).
- F4 d8500ee (doc): Plan 6 doc PD1 (nba &&market==='moneyline'), PD2 (now->NOW), PD3 (bet365->Bet365), PD4
  (T10 audit grep expectations: liveMode hits, .env index.ts comment, forbidden-words assertion regexes).
- F5 da31aaf PASS (two-layer): promoteSome robust — bounded 3x re-scan safety net + clear failure; happy path
  returns cycle 1 (unchanged). Root cause of the 1/~35 flake: parallel-load transient (sim path fully seeded,
  no Math.random/Date.now). server 255.
- F2 c2154d4: ARB mix held-back clause — planted cross-book ARB (2.20/2.20, custom provider) survives recheck,
  ARB at its 6-pick allowance → "ARB … held back — ARB mix at its 47% cap." server 256.
- F1 5f1ac5b DONE (two-layer, money-path). anchorFallback was a DEAD setting (validated+displayed, engine never
  read it — violated Plan 5 "every knob changes behavior" rail).
  COORDINATOR ADJUDICATION (record in ledger): APPROVED leave-one-out consensus (best odds per selection among
  books != candidate B — never self-referential) with TWO refinements: (1) complete-line guardrail — the ≠B
  benchmark must carry EVERY selection in the group (I also added ≥2-selection guard: a lone outcome devigs to a
  phantom 1.0), else emit nothing for B (prevents phantom edges on partial 3-way, e.g. 2-of-3 soccer 1X2); (2) the
  6 pinnacle-less ARB tests get anchorFallback=1 (EV+MIDDLE pause, arbs continue — ARB-scoped), NOT =2. Radios stay
  STATIC TEXT (design-inventory says static; coordinator raises "make interactive" with user separately — NOT
  bundled). REAL-MONEY PATH — coordinator flags it in the user's morning summary for review before relying on live
  EV during a pinnacle outage.
  IMPLEMENTED: candidates.ts detectCandidates (global anchorUp; fallback 2 -> []; anchorUp -> pinnacle EV+middles;
  anchor-down+0 -> consensus EV + middles; anchor-down+1 -> arbs only) + detectEvsConsensus (leave-one-out +
  ≥2 + complete-line). verify.ts recomputeEdge fallback-aware + consensusFairProb (recheck mirrors detection).
  candidates.test.ts: 6 ARB tests -> S1(anchorFallback:1); +5 consensus tests (consensus EV, complete-line guard,
  pause-EV+middles, pause-everything, anchor-up-inert). mixcap.test.ts +1 (consensus EV survives recheck).
  Plan 5 doc corrected: false "defaults preserve old behavior" + degenerate best-all-books text/impl/test flagged
  SUPERSEDED. DORMANT in sim (provider always quotes pinnacle -> anchorUp -> no consensus). server 262, client 63.
- (superseded note) F1 was PENDING PM CONFIRM (money-path): anchorFallback is a DEAD setting.
  Implement leave-one-out consensus fallback in candidates.ts detectEvs (best-odds per selection among books≠
  candidate, ≥2 selections, devig, evEdge). Reconcile 6 pinnacle-less ARB tests + replace degenerate anchorlessGroup
  fixture (it's a 2-book 3.89% arb; Plan5-doc "1 EV" is self-referential) + fix Plan5 doc "defaults preserve old
  behavior" + wire REFERENCE PRICER FALLBACK radios static->interactive. SENT design-confirm to PM; awaiting
  thumbs-up/corrections (best-vs-average, test-reconciliation approach). DORMANT in sim (no smoke change).
  Current suite: server 256/256 (37 files), client 63/63 (8 files), both tc clean. HEAD c2154d4.

## ===== FINALIZATION COMPLETE (F1-F7 all landed) — HEAD 5f1ac5b =====
Finalization commits: ddd5d7f(F7) 44857f5(F6) cf93b51(F3) d8500ee(F4) da31aaf(F5) c2154d4(F2) 5f1ac5b(F1).
Full range mainline 8654ab5 -> 5f1ac5b: 8 Phase A commits + merge cc1ed3f + df3f277(B0-B3) + 0b7905b(B4) + 7 F.
Suites: server 262/262 (37 files), client 63/63 (8 files) = 325. Both typechecks EXIT 0. Forbidden-words clean in
production source (only test guard-regexes). Hostnames confined to inbound/oddsApi/twilio/brain-text (4 sanctioned).
No process.env live-name mutation. No-network proof INTACT (api.test suite-wide throwing fetchImpl + F7 fake-key
proof + 6 throwing-stub test files). One real setTimeout (index.ts). SIM SMOKE (4503, EE_ENV_PATH=/nonexistent,
reverted): state SIMULATED; scan/brain work (F1 dormant — sim quotes pinnacle); POST /api/mode{live:1} -> 409
all-4-names-absent, STAYS SIMULATED. Never flipped live; real .env never read. Tree clean (only ?? EXEC-LOG-P6B).
Reported FINALIZATION COMPLETE to PM. Awaiting PM fresh-eyes review -> controller hands "FULLY DONE — staged for
supervised morning landing" to user. Lead merges nothing.
