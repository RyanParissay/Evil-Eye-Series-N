# Mission: Phases 4–7 — prove the edge, protect the fund

## Context and intent

This app is a personal betting operation being built in deliberate arcs: find opportunities (done — Phases 1–3), **prove with data that acting on them makes money** (this mission), protect the bankroll (this mission), then widen the edge with new strategies on the same rails (roadmap, not now). Benchmark products are OddsJam/RebelBetting ($99–399/mo): their core loop is scanner → alert → one-click execution → automatic tracker → P&L/CLV proof. We have the first three; you are building the proof layer. Optimize for: correctness of money math above all, honesty of displayed numbers, small legible diffs, and extension points over features.

## Operating rules (read before anything)

1. Read `CLAUDE.md` first. Every invariant there holds. The load-bearing ones for this mission: **no server-side polling/schedulers, ever**; **line groups are sacred**; **credits are real money** — any new odds call updates usage math; suspicious/same-book arbs are flagged, never alerted; the alert fingerprint excludes odds/profit; `last-snapshot.json` stays latest-only; engine stays pure; keys never reach the client.
2. Workflow per phase: commit a design doc to `docs/superpowers/specs/` → present plan + open questions → **wait for my approval** → TDD (failing test first) → implement → `npm test` and `npm run typecheck` green in both workspaces → drive the real flow in mock mode (`DEV_MODE=true`) → update `CLAUDE.md` and the onboarding doc's state section → short summary of what changed and why.
3. One phase per session, in order. Do not start the next phase's work early "while you're in there."
4. Stop-and-ask policy: if a requirement below conflicts with an invariant, existing behavior, or another requirement, stop and present options with a recommendation. Never silently reinterpret.
5. No new dependencies without approval and a one-line justification each. Prefer the existing patterns (JSON store, pure modules, pages-own-their-state).
6. All new money math lives in pure, unit-tested functions (engine/ or a pure module beside its feature). No arithmetic on dollars inside React components or route handlers.
7. Anything simulated is labeled SIMULATED in the UI, in API payloads, and in exports. No exceptions.

## Phase 4 — Advanced Mode (presets over the latest snapshot)

**Goal:** recompute opportunities for any set of books from the stored latest raw snapshot, at zero API cost, without touching the default scan experience.

Build:
1. Preset entity persisted via the JSON store: `{ id, name, bookmakerKeys[], createdAt, lastUsedAt }`. Seed two on first run: "All enabled" (dynamic: current enabled books) and "Funded only" (dynamic: balance > 0). Dynamic seeds resolve at evaluation time; the design doc must specify how dynamic vs. static presets are represented.
2. One server endpoint that takes a preset id (or explicit key list) and runs the existing `detectOpportunities` slice against the latest snapshot. It must not fetch odds, must not write opportunity records, and must return the snapshot's `fetchedAt` so the client can display data age.
3. New client route: searchable multi-select with chips, select-all/clear, preset save/rename/delete, opens on last-used preset. Recompute on every selection change. Show "as of scan Xm ago" prominently; if no snapshot exists, an empty state that says to run a scan — never an error.
4. Cards render identically to ScanPage. Deep-link a card to the cockpit **only** if a persisted record with that fingerprint exists; otherwise render snapshot-only (no fabricated records, no dead links).
5. Design-doc decision (present options, recommend one): should WhatsApp alert scope (all-books vs. named preset) land in this phase or later, given allowlist filtering currently happens pre-detection in the scan path? Consider migration of existing subscription state either way.

Acceptance criteria:
- Toggling books changes results with zero credits charged (assert via usage accounting in tests).
- An arb present in the full set correctly disappears in a subset lacking one leg's book (test with the mock feed).
- Preset CRUD survives server restart; last-used restores.
- ScanPage behavior and tests untouched.
- Line-group discipline verified in recompute path by test (no cross-line combinations).

## Phase 5 — Ledger + P&L dashboard + CSV

**Goal:** one place that answers "is this making money, where, and how fast do edges decay," from data we already persist.

Build:
1. Server: a ledger read model streaming JSONL archives + live records (paginated or windowed; do not load unbounded files into memory). Extend the cockpit completion flow if actual filled odds/stakes aren't fully persisted today — completed records must carry them.
2. Dashboard page (existing design system; tables + one equity line, no chart gallery): cumulative realized/locked profit over time; profit by book and by sport; capture rate (completed ÷ alerted); **odds decay** = profitPct at detection vs. at completion/last-verification, overall and per book.
3. CSV export: one row per opportunity — ids, event, market, books, detection/verify/completion odds and stakes, statuses, timestamps, alerted flags. Excel-safe formatting.

Acceptance criteria:
- Numbers reconcile: dashboard totals equal a test-computed sum over a fixture ledger to the cent.
- Decay handles records never verified (falls back sensibly, stated in the design doc).
- A 10k-record synthetic archive renders without loading everything into memory (test the read model's windowing).
- CSV round-trips: parse the export in a test and recover the totals.

## Phase 6 — Paper trading ("shadow fund")

**Goal:** prove, risk-free, what the system would have earned if **100% of alert-worthy opportunities were acted on instantly** — the go/no-go evidence for scaling real money.

Build:
1. Settings: paper mode on/off; paper starting bankroll (default $5,000, clearly fake); stake rule = flat $ (default $400) or % of paper bankroll.
2. Selection rule: an opportunity enters the paper book **iff** it qualifies for WhatsApp push — reuse the alertService's selection logic (threshold, non-suspicious, non-same-book, dedup). Do not duplicate that logic; refactor to share it if needed. Entry uses alert-time odds.
3. Settlement without scores: a two-leg arb taken at both quoted prices has outcome-independent profit — book P&L deterministically as stake × profitPct/100, realized at event commence time. Lazy settlement is fine (compute on read for commenced entries); no schedulers, no external calls, zero credits.
4. Two series, both labeled SIMULATED: headline **ideal-100%** equity curve; secondary **haircut** curve with a configurable slippage assumption (default: propose a defensible % of entries voided/degraded in the design doc, informed by any degradation/verification data we already persist — justify the number).
5. Paper vs. real: monthly totals side by side (ideal / haircut / real) on the Phase 5 dashboard once real completions exist.
6. Isolation: paper state in its own store; it never touches bookmaker balances, alerts, opportunity lifecycle, or credits. "Reset paper fund" action re-zeroes with confirmation.

Acceptance criteria:
- Paper entries exactly match would-be alerts over a mock scan sequence (shared-logic test), including dedup (a re-sighted fingerprint doesn't double-enter).
- Deterministic settlement: fixture with known odds/stakes settles to expected cents; %-of-bankroll staking compounds correctly across sequential entries.
- Ideal vs. haircut math verified independently.
- Toggling paper mode off hides paper UI but preserves data; reset works; nothing in the real ledger changes in any paper test.
- Every paper surface (UI, API, CSV) carries the simulated label — assert in tests where practical.

## Phase 7 — Fund position & bankroll ops

**Goal:** the cash pool is a first-class citizen: alerts and cockpit show exact dollars from real bankroll state, and the fund's position is always visible and reconciled.

Build:
1. Promote bankroll from cockpit-local scaler to persisted settings: real total bankroll + default per-opportunity stake. Cockpit defaults to it (per-visit override stays); **WhatsApp alerts now carry exact dollar stakes**, not per-$100 splits — update the message format and its tests.
2. Fund position panel (compact; avoid a new page if reasonable): total float = Σ per-book balances from the registry; unallocated cash (settings field); real cumulative P&L from the ledger; paper equity alongside, labeled SIMULATED.
3. Safety rails: a leg's suggested stake never exceeds that book's recorded balance — cap and visibly flag in both cockpit and alert message; low-balance warning when an enabled book's balance < default stake; stale-balance nudge at 14+ days since last manual update.
4. Reconciliation: completing an opportunity offers one-tap "apply to balances" (adjust each involved book by −stake, +payout on the winning-leg book, from actual filled numbers). Manual-entry philosophy stands — we never touch bookmaker accounts; this is bookkeeping assistance, with an undo or correction path (design doc decides which).

Acceptance criteria:
- Alert message contains correct exact stakes derived from persisted bankroll (message-format test), including the capped case with its flag.
- Cap logic: leg stake ≤ book balance in every suggestion path; profit figures recompute correctly under a cap (asymmetric stakes), verified against hand-computed fixtures.
- Apply-to-balances updates exactly the involved books by exactly the actual amounts; correction path works; balances survive restart.
- Warnings fire at the specified thresholds and not otherwise.

## Roadmap — do NOT build, but leave the door open

Pinnacle benchmark **merge** (fan-out/merge in `runScan` per the known open item — not a provider swap) → +EV detection with fractional Kelly → CLV capture (closing-odds snapshot → ledger column; the pro proof metric). Middles detector (deliberately pairs *different* lines — needs its own explicit rules, never a relaxation of arb line-group discipline). Reply-to-confirm via Twilio inbound webhook feeding capture rate; morning digest under the no-scheduler invariant (client-triggered or first-scan-of-day; decide later).

Cheap now, valuable later: when touching opportunity records, add `strategy: 'arb'` as a discriminator with room for future values, and keep alertService selection strategy-agnostic. Do not build any roadmap item.

## Definition of done (every phase)

Design doc committed → approved plan → failing-tests-first history → all tests + typecheck green (both workspaces) → real-flow walkthrough in `DEV_MODE=true` demonstrated to me → invariants intact → `CLAUDE.md` + onboarding state updated → summary: what changed, what was deliberately not done, open questions.

Begin now: Phase 4 design doc.
