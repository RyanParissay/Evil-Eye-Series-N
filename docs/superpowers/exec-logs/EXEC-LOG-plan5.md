# Plan 5 (SETTINGS) — Execution Log (UNTRACKED — never commit)

Lead: LEAD-PLAN5 (Opus). Branch: plan-5-exec. Worktree: /Users/ryanparissay/evil-eye-v2-wt-plan5

## Baseline (9b97346)
- Server: 164 tests / 20 files PASS
- Client: 35 tests / 6 files PASS
- Typecheck: clean (server + client)
- Confirmed by lead before dispatch. Tree clean.

## Branch-state resolutions (from PM)
- Plan 4 NOT merged: migrate(db) created fresh with ONLY books.enabled guard (DROP confirmed_at guard line). Export row shapes defined locally (no AnalyticsTradeRow reuse).
- Plan 3 HAS merged: RANGE_RULES settingsPatch, brainKillSwitch, brain/pass, eventsLog.byKind all present — build on them.

## Task log

- T1 (settings keys/validation/calm-lock/books.enabled/mix) — commit 047f6048 (range 9b97346..047f6048). Sonnet impl via TDD.
  - Byte-fidelity review (Sonnet, agent ab42dec4630a75af0): APPROVED — all 11 files byte-exact modulo 4 sanctioned adaptations; no forbidden words; no float-cents; glyphs (→ U+2192 ×4, — ×10, ≠, ≤, ×) correct.
  - Judgment review (lead): APPROVED. Independently re-ran server suite = 173 passed (22 files); typecheck clean. migrate(db) placed after schemaSql exec / before seed, idempotent, books.enabled-only, confirmed_at line dropped (Plan 4 not merged). Calm-lock fires only on SAFETY_KEYS + non-green non-sharp book; advanced-key journaling gated on ADVANCED_JOURNAL_KEYS + value change; mix trio all-or-nothing sum=100. Tests genuinely assert behavior. No new timers/deps.
  - Deviation (escalated + accepted): gates.test.ts mkBook literal gained `enabled: 1` — mechanical consequence of widening Book interface; required for typecheck. Within committed paths.
  - Baseline: server 164 → 173 (+9 new). Client untouched (35). Tree clean.
- LEAD CALL: none for T1.

- PM update mid-T1: review depth slimmed (T6-T10 pure-UI byte-fidelity-only if verbatim; T1-T5 stay two-layer; any deviation escalates to judgment layer). Concurrency cap 4 → 3.

- T2 (strategy-mix cap + book/sport eligibility) — IN PROGRESS.
  - Sonnet impl wired eligibility.ts + scan.ts + verify.ts per plan; 6 of 7 new tests pass, typecheck clean, all 173 pre-existing green. Soft-blocked on 1 test.
  - LEAD CALL #1 (plan test-fixture defect): mixcap.test.ts test 'a category at its mix allowance is held back…' asserts the ARB mix clause, but under the plan's own fixture (rng seed 42, NOW=Date.UTC(2026,6,14,19,0)) the sim's 2 ARB candidates BOTH die at the scan-time ROUNDING_DESTROYS_MARGIN gate (gates.ts gate 5) before reaching verify — so the ARB clause can never fire. Independently verified by lead via throwaway probe (deleted): raw detection = {ARB:2, EV:7, MIDDLE:3}; both ARBs KILLED ROUNDING_DESTROYS_MARGIN; EV cap DOES fire with exact clause 'EV … held back — EV mix at its 29% cap.' The mix-cap FEATURE is correctly implemented; only the test's chosen category was unreachable.
    Resolution: retarget the test from ARB (allowance 6) to EV (allowance 3, exercised by the fixture) — seed 3 EVs, assert EV held-back clause + EV count stays 3 + others (MIDDLE) promote. Preserves the test's full intent; assertions not weakened. Analogous to the plan's own pre-authorized daily-cap seed-category contingency. Touches no hard rail / DECISIONS / cross-plan surface. Probe-verified passing before dispatch. Flagged to PM for whole-plan-review awareness.
  - Note: removed implementer's leftover throwaway debug files (_probe/_dbg) from server/src/pipeline before commit (would be swept by `git add server/src/pipeline`).
  - Verdicts pending (two-layer) after commit.

- T2 (strategy-mix promotion cap + book/sport eligibility at scan and recheck) — commit fc6e840 (range 047f6048..fc6e840). Recovered a dead implementer's WIP.
  - Recovery assessment: on-disk WIP (mod scan.ts+verify.ts; new eligibility.ts/.test.ts, mixcap.test.ts) was byte-faithful to Plan 5 Task 2. Full suite showed 1 FAIL: mixcap.test.ts test 1 asserted a `held back — ARB mix at its 47% cap` journal line, but seed-42 snapshot produces NO surviving PENDING ARB (its 2 ARB candidates die at scan via pre-existing kill battery; eligibility is a no-op at defaults). Mechanism proven correct via EV: 7 EV candidates, allowance round(12×29%)=3 → 3 promote, 4 held with `held back — EV mix at its 29% cap`. Implementation correct; test premise wrong.
  - LEAD CALL (T2): retarget mixcap test 1's one false ARB assertion to EV (the category seed-42 over-supplies), KEEPING the ARB seeding + original passing assertions + title. Added `sentTodayByCategory EV == 3` and `promotedCats.includes('MIDDLE')` (the latter strengthens the plan's original "others promote" intent — proves a non-capped category actually promoted; authorized by lead judgment layer). Analogous to the plan's pre-authorized daily-cap seed-category contingency. INDEPENDENTLY ENDORSED by PM/controller (mix-cap logic in verify.ts is category-uniform, so EV coverage proves the mechanism).
  - Two-layer review: BYTE-FIDELITY (Sonnet, agent ac525882e0c1c4dfe): eligibility.ts / eligibility.test.ts / scan.ts diff / verify.ts diff = clean MATCH to plan verbatim; mixcap tests 2-5 byte-identical; em-dash U+2014 correct; forbidden-words CLEAN. Its only NEEDS-FIXES flag was the `includes('MIDDLE')` assertion = my own authorized amendment (not a defect). JUDGMENT (lead): APPROVED — engine correct, mechanism proven end-to-end, no new timers/deps, money still integer cents.
  - Baseline: server 173 → 180 (+7 new, 24 files). Typecheck clean. Client untouched (35). Tree clean (only EXEC-LOG untracked).
  - DEFERRED MINOR (OPTIONAL, post-beta whole-plan review; PM logged in ledger): the ARB-specific held-back-clause LABEL now has no dedicated fixture (code path is category-uniform, so NOT a real gap). Post-beta: add an ARB-surviving fixture to prove the per-category label string.

- T5 (client contract mirror + pure display helpers + useSettingsView) — commit ba8fcf1 (range fc6e840..ba8fcf1). Sonnet impl via TDD; NO deviations.
  - Two-layer review: BYTE-FIDELITY (lead mechanical + glyph codepoint scan): settings.ts / settings.test.ts / api.ts diff / useSettingsView.ts = MATCH plan verbatim; all 11 glyphs present with correct Unicode in BOTH settings.ts & test (– U+2013, — U+2014, · U+00B7, ● U+25CF, ○ U+25CB, ✓ U+2713, ✗ U+2717, ▾ U+25BE, → U+2192, ≤ U+2264, × U+00D7); forbidden-words CLEAN. JUDGMENT (lead): APPROVED — pure display helpers, dollar strings only from formatCents/money2 (return strings), sole new timer = useSettingsView 5s poll, contract mirror matches server report.ts shape, bundler-resolution imports (no .js), no new deps.
  - Suite: client 35 → 45 (+10 new, 7 files) PASS; client typecheck clean. Server untouched by T5.
  - Ran IN PARALLEL with T3 (disjoint client/ vs server/ workspaces, scoped test cmds — no interference). Committed ahead of T3 (independent).

- T3 (one-sport toggle, reference-pricer fallback, journal minimum) — **BLOCKED / ESCALATED to PM. NOT committed.** Sonnet impl (agent a0eb58daba92a9691) implemented all 8 files verbatim via TDD, then STOPPED (correctly) on a plan-internal engine-math defect.
  - GREEN in isolation: gates.ts+test (oneSportRule knob, 15/15), journalMin.ts+test (3/3), verify.ts (recomputeEdge/fairProbForLeg/consensusFairProb — no regressions), runner.ts (ensureJournalMinimum on doScan after brainPassIfDue — no regressions), server typecheck clean.
  - DEFECT in candidates.ts `detectEvsConsensus` (plan lines 1073-1090): full server suite = 7 FAILED / 181 passed. Root causes (lead-verified by direct arithmetic):
    (1) SELF-REFERENTIAL MATH: consensus benchmark devigs the BEST odds per selection, then flags those same best-odds quotes as +EV. The plan's own new test fixture `anchorlessGroup()` is itself an ARB (best home 2.3 impl 0.4348 + best away 1.9 impl 0.5263 = 0.9611 < 1), so devigging its two best legs yields symmetric +4.05% "EV" on BOTH (plan comment claims only bet365 home qualifies — arithmetic error; fanduel away 1.88 also = +2.95%). Literal algo → 3 candidates, plan test expects 1.
    (2) REGRESSION: old detectEvs REQUIRES pinnacle (size<2→return); the new global `anchorUp` gate routes ALL 6 pre-existing pinnacle-less ARB fixtures through detectEvsConsensus at default anchorFallback=0 → spurious EV → 6 ARB tests break. Plan Step 4's "defaults preserve old behavior" claim is FALSE.
    Note: fallback path is DORMANT in sim (provider always quotes pinnacle → anchorUp always true → detectEvsConsensus never runs at runtime); the defect surfaces only in unit tests + a hypothetical live-outage path.
  - Fix requires an engine-math design decision (sound leave-one-out/benchmark-exclusion consensus devig + a non-arb cross-book fixture) AND touches money/edge-detection semantics + the plan's "preserves old behavior" claim → escalated to PM, NOT adjudicated downward. Options proposed to PM (see SendMessage). T3 WIP kept uncommitted in tree; server suite RED until resolved.

- T6 (settings stylesheet + screen shell + STRATEGY MIX panel) — commit f71932f (range ba8fcf1..f71932f). Sonnet impl verbatim; NO deviations.
  - BYTE-FIDELITY (single-layer, pure UI): settings.css (81 lines, all enumerated classes) / Stepper.tsx / StrategyMixPanel.tsx / SettingsScreen.tsx / main.tsx diff / App.tsx diff = MATCH plan verbatim. Glyphs: − U+2212 (Stepper dec), + ASCII (inc), — U+2014 ("STRATEGY MIX — LOCKED TO 100", "SETTINGS OFFLINE — SERVER UNREACHABLE"), × U+00D7 (comment). Forbidden-words CLEAN. Client 45 tests still PASS (no new test files), typecheck clean.
  - COPY CHECK: "STRATEGY MIX — LOCKED TO 100" = design-inventory line 439 verbatim. "SETTINGS OFFLINE — SERVER UNREACHABLE" = (NEW copy) — not in inventory; degraded-state string following the .empty-note offline pattern; plan-sourced, accepted, flagged.
  - CARRY-FORWARD MINOR (check at T9/T10): the plan's §5 "Produces" list (line 2067) enumerates `.book-select` and `.kv-quit`, but the Step-1 CSS block defines NEITHER and T7-T10 "add no CSS". If T9/T10 reference those classes they render unstyled. Implementer was correctly verbatim to the CSS block. Verify during T9/T10 review; add the two rules if referenced.

- T3 RESOLVED via OPTION C (PM ruling + locked-rule check PASSED) — T3-PARTIAL committed 3a4744e (range f71932f..3a4744e): "feat(server): one-sport rule toggle + journal minimum on the tick".
  - LANDED (fully green): one-sport toggle (gates.ts knob-gate + gates.test.ts one-sport test), journal minimum (journalMin.ts + journalMin.test.ts, rides doScan after brainPassIfDue — no new timer), runner.ts wiring.
  - REVERTED to HEAD (consensus/outage path only): candidates.ts detectEvsConsensus + global anchorUp routing, candidates.test.ts's 4 new consensus tests, verify.ts's recompute consensus branch (fairProbForLeg/consensusFairProb). Did NOT touch anchorIdx (separate REFERENCE PRICER selection tile). anchorFallback settings KEY + RANGE_RULES retained from T1 (stored, no live engine consumer for the beta).
  - GATE PASSED: full server suite 184/25 GREEN (the 6 pinnacle-less ARB tests restored), typecheck clean. Isolation clean (kept parts have zero dependency on reverted code).
  - TWO-LAYER review of kept parts: byte-fidelity (gates/runner diffs + journalMin.ts = plan verbatim, · U+00B7 correct, forbidden-words CLEAN) + judgment (one-timer invariant held; journalMin deterministic from live tables, kill-switch-gated, counts-not-cents; one-sport unknown-book kill stays unconditional) = APPROVED.
  - T10 RAIL (when reached): render REFERENCE PRICER FALLBACK radios (anchorFallback) as STATIC TEXT (design-inventory line 513 calls them "static text") — no interactive radio PATCHing an inert setting ("no dead knob" + inventory-faithful).
  - POST-BETA DEFERRED (first-class, logged in ledger; full two-layer, NOT under deadline): Option A sound consensus — LEAVE-ONE-OUT benchmark excluding each candidate's own quote (mirroring detectEvs's pinnacle exclusion), non-arb cross-book fixture, reconcile 6 ARB tests, correct the plan's false "defaults preserve old behavior" text.

- T7 (SCAN RULES · CREDIT FORECASTER + RISK & BANKROLL panels) — commit b1834af. Sonnet impl verbatim; NO deviations.
  - BYTE-FIDELITY (single-layer): ScanRulesPanel.tsx / RiskBankrollPanel.tsx / SettingsScreen.tsx diff = MATCH plan verbatim. Glyphs: · U+00B7 ("SCAN RULES · CREDIT FORECASTER"), − U+2212 (comment), – U+2013 (comment "0–100%"). "RISK & BANKROLL" ASCII &. Forbidden-words CLEAN. Client 45 tests + typecheck green. No CSS/timers added.

- T4 (settings view read model + routes + exports) — commit d1922f6. Sonnet impl verbatim; impl correct, plan TEST had a casing bug.
  - Sonnet correctly STOPPED on a plan-internal contradiction: route journals `Books: ${displayName(book.name)} turned ...`, but the plan's Task-4 test asserted lowercase 'bet365'. displayName('bet365')='Bet365' (BOOK_DISPLAY, pre-existing) — LOCKED by passing pass.test.ts:70 ('...Bet365 red...').
  - LEAD CALL (T4): impl is CORRECT (uses displayName; design-inventory renders the book as 'Bet365' at lines 245/264/280[a JOURNAL line]/420/501 — authoritative copy source). Plan test expectation had the wrong casing (authoring oversight, same class as T2). Fixed the TWO journal-text assertions only ('bet365'→'Bet365'); the URL paths (/api/books/bet365) and response `name:'bet365'` (raw key) correctly stay lowercase. Inventory resolves this unambiguously → adjudicated as LEAD CALL, not escalated.
  - Two-layer review: BYTE-FIDELITY — report.ts verbatim (forecaster math on integer credit counts; llmSpentCents/llmCapCents integer cents; tradesCsv RFC-4180 string serialization; displayName for books); routes.ts 5 handlers verbatim before 404. JUDGMENT — whatsapp/test is a SIM stub (one events_log wa_test row, {ok,simulated:true}, ZERO network); both exports READ-ONLY (data kept forever; test asserts idempotent body); money integer cents throughout; no new timers/deps. APPROVED.
  - Suite: server 184 → 188 (+4 api tests, 25 files) PASS; typecheck clean. (Forbidden-words grep hits at api.test.ts:295/542 are the guardrail TEST's own regex, not violations.)

- T8 (BRAIN + WHATSAPP + DATA panels) — commit 6e02b85. Verbatim; BYTE-FIDELITY APPROVED (glyphs ✓ U+2713, · U+00B7, § U+00A7, — U+2014; "SENT ✓" sanctioned NEW copy; MODE badge non-interactive; whatsapp SEND TEST hits sim stub only; no new timer). Forbidden CLEAN; client 45 + typecheck green.
- T9 (ADVANCED SETTINGS — INPUTS, MY BOOKS, SPORTS & LEAGUES) — commit c0bf374. Verbatim; BYTE-FIDELITY APPROVED (all §5.7/§12 copy verbatim; NEW copy NO KEY — SIM / SIM chips / 5 / 5 INPUTS SIM sanctioned; — U+2014 ×4, · U+00B7 ×3; inert EDIT/CHECK FOR UPDATES/+ ADD BOOK; native <select>). Forbidden CLEAN; client 45 + typecheck green.
- T10 (ADVANCED — thresholds, pricer fallback, calm-locked safety, kill rules + journal) — commit 9dc543c. TWO-LAYER (one lead-directed deviation).
  - DEVIATION (per PM rail + design-inventory line 513): REFERENCE PRICER FALLBACK renders as STATIC TEXT — each fallbackItems entry is a non-interactive <div>, NO onClick, NO step('anchorFallback',...) anywhere (verified: 'anchorFallback' absent from file). No dead knob for the beta (engine consumer deferred with T3's Option C). Everything else byte-verbatim.
  - BYTE-FIDELITY: imports/handlers + EDGE THRESHOLDS + ACCOUNT SAFETY + KILL RULES/JOURNAL panels verbatim; □ U+25A1 ×2 (both head-notes); calm-lock disabled={locked} on ONE-SPORT chip; JOURNAL MINIMUM clamped 1..4; kv-quit class kept (undefined-in-CSS — cosmetic, see below). Forbidden CLEAN.
  - JUDGMENT: live knobs (thresholds/one-sport/journal-min) PATCH real engine settings; fallback correctly inert; step+fallbackItems both used (typecheck green); no new timers/deps; money integer cents. APPROVED. Client 45 + typecheck green.
  - COSMETIC MINOR (assess at T11 smoke): .kv-quit referenced by DEFAULT QUIT RULE row but not defined in the frozen CSS (renders as plain .kv-value). .book-select from the §5 Produces list is a phantom (T9 uses .book-sport). Decide at smoke whether to add a minimal .kv-quit rule.

ALL 10 IMPL TASKS COMMITTED (T1,T2,T3-partial,T4,T5,T6,T7,T8,T9,T10). Lineage: 047f604→fc6e840→ba8fcf1→f71932f→3a4744e→b1834af→d1922f6→6e02b85→c0bf374→9dc543c. T11 (sweep+suite+smoke) IN PROGRESS.

- T11 (forbidden-words sweep + full suite + end-to-end smoke) — PASSED. No commit needed (no fixes).
  - Step 1 forbidden sweep: only api.test.ts:295/542 (the guardrail TEST's own regex asserting API responses are clean) — NO production/UI/API-copy hits. CLEAN.
  - Step 2 full suite: server 188/25 + client 45/7 PASS; both typechecks clean (exit 0).
  - Step 3 smoke on port 4501 (index.ts PORT temp-patched 4400→4501, reverted after; user's 4400/PID7946 never touched; DB fresh): PASSED —
    · GET /api/settings/view: mode SIMULATED, 16 books (pinnacle sharp+enabled), 5 sports, planMonthly 100000, dailyAllowance 3333, llmCapCents 300, weightsCustom false, safetyLocked false, backups {null,14}; forbidden-in-view=0.
    · mix trio: partial{mixArbPct} 400, valid sum100 200, bad sum99 400.
    · books: bet365 OFF→enabled:false + journal 'Books: Bet365 turned OFF' (CORRECT casing — validates T4 LEAD CALL live); sharp pinnacle 409; unknown 404; bad sport 400.
    · eligibility LIVE: 5 scans while bet365 OFF added 0 new bet365 legs (before=after=4 pre-existing; 74 legs total from enabled books) — confirms T2 filter end-to-end.
    · kill switch persist 200→1; journalMin set 3 →200.
    · exports: CSV text/csv + evil-eye-trades.csv disposition + 'id,' header + day_key col + lines=trades+1 (50=49+1 clean snapshot); JSON has all 9 tables; whatsapp/test → {ok:true,simulated:true} (zero network).
    · client `npm run build`: 71 modules bundled clean (all 6 panels + AdvancedSettings compile+bundle). Live browser render + offline note covered by build + byte-fidelity + typecheck (SettingsScreen offline path byte-verified) — agent has no headless browser.
  - Live-scheduler artifacts (NOT bugs, explained): initial "4 bet365 legs"/"export DIFF" were the app's real scheduler churning the DB; deterministic guarantees are in the T2 (eligibility) + T4 (read-only export) unit tests.
  - COSMETIC MINOR left for post-beta (decided at smoke NOT to add CSS — stays faithful to T6's frozen stylesheet): .kv-quit referenced by DEFAULT QUIT RULE row but undefined in settings.css → renders as plain .kv-value (quit-rule text shows fine). .book-select is a phantom (unused).

=== PLAN 5 MERGE-READY @ 9dc543c ===
All 10 impl tasks committed + reviewed (two-layer on engine/money/API/store/T10-deviation; byte-fidelity on pure UI). Server 188/25 + client 45/7 green; both typechecks clean; forbidden sweep clean (guardrail-test only); smoke on 4501 PASSED. T3 landed as Option C (PM-ruled): one-sport toggle + journal minimum shipped; reference-pricer CONSENSUS fallback deferred post-beta (dormant in sim). NOT self-merged — PM/controller coordinate cutover.
POST-BETA FOLLOW-UPS (ledger): (1) Option A sound consensus (leave-one-out benchmark + non-arb fixture + reconcile plan's false "defaults preserve old behavior" + 6 ARB tests). (2) ARB-specific mix held-back-label fixture. (3) .kv-quit CSS rule if the DEFAULT QUIT RULE row wants distinct styling.

(entries appended per task completion)
