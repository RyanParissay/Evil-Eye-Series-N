# Evil Eye V2 — Plan 2: TRADES Screen (client)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React client (`client/` workspace) that renders the TRADES screen pixel-faithful to the design inventory — shared header/nav/status line, VERIFIED LIVE and PENDING VERIFICATION cards with live timers, the CONFIRM cycle, the TRADE LIMITED? flow, STALE/REFRESH?, and the VIEW ALL TRADES expander (ALL TRADES + HISTORY + graveyard + list controls) — consuming Plan 1's simulated-core API exactly.

**Architecture:** A single-page React 18 app with no router, no CSS framework, no state library: tab state is a `useState` in `App` (matches the mockup's `state.tab`), server state is one polling hook (`useAppState`, GET `/api/state` every 5s, falling back to `null` on any error), and one shared 1-second tick (`useTick`) drives every countdown. All display math (money, clocks, odds, metrics, Vancouver timestamps, timer phases, list-reveal states) lives in pure functions under `client/src/lib/` and is the ONLY thing unit-tested (vitest, `node` environment — no component/jsdom tests). Styling is plain CSS: `tokens.css` (every §0.2 color as a custom property) + one `global.css` holding all component classes.

**Tech Stack:** Vite 5, React 18, TypeScript strict (`strict: true`, `noUncheckedIndexedAccess: true`), Vitest 2 (environment `node`), plain CSS with custom properties. Dev server port 5174 proxying `/api` to the Plan 1 server on 4400.

## Global Constraints

- Workspace `client/` is added to the root `package.json` `workspaces: ["server", "client"]`; root scripts gain `"dev:client": "npm run dev -w client"`, and `"test"` / `"typecheck"` run BOTH workspaces (`server` then `client`).
- `client/vite.config.ts`: port **5174** (`strictPort: false`), proxy `'/api'` → `process.env.EE_API_TARGET ?? 'http://localhost:4400'`.
- TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`. Vitest environment `node`, **pure display math only** — never a component/jsdom test.
- No router lib, no CSS framework, no state lib. Tab switching via `useState`.
- Money is **integer cents** in every variable and API payload; dollars exist only inside format functions' return strings.
- All timestamps are **epoch milliseconds**; wall-clock rendering is **America/Vancouver** via `Intl.DateTimeFormat` (never a fixed UTC offset).
- ALL UI copy is copy-paste verbatim from `docs/handoff/design-inventory.md` (uppercase, exact glyphs: `—` em dash, `·` middle dot, `↗`, `▸`, `▾`, `✓`, `−` U+2212 minus, `→`). The five empty-state strings and the placeholder-screen body are NEW copy (not in the inventory) and are flagged where they appear.
- Never render the words: **append-only, ghost, picker, grader, CLV, gatekeeper** — anywhere in UI strings (MASTER PROMPT hard rule 6).
- Every color/size/spacing in CSS comes from design-inventory §0/§1/§2; the handful of values the inventory does not pin are marked `/* not pinned by inventory */` in `global.css` and listed in Decision notes item 16.
- Page column: `max-width: 860px; margin: 0 auto; padding: 24px 22px 80px` (§0.5 + locked call 15). Square corners everywhere (§0.3).
- The client must render sanely with the server **down**: `useAppState` yields `null`, status line shows `NEXT SCAN —`, badge defaults to `SIMULATED`, sections show `(0)` counts and empty-state notes. **No error banner.**
- TDD every lib task; commit after every task. All commands run from the repo root.

> **Shipping note:** Tasks 1–5 ship with this plan's branch as the app shell; executors verify them green and continue from Task 6. Steps are still fully written for all tasks.

## API Contract Consumed (verbatim payload spec — from Plan 1 Task 13)

```
GET /api/state →
  { mode:'SIMULATED', now, nextScanAt, quietHours:boolean,
    trades:{ verified:TradeView[], pending:TradeView[] },
    counts:{ verifiedToday, killedToday } }

TradeView = Trade (plan-1 shared/types.ts) plus marginPct/edgePct (numbers, 2dp).
Trade fields (epoch ms timestamps): id, profileId, category 'ARB'|'MIDDLE'|'EV',
  event, sport, legs [{ book, selection, odds, stakeCents }],
  marginInitial, marginRecheck, marginFinal,
  status 'PENDING'|'VERIFIED'|'CONFIRMED'|'UNCONFIRMED'|'EXPIRED'|'KILLED'|'SETTLED',
  killReason, resultCents, createdAt, verifyDueAt, verifiedAt, freshUntil,
  settledAt, eventStartsAt.
Legs carry NO stakeCents (null) until status ≥ VERIFIED.

POST /api/trades/:id/confirm | /unconfirm | /limited { book, maxAllowedCents }
GET  /api/trades?view=all|history
POST /api/scan            (503 { error:{ code:'quiet_hours', … } } possible)
Errors: { error: { code, message } }
```

The client-side mirror of this contract is `client/src/lib/api.ts` (Task 4) — later tasks import types ONLY from there.

## Decision notes (locked product calls — bake in, do not re-litigate)

1. **CONFIRM 3-state visual cycle maps to 2 API states.** Click `CONFIRM` → POST `/confirm` → render `CONFIRMED ✓` (green `#43d17a` bg). Click that → LOCAL armed state renders `UNCONFIRM?` (yellow `#F5D90A` bg, **no API call**). Click that → POST `/unconfirm` → back to `CONFIRM` (white bg). The armed state resets if the card leaves the verified list (unmount or status change).
2. **FRESH auto-flips to STALE at 0** (the mockup clamps at 0:00; MASTER PROMPT rule 8 wins). FRESH = countdown `freshUntil − now`; when ≤ 0 render STALE counting up `now − freshUntil`, value yellow, plus a `REFRESH?` chip (`rgba(255,255,255,0.75)` bg, black text). REFRESH? posts `POST /api/scan` — the nearest available endpoint (adjudication: the contract has no per-trade refresh; a manual scan re-sights the market, which is what REFRESH? means).
3. **Pending countdown** derives from `verifyDueAt − now`, clamped at `0:00`. The server re-schedules; the client never resets to 75.
4. **NEXT SCAN** renders live from `nextScanAt` as `JUL 13 · 10:47 PM` uppercase in America/Vancouver via pure `formatScanTime(epochMs)`. When state is `null` (server down): `NEXT SCAN —` and the badge defaults to `SIMULATED`. No error banner.
5. **Pending cards keep the tinted metric box** (inventory discrepancy 5: mockup wins) — still NO stakes; the leg stake slot is only a grey `↗`.
6. **Card metric boxes:** ARB → `MARGIN: {x}%` (with colon) border/text `#a8e8be`; EV/MIDDLE → `EDGE: +{x}%` `#f2e08a`. ALL TRADES cells use NO colon (`MARGIN 2.5%` / `EDGE +3.1%`). Both via `formatMetric(category, pct, { colon })`, **1 decimal place**.
7. **Money:** integer cents. `formatCents(c)` → `$35` / `$10,000` (no decimals when `c % 100 === 0`, thousands separators) else `$2.20`. `formatSignedCents(c)` always 2dp with `+` / U+2212 minus: `+$2.20`, `−$20.00`. `parseDollarsToCents('$25')` → `2500` (strip non-digits; empty/no-digit → `null`) feeds the limited flow's `maxAllowedCents`.
8. `formatClock(sec)` → `m:ss` (floor, pad2): 86 → `1:26`, 0 → `0:00`, 161 → `2:41`.
9. `formatOdds(n)` → always 2dp (`3.10`, `2.06`). Leg button text: `{book} — {leg.selection} @ {formatOdds(odds)}`; verified stake segment `BET {formatCents(stakeCents)} ↗` (divider `border-left: 1px solid #cfcfcf; margin-left: 14px; padding-left: 14px`, weight 700).
10. **TRADE LIMITED? panel** per inventory §2.2 verbatim: label `WHICH BOOK LIMITED YOU? — ONE AT A TIME; REOPEN TO REPORT ANOTHER`; single-select book chips (re-click deselects); label `MAX BET THEY ALLOWED`; input placeholder `$25`; send button 3 states — disabled grey `✓ SEND TO MODEL` until book + digit, ready white `✓ SEND TO MODEL`, armed yellow `CONFIRM? ✓`; second click POSTs `/limited` then closes + resets. Only ONE card's panel open at a time; opening resets state; the `TRADE LIMITED?` button inverts while open.
11. **VIEW ALL TRADES:** yellow CTA (`#F5D90A` → `#6a6a6a` while open, hover `#fff`), caption `EVERY VALUABLE TRADE THE SCANNER FOUND — ARB · MIDDLE · EV`; on open fetch BOTH `?view=all` and `?view=history`. ALL TRADES box (2px `#f5ecb8`, header `ALL TRADES` 15px/600/0.14em/#fff, grid `0.6fr 1.7fr 2fr 0.9fr 1.1fr`): CAT | `{event} · {sport}` | legs joined `{book} {formatOdds(odds)}` with ` / ` | metric tinted | STATUS mapped PENDING→`PENDING` #9a9a9a, VERIFIED→`VERIFIED LIVE` #fff, CONFIRMED→`CONFIRMED` #43d17a, UNCONFIRMED→`UNCONFIRMED` #9a9a9a. HISTORY box (2px `#f5ecb8`, header row with graveyard toggle `▸ {killedToday} KILLED TODAY` / `▾ …`): rows from view=history — SETTLED→chip `CONFIRMED` (#37c86f if `resultCents ≥ 0` else #e0442c) + `WON +$x.xx`/`LOST −$x.xx`; EXPIRED→chip `EXPIRED` #5a5a5a + `—`; KILLED rows appear ONLY in the graveyard sublist (`GRAVEYARD — EVERY KILL IS LOGGED WITH ITS REASON`, rows `{category} · {event}` | `{killReason}`). Description col = `{category} · {event} · {stakes joined '/' as $50/$50}` when stakes exist, else `{category} · {event}`. Third col `{formatWhen(settledAt ?? createdAt)}` = `JUL 14 · 2:12 PM`. List controls per §2.5: start 5; `VIEW MORE →` → 15; at 15 `VIEW LESS` + (total>15) `VIEW ALL ({n})`; at full `VIEW LESS` only — implemented as pure `nextRevealState()` / `revealControls(count, total)` with vitest specs.
12. **Empty states** (NEW copy, not in inventory; style 12px `#5a5a5a` 0.08em padding 14px): VERIFIED LIVE → `NOTHING VERIFIED RIGHT NOW`; PENDING → `NO CANDIDATES IN VERIFICATION`; ALL TRADES → `NO TRADES YET`; HISTORY → `NO HISTORY YET`; graveyard → `NO KILLS TODAY`. Section headers always show live counts, e.g. `VERIFIED LIVE (0)`.
13. **Normalize demo one-offs:** ALL cards `padding: 12px 14px` (drop demo card-2's `18px`); stacked cards after the first get `border-top: none` (keep — it's systematic; done with `.trade-card + .trade-card`).
14. **Forbidden words** (never in any UI string): append-only, ghost, picker, grader, CLV, gatekeeper.
15. **Shell chrome per inventory §1 exactly:** eye SVG (`viewBox="0 0 30 18"`, ellipse cx15 cy9 rx13.5 ry8 stroke #fff width 1.6 no fill; circle r4 same; pupil r1.7 fill #e0442c), wordmark `EVIL EYE V2` 16px/500/0.16em #fff with the `V2` span #F5D90A, badge `SIMULATED` 2px #F5D90A outline, joined nav per §0.4, status line right-aligned `NEXT SCAN ` + white timestamp span, border-bottom 1px #8f8f8f. Placeholder panels for BRAIN/ANALYTICS/SETTINGS: 1px #ababab border box, muted label = tab name, body 12px #5a5a5a `ARRIVES WITH PLAN {3|4|5}` (NEW copy, not in inventory).
16. **Adjudications made by this plan** (not covered by the locked calls — flagged for review):
    a. `GET /api/trades` response envelope is unspecified in Plan 1 — `fetchTrades` accepts BOTH a bare `TradeView[]` and `{ trades: TradeView[] }`.
    b. `marginPct`/`edgePct` are typed `number | null` (Plan 1 doesn't say whether both are present on every category); `metricPct(t)` picks by category and defaults to 0.
    c. Plan 1's `view=all` is "every non-settled trade", which can literally include KILLED/EXPIRED; the ALL TRADES status cell therefore has defensive renderings beyond the four locked mappings: SETTLED→`CONFIRMED {±$x.xx}` (result-colored, per mockup rows 5–7), KILLED→`KILLED — {killReason with _ → space}` #e0442c, EXPIRED→`EXPIRED` #5a5a5a.
    d. `useAppState` also returns a `refresh()` so POST actions reflect immediately instead of waiting ≤5s for the next poll.
    e. Timer rounding: FRESH uses `ceil` (never shows 0:00 while still fresh), STALE and the pending countdown use `floor`/`ceil` respectively — pinned in Task 6 specs.
    f. `formatWhen` delegates to `formatScanTime` (both surfaces use the identical `MMM DD · h:mm AM/PM` Vancouver format).
    g. Sports arrive lowercase from the server seed (`soccer`) and are rendered `toUpperCase()`.
    h. The LimitedPanel disarms (`CONFIRM? ✓` → ready) whenever the book or amount changes after arming.
    i. Two files not in the locked file map were required by this plan's own TDD demands: `client/src/lib/api.test.ts` (Task 4's `deriveStatusLine` spec) and `client/src/lib/reveal.ts` + `reveal.test.ts` (Task 12's list-controls spec).
    j. Unpinned spacings marked in `global.css`: book-chips row `margin-top: 6px`, limited input/send row `display:flex; gap:10px`, CTA caption `margin-top: 8px`, VIEW ALL section `margin-top: 16px`, placeholder panel `padding: 13px 16px` (patterned on §3.3), empty-state notes render as borderless divs.
    k. The graveyard toggle count is `counts.killedToday` from `/api/state` (locked call 11); the graveyard rows are ALL KILLED rows from `view=history` — they can disagree in count (history may hold older kills). Rendered as specified.

## File Map

```
package.json                          (Modify — add client workspace + scripts)
.gitignore                            (Modify — ignore client/dist)
client/package.json                   (Create)
client/vite.config.ts                 (Create)
client/tsconfig.json                  (Create)
client/index.html                     (Create)
client/src/main.tsx                   (Create T1; final form T5)
client/src/smoke.test.ts              (Create)
client/src/styles/tokens.css          (Create — §0.2 colors as custom properties)
client/src/styles/global.css          (Create — COMPLETE stylesheet, all components)
client/src/lib/format.ts + format.test.ts        (Create — money/clock/odds/metric/time)
client/src/lib/timers.ts + timers.test.ts        (Create — FRESH/STALE + pending math)
client/src/lib/reveal.ts + reveal.test.ts        (Create — §2.5 list controls)
client/src/lib/api.ts + api.test.ts              (Create — contract types + fetch helpers)
client/src/hooks/useAppState.ts       (Create — 5s poll, null fallback, refresh())
client/src/hooks/useTick.ts           (Create — single shared 1s tick)
client/src/components/Header.tsx      (Create)
client/src/components/Nav.tsx         (Create)
client/src/components/StatusLine.tsx  (Create)
client/src/components/LiveCard.tsx    (Create T7; grows T8, T9, T11)
client/src/components/ConfirmButton.tsx (Create)
client/src/components/LimitedPanel.tsx  (Create)
client/src/components/PendingCard.tsx   (Create)
client/src/components/ViewAll.tsx       (Create)
client/src/screens/TradesScreen.tsx     (Create T5; grows T7, T9, T10, T12, T13)
client/src/screens/PlaceholderScreen.tsx (Create)
client/src/App.tsx                       (Create)
```

---

### Task 1: Client workspace scaffold

**Files:**
- Modify: `package.json` (repo root)
- Modify: `.gitignore`
- Create: `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`, `client/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first client task). The Plan 1 server workspace already exists and must keep passing.
- Produces: the commands every later task runs — `npm test -w client`, `npm run typecheck -w client`, `npm run dev:client` — and the root `npm test`/`npm run typecheck` running both workspaces.

- [ ] **Step 1: Rewrite the root `package.json`** (current content has only the `server` workspace):

```json
{
  "name": "evil-eye-v2",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "test": "npm run test -w server && npm run test -w client",
    "typecheck": "npm run typecheck -w server && npm run typecheck -w client",
    "dev": "npm run dev -w server",
    "dev:client": "npm run dev -w client"
  }
}
```

- [ ] **Step 2: Append to `.gitignore`** so the full file reads:

```
node_modules/
server/data/
*.log
client/dist/
```

- [ ] **Step 3: Create `client/package.json`**

```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: Create `client/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': process.env.EE_API_TARGET ?? 'http://localhost:4400',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `client/tsconfig.json`** (vite.config.ts is deliberately excluded — vite transpiles it itself; `tsc` covers `src/` only)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EVIL EYE V2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `client/src/main.tsx`** (minimal — no CSS imports yet, those files arrive in Task 2; the real `App` arrives in Task 5)

```tsx
import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(<div>EVIL EYE V2 — client scaffold</div>);
```

- [ ] **Step 8: Create `client/src/smoke.test.ts`**

```ts
import { expect, test } from 'vitest';

test('client toolchain runs', () => {
  expect(2 + 2).toBe(4);
});
```

- [ ] **Step 9: Install and verify**

Run: `npm install && npm test && npm run typecheck`
Expected: install succeeds; server suite passes as before; client suite reports `1 passed`; both typechecks clean.

- [ ] **Step 10: Verify the dev server boots**

Run: `npm run dev:client` (leave running) and in a second terminal: `curl -s http://localhost:5174/ | grep -c 'EVIL EYE V2'`
Expected: `1` (the index.html title). Stop the dev server (Ctrl-C).

- [ ] **Step 11: Commit**

```bash
git add package.json .gitignore client
git commit -m "feat(client): scaffold vite+react client workspace"
```

---

### Task 2: Design tokens + complete global stylesheet

**Files:**
- Create: `client/src/styles/tokens.css`, `client/src/styles/global.css`
- Modify: `client/src/main.tsx` (add the two CSS imports)

**Interfaces:**
- Consumes: design-inventory §0 (tokens), §1 (shell), §2 (TRADES).
- Produces: every CSS class used by Tasks 5–13. Class names are FROZEN here: `.page .header .brand .wordmark .v2 .mode-badge .nav .status-line .time .section-header (.pending .inline) .empty-note .trade-card (.pending) .card-top .card-title (.pending) .tag (.pending) .card-status .status-text (.pending) .status-value (.stale .dim) .refresh-chip .legs .leg-btn (.pending) .leg-stake .leg-arrow .action-row .confirm-btn (.state-confirm .state-confirmed .state-unconfirm) .limited-btn (.open) .metric-box (.arb .edge) .limited-panel .limited-label (.max) .book-chips .book-chip (.selected) .limited-row .limited-input .send-btn (.disabled .ready .armed) .viewall .cta (.open) .cta-caption .va-box .va-row .va-cat .va-event .va-legs .va-metric (.arb .edge) .va-status .va-footer .list-btn .hist-header-row .grave-toggle .hist-row .hist-desc .hist-outcome .chip .hist-when .graveyard .grave-title .grave-row .grave-reason .placeholder .placeholder-label .placeholder-body`.

- [ ] **Step 1: Create `client/src/styles/tokens.css`** — every §0.2 color, spec names kebab-cased:

```css
/* client/src/styles/tokens.css — design tokens, verbatim from design-inventory §0.2 */
:root {
  --yellow: #F5D90A;
  --blue: #5CA8FF;
  --pink: #FF7AC6;
  --green: #43d17a;
  --green-money: #37c86f;
  --red: #e0442c;
  --grey-strongest: #cfcfcf;
  --grey-panel: #ababab;
  --grey-divider: #8f8f8f;
  --grey-subtle-row: #4a4a4a;
  --margin-tint: #a8e8be;
  --edge-tint: #f2e08a;
  --trade-log: #f5ecb8;
  --body-text: #d6d6d6;
  --muted-label: #9a9a9a;
  --faint: #5a5a5a;
  --raised-bg: #161616;
  --hover-bg: #1e1e1e;
  --inset-bg: #0d0d0d;
  --cta-greyed-open: #6a6a6a;
  --pink-dim-border: #6e2a4e;
  --blue-dim-border: #2a3a52;
  --chart-bg: #d9d9d9;
  --chart-ink: #111;
  --chart-minor: #999;
}
```

- [ ] **Step 2: Create `client/src/styles/global.css`** — the COMPLETE stylesheet for this plan (later tasks add no CSS):

```css
/* client/src/styles/global.css — complete TRADES-screen + shell stylesheet.
   Every value from design-inventory §0–§2 unless marked "not pinned by inventory". */

/* ---------- base (§0.1) ---------- */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: #000;
  color: var(--body-text);
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
body { min-height: 100vh; }
a { color: #fff; text-decoration: underline; }
a:hover { color: var(--yellow); }
::selection { background: var(--yellow); color: #000; }
button { font-family: inherit; cursor: pointer; }
button:disabled { cursor: default; }

/* ---------- page shell (§0.5, locked call 15) ---------- */
.page { max-width: 860px; margin: 0 auto; padding: 24px 22px 80px; }

/* ---------- header (§1) ---------- */
.header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.brand { display: flex; align-items: center; gap: 10px; }
.wordmark { font-size: 16px; font-weight: 500; letter-spacing: 0.16em; color: #fff; }
.wordmark .v2 { color: var(--yellow); }
.mode-badge { border: 2px solid var(--yellow); color: var(--yellow); font-size: 12px; letter-spacing: 0.16em; padding: 6px 14px; font-weight: 500; }

/* ---------- joined-chip nav (§0.4) ---------- */
.nav { display: flex; gap: 0; border: 2px solid #fff; width: max-content; margin-top: 14px; }
.nav button { background: none; border: none; border-left: 2px solid #fff; color: var(--muted-label); padding: 8px 18px; font-size: 12px; font-weight: 500; letter-spacing: 0.14em; }
.nav button:first-child { border-left: none; }
.nav button.active { background: #fff; color: #000; }

/* ---------- status line (§1) ---------- */
.status-line { margin-top: 12px; padding: 8px 0; border-bottom: 1px solid var(--grey-divider); font-size: 11px; letter-spacing: 0.1em; color: var(--muted-label); text-align: right; white-space: nowrap; }
.status-line .time { color: #fff; }

/* ---------- section headers (§2.1, §2.3) ---------- */
.section-header { margin: 16px 0 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.14em; color: #fff; }
.section-header.pending { font-weight: 500; color: var(--muted-label); }
.section-header.inline { margin: 0; }

/* ---------- empty states (locked call 12 — new copy) ---------- */
.empty-note { font-size: 12px; color: var(--faint); letter-spacing: 0.08em; padding: 14px; }

/* ---------- trade cards (§2.1, §2.3; locked call 13) ---------- */
.trade-card { border: 2px solid var(--grey-panel); padding: 12px 14px; font-variant-numeric: tabular-nums; }
.trade-card + .trade-card { border-top: none; }
.trade-card.pending { opacity: 0.82; }
.card-top { display: flex; justify-content: space-between; font-size: 14px; }
.card-title { font-weight: 600; }
.card-title.pending { color: var(--body-text); }
.tag { border: 1px solid #fff; color: #fff; font-size: 11px; letter-spacing: 0.1em; padding: 2px 6px; margin-right: 8px; }
.tag.pending { border-color: var(--muted-label); color: var(--muted-label); }
.card-status { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.status-text { font-size: 13px; font-weight: 500; letter-spacing: 0.1em; color: var(--body-text); }
.status-text.pending { color: var(--muted-label); }
.status-value { font-weight: 600; color: #fff; }
.status-value.stale { color: var(--yellow); }
.status-value.dim { color: var(--body-text); }
.refresh-chip { background: rgba(255, 255, 255, 0.75); border: none; color: #000; font-size: 11px; font-weight: 500; letter-spacing: 0.12em; padding: 4px 10px; }

/* legs (§2.1, §2.3) */
.legs { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 10px; }
.leg-btn { white-space: nowrap; background: var(--raised-bg); border: 2px solid var(--grey-strongest); color: #fff; padding: 9px 14px; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; text-align: left; }
.leg-btn:hover { border-color: #fff; color: #fff; background: var(--hover-bg); }
.leg-btn.pending { border-color: var(--grey-divider); color: var(--body-text); }
.leg-stake { display: inline-block; border-left: 1px solid var(--grey-strongest); margin-left: 14px; padding-left: 14px; color: #fff; font-weight: 700; }
.leg-arrow { margin-left: 10px; color: var(--muted-label); }

/* action row + metric box (§2.1, locked call 6) */
.action-row { display: flex; gap: 10px; margin-top: 12px; align-items: center; }
.confirm-btn { border: none; color: #000; font-size: 11px; letter-spacing: 0.12em; padding: 8px 16px; font-weight: 500; }
.confirm-btn:hover { opacity: 0.85; }
.confirm-btn.state-confirm { background: #fff; }
.confirm-btn.state-confirmed { background: var(--green); }
.confirm-btn.state-unconfirm { background: var(--yellow); }
.limited-btn { background: none; color: #fff; border: 2px solid #fff; font-size: 11px; letter-spacing: 0.12em; padding: 6px 14px; }
.limited-btn.open { background: #fff; color: #000; }
.metric-box { margin-left: auto; padding: 6px 14px; font-size: 11px; font-weight: 500; letter-spacing: 0.12em; white-space: nowrap; }
.metric-box.arb { border: 2px solid var(--margin-tint); color: var(--margin-tint); }
.metric-box.edge { border: 2px solid var(--edge-tint); color: var(--edge-tint); }

/* ---------- TRADE LIMITED? panel (§2.2) ---------- */
.limited-panel { border: 1px solid var(--grey-panel); background: var(--inset-bg); margin-top: 12px; padding: 12px 14px; }
.limited-label { font-size: 11px; letter-spacing: 0.14em; color: var(--muted-label); }
.limited-label.max { margin: 12px 0 6px; }
.book-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; } /* margin-top not pinned by inventory */
.book-chip { background: var(--raised-bg); color: var(--body-text); border: 2px solid var(--grey-strongest); font-size: 12px; padding: 6px 12px; }
.book-chip.selected { background: #fff; color: #000; border-color: #fff; }
.limited-row { display: flex; gap: 10px; align-items: center; } /* row layout not pinned by inventory */
.limited-input { width: 110px; background: #000; color: #fff; border: 2px solid var(--grey-panel); padding: 8px 10px; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; font-family: inherit; }
.limited-input:focus { border-color: #fff; outline: none; }
.send-btn { padding: 9px 16px; font-size: 11px; letter-spacing: 0.12em; font-weight: 500; border: none; }
.send-btn.disabled { background: var(--faint); color: var(--hover-bg); }
.send-btn.ready { background: #fff; color: #000; }
.send-btn.armed { background: var(--yellow); color: #000; }

/* ---------- VIEW ALL TRADES (§2.4, §2.5) ---------- */
.viewall { margin-top: 16px; } /* section rhythm §0.5; exact top-margin not pinned */
.cta { display: block; width: 100%; background: var(--yellow); color: #000; text-align: center; font-size: 12px; letter-spacing: 0.14em; font-weight: 500; padding: 11px 16px; border: none; }
.cta:hover { background: #fff; }
.cta.open { background: var(--cta-greyed-open); }
.cta.open:hover { background: #fff; }
.cta-caption { font-size: 11px; letter-spacing: 0.08em; color: var(--faint); text-align: center; margin-top: 8px; } /* margin-top not pinned by inventory */
.va-box { border: 2px solid var(--trade-log); }
.va-row { display: grid; grid-template-columns: 0.6fr 1.7fr 2fr 0.9fr 1.1fr; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--grey-subtle-row); font-size: 12px; }
.va-cat { color: var(--muted-label); letter-spacing: 0.08em; }
.va-event { color: #fff; }
.va-legs { color: var(--muted-label); }
.va-metric.arb { color: var(--margin-tint); }
.va-metric.edge { color: var(--edge-tint); }
.va-status { text-align: right; letter-spacing: 0.08em; }
.va-footer { display: flex; gap: 20px; padding: 10px 14px; }
.list-btn { background: none; border: none; font-size: 12px; letter-spacing: 0.14em; color: var(--faint); padding: 0; }
.list-btn:hover { color: #fff; }
.hist-header-row { display: flex; justify-content: space-between; align-items: baseline; margin: 18px 0 8px; }
.grave-toggle { background: none; border: 1px solid var(--grey-strongest); color: var(--muted-label); padding: 3px 10px; font-size: 11px; letter-spacing: 0.1em; }
.grave-toggle:hover { color: #fff; }
.hist-row { display: grid; grid-template-columns: 2.4fr 1.5fr 1fr; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--grey-subtle-row); font-size: 12px; }
.hist-desc { color: var(--body-text); }
.hist-outcome { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.chip { border: 1px solid currentColor; padding: 2px 8px; letter-spacing: 0.1em; font-size: 11px; }
.hist-when { color: var(--muted-label); text-align: right; letter-spacing: 0.06em; white-space: nowrap; }
.graveyard { padding: 10px 14px; }
.grave-title { font-size: 11px; letter-spacing: 0.14em; color: var(--faint); }
.grave-row { display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--grey-subtle-row); font-size: 12px; color: var(--muted-label); }
.grave-reason { letter-spacing: 0.08em; color: var(--faint); }

/* ---------- placeholder screens (locked call 15 — new copy) ---------- */
.placeholder { border: 1px solid var(--grey-panel); margin-top: 16px; padding: 13px 16px; } /* padding patterned on §3.3; not pinned */
.placeholder-label { font-size: 11px; letter-spacing: 0.14em; color: var(--muted-label); }
.placeholder-body { font-size: 12px; color: var(--faint); letter-spacing: 0.08em; margin-top: 8px; }
```

- [ ] **Step 3: Rewrite `client/src/main.tsx`** to load the styles:

```tsx
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(<div className="page">EVIL EYE V2 — client scaffold</div>);
```

- [ ] **Step 4: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: 1 test passes, typecheck clean.
Then: `npm run dev:client`, open http://localhost:5174 — black page, light-grey Helvetica text inside the 860px column. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add client/src/styles client/src/main.tsx
git commit -m "feat(client): design tokens and global stylesheet"
```

---

### Task 3: Display formatters (TDD)

**Files:**
- Create: `client/src/lib/format.ts`
- Test: `client/src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing (zero imports — keep it dependency-free).
- Produces (consumed by Tasks 4–13):
  `formatCents(c: number): string` · `formatSignedCents(c: number): string` · `formatClock(sec: number): string` · `formatOdds(n: number): string` · `formatMetric(category: 'ARB' | 'MIDDLE' | 'EV', pct: number, opts: { colon: boolean }): string` · `parseDollarsToCents(input: string): number | null` · `formatScanTime(epochMs: number): string` · `formatWhen(epochMs: number): string`

- [ ] **Step 1: Write the failing spec** — `client/src/lib/format.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  formatCents, formatClock, formatMetric, formatOdds,
  formatScanTime, formatSignedCents, formatWhen, parseDollarsToCents,
} from './format';

test('formatCents: whole dollars drop decimals, thousands separated', () => {
  expect(formatCents(3500)).toBe('$35');
  expect(formatCents(1_000_000)).toBe('$10,000');
  expect(formatCents(5000)).toBe('$50');
});

test('formatCents: fractional cents render 2dp', () => {
  expect(formatCents(220)).toBe('$2.20');
  expect(formatCents(5)).toBe('$0.05');
  expect(formatCents(123_456)).toBe('$1,234.56');
});

test('formatSignedCents: always 2dp, + or U+2212 minus', () => {
  expect(formatSignedCents(220)).toBe('+$2.20');
  expect(formatSignedCents(-2000)).toBe('−$20.00');
  expect(formatSignedCents(0)).toBe('+$0.00');
  expect(formatSignedCents(4750)).toBe('+$47.50');
  expect(formatSignedCents(-1500)).toBe('−$15.00');
});

test('formatClock: m:ss, floor, pad2, clamps below 0', () => {
  expect(formatClock(86)).toBe('1:26');
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(161)).toBe('2:41');
  expect(formatClock(42)).toBe('0:42');
  expect(formatClock(-5)).toBe('0:00');
});

test('formatOdds: always 2dp', () => {
  expect(formatOdds(3.1)).toBe('3.10');
  expect(formatOdds(2.06)).toBe('2.06');
  expect(formatOdds(2)).toBe('2.00');
});

test('formatMetric: card style (colon) vs list style (no colon), 1dp', () => {
  expect(formatMetric('ARB', 2.5, { colon: true })).toBe('MARGIN: 2.5%');
  expect(formatMetric('EV', 2.8, { colon: true })).toBe('EDGE: +2.8%');
  expect(formatMetric('MIDDLE', 4.6, { colon: true })).toBe('EDGE: +4.6%');
  expect(formatMetric('ARB', 2.5, { colon: false })).toBe('MARGIN 2.5%');
  expect(formatMetric('EV', 3.1, { colon: false })).toBe('EDGE +3.1%');
  expect(formatMetric('ARB', 2.44, { colon: false })).toBe('MARGIN 2.4%');
});

test('parseDollarsToCents: strip non-digits; empty/no-digit → null', () => {
  expect(parseDollarsToCents('$25')).toBe(2500);
  expect(parseDollarsToCents('25')).toBe(2500);
  expect(parseDollarsToCents('$1,000')).toBe(100_000);
  expect(parseDollarsToCents(' $50 ')).toBe(5000);
  expect(parseDollarsToCents('')).toBeNull();
  expect(parseDollarsToCents('$')).toBeNull();
  expect(parseDollarsToCents('abc')).toBeNull();
});

test('formatScanTime: America/Vancouver, MMM DD · h:mm AM/PM, uppercase', () => {
  // 2026-07-13 22:47 PDT (UTC-7) == 2026-07-14 05:47 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 14, 5, 47))).toBe('JUL 13 · 10:47 PM');
  // 2026-07-14 14:12 PDT == 2026-07-14 21:12 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 14, 21, 12))).toBe('JUL 14 · 2:12 PM');
  // day pads to 2 digits: 2026-07-08 19:29 PDT == 2026-07-09 02:29 UTC
  expect(formatScanTime(Date.UTC(2026, 6, 9, 2, 29))).toBe('JUL 08 · 7:29 PM');
  // DST-safe: winter is PST (UTC-8): 2026-01-15 10:05 PST == 18:05 UTC
  expect(formatScanTime(Date.UTC(2026, 0, 15, 18, 5))).toBe('JAN 15 · 10:05 AM');
});

test('formatWhen: identical format to formatScanTime (history third column)', () => {
  expect(formatWhen(Date.UTC(2026, 6, 14, 21, 12))).toBe('JUL 14 · 2:12 PM');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- format`
Expected: FAIL — cannot resolve/find module `./format`.

- [ ] **Step 3: Implement `client/src/lib/format.ts`**

```ts
// client/src/lib/format.ts — pure display formatting. No imports, no React, no fetch.
// Money is integer cents everywhere; dollars exist only in these return strings.

function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** $35 / $10,000 when whole dollars; else $2.20. Input: non-negative cents. */
export function formatCents(c: number): string {
  const dollars = Math.floor(c / 100);
  const rem = c % 100;
  if (rem === 0) return `$${group(String(dollars))}`;
  return `$${group(String(dollars))}.${String(rem).padStart(2, '0')}`;
}

/** Always 2dp, '+' or U+2212 '−' sign: +$2.20, −$20.00. */
export function formatSignedCents(c: number): string {
  const sign = c < 0 ? '−' : '+';
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${group(String(dollars))}.${String(rem).padStart(2, '0')}`;
}

/** m:ss — floor, pad2. 86 → "1:26", 0 → "0:00", 161 → "2:41". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Decimal odds, always 2dp: "3.10", "2.06". */
export function formatOdds(n: number): string {
  return n.toFixed(2);
}

/** ARB → MARGIN[:] x.x% · EV/MIDDLE → EDGE[:] +x.x% — 1 decimal place. */
export function formatMetric(
  category: 'ARB' | 'MIDDLE' | 'EV',
  pct: number,
  opts: { colon: boolean },
): string {
  const sep = opts.colon ? ': ' : ' ';
  if (category === 'ARB') return `MARGIN${sep}${pct.toFixed(1)}%`;
  return `EDGE${sep}+${pct.toFixed(1)}%`;
}

/** "$25" → 2500. Strips every non-digit; empty / no digit → null. */
export function parseDollarsToCents(input: string): number | null {
  const digits = input.replace(/\D/g, '');
  if (digits === '') return null;
  return Number(digits) * 100;
}

const VANCOUVER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Epoch ms → "JUL 13 · 10:47 PM" in America/Vancouver (DST-safe via Intl). */
export function formatScanTime(epochMs: number): string {
  const parts = VANCOUVER.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')} · ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** History third column — same format as the status line. */
export function formatWhen(epochMs: number): string {
  return formatScanTime(epochMs);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client -- format`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck** — Run: `npm run typecheck -w client` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/format.ts client/src/lib/format.test.ts
git commit -m "feat(client): display formatters (money, clock, odds, metric, vancouver time)"
```

---

### Task 4: API contract types, status-line derivation, polling hooks (TDD on the pure parts)

**Files:**
- Create: `client/src/lib/api.ts`, `client/src/hooks/useAppState.ts`, `client/src/hooks/useTick.ts`
- Test: `client/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `formatScanTime` (Task 3); the server contract quoted in the header.
- Produces (consumed by Tasks 5–13):
  Types `Strategy`, `TradeStatus`, `KillReason`, `Leg`, `TradeView`, `AppState`, `StatusLineView`.
  Pure: `metricPct(t): number` · `deriveStatusLine(state: AppState | null): StatusLineView`.
  Fetch: `fetchState(): Promise<AppState | null>` · `fetchTrades(view: 'all' | 'history'): Promise<TradeView[] | null>` · `confirmTrade(id)` · `unconfirmTrade(id)` · `reportLimited(id, book, maxAllowedCents)` · `requestScan()` — all POST helpers resolve `boolean` (ok) and NEVER throw.
  Hooks: `useAppState(): { state: AppState | null; refresh: () => void }` (poll 5s, null on any error) · `useTick(): number` (epoch ms, 1s interval — call ONCE in `App`, pass `now` down).

- [ ] **Step 1: Write the failing spec** — `client/src/lib/api.test.ts` (pure functions only; the fetch helpers and hooks are exercised by the running app, per the no-component-tests constraint):

```ts
import { expect, test } from 'vitest';
import { AppState, deriveStatusLine, metricPct } from './api';

function stateWith(nextScanAt: number): AppState {
  return {
    mode: 'SIMULATED',
    now: 0,
    nextScanAt,
    quietHours: false,
    trades: { verified: [], pending: [] },
    counts: { verifiedToday: 0, killedToday: 0 },
  };
}

test('deriveStatusLine: null state → em-dash time, SIMULATED badge (no error banner)', () => {
  expect(deriveStatusLine(null)).toEqual({ nextScanText: '—', modeLabel: 'SIMULATED' });
});

test('deriveStatusLine: live state → vancouver timestamp + server mode', () => {
  // 2026-07-13 22:47 PDT == 2026-07-14 05:47 UTC
  const s = stateWith(Date.UTC(2026, 6, 14, 5, 47));
  expect(deriveStatusLine(s)).toEqual({ nextScanText: 'JUL 13 · 10:47 PM', modeLabel: 'SIMULATED' });
});

test('metricPct: ARB reads marginPct, EV/MIDDLE read edgePct, null → 0', () => {
  expect(metricPct({ category: 'ARB', marginPct: 2.5, edgePct: null })).toBe(2.5);
  expect(metricPct({ category: 'EV', marginPct: null, edgePct: 2.8 })).toBe(2.8);
  expect(metricPct({ category: 'MIDDLE', marginPct: null, edgePct: 4.6 })).toBe(4.6);
  expect(metricPct({ category: 'EV', marginPct: null, edgePct: null })).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- api`
Expected: FAIL — cannot resolve/find module `./api`.

- [ ] **Step 3: Implement `client/src/lib/api.ts`**

```ts
// client/src/lib/api.ts — client mirror of the Plan 1 API contract + fetch helpers.
// Fetch helpers NEVER throw: any network/HTTP failure → null (queries) or false (posts).
import { formatScanTime } from './format';

export type Strategy = 'ARB' | 'MIDDLE' | 'EV';
export type TradeStatus =
  | 'PENDING' | 'VERIFIED' | 'CONFIRMED' | 'UNCONFIRMED' | 'EXPIRED' | 'KILLED' | 'SETTLED';
export type KillReason =
  | 'ONE_SPORT_RULE' | 'HEAT_GATE' | 'SHARP_VELOCITY_CAP' | 'MARKET_BREADTH_CAP'
  | 'ROUNDING_DESTROYS_MARGIN' | 'QUOTE_STALE' | 'FAILED_VERIFICATION';

export interface Leg {
  book: string;
  selection: string;
  odds: number;
  stakeCents: number | null; // null until status ≥ VERIFIED
}

export interface TradeView {
  id: string;
  profileId: number;
  category: Strategy;
  event: string;
  sport: string;
  legs: Leg[];
  marginInitial: number;
  marginRecheck: number | null;
  marginFinal: number | null;
  status: TradeStatus;
  killReason: KillReason | null;
  resultCents: number | null;
  createdAt: number;      // all timestamps epoch ms
  verifyDueAt: number;
  verifiedAt: number | null;
  freshUntil: number | null;
  settledAt: number | null;
  eventStartsAt: number;
  marginPct: number | null; // display fields, 2dp numbers from the server
  edgePct: number | null;
}

export interface AppState {
  mode: 'SIMULATED';
  now: number;
  nextScanAt: number;
  quietHours: boolean;
  trades: { verified: TradeView[]; pending: TradeView[] };
  counts: { verifiedToday: number; killedToday: number };
}

/** ARB cards show marginPct; EV/MIDDLE show edgePct. Missing value → 0. */
export function metricPct(
  t: Pick<TradeView, 'category' | 'marginPct' | 'edgePct'>,
): number {
  return t.category === 'ARB' ? t.marginPct ?? 0 : t.edgePct ?? 0;
}

export interface StatusLineView {
  nextScanText: string;
  modeLabel: string;
}

/** Server down (state null) → "NEXT SCAN —" and a default SIMULATED badge. */
export function deriveStatusLine(state: AppState | null): StatusLineView {
  if (state === null) return { nextScanText: '—', modeLabel: 'SIMULATED' };
  return { nextScanText: formatScanTime(state.nextScanAt), modeLabel: state.mode };
}

export async function fetchState(): Promise<AppState | null> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return null;
    return (await res.json()) as AppState;
  } catch {
    return null;
  }
}

/** Accepts either a bare array or { trades: [...] } (envelope unspecified in Plan 1). */
export async function fetchTrades(view: 'all' | 'history'): Promise<TradeView[] | null> {
  try {
    const res = await fetch(`/api/trades?view=${view}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (Array.isArray(data)) return data as TradeView[];
    if (data !== null && typeof data === 'object') {
      const trades = (data as { trades?: unknown }).trades;
      if (Array.isArray(trades)) return trades as TradeView[];
    }
    return null;
  } catch {
    return null;
  }
}

async function postAction(path: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const confirmTrade = (id: string): Promise<boolean> =>
  postAction(`/api/trades/${id}/confirm`);
export const unconfirmTrade = (id: string): Promise<boolean> =>
  postAction(`/api/trades/${id}/unconfirm`);
export const reportLimited = (
  id: string, book: string, maxAllowedCents: number,
): Promise<boolean> =>
  postAction(`/api/trades/${id}/limited`, { book, maxAllowedCents });
export const requestScan = (): Promise<boolean> => postAction('/api/scan');
```

- [ ] **Step 4: Implement `client/src/hooks/useAppState.ts`**

```ts
// client/src/hooks/useAppState.ts — poll GET /api/state every 5s.
// Any error → state null (the UI renders its degraded-but-calm form; no banner).
import { useCallback, useEffect, useState } from 'react';
import { AppState, fetchState } from '../lib/api';

const POLL_MS = 5000;

export function useAppState(): { state: AppState | null; refresh: () => void } {
  const [state, setState] = useState<AppState | null>(null);

  const refresh = useCallback(() => {
    void fetchState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { state, refresh };
}
```

- [ ] **Step 5: Implement `client/src/hooks/useTick.ts`**

```ts
// client/src/hooks/useTick.ts — THE single shared 1s tick.
// Call once in App and pass `now` down as a prop; never mount a second interval.
import { useEffect, useState } from 'react';

export function useTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all tests pass (smoke + format + api), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.ts client/src/lib/api.test.ts client/src/hooks
git commit -m "feat(client): api contract types, status-line derivation, polling hooks"
```

---

### Task 5: App shell — Header, Nav, StatusLine, placeholder screens

**Files:**
- Create: `client/src/components/Header.tsx`, `client/src/components/Nav.tsx`, `client/src/components/StatusLine.tsx`, `client/src/screens/PlaceholderScreen.tsx`, `client/src/screens/TradesScreen.tsx` (v1 — headers only), `client/src/App.tsx`
- Modify: `client/src/main.tsx` (final form)

**Interfaces:**
- Consumes: `useAppState`, `useTick`, `deriveStatusLine`, `AppState` (Task 4); CSS classes (Task 2).
- Produces: `App` (root component); `Tab` type; `TradesScreen({ state, now, refresh })` prop shape that Tasks 7–13 keep.

- [ ] **Step 1: Create `client/src/components/Header.tsx`** (eye SVG + wordmark + badge, §1 verbatim)

```tsx
interface HeaderProps {
  modeLabel: string;
}

export function Header({ modeLabel }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
          <ellipse cx="15" cy="9" rx="13.5" ry="8" stroke="#fff" strokeWidth="1.6" fill="none" />
          <circle cx="15" cy="9" r="4" stroke="#fff" strokeWidth="1.6" fill="none" />
          <circle cx="15" cy="9" r="1.7" fill="#e0442c" />
        </svg>
        <span className="wordmark">
          EVIL EYE <span className="v2">V2</span>
        </span>
      </div>
      <span className="mode-badge">{modeLabel}</span>
    </header>
  );
}
```

- [ ] **Step 2: Create `client/src/components/Nav.tsx`**

```tsx
export type Tab = 'TRADES' | 'BRAIN' | 'ANALYTICS' | 'SETTINGS';

const TABS: Tab[] = ['TRADES', 'BRAIN', 'ANALYTICS', 'SETTINGS'];

interface NavProps {
  tab: Tab;
  onSelect: (t: Tab) => void;
}

export function Nav({ tab, onSelect }: NavProps) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button key={t} className={t === tab ? 'active' : ''} onClick={() => onSelect(t)}>
          {t}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create `client/src/components/StatusLine.tsx`**

```tsx
import { AppState, deriveStatusLine } from '../lib/api';

interface StatusLineProps {
  state: AppState | null;
}

export function StatusLine({ state }: StatusLineProps) {
  const { nextScanText } = deriveStatusLine(state);
  return (
    <div className="status-line">
      NEXT SCAN <span className="time">{nextScanText}</span>
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/screens/PlaceholderScreen.tsx`** (body copy is NEW, not in the inventory)

```tsx
interface PlaceholderScreenProps {
  label: string;
  planNumber: 3 | 4 | 5;
}

export function PlaceholderScreen({ label, planNumber }: PlaceholderScreenProps) {
  return (
    <section className="placeholder">
      <div className="placeholder-label">{label}</div>
      <div className="placeholder-body">ARRIVES WITH PLAN {planNumber}</div>
    </section>
  );
}
```

- [ ] **Step 5: Create `client/src/screens/TradesScreen.tsx`** (v1 — live-count section headers only; cards land in Tasks 7–10)

```tsx
import { AppState } from '../lib/api';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state }: TradesScreenProps) {
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
    </main>
  );
}
```

- [ ] **Step 6: Create `client/src/App.tsx`**

```tsx
import { useState } from 'react';
import { Header } from './components/Header';
import { Nav, type Tab } from './components/Nav';
import { StatusLine } from './components/StatusLine';
import { useAppState } from './hooks/useAppState';
import { useTick } from './hooks/useTick';
import { deriveStatusLine } from './lib/api';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { TradesScreen } from './screens/TradesScreen';

export function App() {
  const [tab, setTab] = useState<Tab>('TRADES');
  const { state, refresh } = useAppState();
  const now = useTick(); // the single shared 1s tick
  const { modeLabel } = deriveStatusLine(state);

  return (
    <div className="page">
      <Header modeLabel={modeLabel} />
      <Nav tab={tab} onSelect={setTab} />
      <StatusLine state={state} />
      {tab === 'TRADES' && <TradesScreen state={state} now={now} refresh={refresh} />}
      {tab === 'BRAIN' && <PlaceholderScreen label="BRAIN" planNumber={3} />}
      {tab === 'ANALYTICS' && <PlaceholderScreen label="ANALYTICS" planNumber={4} />}
      {tab === 'SETTINGS' && <PlaceholderScreen label="SETTINGS" planNumber={5} />}
    </div>
  );
}
```

- [ ] **Step 7: Rewrite `client/src/main.tsx`** (final form)

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Verify (tests + manual)**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Then: `npm run dev:client`, open http://localhost:5174 and check:
- Eye logo (white outline, red pupil) + `EVIL EYE V2` with yellow `V2`; yellow-outlined `SIMULATED` badge right.
- Joined nav — `TRADES` filled white, others grey; clicking `BRAIN`/`ANALYTICS`/`SETTINGS` shows the bordered placeholder (`ARRIVES WITH PLAN 3/4/5`).
- Status line right-aligned. With the Plan 1 server NOT running: `NEXT SCAN —`. If the server IS running (`npm run dev` in another terminal): `NEXT SCAN JUL 14 · …` style timestamp.
- Section headers `VERIFIED LIVE (0)` (white) and `PENDING VERIFICATION (0)` (grey) — counts go live once the server serves trades.
Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add client/src
git commit -m "feat(client): app shell — header, nav, status line, placeholder screens"
```

---

### Task 6: Timer math (TDD)

**Files:**
- Create: `client/src/lib/timers.ts`
- Test: `client/src/lib/timers.test.ts`

**Interfaces:**
- Consumes: nothing (pure; callers pass `now` from `useTick`).
- Produces (consumed by Tasks 7, 10, 11):
  `liveTimer(freshUntil: number, now: number): { phase: 'FRESH' | 'STALE'; seconds: number }`
  `pendingCountdown(verifyDueAt: number, now: number): number`

- [ ] **Step 1: Write the failing spec** — `client/src/lib/timers.test.ts`:

```ts
import { expect, test } from 'vitest';
import { liveTimer, pendingCountdown } from './timers';

test('FRESH counts down from freshUntil − now (ceil — never 0:00 while fresh)', () => {
  expect(liveTimer(86_000, 0)).toEqual({ phase: 'FRESH', seconds: 86 });
  expect(liveTimer(1_000_500, 1_000_000)).toEqual({ phase: 'FRESH', seconds: 1 });
});

test('at 0 it auto-flips to STALE and counts UP (MASTER PROMPT rule 8 — no clamp)', () => {
  expect(liveTimer(1000, 1000)).toEqual({ phase: 'STALE', seconds: 0 });
  expect(liveTimer(0, 161_000)).toEqual({ phase: 'STALE', seconds: 161 });
  expect(liveTimer(0, 1500)).toEqual({ phase: 'STALE', seconds: 1 });
});

test('pending countdown derives from verifyDueAt − now, clamped at 0 (server reschedules)', () => {
  expect(pendingCountdown(42_000, 0)).toBe(42);
  expect(pendingCountdown(500, 0)).toBe(1);
  expect(pendingCountdown(1000, 5000)).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- timers`
Expected: FAIL — cannot resolve/find module `./timers`.

- [ ] **Step 3: Implement `client/src/lib/timers.ts`**

```ts
// client/src/lib/timers.ts — pure countdown math; components feed it `now` from useTick.

export interface LiveTimer {
  phase: 'FRESH' | 'STALE';
  seconds: number;
}

/** FRESH = countdown to freshUntil (ceil); at/past 0 → STALE counting up (floor). */
export function liveTimer(freshUntil: number, now: number): LiveTimer {
  const diffMs = freshUntil - now;
  if (diffMs > 0) return { phase: 'FRESH', seconds: Math.ceil(diffMs / 1000) };
  return { phase: 'STALE', seconds: Math.floor(-diffMs / 1000) };
}

/** CHECKING AGAIN IN — clamps at 0; the client NEVER resets to 75. */
export function pendingCountdown(verifyDueAt: number, now: number): number {
  return Math.max(0, Math.ceil((verifyDueAt - now) / 1000));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client -- timers`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/timers.ts client/src/lib/timers.test.ts
git commit -m "feat(client): fresh/stale and pending countdown timer math"
```

---

### Task 7: LiveCard (tag, event line, status column, leg buttons, metric box)

**Files:**
- Create: `client/src/components/LiveCard.tsx` (v1 — CONFIRM lands in Task 8, TRADE LIMITED? in Task 9, REFRESH? in Task 11)
- Modify: `client/src/screens/TradesScreen.tsx` (render LiveCards)

**Interfaces:**
- Consumes: `TradeView`, `metricPct` (Task 4); `formatCents`, `formatClock`, `formatMetric`, `formatOdds` (Task 3); `liveTimer` (Task 6).
- Produces: `LiveCard({ trade, now, refresh })` — Task 9 widens the props to `{ trade, now, refresh, limitedOpen, onToggleLimited }` and Tasks 8/9/11 rewrite this file (full file shown each time).

- [ ] **Step 1: Create `client/src/components/LiveCard.tsx`**

```tsx
import { TradeView, metricPct } from '../lib/api';
import { formatCents, formatClock, formatMetric, formatOdds } from '../lib/format';
import { liveTimer } from '../lib/timers';

interface LiveCardProps {
  trade: TradeView;
  now: number;
  refresh: () => void;
}

export function LiveCard({ trade, now }: LiveCardProps) {
  const timer = liveTimer(trade.freshUntil ?? now, now);
  const stale = timer.phase === 'STALE';
  return (
    <article className="trade-card">
      <div className="card-top">
        <span className="card-title">
          <span className="tag">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text">
            {timer.phase}{' '}
            <span className={stale ? 'status-value stale' : 'status-value'}>
              {formatClock(timer.seconds)}
            </span>
          </span>
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            {leg.stakeCents !== null && (
              <span className="leg-stake">BET {formatCents(leg.stakeCents)} ↗</span>
            )}
          </button>
        ))}
      </div>
      <div className="action-row">
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
    </article>
  );
}
```

(Note: `{leg.book} — {leg.selection} @ {formatOdds(leg.odds)}` must stay on ONE JSX line — JSX drops whitespace across line breaks. Same for the event line and `{timer.phase}{' '}`.)

- [ ] **Step 2: Rewrite `client/src/screens/TradesScreen.tsx`** (v2)

```tsx
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard key={t.id} trade={t} now={now} refresh={refresh} />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Manual (only possible once Plan 1's API serves verified trades — otherwise the section stays at `(0)` which is also correct): with `npm run dev` + `npm run dev:client` running and a scan verified (`curl -s -X POST localhost:4400/api/scan`, wait ~80s), a verified card shows: white-bordered tag, bold `Event · SPORT` line, `FRESH m:ss` counting DOWN once per second (value white, flips to yellow `STALE` counting UP at 0), stacked dark leg buttons `Book — Selection @ 2.10 │ BET $35 ↗` (divider before the bold stake), tinted metric box bottom-right (`MARGIN: x.x%` green-tint for ARB, `EDGE: +x.x%` yellow-tint otherwise).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/LiveCard.tsx client/src/screens/TradesScreen.tsx
git commit -m "feat(client): verified live card"
```

---

### Task 8: ConfirmButton — the 3-state cycle over 2 API states

**Files:**
- Create: `client/src/components/ConfirmButton.tsx`
- Modify: `client/src/components/LiveCard.tsx` (add the button to the action row)

**Interfaces:**
- Consumes: `TradeView`, `confirmTrade`, `unconfirmTrade` (Task 4).
- Produces: `ConfirmButton({ trade, refresh })`. Cycle (locked call 1): status `VERIFIED` → label `CONFIRM` (white bg); click POSTs `/confirm` then `refresh()`. Status `CONFIRMED` → label `CONFIRMED ✓` (green); click sets LOCAL `armed` (no API) → label `UNCONFIRM?` (yellow); click POSTs `/unconfirm` then `refresh()`. `armed` resets whenever status leaves `CONFIRMED` or the card unmounts.

- [ ] **Step 1: Create `client/src/components/ConfirmButton.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { TradeView, confirmTrade, unconfirmTrade } from '../lib/api';

interface ConfirmButtonProps {
  trade: TradeView;
  refresh: () => void;
}

export function ConfirmButton({ trade, refresh }: ConfirmButtonProps) {
  // The yellow UNCONFIRM? step is purely local — 3 visual states over 2 API states.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (trade.status !== 'CONFIRMED') setArmed(false);
  }, [trade.status]);

  const onClick = () => {
    if (trade.status === 'CONFIRMED' && armed) {
      setArmed(false);
      void unconfirmTrade(trade.id).then(() => refresh());
    } else if (trade.status === 'CONFIRMED') {
      setArmed(true); // NO api call — arming is local
    } else {
      void confirmTrade(trade.id).then(() => refresh());
    }
  };

  if (trade.status === 'CONFIRMED' && armed) {
    return (
      <button className="confirm-btn state-unconfirm" onClick={onClick}>
        UNCONFIRM?
      </button>
    );
  }
  if (trade.status === 'CONFIRMED') {
    return (
      <button className="confirm-btn state-confirmed" onClick={onClick}>
        CONFIRMED ✓
      </button>
    );
  }
  return (
    <button className="confirm-btn state-confirm" onClick={onClick}>
      CONFIRM
    </button>
  );
}
```

- [ ] **Step 2: Rewrite `client/src/components/LiveCard.tsx`** (v2 — ConfirmButton first in the action row)

```tsx
import { TradeView, metricPct } from '../lib/api';
import { formatCents, formatClock, formatMetric, formatOdds } from '../lib/format';
import { liveTimer } from '../lib/timers';
import { ConfirmButton } from './ConfirmButton';

interface LiveCardProps {
  trade: TradeView;
  now: number;
  refresh: () => void;
}

export function LiveCard({ trade, now, refresh }: LiveCardProps) {
  const timer = liveTimer(trade.freshUntil ?? now, now);
  const stale = timer.phase === 'STALE';
  return (
    <article className="trade-card">
      <div className="card-top">
        <span className="card-title">
          <span className="tag">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text">
            {timer.phase}{' '}
            <span className={stale ? 'status-value stale' : 'status-value'}>
              {formatClock(timer.seconds)}
            </span>
          </span>
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            {leg.stakeCents !== null && (
              <span className="leg-stake">BET {formatCents(leg.stakeCents)} ↗</span>
            )}
          </button>
        ))}
      </div>
      <div className="action-row">
        <ConfirmButton trade={trade} refresh={refresh} />
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Manual (server + client running, a verified card on screen): click `CONFIRM` (white) → turns green `CONFIRMED ✓` within a beat (POST + refresh); click it → instantly yellow `UNCONFIRM?` (no network call — check the devtools network tab); click it → back to white `CONFIRM` (POST `/unconfirm` fired). Double-tapping never errors (Plan 1 treats re-applied states as no-ops).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ConfirmButton.tsx client/src/components/LiveCard.tsx
git commit -m "feat(client): confirm cycle button"
```

---

### Task 9: LimitedPanel — the TRADE LIMITED? flow

**Files:**
- Create: `client/src/components/LimitedPanel.tsx`
- Modify: `client/src/components/LiveCard.tsx` (TRADE LIMITED? button + panel), `client/src/screens/TradesScreen.tsx` (one-panel-at-a-time state)

**Interfaces:**
- Consumes: `TradeView`, `reportLimited` (Task 4); `parseDollarsToCents` (Task 3).
- Produces: `LimitedPanel({ trade, onClose, refresh })`. `LiveCard` props widen to `{ trade, now, refresh, limitedOpen, onToggleLimited }` (kept through Tasks 11–13). TradesScreen owns `limitedOpenId: string | null` — only one card's panel open; opening a panel mounts it fresh (book/amount/armed reset by construction).

- [ ] **Step 1: Create `client/src/components/LimitedPanel.tsx`** (§2.2 verbatim copy; send enabled = book selected AND input contains a digit — `parseDollarsToCents` returning non-null is exactly the inventory's `/\d/` rule)

```tsx
import { useState } from 'react';
import { TradeView, reportLimited } from '../lib/api';
import { parseDollarsToCents } from '../lib/format';

interface LimitedPanelProps {
  trade: TradeView;
  onClose: () => void;
  refresh: () => void;
}

export function LimitedPanel({ trade, onClose, refresh }: LimitedPanelProps) {
  const [book, setBook] = useState<string | null>(null); // strict single-select
  const [amount, setAmount] = useState('');
  const [armed, setArmed] = useState(false);

  const cents = parseDollarsToCents(amount);
  const ready = book !== null && cents !== null;

  const onSend = () => {
    if (!ready || book === null || cents === null) return;
    if (!armed) {
      setArmed(true); // first click arms — yellow CONFIRM? ✓
      return;
    }
    void reportLimited(trade.id, book, cents).then(() => refresh());
    onClose(); // second click sends, then closes + resets (unmount)
  };

  const sendClass = !ready ? 'send-btn disabled' : armed ? 'send-btn armed' : 'send-btn ready';

  return (
    <div className="limited-panel">
      <div className="limited-label">
        WHICH BOOK LIMITED YOU? — ONE AT A TIME; REOPEN TO REPORT ANOTHER
      </div>
      <div className="book-chips">
        {trade.legs.map((leg) => (
          <button
            key={leg.book}
            className={leg.book === book ? 'book-chip selected' : 'book-chip'}
            onClick={() => {
              setBook(leg.book === book ? null : leg.book); // re-click deselects
              setArmed(false);
            }}
          >
            {leg.book}
          </button>
        ))}
      </div>
      <div className="limited-label max">MAX BET THEY ALLOWED</div>
      <div className="limited-row">
        <input
          className="limited-input"
          placeholder="$25"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setArmed(false);
          }}
        />
        <button className={sendClass} disabled={!ready} onClick={onSend}>
          {armed ? 'CONFIRM? ✓' : '✓ SEND TO MODEL'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `client/src/components/LiveCard.tsx`** (v3 — TRADE LIMITED? button inverts while open; panel renders inside the card)

```tsx
import { TradeView, metricPct } from '../lib/api';
import { formatCents, formatClock, formatMetric, formatOdds } from '../lib/format';
import { liveTimer } from '../lib/timers';
import { ConfirmButton } from './ConfirmButton';
import { LimitedPanel } from './LimitedPanel';

interface LiveCardProps {
  trade: TradeView;
  now: number;
  refresh: () => void;
  limitedOpen: boolean;
  onToggleLimited: () => void;
}

export function LiveCard({ trade, now, refresh, limitedOpen, onToggleLimited }: LiveCardProps) {
  const timer = liveTimer(trade.freshUntil ?? now, now);
  const stale = timer.phase === 'STALE';
  return (
    <article className="trade-card">
      <div className="card-top">
        <span className="card-title">
          <span className="tag">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text">
            {timer.phase}{' '}
            <span className={stale ? 'status-value stale' : 'status-value'}>
              {formatClock(timer.seconds)}
            </span>
          </span>
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            {leg.stakeCents !== null && (
              <span className="leg-stake">BET {formatCents(leg.stakeCents)} ↗</span>
            )}
          </button>
        ))}
      </div>
      <div className="action-row">
        <ConfirmButton trade={trade} refresh={refresh} />
        <button
          className={limitedOpen ? 'limited-btn open' : 'limited-btn'}
          onClick={onToggleLimited}
        >
          TRADE LIMITED?
        </button>
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
      {limitedOpen && <LimitedPanel trade={trade} onClose={onToggleLimited} refresh={refresh} />}
    </article>
  );
}
```

- [ ] **Step 3: Rewrite `client/src/screens/TradesScreen.tsx`** (v3 — one panel at a time)

```tsx
import { useState } from 'react';
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Manual (server + client, a verified card): click `TRADE LIMITED?` → button inverts white, inset dark panel opens with the verbatim label, one chip per leg book, `MAX BET THEY ALLOWED` + `$25` placeholder input, grey disabled `✓ SEND TO MODEL`. Select a chip (re-click deselects), type `25` → button turns white; click → yellow `CONFIRM? ✓`; click again → network tab shows `POST /api/trades/<id>/limited` with `{"book":"…","maxAllowedCents":2500}`, panel closes. Open a second card's panel → the first closes; reopen → fields are reset.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/LimitedPanel.tsx client/src/components/LiveCard.tsx client/src/screens/TradesScreen.tsx
git commit -m "feat(client): trade limited panel"
```

---

### Task 10: PendingCard + sections composition

**Files:**
- Create: `client/src/components/PendingCard.tsx`
- Modify: `client/src/screens/TradesScreen.tsx` (render pending cards)

**Interfaces:**
- Consumes: `TradeView`, `metricPct` (Task 4); `formatClock`, `formatMetric`, `formatOdds` (Task 3); `pendingCountdown` (Task 6).
- Produces: `PendingCard({ trade, now })` — dimmed card, NO stakes, NO confirm/limited row; tinted metric box kept (locked call 5).

- [ ] **Step 1: Create `client/src/components/PendingCard.tsx`**

```tsx
import { TradeView, metricPct } from '../lib/api';
import { formatClock, formatMetric, formatOdds } from '../lib/format';
import { pendingCountdown } from '../lib/timers';

interface PendingCardProps {
  trade: TradeView;
  now: number;
}

export function PendingCard({ trade, now }: PendingCardProps) {
  const seconds = pendingCountdown(trade.verifyDueAt, now);
  return (
    <article className="trade-card pending">
      <div className="card-top">
        <span className="card-title pending">
          <span className="tag pending">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text pending">
            CHECKING AGAIN IN <span className="status-value dim">{formatClock(seconds)}</span>
          </span>
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn pending">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            <span className="leg-arrow">↗</span>
          </button>
        ))}
      </div>
      <div className="action-row">
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Rewrite `client/src/screens/TradesScreen.tsx`** (v4)

```tsx
import { useState } from 'react';
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';
import { PendingCard } from '../components/PendingCard';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
      {pending.map((t) => (
        <PendingCard key={t.id} trade={t} now={now} />
      ))}
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Manual (server + client; `curl -s -X POST localhost:4400/api/scan` to spawn pendings): pending cards render dimmed (0.82), grey tag/borders, `CHECKING AGAIN IN m:ss` ticking to `0:00` and holding until the server verdict lands via the next poll; legs end in a plain grey `↗` (NO `BET $…` anywhere on a pending card — hard rule 1); tinted metric box bottom-right. Stacked cards in each section share a single border line; the first card of EACH section keeps its full border (the `<h2>` between sections breaks CSS adjacency — that's intended).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/PendingCard.tsx client/src/screens/TradesScreen.tsx
git commit -m "feat(client): pending card and trades screen composition"
```

---

### Task 11: STALE / REFRESH? wiring

**Files:**
- Modify: `client/src/components/LiveCard.tsx` (final form — REFRESH? chip under the status when STALE)

**Interfaces:**
- Consumes: `requestScan` (Task 4); `liveTimer` (Task 6 — the auto-flip is already pure math).
- Produces: the final `LiveCard`. REFRESH? posts `POST /api/scan` (adjudication: nearest available endpoint — no per-trade refresh exists in the contract) then `refresh()`; a 503 `quiet_hours` resolves `false` and is silently ignored (no error banner).

- [ ] **Step 1: Rewrite `client/src/components/LiveCard.tsx`** (final)

```tsx
import { TradeView, metricPct, requestScan } from '../lib/api';
import { formatCents, formatClock, formatMetric, formatOdds } from '../lib/format';
import { liveTimer } from '../lib/timers';
import { ConfirmButton } from './ConfirmButton';
import { LimitedPanel } from './LimitedPanel';

interface LiveCardProps {
  trade: TradeView;
  now: number;
  refresh: () => void;
  limitedOpen: boolean;
  onToggleLimited: () => void;
}

export function LiveCard({ trade, now, refresh, limitedOpen, onToggleLimited }: LiveCardProps) {
  const timer = liveTimer(trade.freshUntil ?? now, now);
  const stale = timer.phase === 'STALE';
  return (
    <article className="trade-card">
      <div className="card-top">
        <span className="card-title">
          <span className="tag">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text">
            {timer.phase}{' '}
            <span className={stale ? 'status-value stale' : 'status-value'}>
              {formatClock(timer.seconds)}
            </span>
          </span>
          {stale && (
            <button
              className="refresh-chip"
              onClick={() => void requestScan().then(() => refresh())}
            >
              REFRESH?
            </button>
          )}
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            {leg.stakeCents !== null && (
              <span className="leg-stake">BET {formatCents(leg.stakeCents)} ↗</span>
            )}
          </button>
        ))}
      </div>
      <div className="action-row">
        <ConfirmButton trade={trade} refresh={refresh} />
        <button
          className={limitedOpen ? 'limited-btn open' : 'limited-btn'}
          onClick={onToggleLimited}
        >
          TRADE LIMITED?
        </button>
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
      {limitedOpen && <LimitedPanel trade={trade} onClose={onToggleLimited} refresh={refresh} />}
    </article>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS, clean.
Manual (server + client; watch a verified card past its 120s fresh window): at `0:00` the label flips to `STALE`, the value turns yellow and counts UP, and the translucent-white `REFRESH?` chip appears beneath. Clicking it fires `POST /api/scan` (server log shows a scan) and the UI keeps ticking; during quiet hours the 503 is swallowed with no visible error. Note the server auto-EXPIREs stale trades after 10 min — the card then leaves the list on a poll; that disappearance is server-driven, not client logic.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/LiveCard.tsx
git commit -m "feat(client): stale refresh chip wired to manual scan"
```

---

### Task 12: VIEW ALL TRADES — list controls (TDD), ALL TRADES + HISTORY boxes, graveyard

**Files:**
- Create: `client/src/lib/reveal.ts`, `client/src/components/ViewAll.tsx`
- Test: `client/src/lib/reveal.test.ts`
- Modify: `client/src/screens/TradesScreen.tsx` (mount ViewAll)

**Interfaces:**
- Consumes: `TradeView`, `fetchTrades`, `metricPct` (Task 4); `formatCents`, `formatMetric`, `formatOdds`, `formatSignedCents`, `formatWhen` (Task 3).
- Produces:
  `type Reveal = 5 | 15 | 'all'` · `nextRevealState(cur: Reveal): Reveal` · `revealControls(cur: Reveal, total: number): { visible: number; showMore: boolean; showLess: boolean; showAll: number | null }`
  `ViewAll({ killedToday })` — the CTA + both boxes + graveyard, fetching `?view=all` and `?view=history` on open.

- [ ] **Step 1: Write the failing spec** — `client/src/lib/reveal.test.ts` (§2.5 exactly):

```ts
import { expect, test } from 'vitest';
import { nextRevealState, revealControls } from './reveal';

test('at 5 rows: single VIEW MORE → (when more exist)', () => {
  expect(revealControls(5, 18)).toEqual({ visible: 5, showMore: true, showLess: false, showAll: null });
  expect(nextRevealState(5)).toBe(15);
});

test('at 15 rows: VIEW LESS plus VIEW ALL (n) only when total > 15', () => {
  expect(revealControls(15, 18)).toEqual({ visible: 15, showMore: false, showLess: true, showAll: 18 });
  expect(revealControls(15, 12)).toEqual({ visible: 12, showMore: false, showLess: true, showAll: null });
  expect(nextRevealState(15)).toBe('all');
});

test('at full: VIEW LESS only', () => {
  expect(revealControls('all', 18)).toEqual({ visible: 18, showMore: false, showLess: true, showAll: null });
  expect(nextRevealState('all')).toBe('all');
});

test('tiny lists never show controls at the 5-state', () => {
  expect(revealControls(5, 3)).toEqual({ visible: 3, showMore: false, showLess: false, showAll: null });
  expect(revealControls(5, 5)).toEqual({ visible: 5, showMore: false, showLess: false, showAll: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- reveal`
Expected: FAIL — cannot resolve/find module `./reveal`.

- [ ] **Step 3: Implement `client/src/lib/reveal.ts`**

```ts
// client/src/lib/reveal.ts — pure list-reveal state machine for §2.5 list controls.

export type Reveal = 5 | 15 | 'all';

export interface RevealControlsView {
  visible: number;        // rows to slice
  showMore: boolean;      // VIEW MORE →
  showLess: boolean;      // VIEW LESS (always returns to 5)
  showAll: number | null; // VIEW ALL (n); null = hidden
}

export function nextRevealState(cur: Reveal): Reveal {
  return cur === 5 ? 15 : 'all';
}

export function revealControls(cur: Reveal, total: number): RevealControlsView {
  const visible = cur === 'all' ? total : Math.min(cur, total);
  return {
    visible,
    showMore: cur === 5 && total > 5,
    showLess: cur !== 5,
    showAll: cur === 15 && total > 15 ? total : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client -- reveal`
Expected: PASS (4 tests).

- [ ] **Step 5: Create `client/src/components/ViewAll.tsx`**

```tsx
import { useState } from 'react';
import { TradeView, fetchTrades, metricPct } from '../lib/api';
import {
  formatCents, formatMetric, formatOdds, formatSignedCents, formatWhen,
} from '../lib/format';
import { Reveal, nextRevealState, revealControls } from '../lib/reveal';

interface ViewAllProps {
  killedToday: number;
}

/* Locked mapping for the four active statuses; SETTLED/KILLED/EXPIRED are
   defensive (Plan 1's view=all is "every non-settled trade", which can
   literally include terminal rows) and follow the mockup's colors. */
function allStatusCell(t: TradeView): { text: string; color: string } {
  switch (t.status) {
    case 'PENDING':
      return { text: 'PENDING', color: 'var(--muted-label)' };
    case 'VERIFIED':
      return { text: 'VERIFIED LIVE', color: '#fff' };
    case 'CONFIRMED':
      return { text: 'CONFIRMED', color: 'var(--green)' };
    case 'UNCONFIRMED':
      return { text: 'UNCONFIRMED', color: 'var(--muted-label)' };
    case 'SETTLED': {
      const cents = t.resultCents ?? 0;
      return {
        text: `CONFIRMED ${formatSignedCents(cents)}`,
        color: cents >= 0 ? 'var(--green)' : 'var(--red)',
      };
    }
    case 'KILLED':
      return { text: `KILLED — ${(t.killReason ?? '').replace(/_/g, ' ')}`, color: 'var(--red)' };
    case 'EXPIRED':
      return { text: 'EXPIRED', color: 'var(--faint)' };
  }
}

function AllTradesRow({ t }: { t: TradeView }) {
  const status = allStatusCell(t);
  return (
    <div className="va-row">
      <span className="va-cat">{t.category}</span>
      <span className="va-event">
        {t.event} · {t.sport.toUpperCase()}
      </span>
      <span className="va-legs">
        {t.legs.map((l) => `${l.book} ${formatOdds(l.odds)}`).join(' / ')}
      </span>
      <span className={t.category === 'ARB' ? 'va-metric arb' : 'va-metric edge'}>
        {formatMetric(t.category, metricPct(t), { colon: false })}
      </span>
      <span className="va-status" style={{ color: status.color }}>
        {status.text}
      </span>
    </div>
  );
}

function historyDescription(t: TradeView): string {
  const stakes = t.legs
    .map((l) => l.stakeCents)
    .filter((c): c is number => c !== null);
  const base = `${t.category} · ${t.event}`;
  if (stakes.length === 0) return base;
  return `${base} · ${stakes.map((c) => formatCents(c)).join('/')}`;
}

function HistoryRow({ t }: { t: TradeView }) {
  const settled = t.status === 'SETTLED';
  const cents = t.resultCents ?? 0;
  const chipColor = settled
    ? cents >= 0 ? 'var(--green-money)' : 'var(--red)'
    : 'var(--faint)';
  const resultText = settled
    ? `${cents >= 0 ? 'WON' : 'LOST'} ${formatSignedCents(cents)}`
    : '—';
  return (
    <div className="hist-row">
      <span className="hist-desc">{historyDescription(t)}</span>
      <span className="hist-outcome">
        <span className="chip" style={{ color: chipColor }}>
          {settled ? 'CONFIRMED' : 'EXPIRED'}
        </span>
        <span style={{ color: chipColor }}>{resultText}</span>
      </span>
      <span className="hist-when">{formatWhen(t.settledAt ?? t.createdAt)}</span>
    </div>
  );
}

function ListControls({
  reveal, total, onChange,
}: {
  reveal: Reveal;
  total: number;
  onChange: (r: Reveal) => void;
}) {
  const c = revealControls(reveal, total);
  if (!c.showMore && !c.showLess && c.showAll === null) return null;
  return (
    <div className="va-footer">
      {c.showMore && (
        <button className="list-btn" onClick={() => onChange(nextRevealState(reveal))}>
          VIEW MORE →
        </button>
      )}
      {c.showLess && (
        <button className="list-btn" onClick={() => onChange(5)}>
          VIEW LESS
        </button>
      )}
      {c.showAll !== null && (
        <button className="list-btn" onClick={() => onChange('all')}>
          VIEW ALL ({c.showAll})
        </button>
      )}
    </div>
  );
}

export function ViewAll({ killedToday }: ViewAllProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<TradeView[] | null>(null);
  const [history, setHistory] = useState<TradeView[] | null>(null);
  const [allReveal, setAllReveal] = useState<Reveal>(5);
  const [histReveal, setHistReveal] = useState<Reveal>(5);
  const [graveyardOpen, setGraveyardOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setAllReveal(5);
      setHistReveal(5);
      setGraveyardOpen(false);
      void fetchTrades('all').then(setAll);
      void fetchTrades('history').then(setHistory);
    }
  };

  const allRows = all ?? [];
  const histAll = history ?? [];
  const histRows = histAll.filter((t) => t.status === 'SETTLED' || t.status === 'EXPIRED');
  const killedRows = histAll.filter((t) => t.status === 'KILLED'); // graveyard ONLY
  const allCtl = revealControls(allReveal, allRows.length);
  const histCtl = revealControls(histReveal, histRows.length);

  return (
    <section className="viewall">
      {open && (
        <>
          <h2 className="section-header">ALL TRADES</h2>
          <div className="va-box">
            {allRows.slice(0, allCtl.visible).map((t) => (
              <AllTradesRow key={t.id} t={t} />
            ))}
            {allRows.length === 0 && <div className="empty-note">NO TRADES YET</div>}
            <ListControls reveal={allReveal} total={allRows.length} onChange={setAllReveal} />
          </div>
          <div className="hist-header-row">
            <h2 className="section-header inline">HISTORY</h2>
            <button className="grave-toggle" onClick={() => setGraveyardOpen((g) => !g)}>
              {graveyardOpen ? '▾' : '▸'} {killedToday} KILLED TODAY
            </button>
          </div>
          <div className="va-box">
            {histRows.slice(0, histCtl.visible).map((t) => (
              <HistoryRow key={t.id} t={t} />
            ))}
            {histRows.length === 0 && <div className="empty-note">NO HISTORY YET</div>}
            <ListControls reveal={histReveal} total={histRows.length} onChange={setHistReveal} />
            {graveyardOpen && (
              <div className="graveyard">
                <div className="grave-title">
                  GRAVEYARD — EVERY KILL IS LOGGED WITH ITS REASON
                </div>
                {killedRows.map((t) => (
                  <div key={t.id} className="grave-row">
                    <span>
                      {t.category} · {t.event}
                    </span>
                    <span className="grave-reason">{t.killReason ?? ''}</span>
                  </div>
                ))}
                {killedRows.length === 0 && <div className="empty-note">NO KILLS TODAY</div>}
              </div>
            )}
          </div>
        </>
      )}
      <button className={open ? 'cta open' : 'cta'} onClick={toggle}>
        VIEW ALL TRADES
      </button>
      <div className="cta-caption">
        EVERY VALUABLE TRADE THE SCANNER FOUND — ARB · MIDDLE · EV
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Rewrite `client/src/screens/TradesScreen.tsx`** (v5 — mount ViewAll after the pending section)

```tsx
import { useState } from 'react';
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';
import { PendingCard } from '../components/PendingCard';
import { ViewAll } from '../components/ViewAll';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
      {pending.map((t) => (
        <PendingCard key={t.id} trade={t} now={now} />
      ))}
      <ViewAll killedToday={state?.counts.killedToday ?? 0} />
    </main>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm test -w client && npm run typecheck -w client`
Expected: PASS (reveal suite included), clean.
Manual (server + client, after some scans/settlements): yellow full-width `VIEW ALL TRADES` CTA with the grey caption; click → CTA greys `#6a6a6a`, two `#f5ecb8`-bordered boxes appear ABOVE it. ALL TRADES rows: grey CAT, white `Event · SPORT`, grey `book 2.10 / book 2.06` legs, tinted colon-less metric, right-aligned colored status. Footer `VIEW MORE →` → 15 rows → `VIEW LESS` (+ `VIEW ALL (n)` when total > 15). HISTORY header row carries `▸ n KILLED TODAY`; rows show the `CONFIRMED`/`EXPIRED` chip + `WON +$x.xx` / `LOST −$x.xx` / `—` + `JUL 14 · 2:12 PM`-style timestamps; toggling the graveyard reveals kills with their reason strings. Click the CTA again → boxes close, CTA back to yellow.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/reveal.ts client/src/lib/reveal.test.ts client/src/components/ViewAll.tsx client/src/screens/TradesScreen.tsx
git commit -m "feat(client): view all trades — all trades, history, graveyard, list controls"
```

---

### Task 13: Empty states + final polish + full-suite run

**Files:**
- Modify: `client/src/screens/TradesScreen.tsx` (final form — section empty states; ViewAll's `NO TRADES YET` / `NO HISTORY YET` / `NO KILLS TODAY` already landed with Task 12)

**Interfaces:**
- Consumes: everything above.
- Produces: the finished TRADES screen; the full-repo green run.

- [ ] **Step 1: Rewrite `client/src/screens/TradesScreen.tsx`** (final)

```tsx
import { useState } from 'react';
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';
import { PendingCard } from '../components/PendingCard';
import { ViewAll } from '../components/ViewAll';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.length === 0 && <div className="empty-note">NOTHING VERIFIED RIGHT NOW</div>}
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
      {pending.length === 0 && <div className="empty-note">NO CANDIDATES IN VERIFICATION</div>}
      {pending.map((t) => (
        <PendingCard key={t.id} trade={t} now={now} />
      ))}
      <ViewAll killedToday={state?.counts.killedToday ?? 0} />
    </main>
  );
}
```

- [ ] **Step 2: Forbidden-words sweep**

Run: `grep -rniE 'append-only|ghost|picker|grader|gatekeeper|CLV' client/src`
Expected: **no output** (exit code 1). Any hit is a bug — fix it before proceeding.

- [ ] **Step 3: Full-suite run**

Run: `npm test && npm run typecheck`
Expected: server suite + client suite all pass; both typechecks clean.

- [ ] **Step 4: End-to-end smoke (manual, real processes)**

Terminal A: `npm run dev` (server, port 4400). Terminal B: `npm run dev:client` (port 5174). Then:
1. Open http://localhost:5174 — shell renders; status line shows a live `NEXT SCAN JUL … · …` timestamp.
2. `curl -s -X POST localhost:4400/api/scan` — within a poll (~5s) pending cards appear, counting down; ~75s later survivors move to VERIFIED LIVE with `BET $…` stakes; counts in both headers update.
3. Click through: CONFIRM cycle, TRADE LIMITED? flow, VIEW ALL TRADES (+graveyard), and — after 120s — the STALE flip + REFRESH?.
4. Kill the server (Ctrl-C in Terminal A): within ~5s the client degrades calmly — `NEXT SCAN —`, `SIMULATED` badge stays, sections show `(0)` + `NOTHING VERIFIED RIGHT NOW` / `NO CANDIDATES IN VERIFICATION`. No error banner, no console crash loop (fetch failures resolve to null by design).
5. Restart the server — the client recovers on the next poll without a reload.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/TradesScreen.tsx
git commit -m "feat(client): empty states and final polish"
```

---

## Self-Review Notes (done at planning time)

- **Spec coverage (Plan-2 scope):** inventory §1 shell → Task 5; §2.1 live cards → Tasks 7/8/11; §2.2 limited flow → Task 9; §2.3 pending → Task 10; §2.4 view-all/history/graveyard → Task 12; §2.5 list controls → Task 12 (TDD); §2.6 confirm cycle → Task 8 (adjusted to the 2-API-state mapping, locked call 1); §2.7 timers → Task 6 (with the locked deviations: FRESH auto-flips to STALE, pending clamps at 0 with server-side rescheduling); §0 tokens → Task 2; MASTER PROMPT §4 TRADES + §2 rules 1/6/8 all land in the tasks above. Empty states + placeholders (new copy, flagged) → Tasks 5/12/13. BRAIN/ANALYTICS/SETTINGS bodies are explicitly Plans 3–5.
- **Copy fidelity:** every UI string in the components is either verbatim inventory copy (labels, captions, graveyard title, chip labels, button labels, glyphs `— · ↗ ▸ ▾ ✓ − →`) or one of the flagged new strings (5 empty states, `ARRIVES WITH PLAN {n}`). `formatSignedCents` uses U+2212 `−`, never the ASCII hyphen. The forbidden-words grep is a hard gate in Task 13.
- **Placeholder scan:** no TBD/TODO/"similar to"/"add validation" anywhere; every code step contains the complete file content; the only intentional repetition is LiveCard/TradesScreen shown in full at each revision (Tasks 7→8→9→10→11→12→13) so tasks are readable out of order.
- **Type consistency:** `TradeView`/`AppState`/`Strategy` defined once in `api.ts` (Task 4) and imported everywhere; `metricPct` is the single category→pct chooser (Tasks 7/10/12); `Reveal`/`revealControls`/`nextRevealState` names match between Task 12's spec and `ViewAll.tsx`; `LiveCard` prop widening (Task 9) is declared in Task 7's Produces block; class names used in Tasks 5–13 all exist in Task 2's frozen list; `formatWhen`≡`formatScanTime` is deliberate (Decision note 16f).
- **Contract consistency with Plan 1:** field names/types mirror `shared/types.ts` exactly plus `marginPct`/`edgePct` (typed nullable — Decision 16b); POST bodies `{ book, maxAllowedCents }` in cents; `/api/scan` 503 handled as a silent false; the two `view=` responses tolerate either envelope (Decision 16a); defensive status renderings for terminal rows in view=all (Decision 16c). If Plan 1's executor pins different envelopes, the ONLY touch-point is `fetchTrades` in `api.ts`.
- **Known judgment calls:** enumerated in Decision notes 16a–16k for the reviewer; none change the locked calls 1–15.
