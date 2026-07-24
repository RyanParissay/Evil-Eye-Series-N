# Evil Eye V2

Sports-betting arbitrage / expected-value / middle finder — the from-scratch
rebuild of Evil Eye V1. An information tool only: it scans odds, detects
opportunities, verifies them twice, and recommends exact stakes. It never
places bets or touches bookmaker accounts.

**V2 runs in SIM mode by default** — a deterministic simulated odds provider,
zero API keys, structurally incapable of network calls. LIVE mode (The Odds
API + Twilio WhatsApp) is switched on explicitly via `POST /api/mode` and
requires env vars to be present.

## Quick start

```bash
npm install
npm run dev            # server on :4400 (SIM mode)
npm run dev:client     # UI on :5174
npm test               # server + client test suites
npm run typecheck
```

## Layout

- `server/` — Express + better-sqlite3. Pure engine math, scan→verify
  pipeline, kill battery, scheduler (one timer chain), brain heat model,
  analytics read models, SIM/LIVE seam.
- `client/` — React/Vite SPA: TRADES · BRAIN · ANALYTICS · SETTINGS.
- `docs/handoff/DECISIONS.md` — locked product rules.
- `docs/HANDOFF.md` — rolling current-state notes.
- `TASKS.md` — passive backlog of bugs/follow-ups, each worktree-sized.

## For LLM sessions

Read `CLAUDE.md` (auto-loaded session contract) first; `ARCHITECTURE.md` is
the deep reference. V1 at `../evil-eye-arbitrage` is live and frozen — all
development happens here.
