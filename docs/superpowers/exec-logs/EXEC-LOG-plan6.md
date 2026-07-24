# EXEC-LOG — LEAD-PLAN6 (Plan 6 LIVE MODE) — UNTRACKED, never commit

Worktree: /Users/ryanparissay/evil-eye-v2-wt-plan6 · branch plan-6-exec · base 9b97346 (clean)
Baseline (PM-verified): server 164 + client 35 tests green; both typechecks clean.
Rule reminders: app STAYS SIMULATED; zero real network; env NAMES only never values; no new npm deps;
NodeNext .js server imports; explicit-path git add (never -A); never commit this file.

## PHASE A / PHASE B SPLIT (delivered to PM this session)

Base 9b97346 LACKS Plan 4/5 files. Verified absent at base:
  server/src/settings/report.ts (Plan 5), server/src/analytics/report.ts (Plan 4),
  client/src/lib/settings.ts (Plan 5), client/src/components/DataPanel.tsx (Plan 5),
  client/src/components/AdvancedSettings.tsx (Plan 5), client SETTINGS screen (Plan 5) — none exist.

PHASE A (now, off 9b97346 — only files that exist at base or that Plan 6 creates):
  T1 FULL   — env.ts/env.test.ts (new), defaults.ts+test (liveMode key), routes.ts PATCH refusal, api.test.ts.
  T2 FULL   — oddsApi.ts/test + fixture (new), types.ts OddsProvider.refresh?, runner.ts onTimer refresh-await,
              routes.ts /api/scan async refresh.
  T3 FULL   — twilio.ts/test (new). Imports displayName from brain/pass.ts (exists, read-only).
  T4 FULL   — inbound.ts/test (new), runner.hooks.test.ts (new), runner.ts hooks+pump rework.
  T5 FULL   — backup.ts/test (new). (depends on HookTask type from T4.)
  T6 PARTIAL— brain/text.ts + text.test.ts (new) ONLY. DEFER settings/report.ts llmSpentCents edit -> Phase B.
              NOTE: File Map's "T6 modifies pass.ts" is STALE — T6 does NOT modify pass.ts; the digest rides
              as a hook added in T7's createApp. T6 Phase A commit adds ONLY server/src/brain/text*.ts.
  T7 PARTIAL— mode.ts/mode.test.ts (new), routes.ts (AppOptions fetchImpl/env/backupDir, createApp live wiring
              +hooks +wireMode +brain-digest hook, POST /api/mode, GET /api/state mode=modeLabel), api.test.ts
              (throwing-fetch harness + mode refusal/LIVE->SIM tests), pipeline/actions.ts (runSimSettlement
              liveMode gate). DEFER settings/report.ts mode field + analytics/report.ts simulated flag -> Phase B.
  T8 FULL   — index.ts rewrite (env load, real fetch/timer, backupDir). Phase A verify: boot on patched port
              >=4503, curl /api/state mode==SIMULATED. NEVER POST live:1.
  T10 PARTIAL (Phase A close) — mechanical audit over what exists: forbidden-words sweep, hostname-confinement
              grep, no-live-env grep, full server+client suites + both typechecks, throwing-stub no-network proof.

PHASE B (after PM merges Plans 4+5 and syncs branch) — exact old->new edits, reconcile vs merged text:
  B1  server/src/settings/report.ts (Plan 5) [T6]: llmSpentCents costCents-sum -> Math.ceil(costMicro-sum/10_000).
  B2  server/src/settings/report.ts (Plan 5) [T7]: `mode: 'SIMULATED',` -> `mode: modeLabel(s),`;
      import modeLabel from ../live/mode.js; widen SettingsView['mode'] to 'SIMULATED'|'LIVE'.
  B3  server/src/analytics/report.ts (Plan 4) [T7]: `simulated: true,` -> `simulated: s.liveMode !== 1,`.
  B4  T9 client (ALL Phase B — every piece depends on Plan 5's client/src/lib/settings.ts which does NOT exist):
      - client/src/lib/settings.ts: append modeSwitchLabel, missingText, inputStatus.
      - client/src/lib/settings.test.ts: append 3 pure-label tests.
      - client/src/lib/api.ts: append setMode.
      - client/src/components/DataPanel.tsx: MODE row -> armed two-click switch (full component in plan).
      - client/src/styles/settings.css: append .badge-sim.live / .badge-sim.armed.
      - SettingsScreen call site: <DataPanel backups mode refresh/>.
      - client/src/components/AdvancedSettings.tsx: SIM chips -> inputStatus-driven; header follows mode.
      - client/src/components/AdvancedBrainSettings.tsx (Plan 3, EXISTS but change needs inputStatus from
        settings.ts -> B): INPUTS rows use inputStatus(live,'feed'/'poll'); add live prop.
      - client/src/App.tsx: <BrainScreen live={modeLabel==='LIVE'} />.
      - client/src/screens/BrainScreen.tsx: accept+thread live prop.
  B5  T10 remainder: full hard-gate grep audit INCLUDING client, and end-to-end SIM-ONLY smoke (patched port
      >=4499, never flip to LIVE).

LEAD CALLS (in-plan clarifications):
  LC1  T9 is ENTIRELY Phase B (refines PM's proposed split). PM's example "AdvancedBrainSettings INPUTS rows =
       Phase A" is NOT Phase-A-able: that change consumes inputStatus from client/src/lib/settings.ts, a Plan 5
       file absent at base. The lone Phase-A-eligible sliver (api.ts setMode) is trivial + only meaningful with
       its DataPanel consumer, so kept with T9 in Phase B. No Phase A client work at all.
  LC2  T6 does NOT modify brain/pass.ts (File Map line is stale; digest is a T7 createApp hook). Recorded above.

RISK FLAG to PM: Phase A edits routes.ts (AppOptions, createApp, /api/state, /api/mode, /api/scan, settingsPatch).
  Plans 4/5 also edit routes.ts (their view/analytics routes). PM's Phase-B sync may hit routes.ts merge
  conflicts — Phase A keeps its routes.ts edits localized/additive to minimize surface. PM owns that merge.

## SEQUENCING (Phase A; concurrency cap 2)
  T1 -> T2 -> T4 -> T5 ; T3 and T6 independent after T1 (no file overlap with T2/T4). T7 integrates all
  (after T2,T3,T4,T5,T6). T8 after T7. Then Phase A audit. runner.ts shared by T2+T4 (T2 minimal onTimer edit,
  T4 full rework) -> T2 strictly before T4. routes.ts shared by T1+T2+T7 -> T1<T2<T7.

  LC3  ORCHESTRATION: Phase A implementers run SEQUENTIALLY (one at a time) in the shared worktree. Two agents
       committing concurrently here would interleave git add/commit and cross-contaminate the index. Critical
       path (T1->T2->T4->T5->T7->T8) is sequential anyway; T3/T6 are off-path but still serialized to protect
       the index. Do not exceed 1 live implementer at a time regardless of the cap-2 allowance.

## PROGRESS
- T1  PASS (two-layer, no findings). commit e85b93b. server 170/170, client 35 untouched, typecheck clean.
      Byte-fidelity verbatim vs plan 177-377. Hard gates honored: names-only, no net, no deps, liveMode PATCH
      refusal 400 w/ '/api/mode'. Tree clean (only ?? EXEC-LOG.md). settings.all().liveMode==0 confirmed working.
- T2  PASS (two-layer). commit 6aa206a. server 174/174, typecheck clean. oddsApi.ts verbatim vs plan; runner.ts
      MINIMAL async onTimer (no T4 code); /api/scan 503 message kept verbatim; types.ts refresh? added.
      Greps: hostname the-odds-api.com only in oddsApi.ts; no process.env live-name mutation.
      DEVIATION (accepted, Minor, PLAN-DEFECT flagged to PM): oddsApi.test.ts line 14 nba filter scoped with
      `&& q.market === 'moneyline'`. Plan's verbatim `q.event==='Nuggets @ Suns'` also captures total+spread
      quotes -> selection set {home,away,over,under} fails toEqual({home,away}). Fix is test-only, minimal,
      aligns with next nba[0] moneyline assertion, masks no impl bug (impl verbatim+correct). Plan is locked ->
      a clean re-run hits the same failing assertion; recommend PM amend the plan test.
- T4  PASS (two-layer). commit 84046c1. server 181/181, typecheck clean. runner.ts hooks+pumpHooks+finishTick;
      tick() unchanged sync; refresh awaited once (in pumpHooks); no new setTimeout; planNext untouched.
      inbound.ts verbatim; hostname api.twilio.com confined there; NEW-copy strings exact (U+2014); no forbidden
      words in new code. Two DEVIATIONS (both accepted, both PLAN-DEFECT, test-only):
        D1 onTimer sync FAST-PATH guard `if (!deps.provider.refresh && hooks.length === 0) { finishTick(); return; }`.
           Plan's literal onTimer does `await pumpHooks()` UNCONDITIONALLY -> microtask yield even with hooks=[]/
           no-refresh -> broke 3 sim timer tests in api.test.ts (fire h.timers[N].fn() then SYNC-assert on h.timers).
           Guard restores T2's sync invariant for pre-live wiring. Necessary to satisfy plan Decision 12.
        D2 runner.hooks.test.ts 'future' hook nextAt `now+60_000` (mutable clock var, always 60s ahead of clock()
           -> never due, contradicts its own assertion) -> fixed to `NOW+60_000` (fixed const). Test-only.
   *** CARRY-FORWARD TO T7 (CRITICAL — authorize T7 to also edit runner.ts) ***
      T7 wires hooks into createApp (inbound + brain-digest ALWAYS; backup if backupDir) -> post-T7 hooks.length>=1
      for EVERY createApp incl. api.test.ts makeApp -> D1 guard (`hooks.length===0`) goes FALSE -> onTimer takes
      async path -> the 3 SYNC timer-firing api.test.ts tests (approx lines 122-126, 136-164, 171-192) REGRESS,
      violating Decision 12. FIX at T7: GENERALIZE the guard from `hooks.length===0` to "no hook due now":
        const anyHookDue = hooks.some(h => { const at = h.nextAt(clock()); return at !== null && at <= clock(); });
        if (!deps.provider.refresh && !anyHookDue) { finishTick(); return; }
      In sim + no-ANTHROPIC-key test conditions inbound.nextAt->null (liveMode 0), digest.nextAt->null (no key),
      backup absent (no backupDir) => no hook due => sync path => the 3 tests pass untouched. Live/hook-due =>
      async path (correct). This is TESTABLE at T7 (full sim api.test.ts runs under createApp WITH hooks). T7's
      file set must be widened to include runner.ts (lead-authorized).
   *** PHASE-A-AUDIT NOTE (T10) ***
      Forbidden-words sweep `grep -rniE 'append-only|ghost|picker|grader|gatekeeper|CLV' server/src client/src`
      WILL hit the pre-existing forbidden-word ASSERTION REGEXES (api.test.ts lines 295, 542; likely a client
      test too). Those are the tests that PROVE absence in rendered output. Audit must scope the sweep to exclude
      those assertion lines / non-rendered test regexes; the meaningful check (no forbidden word in any rendered
      string / API payload / UI copy / outbound WhatsApp text) still holds.
- T5  PASS (two-layer). commit 2932295. server 184/184, typecheck clean. backup.ts verbatim; pure fs, no network,
      no hostname; runs both modes; keep-14 lexicographic rotation. (backup_error kind used but not in plan's
      owned-kinds list — harmless error path, noted.)
  LC4 (T3 pre-resolution, PLAN-DEFECT #3, test-only): displayName('bet365')='Bet365' (pass.ts BOOK_DISPLAY), but
      T3 plan test line 760 expects lowercase 'bet365 — home @ 3.10 │ BET $35'. Design-inventory shows leg lines
      use DISPLAY names (Pinnacle/FanDuel/Betway/BetMGM); plan impl deliberately uses displayName + RAW selection
      slugs (home/draw), so it's structural not literal card parity. KEEP impl verbatim (displayName); FIX test
      assertion 'bet365 —'->'Bet365 —'. Only that one line; 'Pinnacle — draw' already matches. Not a HARD GATE.
      (Root cause: routes.ts bookLabel maps bet365->'bet365' but pass.ts displayName maps bet365->'Bet365' — a
      pre-existing single-book divergence, not Plan 6's to fix.)
- T3  PASS (two-layer). commit 0e64dc5. server 187/187, typecheck clean. twilio.ts verbatim EXCEPT one type-only
      cast (below); verifiedMessageText glyphs exact; dev-mode short-circuits before network; wa_error paths carry
      no values; hostname api.twilio.com confined to twilio.ts:62; no forbidden words. LC4 (Bet365 casing) +
      whatsappNumber amend applied as directed.
      CROSS-PLAN TYPE FINDING (I missed this in the split; corrected here): twilio.ts reads
      repos.settings.all().whatsappNumber — a PLAN 5 Settings field (Plan 5 doc line 49/216/372: `whatsappNumber:
      '' as string`) ABSENT from this Phase A branch's DEFAULT_SETTINGS -> verbatim code fails tsc (TS2339/TS2353).
      Cannot add the field in Phase A (would collide with Plan 5); cannot defer the sender (T7 wireMode needs it).
      Resolution accepted: implementer bridged with type-only casts (zero runtime effect), field name matches
      Plan 5 exactly so no hidden runtime bug; test .set() persists it to the k/v store so the live-path test
      truly runs. Twilio.ts stays Phase A.
  B0 (Phase B cleanup, add to worklist): remove the two whatsappNumber type casts once Plan 5's Settings widening
      merges — twilio.ts:51 `(repos.settings.all() as unknown as { whatsappNumber: string }).whatsappNumber` and
      twilio.test.ts:46 `{ whatsappNumber: '...' } as any`. After merge, `repos.settings.all().whatsappNumber`
      typechecks natively.
- PRICING VERIFIED (claude-api skill, cached 2026-06-24): claude-haiku-4-5 = valid active model, $1/MTok in,
  $5/MTok out -> 1 µ$/input-tok, 5 µ$/output-tok EXACTLY as plan locks. Cap 3,000,000 µ$ = $3.00. Plan cap math
  correct; no HARD GATE 6 money ambiguity. Raw-HTTP Messages shape valid for Haiku. T6 cleared to dispatch.
- [dispatched] T6 -> Sonnet implementer (background, sequential). Two-layer review pending (money/µ$/cap).
      Phase A = brain/text.ts + text.test.ts ONLY. DEFER settings/report.ts llmSpentCents edit (B1). model id +
      pricing LOCKED+VERIFIED — transcribe verbatim, no SDK, no thinking/sampling params. no-key/cap tests use
      THROWING fetch. hostname api.anthropic.com only in text.ts. Expect server 193.
- T6  PASS (two-layer, money/µ$/cap). commit b2be638. server 193/193, typecheck clean. text.ts verbatim;
      costMicro=in*1+out*5; cap refuses BEFORE fetch; worstCase=ceil(chars/3)+512*5; integer µ$; no-key silent
      zero-events. hostname api.anthropic.com confined to text.ts (4 sanctioned live/text files). settings/ dir
      absent (B1 deferred correctly). Implementer independently re-verified pricing via claude-api skill. No devs.
- T7 INTEGRATION FACTS (verified before dispatch): makeApp injects provider+sender -> wireMode NOT called in sim
      suite (its Date.now() sim-sender is test-irrelevant). Sim: inbound.nextAt->null (liveMode 0), digest.nextAt
      ->null (env {} no ANTHROPIC key) => anyHookDue false => onTimer sync fast-path (D1) holds => fire-and-assert
      api.test timer tests pass; throwing fetchImpl never invoked = HARD GATE 2 no-network proof. mode tests: 409
      refusal + LIVE->SIM only; never flips to live; never fetches.
- [dispatched] T7 -> Sonnet implementer (background, sequential). Two-layer review MANDATORY (API surface + live
      gating + throwing-fetch proof + D1 runner.ts generalization). Phase A files ONLY: mode.ts/test, routes.ts,
      api.test.ts, pipeline/actions.ts, runner.ts. DEFER settings/report.ts mode field (B2) + analytics/report.ts
      simulated flag (B3). Gave implementer the exact D1 onTimer snippet (guard hooks.length===0 -> anyHookDue).
      Expect server ~198. Escalate to Opus if 2x needs-fixes.
- T7  PASS (two-layer, integration). commit fbd0ed1. server 198/198, typecheck clean. routes.ts (AppOptions,
      createApp wiring block, mode=modeLabel(s), POST /api/mode) byte-exact; mode.ts + actions.ts §13 gate +
      runner.ts D1 generalization all exact. Greps: no process.env live-name mutation; every liveMode:1/live:1 in
      tests sanctioned (direct isolated-repos set in mode/inbound tests; api.test hits are the PATCH-400 + mode-409
      REFUSAL tests, liveMode stays 0 — no successful live flip); 409 msg names-only w/ U+2014. Fire-and-assert
      timer tests survived D1 (198/198). Throwing-fetch no-network proof now binding across ALL server tests.
      settings/analytics correctly deferred (B2/B3).
- [dispatched] T8 -> Sonnet implementer (background, sequential). Two-layer (fast, verbatim full-file rewrite).
      index.ts full rewrite per plan 2011-2042: PORT=4400 locked, loadV1Env() at boot, fetchImpl: real fetch,
      env: process.env, backupDir, the ONE real setTimeout. IMPLEMENTER: write + `npm test && typecheck` ONLY;
      NO server boot (index.ts's loadV1Env would read real ~/evil-eye-arbitrage/.env — HARD GATE 3 forbids agent
      reads). Lead does boot verify in the audit with EE_ENV_PATH=/nonexistent + PORT 4503. Expect server 198.
- T8  PASS (two-layer). commit 8f10300. server 198/198, typecheck clean. index.ts verbatim; PORT=4400 locked
      (not from env); the ONE real setTimeout via timer seam; loadV1Env() at boot.
- BOOT VERIFY (lead, port 4503, EE_ENV_PATH=/nonexistent so real ~/evil-eye-arbitrage/.env NOT read; reverted
      after): GET /api/state -> mode SIMULATED; POST /api/mode {live:0} -> SIMULATED (LIVE->SIM allowed); POST
      {live:1} -> 409 names-only, mode STAYS SIMULATED (sanctioned refusal path; never flipped live; process.env
      carried no live names — all 4 reported missing). Server booted clean, no crash. PORT reverted to 4400,
      server/data (gitignored) removed, tree clean.

## ===== PHASE A COMPLETE (2026-07-15) — STOP; await PM sync + Phase B go. Lead merges nothing. =====
Commit range on plan-6-exec: 9b97346 (base) -> 8f10300 (HEAD), 8 commits: e85b93b(T1) 6aa206a(T2) 84046c1(T4)
2932295(T5) 0e64dc5(T3) b2be638(T6) fbd0ed1(T7) 8f10300(T8). All two-layer reviewed PASS.
Suites: server 198/198 (28 files, baseline 164 +34), client 35/35 (6 files, untouched). Both typechecks EXIT 0.
Forbidden-words: clean in production source (only hits = pre-existing assertion regexes api.test.ts:297,544).
No-network proof: 7 throwing-stub tests present+passing; api.test.ts:52 throwing fetchImpl runs the ENTIRE 198
sim suite = binding proof. Hostnames confined to oddsApi/twilio/inbound/brain-text (4 sanctioned). No process.env
live-name mutation. .env path constructed/read only in env.ts (index.ts has it in a COMMENT only).
PLAN-DEFECTS (recommend PM amend locked plan): PD1 oddsApi.test nba filter needs &&market==='moneyline';
PD2 runner.hooks.test future-hook now->NOW; PD3 test 'bet365'->'Bet365' (displayName casing); PD4 T10 audit greps
("forbidden-words no output" and "evil-eye-arbitrage env.ts only") don't account for api.test assertion regexes /
index.ts comment — benign, adjust audit expectations.
Deferred Minors: backup_error kind not in plan owned-kinds list (harmless); B0 twilio whatsappNumber casts.
