# EVIL EYE V2 — DESIGN INVENTORY (extracted from the approved mockup)

Source of truth: `docs/handoff/design-reference/Evil Eye V2 Dark.dc.html`.
All component logic, event handlers, and demo data live in the **inline `<script type="text/x-dc" data-dc-script>` block at the bottom of that HTML file** (`class Component extends DCLogic`). `support.js` is a *generic* template runtime (dc-runtime: `{{ }}` interpolation, `<sc-for>`/`<sc-if>`, `style-hover`/`style-focus` pseudo-classes, React 18 UMD auto-load) and contains **no app-specific data or logic** — every handler name referenced below lives in the HTML's inline script, not in support.js.

Rendered screenshots (Playwright, viewport 920px, full-page): `docs/handoff/screens/`
- `trades.png` — default TRADES tab
- `trades-states.png` — CONFIRMED ✓ (green), UNCONFIRM? (yellow), TRADE LIMITED? panel open with book selected + amount entered + armed yellow "CONFIRM? ✓"
- `trades-view-all.png` — VIEW ALL TRADES open, both lists at 15 rows ("VIEW LESS · VIEW ALL (18)"), graveyard open, CTA greyed
- `brain.png` — default BRAIN tab (5-site table, BetMGM selected)
- `brain-advanced.png` — all 16 sites, journal expanded, ADVANCED BRAIN SETTINGS + boiler room open
- `analytics.png` — default ANALYTICS tab
- `analytics-add-profile.png` — profile dropdown → + ADD NEW PROFILE inline form
- `analytics-advanced.png` — ADVANCED ANALYTICS open
- `settings.png` — default SETTINGS tab
- `settings-advanced.png` — ADVANCED SETTINGS expanded

Component props (`data-props` on the script tag): `liveMode` (boolean, default `false`) flips the mode badge SIMULATED→LIVE and hides the Analytics paper-money footnote; `startTab` (enum `TRADES|BRAIN|ANALYTICS|SETTINGS`, default `TRADES`).

---

## 0. DESIGN TOKENS

### 0.1 Base / typography
- Page: `background:#000`, `color:#d6d6d6`, `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif`, `font-variant-numeric:tabular-nums` (global on html/body AND repeated on every trade card), `-webkit-font-smoothing:antialiased`.
- Links: `color:#fff;text-decoration:underline`, hover `#F5D90A`. Text selection: `background:#F5D90A;color:#000`.
- Monospace (boiler-room code/trace only): `'SF Mono',Menlo,Consolas,monospace`, 12px, line-height 1.7 (code) / 1.9 (trace).
- Everything is UPPERCASE letterspaced labels except: event names, book names, journal text, rationale prose, "Changes here are written to the brain journal.", advanced-settings helper sentences, and site-detail prose (sentence case).
- Letterspacing rhythm: 0.16em (wordmark, mode badge, BRAIN heading, chart titles), 0.14em (nav chips, section headers, panel headers, small labels), 0.12em (tile labels, buttons, metric boxes), 0.1em (status lines, chips), 0.08em (footnotes, table cats), 0.06em (settings keys), 0.04em (cost-tile small notes).
- Font sizes in use: 10px (micro table headers, small chip buttons), 11px (labels/footnotes/buttons/chips), 12px (table rows, journal, settings rows, nav chips), 13px (tile values, status, inputs, chart titles), 14px (card headers, leg buttons, site names, stats rows, fund box), 15px (section headers TRADES/ALL TRADES/HISTORY/advanced-section heads, grade numbers), 16px (wordmark), 20px (COST OF SAFETY big numbers).
- Weights: 400 default, 500 "medium emphasis" (most values/buttons), 600 (card event names, section headers, status values, PROFILE chip), 700 (leg stake "BET $XX" segment, chart axis labels).

### 0.2 Color roster (spec names where they match)
| Token | Value | Used for |
|---|---|---|
| yellow | `#F5D90A` | mode badge SIMULATED, VIEW ALL TRADES CTA, STALE count-up value, UNCONFIRM? state, armed "CONFIRM? ✓", held-back tile note, AMBER badge, GO GENTLE value, MONTH-END PROJECTION value, gate-cost top bar, suspicion-chart marks/labels, LIMITS LOG status, analytics PROFILE underline (vestigial) |
| blue | `#5CA8FF` | ADVANCED ANALYTICS CTA, chart borders + trendlines + points, advanced-analytics section headers, LIMITS/OPPORTUNITY box borders + header text + AVG values, sort-toggle |
| pink | `#FF7AC6` | ADVANCED BRAIN SETTINGS CTA, advanced-brain panel border + headers, pipeline chips, + ADD DATA SOURCE / EDIT MODEL buttons |
| green | `#43d17a` | CONFIRMED ✓ button bg, "live"/runway/beat-the-close tile subtexts, GREEN health badge, grades 92/81, LIVE/LINKED/ON chips, 5/5 INPUTS LIVE dot, CONFIRMED +$ statuses in ALL TRADES |
| green (money) | `#37c86f` | history CONFIRMED chip + "WON +$x" results, RETURN (RANGE)/ANNUALIZED values. NOTE: a second green, distinct from #43d17a — keep both. |
| red | `#e0442c` | logo pupil, LOST results, RED health badge, "▼ WAS $500", STOP AT value, KILLED statuses |
| grey strongest | `#cfcfcf` | verified leg-button borders, leg stake divider, graveyard-toggle border |
| grey panel | `#ababab` | trade-card borders, most panel borders (1px and 2px), suspicion-chart dashed thresholds, fund-start box, input borders |
| grey divider | `#8f8f8f` | status-line underline, pending leg borders, settings row dividers, tile borders, funnel/bar tracks, stepper borders, monthly table |
| grey subtle row | `#4a4a4a` | fine row dividers (ALL TRADES, HISTORY, journal, brain inputs, advanced-settings sub-rows), boiler-room box borders |
| margin tint | `#a8e8be` | ARB metric box (text + 2px border), ALL TRADES "MARGIN x%" cells, trace margin value |
| edge tint | `#f2e08a` | EV/MIDDLE metric box (text + 2px border), ALL TRADES "EDGE +x%" cells |
| trade-log | `#f5ecb8` | 2px borders of the ALL TRADES and HISTORY boxes |
| body text | `#d6d6d6` | default text |
| muted label | `#9a9a9a` | section labels, keys, pending header, inactive nav chips, subnotes |
| faint | `#5a5a5a` | footnotes, list-control buttons, graveyard reasons/title, disabled send bg, micro headers, expired chips/bars, trace prefixes, journal timestamps |
| raised bg | `#161616` | leg/book-chip button bg, hover bg (nav pricer tile, profile items), selected site row bg |
| hover bg / disabled text | `#1e1e1e` | leg button hover bg; text color on disabled (grey) buttons |
| inset bg | `#0d0d0d` | TRADE LIMITED? panel bg, boiler-room code/trace boxes |
| CTA greyed-open | `#6a6a6a` | any bottom CTA while its section is open |
| pink-dim border | `#6e2a4e` | internal dividers of the pink advanced-brain panel |
| blue-dim border | `#2a3a52` | internal dividers of the blue LIMITS/OPPORTUNITY boxes |
| chart bg | `#d9d9d9` | analytics chart plate |
| chart ink | `#111` | chart major gridlines, axis labels, dates, last-point ring |
| chart minor | `#999` | chart minor gridlines |

### 0.3 Border & shape conventions
- **Square corners everywhere.** The ONLY rounded element in the whole design is the 8px green status dot (`border-radius:50%`) in SETTINGS → INPUTS "5 / 5 INPUTS LIVE".
- 2px borders = interactive/major: nav group, trade cards, leg buttons, metric boxes, panel frames, health badges, ALL TRADES/HISTORY boxes (#f5ecb8), detail panel (#fff), CTA-adjacent frames, inputs.
- 1px borders = secondary: tiles, rationale/journal panels, chips, steppers, row dividers, funnel tracks, small buttons.
- 3px = analytics chart border (#5CA8FF) and the selected-site row's left indicator (`border-left:3px solid #fff`, unselected rows carry `3px solid transparent`).
- Stacked cards join: within VERIFIED LIVE and PENDING lists, every card after the first has `border-top:none` so cards share a single 2px rule.

### 0.4 Joined-chip-group nav pattern
Group: `display:flex;gap:0;border:2px solid #fff;width:max-content`. Each chip is a `<button>` with **no own border** except `border-left:2px solid #fff` (omitted on the first chip). Active chip: `background:#fff;color:#000`; inactive: `background:none;color:#9a9a9a`. Padding `8px 18px`, `font-size:12px;font-weight:500;letter-spacing:0.14em`. Used identically for the main nav (TRADES · BRAIN · ANALYTICS · SETTINGS) and the Analytics range chips (1D 5D 30D 1Y MAX). A miniature 1px `#5CA8FF` variant (padding `4px 10px`, 10px, active bg #5CA8FF) is the OPPORTUNITY LEADERBOARDS sort toggle. The PROFILE box + RYAN ▾ dropdown button is a two-segment joined group (white filled segment + outlined segment with `border-left:none`).

### 0.5 Spacing rhythm
Page shell: `min-height:100vh; padding-bottom:80px`; content column `max-width:860px; margin:0 auto; padding:24px 22px 0`. Section top-margins: 14–18px (16px most common). Panel headers `padding:8px 14px`; panel row padding `9–12px 14–16px`; settings kv rows `padding:7px 0` inside `padding:6px 14px` bodies; grid gaps 8px (panel grids), 10px (table columns), 6px (dense monthly table).

---

## 1. SHARED HEADER / NAV (all tabs)

DOM order:
1. **Header** — flex space-between, wrap, gap 12px.
   - Left (flex, gap 10px): eye logo SVG `width=30 height=18 viewBox="0 0 30 18"`: ellipse cx15 cy9 rx13.5 ry8 `stroke:#fff` width 1.6, no fill; circle r4 same stroke; pupil circle r1.7 `fill:#e0442c`.
   - Wordmark: `EVIL EYE V2` — 16px, weight 500, letter-spacing 0.16em, `#fff`; the `V2` span is `#F5D90A`.
   - Right: mode badge `{{ modeLabel }}` = `SIMULATED` (border 2px solid #F5D90A, color #F5D90A) or `LIVE` (border 2px solid #fff, color #fff); both 12px, letter-spacing 0.16em, padding 6px 14px, weight 500. Driven by `liveMode` prop — no in-header toggle (mode switch lives conceptually in SETTINGS → DATA).
2. **Nav** — joined chip group (§0.4), `margin-top:14px`, chips `TRADES` `BRAIN` `ANALYTICS` `SETTINGS`; clicking sets `state.tab` (`navTabs[].onClick`).
3. **Status line** — `margin-top:12px;padding:8px 0;border-bottom:1px solid #8f8f8f;font-size:11px;letter-spacing:0.1em;color:#9a9a9a`, content right-aligned, nowrap:
   - `NEXT SCAN ` + `JUL 13 · 10:47 PM` (the timestamp span is `#fff`). Static in the demo (does not tick).

---

## 2. TRADES SCREEN

### 2.1 VERIFIED LIVE section
Header: `VERIFIED LIVE (3)` — `margin:16px 0 8px;font-size:15px;font-weight:600;letter-spacing:0.14em;color:#fff`. Count = `liveCount` (demo: 3).

**Card anatomy** (each `t` in `live`): container `border:2px solid #ababab;padding:12px 14px;font-variant-numeric:tabular-nums` (cards 2+ add `border-top:none`; demo card 2 uses one-off `padding:18px 14px`).
- Row 1 (flex space-between, 14px): left `<span style="font-weight:600">` = category tag + `{{ t.event }} · {{ t.sport }}`. Tag (live): `border:1px solid #fff;color:#fff;font-size:11px;letter-spacing:0.1em;padding:2px 6px;margin-right:8px`. Right column (flex column, align-end, gap 4px): status `{{ t.statusLabel }} {{ t.statusValue }}` — label 13px/500/0.1em `#d6d6d6`, value weight 600, `#fff` when FRESH, `#F5D90A` when STALE; below it optional chips (demo: the STALE card's `REFRESH?` chip — `background:rgba(255,255,255,0.75);border:none;color:#000;font-size:11px;font-weight:500;letter-spacing:0.12em;padding:4px 10px;cursor:pointer` — **no click handler in the demo**).
- Legs block (flex column, align-start, gap 8px, margin-top 10px): one `<button>` per leg — `white-space:nowrap;background:#161616;border:2px solid #cfcfcf;color:#fff;padding:9px 14px;font-size:14px;font-weight:500;font-family:inherit;font-variant-numeric:tabular-nums;text-align:left`; hover `border-color:#fff;color:#fff;background:#1e1e1e`. Content: `{{ leg.text }}` then the stake segment `{{ leg.stakeLabel }}` styled `display:inline-block;border-left:1px solid #cfcfcf;margin-left:14px;padding-left:14px;color:#fff;font-weight:700` (the "│ BET $35 ↗" divider effect). `t.subnote` slot exists after the legs (12px `#9a9a9a`) — empty string on all demo cards.
- Action row (flex, gap 10px, margin-top 12px, align-center): CONFIRM button, `TRADE LIMITED?` button, then metric box pushed right via `margin-left:auto`.
  - CONFIRM (handler `t.confirm`) — see §2.6.
  - `TRADE LIMITED?` (handler `t.toggleLimited`): `background:none;color:#fff;border:2px solid #fff;font-size:11px;letter-spacing:0.12em;padding:6px 14px`; while its panel is open it inverts (`background:#fff;color:#000`).
  - Metric box: ARB → `border:2px solid #a8e8be;color:#a8e8be`; EV/MIDDLE → `border:2px solid #f2e08a;color:#f2e08a`; both `padding:6px 14px;font-size:11px;font-weight:500;letter-spacing:0.12em;white-space:nowrap`.

**Demo VERIFIED LIVE cards (values verbatim):**
| # | tag | event · sport | status | legs (text │ stake) | metric |
|---|---|---|---|---|---|
| 1 | `ARB` | `Arsenal vs Chelsea` · `SOCCER` | `FRESH` countdown from **86s** (1:26) | `Betsson — Arsenal @ 3.10` │ `BET $35 ↗`; `Marathon Bet — Draw @ 3.65` │ `BET $30 ↗`; `Pinnacle — Chelsea @ 3.30` │ `BET $33 ↗` | `MARGIN: 2.5%` |
| 2 | `EV` | `Ruud vs Shelton` · `TENNIS` | `FRESH` countdown from **104s** (1:44) | `888sport — Ruud ML @ 2.15` │ `BET $20 ↗` | `EDGE: +2.8%` |
| 3 | `MIDDLE` | `Lions @ Stampeders` · `CFL` | `STALE` counting **up from 161s** (2:41) + `REFRESH?` chip | `Betway — Lions +4.5 @ 1.95` │ `BET $50 ↗`; `Pinnacle — Stampeders −2.5 @ 1.98` │ `BET $50 ↗` | `EDGE: +4.6%` |

### 2.2 TRADE LIMITED? inline panel
Rendered inside the card when `t.limitedOpen` (state `limitedOpenId === cardIndex`): `border:1px solid #ababab;background:#0d0d0d;margin-top:12px;padding:12px 14px`.
- Label: `WHICH BOOK LIMITED YOU? — ONE AT A TIME; REOPEN TO REPORT ANOTHER` (11px, 0.14em, #9a9a9a).
- Book chips (flex, gap 8px, wrap): one per leg, label = book name (text before ` — ` in the leg). Unselected: `background:#161616;color:#d6d6d6;border:2px solid #cfcfcf;font-size:12px;padding:6px 12px`. Selected: `background:#fff;color:#000;border:2px solid #fff`. **Single-select**: clicking a chip replaces the whole selection (`limitedBooks` reset to just that book); clicking the already-selected chip deselects it.
- Label: `MAX BET THEY ALLOWED` (same label style, `margin:12px 0 6px`).
- Input: placeholder `$25`, `width:110px;background:#000;color:#fff;border:2px solid #ababab;padding:8px 10px;font-size:13px;font-weight:500;tabular-nums`; focus `border-color:#fff`. Handler `setLimitedMax`.
- Send button (handler `t.sendLimited`), 3 visual states: disabled — `background:#5a5a5a;color:#1e1e1e;cursor:default`, label `✓ SEND TO MODEL` (until a book is selected AND the input contains a digit, regex `/\d/`); ready — `background:#fff;color:#000`, label `✓ SEND TO MODEL`; armed (after 1st click sets `sendArmed`) — `background:#F5D90A;color:#000`, label `CONFIRM? ✓`. Padding `9px 16px`, 11px, 0.12em, weight 500.
- 2nd click: prepends `{ left:'JUL 14 · <books joined ", "> · <SPORT> — <event>', right:'MAX <input value>' }` to `limitsLog` (surfaces in ANALYTICS → LIMITS REPORTED — SENT TO MODEL) and closes/resets the panel. Opening the panel on any card resets book selection, amount, and armed state; only one card's panel can be open at a time.

### 2.3 PENDING VERIFICATION section
Header: `PENDING VERIFICATION (2)` — same geometry as the live header but weight 500 and `color:#9a9a9a` (dimmed).
Cards: same frame + `opacity:0.82` (2nd card also `border-top:none`). Event line color `#d6d6d6`; tag chip greyed (`border:1px solid #9a9a9a;color:#9a9a9a`). Status: `CHECKING AGAIN IN` + live countdown (label #9a9a9a, value `#d6d6d6` weight 600). Legs: same buttons but `border:2px solid #8f8f8f;color:#d6d6d6`; stake slot is only `↗` styled `margin-left:10px;color:#9a9a9a` (**no stakes before verification**). Metric box bottom-right via `margin-left:auto;align-self:flex-end`. No CONFIRM / TRADE LIMITED? row.

**Demo PENDING cards:**
| tag | event · sport | countdown start | legs | metric |
|---|---|---|---|---|
| `ARB` | `Canucks @ Oilers` · `NHL` | **42s**, resets to 75 at 0 | `Coolbet — Canucks ML @ 2.10` ↗; `Pinnacle — Oilers ML @ 2.06` ↗ | `MARGIN: 2.4%` |
| `EV` | `Nuggets @ Suns` · `NBA` | **68s**, resets to 75 at 0 | `FanDuel — Nuggets −3.5 @ 1.98` ↗ | `EDGE: +3.1%` |

### 2.4 VIEW ALL TRADES (expander)
Bottom CTA (always visible, handler `toggleViewAll`): full-width button `VIEW ALL TRADES` — `display:block;width:100%;background:#F5D90A` (→ `#6a6a6a` while open); `color:#000;text-align:center;font-size:12px;letter-spacing:0.14em;font-weight:500;padding:11px 16px`; hover `background:#fff`. Caption under it (11px, 0.08em, #5a5a5a, centered): `EVERY VALUABLE TRADE THE SCANNER FOUND — ARB · MIDDLE · EV`.

When open, TWO boxes render **above** the CTA:

**ALL TRADES** — header `ALL TRADES` (15px/600/0.14em/#fff), box `border:2px solid #f5ecb8`. Rows: grid `0.6fr 1.7fr 2fr 0.9fr 1.1fr`, gap 10px, `padding:9px 14px;border-bottom:1px solid #4a4a4a;font-size:12px`. No column-header row. Cells: CAT `#9a9a9a` 0.08em · EVENT `#fff` · LEGS `#9a9a9a` · METRIC tinted (`#a8e8be` margins / `#f2e08a` edges) · STATUS colored, right-aligned, 0.08em. Footer row (flex, gap 20px, padding 10px 14px) holds the list controls (§2.5).

All 18 demo rows verbatim (CAT | EVENT | LEGS | METRIC | STATUS(color)):
1. `ARB` | `Arsenal vs Chelsea · SOCCER` | `Betsson 3.10 / Marathon 3.65 / Pinnacle 3.30` | `MARGIN 2.5%` | `VERIFIED LIVE` (#fff)
2. `MIDDLE` | `Lions @ Stampeders · CFL` | `Betway 1.95 / Pinnacle 1.98` | `EDGE +4.6%` | `VERIFIED LIVE` (#fff)
3. `ARB` | `Canucks @ Oilers · NHL` | `Coolbet 2.10 / Pinnacle 2.06` | `MARGIN 2.4%` | `PENDING` (#9a9a9a)
4. `EV` | `Nuggets @ Suns · NBA` | `FanDuel −3.5 @ 1.98` | `EDGE +3.1%` | `PENDING` (#9a9a9a)
5. `ARB` | `Bruins @ Maple Leafs · NHL` | `Coolbet 2.08 / Pinnacle 2.04` | `MARGIN 2.2%` | `CONFIRMED +$2.20` (#43d17a)
6. `MIDDLE` | `Yankees @ Red Sox · MLB` | `Caesars +1.5 / Pinnacle −0.5` | `EDGE +5.0%` | `CONFIRMED +$47.50` (#43d17a)
7. `EV` | `Mariners ML · MLB` | `DraftKings 2.05` | `EDGE +2.6%` | `CONFIRMED −$20.00` (#e0442c)
8. `ARB` | `UFC 319 co-main · MMA` | `LeoVegas 1.92 / Pinnacle 2.14` | `MARGIN 1.9%` | `UNCONFIRMED` (#9a9a9a)
9. `ARB` | `LA Galaxy vs Austin · MLS` | `Betsson 2.90 / Marathon 3.40 / Pinnacle 3.05` | `MARGIN 1.4%` | `KILLED — VERIFICATION` (#e0442c)
10. `EV` | `ATP Washington QF · TENNIS` | `888sport 2.15` | `EDGE +2.1%` | `KILLED — HEAT GATE` (#e0442c)
11. `MIDDLE` | `Blue Bombers @ Argonauts · CFL` | `Betway +6.5 / Pinnacle −3.5` | `EDGE +3.8%` | `EXPIRED` (#5a5a5a)
12. `EV` | `Canadiens ML · NHL` | `Nordic Bet 2.30` | `EDGE +2.4%` | `CONFIRMED +$8.40` (#43d17a)
13. `ARB` | `Sky @ Fever · WNBA` | `BetRivers 1.98 / Pinnacle 2.10` | `MARGIN 1.7%` | `KILLED — ROUNDING` (#e0442c)
14. `MIDDLE` | `Chiefs @ Bills · NFL` | `BetMGM +3.5 / Pinnacle −1.5` | `EDGE +4.2%` | `PENDING` (#9a9a9a)
15. `EV` | `Ruud vs Shelton · TENNIS` | `888sport 2.15` | `EDGE +2.8%` | `CONFIRMED +$17.25` (#43d17a)
16. `ARB` | `Whitecaps vs Timbers · MLS` | `Betsson 2.75 / Marathon 3.10 / Pinnacle 3.20` | `MARGIN 2.0%` | `EXPIRED` (#5a5a5a)
17. `EV` | `Alcaraz vs Sinner · TENNIS` | `Bet Victor 2.40` | `EDGE +3.5%` | `KILLED — QUOTE STALE` (#e0442c)
18. `MIDDLE` | `Raptors @ Celtics · NBA` | `FanDuel +7.5 / Pinnacle −4.5` | `EDGE +3.9%` | `UNCONFIRMED` (#9a9a9a)

**HISTORY** — header row (flex space-between baseline, `margin:18px 0 8px`): `HISTORY` (15px/600/0.14em/#fff) + graveyard toggle button (handler `toggleGraveyard`): `background:none;border:1px solid #cfcfcf;color:#9a9a9a;padding:3px 10px;font-size:11px;letter-spacing:0.1em`; hover white. Label: `▸ 7 KILLED TODAY` closed / `▾ 7 KILLED TODAY` open (count = killed.length). Box `border:2px solid #f5ecb8`. Rows: grid `2.4fr 1.5fr 1fr`, gap 10px, `padding:9px 14px;border-bottom:1px solid #4a4a4a;font-size:12px`. Col 1 description `#d6d6d6`; col 2 (right-justified flex, gap 8px): outcome chip (`1px solid <color>`, same color text, `padding:2px 8px;letter-spacing:0.1em;font-size:11px`) + result text; col 3 DATE · TIME `#9a9a9a;text-align:right;letter-spacing:0.06em;nowrap`.

All 18 demo history rows (description | CHIP(color) | result(color) | when):
1. `ARB · Bruins @ Maple Leafs · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$2.20`(#37c86f) | `JUL 14 · 2:12 PM`
2. `MIDDLE · Yankees @ Red Sox · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$47.50`(#37c86f) | `JUL 14 · 11:05 AM`
3. `EV · DraftKings · Mariners ML @ 2.05 · $20` | `CONFIRMED`(#e0442c) | `LOST −$20.00`(#e0442c) | `JUL 13 · 9:48 PM`
4. `ARB · UFC main event · $50/$50` | `UNCONFIRMED`(#9a9a9a) | `NO REPLY`(#5a5a5a) | `JUL 13 · 7:31 PM`
5. `ARB · Betsson / Marathon · LAFC @ Sounders · $50/$50` | `EXPIRED`(#5a5a5a) | `—`(#5a5a5a) | `JUL 12 · 6:20 PM`
6. `MIDDLE · Nuggets @ Suns · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$12.00`(#37c86f) | `JUL 12 · 4:15 PM`
7. `ARB · Coolbet / Pinnacle · Canucks @ Flames · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$1.90`(#37c86f) | `JUL 12 · 1:44 PM`
8. `EV · FanDuel · Celtics −2.5 @ 1.96 · $15` | `CONFIRMED`(#e0442c) | `LOST −$15.00`(#e0442c) | `JUL 11 · 8:02 PM`
9. `ARB · DraftKings / Pinnacle · Astros @ Rangers O/U 9 · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$2.60`(#37c86f) | `JUL 11 · 5:38 PM`
10. `MIDDLE · Betway / Pinnacle · Elks @ Roughriders · $50/$50` | `UNCONFIRMED`(#9a9a9a) | `NO REPLY`(#5a5a5a) | `JUL 11 · 2:10 PM`
11. `EV · 888sport · Gauff vs Swiatek ML @ 2.15 · $15` | `CONFIRMED`(#37c86f) | `WON +$17.25`(#37c86f) | `JUL 10 · 6:55 PM`
12. `ARB · Betsson / Pinnacle · Inter vs Milan · $50/$50` | `EXPIRED`(#5a5a5a) | `—`(#5a5a5a) | `JUL 10 · 3:22 PM`
13. `EV · LeoVegas · UFC prelim ML @ 2.20 · $15` | `CONFIRMED`(#e0442c) | `LOST −$15.00`(#e0442c) | `JUL 10 · 11:40 AM`
14. `ARB · Nordic Bet / Pinnacle · Jets @ Wild · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$2.10`(#37c86f) | `JUL 09 · 9:12 PM`
15. `MIDDLE · Caesars / Pinnacle · Dodgers @ Padres · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$38.00`(#37c86f) | `JUL 09 · 6:48 PM`
16. `EV · BetRivers · Pacers ML @ 2.35 · $10` | `UNCONFIRMED`(#9a9a9a) | `NO REPLY`(#5a5a5a) | `JUL 09 · 1:05 PM`
17. `ARB · Bet Victor / Pinnacle · Zverev vs Rune · $50/$50` | `CONFIRMED`(#37c86f) | `WON +$1.75`(#37c86f) | `JUL 08 · 7:29 PM`
18. `EV · Marathon Bet · Sounders ML @ 2.60 · $10` | `CONFIRMED`(#e0442c) | `LOST −$10.00`(#e0442c) | `JUL 08 · 4:11 PM`

(Note: losing EV rows reuse the CONFIRMED chip but in red #e0442c.)

**GRAVEYARD** (inside the HISTORY box, below its footer, when `graveyardOpen`): `padding:10px 14px`. Title: `GRAVEYARD — EVERY KILL IS LOGGED WITH ITS REASON` (11px, 0.14em, #5a5a5a). Rows: flex space-between, `padding:6px 0;border-top:1px solid #4a4a4a;font-size:12px;color:#9a9a9a`; reason right side `letter-spacing:0.08em;color:#5a5a5a`.
1. `ARB · UFC 319 — Pereira vs Ankalaev` — `ONE_SPORT_RULE (1XBET × NBA LEG)`
2. `ARB · Canadiens @ Senators` — `ROUNDING_DESTROYS_MARGIN`
3. `EV · Sky @ Fever` — `FAILED_VERIFICATION (58% RETENTION)`
4. `ARB · Arsenal vs Chelsea` — `QUOTE_STALE (14 MIN)`
5. `EV · ATP Washington — QF` — `HEAT_GATE (FANDUEL AMBER)`
6. `ARB · LA Galaxy vs Austin` — `FAILED_VERIFICATION (61% RETENTION)`
7. `MIDDLE · Blue Bombers @ Argonauts` — `MARKET_BREADTH_CAP`

### 2.5 List controls (shared by ALL TRADES and HISTORY)
State keys `allTradesView` / `historyView`, start at **5** rows. Buttons styled `background:none;border:none;font-size:12px;letter-spacing:0.14em;color:#5a5a5a`; hover `#fff`.
- At 5 rows: single button `VIEW MORE →` → sets 15.
- At 15 rows: `VIEW LESS` (→ 5) plus, if total > 15, `VIEW ALL (18)` (→ all; both demo lists total 18).
- At full: `VIEW LESS` only.

### 2.6 CONFIRM state cycle (handler `t.confirm`, state `confirmed[i]` cycles `(n+1) % 3`)
| state | label | background | text |
|---|---|---|---|
| 0 | `CONFIRM` | `#fff` | `#000` |
| 1 | `CONFIRMED ✓` | `#43d17a` | `#000` |
| 2 | `UNCONFIRM?` | `#F5D90A` | `#000` |
Click in state 2 returns to 0. Button: no border, 11px, 0.12em, padding `8px 16px`, weight 500; hover `opacity:0.85`. Per-card independent state.

### 2.7 Timers (single 1s interval set in `componentDidMount`)
- `pendRemain` (demo start `[42, 68]` s): each ticks down 1/s; **on reaching 0 resets to 75** (the VERIFY GAP) and keeps cycling.
- `liveRemain` (demo start `[86, 104]` s): ticks down; **clamps at 0** (stays 0:00 — the mockup does not auto-flip FRESH→STALE).
- `staleUp` (demo start `161` s): ticks up forever.
- Format `fmtSec(v) = floor(v/60) + ':' + pad2(v%60)` → `m:ss` (e.g. `1:26`, `0:42`, `2:41`).

---

## 3. BRAIN SCREEN

DOM order:

### 3.1 Header row
Flex space-between, margin-top 16px. Left: `BRAIN` (13px, 0.16em, #fff, 500). Right (flex, gap 14px, 11px, 0.1em, #9a9a9a): `LAST FULL PASS 10:47 PM` and chip `KILL SWITCH · OFF` (`border:1px solid #ababab;padding:3px 10px;color:#d6d6d6`) — **non-interactive** in the mockup.

### 3.2 Engine strip — 5 tiles
Grid `repeat(auto-fit,minmax(110px,1fr))`, gap 8px, margin-top 14px. Tile anatomy: label 11px/0.12em/#9a9a9a; value 13px/#fff margin-top 6px; subtext 11px margin-top 3px.
1. `REFERENCE PRICER` — the only tile that is a `<button>`: `border:2px solid #fff;background:none;padding:10px;text-align:left`; hover `background:#161616`. Value (weight 500) cycles on click (handler `cycleAnchor`): `PINNACLE ▾` → `CIRCA ▾` → `CONSENSUS ▾` → back. Subtext `live` in `#43d17a`.
2. `CREDITS` (1px solid #8f8f8f like tiles 2–5) — `61,212 / 100,000`, sub `19d runway` (#43d17a).
3. `DOUBLE VERIFICATION` — `77% pass rate`, sub `survivors keep 81% edge` (#9a9a9a).
4. `TODAY'S PICKS` — `8 of 12 sent`, sub `4 held back` (#F5D90A).
5. `CLOSING PRICE EDGE` — `+1.1% avg`, sub `62% beat the close` (#43d17a).

### 3.3 Rationale panel
`border:1px solid #ababab;margin-top:10px;padding:13px 16px`. Label `WHY ONLY 8 TODAY` (11px/0.14em/#9a9a9a). Body (13px, line-height 1.65, #d6d6d6, margin-top 8px), verbatim:
`214 candidates → 96 passed double verification → 8 sent. Held back: BetMGM heat budget spent · EV mix at its 29% cap · two candidates shared a game with a sent pick.`

### 3.4 Site table
`border:2px solid #ababab;margin-top:16px`. Header: grid `1.5fr 1.1fr 1fr 0.5fr`, gap 10px, `padding:11px 16px;border-bottom:2px solid #ababab;font-size:11px;letter-spacing:0.14em;color:#9a9a9a`: `SITE` `ITS SPORT` `HEALTH` `HEAT`.
Rows (clickable, handler `s.select` → `selectedSite`): same grid, `padding:12px 16px;border-bottom:1px solid #8f8f8f;cursor:pointer`; selected row gets `border-left:3px solid #fff` + `background:#161616` (others `3px solid transparent`) and its name gains the suffix ` ◂` (U+25C2). Name 14px #fff; sport 12px/0.08em #9a9a9a; health badge (11px, 0.1em, padding 2px 8px, `2px solid` in its color, fit-content): `SHARP — SAFE` (#fff) / `GREEN` (#43d17a) / `AMBER` (#F5D90A) / `RED` (#e0442c); heat 13px #d6d6d6.
Footer toggle (handler `toggleSites`; full-width left-aligned text button, `padding:11px 16px`, 12px/0.14em/#5a5a5a, hover #fff): `+ 11 MORE SITES` collapsed / `− SHOW FEWER SITES` expanded. Collapsed shows only Pinnacle, Coolbet, DraftKings, BetMGM, 1xBet. Default `selectedSite:'BetMGM'`.

**Full 16-book demo roster** (name | sport | health | heat | MY MAX BET | WAS):
| Pinnacle | ANY | SHARP — SAFE | `—` | `NO LIMIT` | — |
| Coolbet | HOCKEY | GREEN | 12 | `$500` | — |
| Nordic Bet | HOCKEY | GREEN | 4 | `$500` | — |
| FanDuel | BASKETBALL | AMBER | 38 | `$120` | `WAS $400` |
| BetRivers | BASKETBALL | GREEN | 9 | `$500` | — |
| DraftKings | BASEBALL | GREEN | 18 | `$400` | — |
| Caesars | BASEBALL | GREEN | 6 | `$500` | — |
| BetMGM | FOOTBALL | AMBER | 41 | `$250` | `WAS $500` |
| Betway | FOOTBALL | GREEN | 15 | `$350` | — |
| Bet365 | SOCCER | RED | 64 | `$25` | `WAS $500` |
| Betsson | SOCCER | GREEN | 11 | `$500` | — |
| Marathon Bet | SOCCER | GREEN | 2 | `$500` | — |
| 888sport | TENNIS | GREEN | 7 | `$500` | — |
| Bet Victor | TENNIS | GREEN | 0 | `$500` | — |
| LeoVegas | MMA | GREEN | 18 | `$300` | — |
| 1xBet | MMA | RED | 68 | `$150` | `WAS $500` |

### 3.5 Site detail panel
`border:2px solid #fff;margin-top:16px;padding:16px 18px`. Content follows `selectedSite`:
- Title line (14px, 0.14em): name uppercase #fff/500 + meta #9a9a9a. Meta = `· TAKES EVERY SPORT · THE HEDGE LEG` for Pinnacle, else `· <SPORT> ONLY · SUSPICION LEVEL <n>/5` where n maps from heat: ≥60→`5/5`, ≥45→`4/5`, ≥30→`3/5`, ≥15→`2/5`, else `1/5`.
- Max-bet line (margin-top 12px, 13px, 0.08em, #9a9a9a): `MY MAX BET HERE ` + max (#fff/500) + optional ` ▼ WAS $Y` (#e0442c/500).
- Suspicion chart (hidden for Pinnacle — `detailShowChart:false`): label `SUSPICION OVER TIME — GUESS (LINE) VS WHAT ACTUALLY HAPPENED (YELLOW MARKS)` (11px/0.14em/#9a9a9a). SVG `viewBox="0 0 800 180"`, height 170px, static for every site:
  - dashed thresholds `stroke:#ababab` 1px dasharray `4 4`: y=20 (x 0→740) labeled `STOP` (x798 y24, end-anchored, #9a9a9a 10px letter-spacing 1); y=85 (x 0→720) labeled `GO GENTLE` (y89).
  - white polyline 1.5px: `10,138 120,135 220,131 320,133 420,129 500,126 560,100 620,96 655,56 750,63 790,59`.
  - yellow 9×9 `#F5D90A` rects at (555.5,95.5) and (650.5,51.5); labels `BET REJECTED` (560,126, middle-anchored) and `STAKE CUT` (655,42), #F5D90A 10px letter-spacing 1.
- Box `WHAT THE BRAIN DOES NOW` (1px solid #ababab, margin-top 14px, padding 12px 16px; body 14px/1.6 #d6d6d6). Texts verbatim:
  - green books: `Full speed. Stakes at 100%, up to 3 sharp bets a day. Nothing to fix — keep withdrawals boring and regular.`
  - amber (FanDuel, BetMGM): `Half as many risky bets here, stakes shrunk 40%, until heat cools below 30. Also watching: my closing price edge at this book is high — that’s what they grade me on.`
  - red (Bet365, 1xBet): `Nothing sharp goes here anymore. Promo reminders only. Withdraw the balance in two or three plain chunks, then let it rest.`
  - Pinnacle: `Safe by design. Sharp books don’t limit winners — this is where the hedge leg goes, and it never accumulates heat.`
- Box `□ QUIT RULES — WRITTEN IN ADVANCE` (1px solid #ababab, margin-top 10px). Texts verbatim:
  - calm (green books): `"Retire this account after 2 stake cuts in 14 days." Editable now — the account is calm.`
  - locked (amber/red): `"Retire this account after 2 stake cuts in 14 days." Locked while the account struggles — you decided this when calm.`
  - Pinnacle: `None needed. This account is meant to live forever.`

### 3.6 STRATEGY PERFORMANCE
`border:1px solid #ababab;margin-top:16px;padding:13px 16px`. Label `STRATEGY PERFORMANCE`. Column heads (grid `64px 56px 1fr`, 11px/0.12em/#5a5a5a): (blank) `GRADE` `NOTES`. Rows (12px, row-gap 12px; name #9a9a9a/0.1em; grade 15px/500):
- `ARB` — `92` (#43d17a) — `quoted margins hold when confirmed`
- `EV` — `37` (#F5D90A) — `flags run hot — +3.0% quoted lands at +1.1%`
- `MIDDLE` — `81` (#43d17a) — `legs beat the close +0.6% · ` + yellow span `on watch until 200 legs (88 logged)`

### 3.7 BRAIN JOURNAL
`border:1px solid #ababab;margin-top:10px;padding:13px 16px`. Label `BRAIN JOURNAL`. Entries (12px/1.7 #d6d6d6; rows flex gap 12px, `padding:7px 0;border-bottom:1px solid #4a4a4a`; timestamp #5a5a5a `min-width:108px`):
- `JUL 13 · 12:00 PM` — `Daily check: 12 books green, grades steady, credits on pace — no changes`
- `JUL 12 · 9:14 PM` — `Bet365 limit report (WhatsApp) → heat 41→64, max bet $500→$25, quit rule armed`
- `JUL 10 · 3:02 AM` — `EV flags at LeoVegas ran 0.8% hot for 3 weeks → grade cut to 31`
- `JUL 08 · 12:00 PM` — `Consolidation pass: FanDuel amber → sharp bets there halved`
Extra entries when expanded (`journalOpen`, handler `toggleJournal`):
- `JUL 05 · 6:40 PM` — `Soccer 3-way arbs enabled after 20 clean confirms on 2-way`
- `JUL 02 · 12:00 PM` — `FanDuel marked amber — closing price edge there drawing attention`
Toggle button (text style like list controls, `padding:10px 0 0`): `SHOW ALL 47 ENTRIES →` / `SHOWING ALL — COLLAPSE`. (Only 6 entries exist in the demo; "47" is copy.)

### 3.8 ADVANCED BRAIN SETTINGS (pink expander; handler `toggleBrainSettings`)
Bottom CTA `ADVANCED BRAIN SETTINGS` (same CTA pattern, `#FF7AC6` → `#6a6a6a` open). Caption: `API INPUTS · DATA SOURCES · MODEL CONTROLS`.
Open panel `border:2px solid #FF7AC6;margin-top:16px` renders above the CTA:

**Section head** `INPUTS — WHAT THE BRAIN IS CONSUMING` (`padding:8px 14px;border-bottom:1px solid #6e2a4e;font-size:11px;letter-spacing:0.14em;color:#FF7AC6`). Rows: grid `1.2fr 2fr 0.9fr`, gap 10, `padding:10px 14px;border-bottom:1px solid #4a4a4a;font-size:12px`; src #fff/500/0.06em; detail #9a9a9a; status right-aligned 11px/0.1em colored:
| src | detail | status (color) |
|---|---|---|
| `THE ODDS API` | `Odds feed · 16 books · poll 20 min (5–8 min near start)` | `LIVE` (#43d17a) |
| `PINNACLE FEED` | `Reference pricer — de-vig anchor for fair odds` | `LIVE` (#43d17a) |
| `WHATSAPP REPLIES` | `Confirms + limit reports via Twilio` | `POLL 45S` (#9a9a9a) |
| `SETTLED RESULTS` | `Final scores for grading + P/L` | `LIVE` (#43d17a) |
| `LIMITS LOG` | `Your reported max bets (Advanced Analytics)` | `2 THIS MONTH` (#F5D90A) |
| `LLM — HAIKU` | `Consolidation pass · strategy text + heat review` | `$0.84 / $3.00` (#9a9a9a) |

**Section head** `MODEL CONTROLS` (same style). Rows (flex space-between, `padding:9px 14px;border-bottom:1px solid #4a4a4a;font-size:12px`; key #9a9a9a/0.06em, value #fff/500):
- `HEAT WEIGHTS (RAW)` — `LIMIT +23 · REJECT +9 · CUT +14 · WITHDRAWAL −2`
- `SUSPICION DECAY HALF-LIFE` — `21 DAYS`
- `CONSOLIDATION CADENCE` — `EVERY 6 H`
- `JOURNAL RETENTION` — `FOREVER — NEVER DELETED`

Button row (flex gap 10, margin 12px 14px): `+ ADD DATA SOURCE` (2px solid #FF7AC6, pink text, 11px/0.12em, padding 8px 16px; hover invert to pink bg/black — **no handler, inert**) and the model-room toggle (handler `toggleModelRoom`): label `EDIT MODEL →` closed / `CLOSE MODEL ←` open; same pink outline style, filled pink/black text while open.

**MODEL INTERNALS — THE BOILER ROOM** (when `modelRoomOpen`; `border-top:1px solid #6e2a4e`):
- Title (13px/600/0.14em/#FF7AC6, padding 10px 14px): `MODEL INTERNALS — THE BOILER ROOM` + inline sub `READ-ONLY MIRROR OF THE BACK END` (#9a9a9a, 400, 11px).
- Pipeline chips (flex gap 8, 11px/0.1em; chips `border:1px solid #FF7AC6;color:#FF7AC6;padding:3px 9px`, arrows `→` #5a5a5a): `SCAN → NORMALIZE → DE-VIG → EDGE MATH → GATE BATTERY → STAKING → WHATSAPP`.
- Code box (`border:1px solid #4a4a4a;background:#0d0d0d;padding:12px 14px`), label `THE MATH — STRATEGY CORE (strategy.py)`, `<pre>` verbatim:
```
# arbitrage — 2 or 3 legs
inv_sum    = sum(1 / odds_i for each leg)
arb_margin = 1 - inv_sum                  # > 0.75% passes

# fair odds — de-vig the reference pricer
fair_prob  = (1/pin_a) / (1/pin_a + 1/pin_b)
ev_edge    = fair_prob * book_odds - 1    # > 2.0% passes

# staking — kelly against TOTAL bankroll
kelly_frac = 0.25
stake      = bankroll * kelly_frac * ev_edge / (book_odds - 1)
stake      = round_to(min(stake, 0.05 * bankroll), $5)

# verification — 75s later, tolerance gate
retention  = edge_recheck / edge_first
promote if retention >= 1 - tolerance   # default 5%
```
- Trace box (same box style), label `LIVE TRACE — LAST CANDIDATE THROUGH THE PIPE (#1044 ARSENAL VS CHELSEA)`; mono 12px/1.9, line prefixes #5a5a5a:
```
IN :  betsson 3.10 · marathon 3.65 · pinnacle 3.30
DEVIG: inv_sum = 0.3226 + 0.2740 + 0.3030 = 0.8996
EDGE: arb_margin = 1 − 0.8996 = 2.5%          (the “2.5%” is tinted #a8e8be)
GATES: one_sport ✓ · heat ✓ · velocity ✓ · breadth ✓ · rounding ✓
STAKE: $35 / $30 / $33 (rounded to $5, cap 5% of $10,000)
OUT:  verified 22:41:06 · sent via twilio · ttl 10:00
```
- Footer note (11px/0.08em/#5a5a5a): `THIS IS THE EXACT CODE PATH EVERY CANDIDATE WALKS. STRATEGY EDITS HAPPEN IN SETTINGS — NEVER BY HAND IN HERE.`

---

## 4. ANALYTICS SCREEN

DOM order:

### 4.1 Top row
Flex, gap 26px, margin-top 18px, baseline-aligned.
- **PROFILE group** (relative): filled segment `PROFILE` (`background:#fff;color:#000;font-size:13px;font-weight:600;letter-spacing:0.14em;padding:7px 14px`) joined to dropdown button `{{ profileName }} ▾` (demo `RYAN ▾`; `border:2px solid #fff;border-left:none;color:#fff;padding:5px 12px;letter-spacing:0.1em`; hover bg #161616; handler `toggleProfileMenu`).
- **Dropdown** (when open): `position:absolute;top:calc(100% + 4px);left:0;background:#000;border:2px solid #ababab;min-width:200px;z-index:10`. Items (12px/0.1em, padding 9px 12px, hover-less full-width text buttons): each profile uppercase, current one prefixed `● ` and #fff, others #9a9a9a; last item `+ ADD NEW PROFILE` (white, `border-top:1px solid #4a4a4a`; handler `startAddProfile`).
- **Fund box** (margin-left auto): `border:2px solid #ababab;padding:6px 12px;font-size:14px;letter-spacing:0.1em;color:#9a9a9a;nowrap`: `FUND START ` + `$10,000` (#fff/600) + ` · ` + `MAY 01 2026` (#fff/600). Follows the selected profile (`fundStartAmt`/`fundStartDate`).

### 4.2 Add-profile inline form (when `addingProfile`)
`border:2px solid #ababab;margin-top:12px;padding:14px`, flex gap 14, align-end, wrap.
- Field `NAME` (label 11px/0.14em/#9a9a9a): input placeholder `Name`, width 160px, `border:2px solid #8f8f8f`, focus #fff (handler `setNewProfName`).
- Field `STARTING CASH`: input placeholder `$5,000`, width 120px, tabular (handler `setNewProfAmt`).
- Button `CREATE PROFILE` (handler `createProfile`): disabled grey `#5a5a5a`/`#1e1e1e` until name non-empty AND amount contains a digit; then white/black. Padding 10px 16px, 11px/0.12em/500.
- Note: `STARTS THE DAY YOU CREATE IT — JUL 14 2026` (11px/0.08em/#5a5a5a).
- On create: amount digits are parsed and reformatted `$X,XXX`; date hardcoded `JUL 14 2026`; new profile is appended, selected, and the form closes.

### 4.3 Range chips
Joined chip group (§0.4), margin-top 18px: `1D` `5D` `30D` `1Y` `MAX`. Default active `30D`. Clicking sets `state.range` — **charts/stats do not change** (static demo SVGs).

### 4.4 Chart 1 — `CONFIRMED — PROFIT ($)`
Title 13px/0.16em/#d6d6d6, `margin:22px 0 8px`. Plate: `background:#d9d9d9;border:3px solid #5CA8FF;padding:14px 14px 10px`. SVG `viewBox="0 0 960 220"`, height 210px:
- Minor horizontal gridlines `#999` 1px at y 190/160/130/100/70/40; major `#111` at y 205 (2px baseline) and 175/145/115/85/55/25 (1.5px).
- Minor verticals `#999` at x 133/280/427/574/720/867; major `#111` 1.5px at x 207/354/500/647/794.
- Y labels (end-anchored at x=50, `#111` 12px weight 700): `$0` `$100` `$200` `$300` `$400` `$500` `$600`.
- Trendline `#5CA8FF`, 3.5px, round join/cap, points: `60,205 128,197 196,201 263,188 331,178 399,183 466,166 534,170 602,153 669,142 737,149 805,126 872,109 940,74`.
- Bullet r=4 `#5CA8FF` at every point; final point r=5.5 with ring `stroke:#111` 1.5px.
- Date row (flex space-between, 12px/700/#111, `padding:4px 0 2px 50px`): `JUN 13` `JUN 18` `JUN 23` `JUN 28` `JUL 5` `JUL 13`.
Stats row (flex gap 28, margin-top 10, 14px/0.12em): `RETURN (RANGE) ` `+2.74%` (#37c86f/500) · `ANNUALIZED ` `+38.9%` (#37c86f/500) · `PROFIT ` `+$438` (#fff/500).

### 4.5 Chart 2 — `ALL (CONFIRMED + UNCONFIRMED) — IF EVERY PICK WAS FOLLOWED ($)`
Title margin `26px 0 8px`. Same plate/grid style. Y labels: `$0` `$200` `$400` `$600` `$800` (majors at y 205/160/115/70/25; minors at 183/138/93/48). Trendline points: `60,205 128,196 196,199 263,184 331,174 399,178 466,161 534,153 602,159 669,138 737,125 805,131 872,99 940,58`. Same date row. Stats: `RETURN (RANGE) +4.08%` · `ANNUALIZED +62.6%` · `PROFIT +$652`.

Footnote (`margin:18px 0 0`, 11px/0.1em/1.7/#5a5a5a): `RETURNS MEASURED AGAINST TOTAL BANKROLL ($10,000). ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.`

### 4.6 Monthly table
`border:2px solid #8f8f8f;margin-top:22px;font-size:12px`. Header: grid `0.8fr repeat(7,0.7fr) 1fr 0.8fr`, gap 6, `padding:9px 14px;border-bottom:1px solid #8f8f8f;font-size:10px;letter-spacing:0.12em;color:#5a5a5a`: `MONTH` `CAND` `VERIF` `SENT` `CONF` `UNCONF` `EXP` `KILLED` `FOLLOW-THRU` `P/L`. Rows (month #fff/500/0.08em; P/L #fff/500):
| `JUL` | 214 | 96 | 88 | 61 | 6 | 7 | 118 | `69%` | `+$188` |
| `JUN` | 402 | 171 | 160 | 118 | 9 | 11 | 231 | `74%` | `+$171` |
| `MAY` | 318 | 129 | 117 | 79 | 11 | 8 | 189 | `68%` | `+$53` |

### 4.7 TIME TO ACT funnel
`border:2px solid #ababab;padding:14px;margin-top:8px`. Title `TIME TO ACT — SENT → CONFIRMED` (11px/0.14em/#9a9a9a, mb 12). Rows (grid gap 8; label 11px/0.1em `min-width:190px` #9a9a9a; track `flex:1;height:14px;border:1px solid #8f8f8f`; fill `width:<pct>%;height:100%;background:#fff` unless noted; value 12px/500/#fff `min-width:44px` right):
- `CONFIRMED < 2 MIN` — 31% — `31%`
- `CONFIRMED 2–5 MIN` — 46% — `46%`
- `CONFIRMED 5–10 MIN` — 14% — `14%`
- `EXPIRED / DEAD AT CONFIRM` — 9% (fill `#5a5a5a`) — `9%`
Footer (11px/0.08em/#5a5a5a, mt 12): `% OF VERIFIED PICKS STILL ALIVE AT CONFIRMATION — THE REFERENDUM ON THE NOTIFICATION ARCHITECTURE`

### 4.8 ADVANCED ANALYTICS (blue expander; handler `toggleAdvanced`)
CTA `ADVANCED ANALYTICS` (`#5CA8FF` → `#6a6a6a` open); caption `BOOKS THAT LIMITED YOU — LOGGED AND SENT TO THE MODEL`. Open sections render **above** the CTA in this order; every section header is 15px/600/0.14em/`#5CA8FF`:

**`OPEN BETS`** — box `border:2px solid #8f8f8f`, rows flex space-between `padding:10px 14px;border-bottom:1px solid #8f8f8f;font-size:12px` (left #d6d6d6, status #9a9a9a/0.08em):
- `ARB · Blue Jays @ Mariners · DraftKings O8.5 @ 2.04 / Pinnacle U8.5 @ 2.02 · $100` — `STARTS 7:10 PM`
- `EV · 888sport · Ruud vs Shelton · Ruud ML @ 2.15 · $15` — `STARTS 4:00 PM`
- `MIDDLE · Lions @ Stampeders · Betway / Pinnacle · $100` — `LIVE — Q2`

**`LEADERBOARDS`** — subhead line: `TOP BOOKS BY CONFIRMED COUNT · SINCE` (11px/0.14em/#9a9a9a) + chip `MAY 01 2026 ▾` (`border:1px solid #9a9a9a;color:#d6d6d6;padding:2px 8px;font-size:11px;letter-spacing:0.1em` — inert). 2×2 grid of boards (`border:2px solid #ababab`; title bar `padding:8px 14px;border-bottom:1px solid #8f8f8f;11px/0.14em/#fff/500`; rows flex gap 10 `padding:8px 14px;border-bottom:1px solid #8f8f8f;font-size:12px` — book #d6d6d6 flex:1, count #fff, pct #9a9a9a min-width 40 right):
- `ARB`: Coolbet 34 `28%` · DraftKings 27 `22%` · Betsson 19 `16%`
- `EV`: FanDuel 22 `31%` · 888sport 15 `21%` · LeoVegas 12 `17%`
- `MIDDLES`: Betway 11 `34%` · Caesars 8 `25%` · BetRivers 5 `16%`
- `ALL CATEGORIES`: Coolbet 52 `24%` · DraftKings 41 `19%` · FanDuel 33 `15%`

**`COST OF SAFETY`** — 2-col grid of tiles (`border:2px solid #ababab;padding:12px 14px`; label 10px/0.14em/#9a9a9a; big value 20px/500/#fff; note 11px/#5a5a5a/0.04em):
- `ROUNDING COST` — `−$18.40` — `Σ (UNROUNDED − ROUNDED WORST-CASE) OVER 41 CONFIRMED PAIRS`
- `MARGIN RETENTION — INITIAL → RECHECK → FINAL` — `81% MEDIAN` — `PROMOTION THRESHOLD 80% · 23% OF CANDIDATES DIE AT RECHECK`
- (span 2) `GATE COST — ESTIMATED EV OF KILLED CANDIDATES, PER BATTERY RULE` — bar rows (label 11px/0.08em/#d6d6d6 min-width 200; track h14 1px #8f8f8f; cost 12px/500/#fff min-width 56 right; note 11px/#5a5a5a min-width 150):
  - `ONE_SPORT_RULE` — bar 100% `#F5D90A` — `−$212` — `87% OF LINE ITEM IS 1XBET`
  - `HEAT_GATE` — bar 30% #fff — `−$64` — `FANDUEL AMBER SINCE JUL 02`
  - `SHARP_VELOCITY_CAP` — bar 18% #fff — `−$38` — `3/DAY PER BOOK`
  - `MARKET_BREADTH_CAP` — bar 10% #fff — `−$22` — `2 / MARKET / BOOK / WEEK`
- (span 2) `CLV VS PINNACLE CLOSE` — `+1.1% MEAN · 62% POSITIVE` — `FROM LAST CACHED PRE-START SWEEP · VS OWN BOOK: +0.4% MEAN`

**`LIMITS REPORTED — SENT TO MODEL`** — box `border:2px solid #5CA8FF`; header bar `padding:10px 14px;border-bottom:1px solid #2a3a52;font-size:13px;font-weight:600;letter-spacing:0.14em;color:#5CA8FF`. Rows (flex space-between `padding:9px 14px;border-bottom:1px solid #8f8f8f;font-size:12px`; left #d6d6d6; right `#5CA8FF`/0.08em/500). Seed data (`limitsLog`) — new TRADE LIMITED? reports prepend here live:
- `JUL 12 · Bet365 · EPL — Arsenal vs Chelsea` — `MAX $25`
- `JUL 08 · FanDuel · NBA — Nuggets @ Suns` — `MAX $120`

**`OPPORTUNITY LEADERBOARDS — SINCE JUL 11`** — box `border:2px solid #5CA8FF`; same blue header bar, with a right-aligned mini joined toggle (`border:1px solid #5CA8FF`; chips `padding:4px 10px;font-size:10px;letter-spacing:0.12em`; active `background:#5CA8FF;color:#000`, inactive blue text; handler `advSortTabs[].onClick` → `advLbSort`): `COUNT` (default) | `MARGIN / EDGE`. Body: 3-col grid, each column `border-right:1px solid #2a3a52`; column title (11px/0.12em/#9a9a9a): `ARB` / `EV` / `MIDDLES`; sub-header grid `1.3fr 0.6fr 0.9fr` (10px/0.12em/#5a5a5a, border-bottom 1px #4a4a4a): `BOOK` `COUNT` + metric name right-aligned (`AVG MARGIN` for ARB, `AVG EDGE` for EV/MIDDLES). Rows 12px: book #fff, count #d6d6d6 right, avg `#5CA8FF` right/500. Rows re-sort client-side by count desc or avg desc:
- ARB: 1xBet 139 `2.9%` · Coolbet 103 `2.4%` · Pinnacle 80 `2.1%` · Nordic Bet 21 `1.8%` · Betsson 20 `1.6%`
- EV: Coolbet 1037 `3.4%` · Betsson 257 `2.8%` · Nordic Bet 257 `2.6%` · 1xBet 209 `3.1%` · 888sport 134 `2.2%` (order shown = COUNT sort)
- MIDDLES: Coolbet 338 `4.1%` · DraftKings 214 `3.6%` · FanDuel 185 `3.2%` · 1xBet 155 `4.4%` · Pinnacle 120 `2.9%` (order shown = COUNT sort)
Footer text-button `SEE ALL →` (12px/0.14em/#5a5a5a, hover #fff — **inert**).

### 4.9 Sim-mode footnote (only when `!liveMode` and tab is ANALYTICS)
Centered, `margin:26px auto 0;max-width:560px`, 12px/0.12em/1.7/#9a9a9a:
`EVERY FIGURE ON THIS PAGE IS SIMULATED PAPER MONEY — A SHADOW POSITION, NOT A LIVE PROMISE.`

---

## 5. SETTINGS SCREEN

Six panels in a 2-col grid (gap 8, margin-top 16). Panel frame `border:2px solid #ababab`; header `padding:8px 14px;border-bottom:1px solid #8f8f8f;font-size:11px;letter-spacing:0.14em;color:#fff;font-weight:500`. KV rows: flex space-between, `padding:7px 0;border-bottom:1px solid #8f8f8f;font-size:12px`; key `#9a9a9a`/0.06em; value `#fff`/500 (right-aligned by flex).

### 5.1 `STRATEGY MIX — LOCKED TO 100`
Body `padding:14px`, grid gap 14. Per strategy: label row (11px/0.1em/#9a9a9a; pct #fff/500) + slider mock: track `height:12px;border:1px solid #ababab;position:relative`; fill `width:<pct>%;background:#fff`; knob `12×18px;background:#000;border:2px solid #fff` at `left:calc(<pct>% - 6px);top:-4px`. Values: `ARB` `47` · `MIDDLE` `24` · `EV` `29`. (Static — no drag in mockup.)

### 5.2 `SCAN RULES · CREDIT FORECASTER`
- `SCAN WINDOW` — `08:00 – 24:00 PT`
- `QUIET HOURS` — `00:00 – 08:00 · NO SENDS, NO SCANS`
- `CADENCE` — `BASE 20 MIN · 5–8 MIN < 2H TO START`
- `VERIFY GAP` — `75 S`
- `PROJECTED CREDITS / DAY` — `2,306 OF 2,475`
- `MONTH-END PROJECTION` — `91,400 / 100,000` (**value in #F5D90A**)
- `REMAINING (LIVE HEADER)` — `61,212 · 19 DAYS RUNWAY`
- Stepper row: `REMOVE STALE TRADES AFTER` — value `10 MIN` + `−` / `+` buttons (22×22px, `border:1px solid #8f8f8f;color:#d6d6d6`, 12px; hover white). Handlers `decStale` (floor 1) / `incStale` (no ceiling). Label = `staleRemoveMin + ' MIN'`.

### 5.3 `RISK & BANKROLL`
- `FLAT PAIR STAKE` — `$100 CAD`
- `KELLY FRACTION / CAP` — `0.25 / 5% OF TOTAL`
- `TOTAL BANKROLL` — `$10,000 CAD`
- `LINE MOVE TOLERANCE` — `5% · 0–100%`
- `MIN STAKE / ROUND TO` — `$10 / $5`
- `TRADES PER DAY CAP` — `12`

### 5.4 `BRAIN`
- `HEAT WEIGHTS` — `DEFAULT · EDITABLE WHILE GREEN`
- `CONSOLIDATION PASS` — `EVERY 6 H · HAIKU`
- `LLM BUDGET` — `$0.84 / $3.00 THIS MONTH`
- `KILL SWITCH` — `OFF`
- `LAST DIGEST` — `TODAY 12:00 · 16 BOOKS`
- Full-width button `UPDATE UNDERSTANDING` (2px solid #fff, white text, padding 8px, 11px/0.12em/500; hover inverts white bg/black — **inert**).

### 5.5 `WHATSAPP`
- Field `YOUR NUMBER` (key style label, mb 6): `<input type="tel">` value **`+1 604 555 8112`** (editable, handler `setWaNumber`), placeholder `+1 604 555 0000`, full-width, `border:2px solid #ababab`, 13px/500/0.06em tabular; **focus border `#F5D90A`** (unique focus color).
- `TRANSPORT` — `TWILIO · INBOUND POLL 45 S`
- `REPLY CODES` — `1 SECURED · 3 LIMITED`
- `DETAIL LEVEL` — `COMPACT`
- `QUIET HOURS` — `00:00 – 08:00`
- Full-width button `SEND TEST MESSAGE` (same style — inert).

### 5.6 `DATA`
- `MODE` — badge `SIMULATED` (`border:2px solid #F5D90A;color:#F5D90A;font-size:11px;letter-spacing:0.14em;padding:2px 8px` — non-interactive in mockup).
- `BACKUPS` — `14 NIGHTLY · LAST 03:00`
- Button pair (flex gap 8, mt 12, each `flex:1`): `EXPORT CSV` · `EXPORT JSON` (inert).
- Footnote (11px/0.08em/#5a5a5a): `EXPORT, NEVER DELETE. TRADES AND EVENTS ARE KEPT FOREVER.`

### 5.7 ADVANCED SETTINGS expander (handler `toggleAdvSettings`)
Trigger: full-width left-aligned text button (12px/0.14em/#5a5a5a, `padding:16px 0 0`, hover #fff): `ADVANCED SETTINGS →` closed / `ADVANCED SETTINGS — COLLAPSE` open.
Intro line (sentence case, 12px/#9a9a9a): `Changes here are written to the brain journal.`
Then a 2-col grid (gap 8) of panels (same frame/header pattern; **sub-row dividers here are the finer `1px solid #4a4a4a`**):

**`INPUTS`** (span 2). Header right side: green dot (8px, `background:#43d17a;border-radius:50%`) + `5 / 5 INPUTS LIVE` (#43d17a). Rows (each `padding:10px 14px;border-bottom:1px solid #4a4a4a`; title #fff/500/0.06em 12px; helper sentences 12px/#9a9a9a):
1. `ODDS FEED · THE ODDS API` — right cluster: `••••••••8F2C` (#9a9a9a) · button `EDIT` (1px #8f8f8f, 10px/0.1em, padding 3px 8px — inert) · `PLAN 100K / MO` (#9a9a9a/0.08em) · chip `LIVE` (1px solid #43d17a green text 11px/0.1em 2px 8px) · `LAST TICK 41 S AGO` (#9a9a9a/0.08em)
2. `RESULTS FEED` — `SAME KEY · ON` (#fff/500/0.08em). Helper: `Settles every receipt after games end · ~40 credits/day, already in the forecast`
3. `YOUR REPORTS — CONFIRM TAPS + LIMITED? + WHATSAPP REPLIES` — chip `LINKED` (green). Helper: `Channel configured in the WHATSAPP panel. This is the brain's only source of truth about limits.`
4. `REFERENCE TABLES — MARGIN TABLES v2026.07 · DEEP LINKS 16/16 BOOKS` — button `CHECK FOR UPDATES` (inert). Helper: `Ships with the app; updates rarely.`
5. `BRAIN MEMORY` — `4,182 RECEIPTS · 47 JOURNAL ENTRIES · GROWING` (#fff/500/0.08em). Helper: `Backups live in the DATA panel.`
Footer (12px/#9a9a9a, padding 10px 14px): `Inputs in, picks out. The brain never reads news, injuries, or stats — prices only.`

**`MY BOOKS`** — rows (flex space-between, padding 8px 0, `border-bottom:1px solid #4a4a4a`, 12px; name #fff/500; sport 0.08em):
- `Pinnacle` — `ANY` (#9a9a9a) — chip `SHARP — ALWAYS ON` (1px solid #fff, white, 10px/0.08em, 2px 8px, nowrap)
- `Coolbet` — `HOCKEY ▾` (#fff) — chip `ON` (1px solid #43d17a, 10px/0.1em, 2px 10px)
- `DraftKings` — `BASEBALL ▾` — `ON`
- `BetMGM` — `FOOTBALL ▾` — `ON`
- `1xBet` — `MMA ▾` — `ON`
- `Bet365` (row fully greyed #9a9a9a) — `SOCCER ▾` — chip `OFF` (1px #8f8f8f, #9a9a9a)
- Text button `+ ADD BOOK` (12px/0.14em/#5a5a5a — inert). (Sport dropdowns `▾` are static text.)

**`SPORTS & LEAGUES`** — 2-col grid (gap 8, 12px/0.08em): enabled #fff `✓ NHL` `✓ NBA` `✓ MLB` `✓ NFL` `✓ CFL` `✓ EPL` `✓ ATP / WTA` `✓ UFC`; disabled #5a5a5a `✗ NCAA` `✗ LA LIGA`. Helper (12px/#9a9a9a): `More leagues = more credits. The forecaster updates live.`

**`EDGE THRESHOLDS & FRESHNESS`** — stepper rows (same stepper visual as §5.2, all four **inert** in mockup):
- `MIN ARB MARGIN` — `0.75%`
- `MIN EV EDGE` — `2.0%`
- `MIN MIDDLE QUALITY` — `1.5× BREAKEVEN HIT RATE`
- `FRESH WINDOW` — `120 S`
Helper: `Verified cards count down from this before turning STALE.`

**`REFERENCE PRICER FALLBACK`** — label `IF THE ANCHOR GOES DOWN` (11px/0.12em/#9a9a9a); radio list (static text, grid gap 8, 12px):
- `● FALL BACK TO CONSENSUS (DEFAULT)` (#fff)
- `○ PAUSE EV + MIDDLES, ARBS CONTINUE` (#9a9a9a)
- `○ PAUSE EVERYTHING` (#9a9a9a)
Helper: `The anchor itself is switched on the Brain tab. Switching starts a new measurement series — it never mixes rulers.`

**`ACCOUNT SAFETY RULES`** — header includes inline `□ EDITABLE WHILE GREEN` (#9a9a9a/400). Rows:
- `SHARP VELOCITY CAP` — `3 / DAY / BOOK`
- `MARKET BREADTH CAP` — `2 / MARKET / BOOK / WEEK`
- `ONE-SPORT RULE` — `ON`
- `GO GENTLE AT` — `HEAT 30` (**#F5D90A**)
- `STOP AT` — `HEAT 60` (**#e0442c**)
- `DEFAULT QUIT RULE` — `"RETIRE ACCOUNT AFTER 2 STAKE CUTS IN 14 DAYS"` (right-aligned)
Helper: `Locked while any book is amber or red — you set these when calm.`

**`STRATEGY KILL RULES + JOURNAL`** (span 2) — header inline `□ EDITABLE WHILE PASSING`. Rows:
- `ARB DIES IF` — `CONFIRMED MARGIN < 60% OF QUOTED OVER 50 PAIRS`
- `EV DIES IF` — `CLOSING PRICE EDGE ≤ 0 AFTER 300 PICKS`
- `MIDDLE DIES IF` — `LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS`
Helper: `A strategy on watch locks its own rule.`
Then a `border-top:1px solid #8f8f8f` sub-section: stepper row `JOURNAL MINIMUM` — `1 / DAY` with − / + (inert). Helper: `The brain always writes at least this many entries and as many more as it wants.`

---

## 6. INTERACTION CATALOGUE (complete)

All handlers live in the inline `data-dc-script` in the HTML. Live/functional in the mockup:

| Control | Handler / state | Behavior |
|---|---|---|
| Nav chips | `navTabs[].onClick` → `state.tab` | switches screen; active chip filled white |
| Mode badge | `liveMode` prop only | SIMULATED (yellow) / LIVE (white); not clickable |
| CONFIRM | `t.confirm` → `confirmed[i] = (n+1)%3` | CONFIRM → CONFIRMED ✓ (green) → UNCONFIRM? (yellow) → CONFIRM |
| TRADE LIMITED? | `t.toggleLimited` → `limitedOpenId` | opens/closes inline panel (one at a time; resets book/amount/armed); button inverts while open |
| Book chips | `b.onClick` → `limitedBooks` | strict single-select; re-click deselects |
| Max-bet input | `setLimitedMax` → `limitedMax` | enables send when it contains any digit |
| Send button | `t.sendLimited` + `sendArmed` | disabled(grey) → ✓ SEND TO MODEL(white) → click → CONFIRM? ✓(yellow) → click → prepend to `limitsLog`, close panel |
| VIEW ALL TRADES | `toggleViewAll` → `viewAllOpen` | shows ALL TRADES + HISTORY boxes; CTA greys #6a6a6a |
| List controls | `listControls('allTradesView'/'historyView')` | 5 → VIEW MORE → (15) → VIEW LESS / VIEW ALL (18) → all |
| Graveyard toggle | `toggleGraveyard` → `graveyardOpen` | `▸ 7 KILLED TODAY` ↔ `▾ 7 KILLED TODAY`; reveals kill list |
| REFERENCE PRICER tile | `cycleAnchor` → `anchorIdx` | cycles PINNACLE ▾ / CIRCA ▾ / CONSENSUS ▾ |
| Site rows | `s.select` → `selectedSite` | highlights row (3px white left bar + #161616 bg + ` ◂` suffix), swaps detail panel |
| Sites expander | `toggleSites` → `allSites` | `+ 11 MORE SITES` ↔ `− SHOW FEWER SITES` (5 ↔ 16 rows) |
| Journal expander | `toggleJournal` → `journalOpen` | `SHOW ALL 47 ENTRIES →` ↔ `SHOWING ALL — COLLAPSE` (+2 rows) |
| ADVANCED BRAIN SETTINGS | `toggleBrainSettings` → `brainSettingsOpen` | pink panel; CTA greys; **this tab only** |
| EDIT MODEL | `toggleModelRoom` → `modelRoomOpen` | `EDIT MODEL →` ↔ `CLOSE MODEL ←`; button fills pink while open; reveals boiler room |
| Profile dropdown | `toggleProfileMenu`, `profileMenu[].onClick` → `curProfile` | select profile (● prefix on current); FUND START box follows |
| + ADD NEW PROFILE | `startAddProfile` → `addingProfile` | opens inline form, closes menu |
| Create profile | `setNewProfName` / `setNewProfAmt` / `createProfile` | button grey until name + digit; formats `$X,XXX`; date `JUL 14 2026`; selects new profile |
| Range chips | `rangeTabs[].onClick` → `range` | visual active state only (charts static); default 30D |
| Sort toggle | `advSortTabs[].onClick` → `advLbSort` | re-sorts the 3 opportunity boards by COUNT or avg MARGIN/EDGE desc |
| ADVANCED ANALYTICS | `toggleAdvanced` → `advancedOpen` | blue sections; CTA greys |
| Stale stepper | `decStale` / `incStale` → `staleRemoveMin` | `10 MIN` default; − floor 1; + unbounded |
| WhatsApp number | `setWaNumber` → `waNumber` | editable; default `+1 604 555 8112` |
| ADVANCED SETTINGS | `toggleAdvSettings` → `advSettingsOpen` | `ADVANCED SETTINGS →` ↔ `ADVANCED SETTINGS — COLLAPSE` |

**Inert in the mockup** (rendered as interactive-looking, no handler — the real app must implement them): `REFRESH?` chip · leg buttons (deep links) · `+ ADD DATA SOURCE` · `SEE ALL →` · `MAY 01 2026 ▾` since-date chip · `UPDATE UNDERSTANDING` · `SEND TEST MESSAGE` · `EXPORT CSV` / `EXPORT JSON` · `EDIT` (API key) · `CHECK FOR UPDATES` · `+ ADD BOOK` · book sport `▾` dropdowns · SPORTS & LEAGUES toggles · the four EDGE THRESHOLDS steppers · JOURNAL MINIMUM stepper · strategy-mix sliders · KILL SWITCH chip · DATA MODE badge · radio list.

**Vestigial state** (returned by `renderVals()` but never rendered): `analyticsTabs` (yellow-underline PROFILE tab style), `showOpenBets` / `showLeaderboards` / `showCost`, `aTab`.

---

## 7. FORMULAS & HOW DEMO NUMBERS RELATE

### 7.1 Formulas that exist (displayed as the boiler-room spec, §3.8)
- **ARB margin**: `inv_sum = Σ 1/odds_i` over 2 or 3 legs; `arb_margin = 1 − inv_sum`; passes if > 0.75% (SETTINGS: MIN ARB MARGIN).
- **EV edge**: de-vig the reference pricer's two-sided quote: `fair_prob = (1/pin_a) / (1/pin_a + 1/pin_b)`; `ev_edge = fair_prob × book_odds − 1`; passes if > 2.0% (MIN EV EDGE).
- **Staking (Kelly)**: `kelly_frac = 0.25`; `stake = bankroll × kelly_frac × ev_edge / (book_odds − 1)`; then `round_to(min(stake, 0.05 × bankroll), $5)`; bankroll = the ONE total bankroll ($10,000); min stake $10 per MASTER PROMPT/RISK panel.
- **Verification tolerance gate**: `retention = edge_recheck / edge_first`; `promote if retention >= 1 − tolerance` (tolerance default 5%, user-set 0–100%).

### 7.2 MIDDLE edge / "middle 1.5×" — NO formula exists in the mockup
There is **no middle math anywhere** in the HTML or support.js. The only definition is the SETTINGS threshold `MIN MIDDLE QUALITY: 1.5× BREAKEVEN HIT RATE` — i.e. a middle qualifies when its estimated probability of landing in the middle window is at least 1.5× the breakeven hit rate (the hit rate at which the middle's win-both payoff exactly covers the guaranteed one-leg loss). The MIDDLE card's `EDGE: +4.6%` and every other middle EDGE value in the demo are **hardcoded strings with no derivation**. The implementation must define this math itself (and the strategy kill rule grades middles by *leg closing edge*, not window math: `MIDDLE DIES IF LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS`).

### 7.3 Are the demo numbers computed? NO — all hardcoded, and several don't satisfy the formulas
- Every card metric, stake, chart point, table cell, and tile value is a **literal string in the demo state**. Nothing on screen is computed from odds (only the two list sorts and the m:ss timers are computed).
- **The live-trace arithmetic is internally wrong**: it prints `arb_margin = 1 − 0.8996 = 2.5%`, but 1 − 0.8996 = 0.1004 → **10.0%**, and the card shows `MARGIN: 2.5%`. The odds 3.10/3.65/3.30 genuinely imply a 10% arb. Trust the formula, not the sample numbers.
- Same for the pending ARB (2.10/2.06 → true margin 3.84%, card says 2.4%) and most ALL TRADES rows.
- **ARB stakes $35/$30/$33 DO follow a consistent scheme**: total ≈ $100 (the FLAT PAIR STAKE / demo total $98) split for equal payout, `stake_i ∝ 1/odds_i`, rounded to $5 (98 × 0.3226/0.8996 ≈ $35, × 0.2740/0.8996 ≈ $30, × 0.3030/0.8996 ≈ $33; payouts ≈ $109 each). History's ARB/MIDDLE `$50/$50` pairs = flat pair $100 on ~even odds.
- **The EV stake does NOT match the Kelly formula**: edge +2.8% @ 2.15 with $10,000 bankroll gives 10000×0.25×0.028/1.15 ≈ **$60**, but the card says `BET $20 ↗`. Hardcoded.

---

## 8. MOCKUP ↔ MASTER PROMPT DISCREPANCIES (and internal demo inconsistencies)

1. **"CLV" appears on screen.** MASTER PROMPT hard rule 6 bans showing the word "CLV" (say "closing price edge"), but ADVANCED ANALYTICS has a tile literally headed `CLV VS PINNACLE CLOSE`. The Brain tile correctly says `CLOSING PRICE EDGE`. Decide: rename the tile (rule) or copy the mockup (visual truth). Recommend renaming to honor the hard rule.
2. **Tolerance-gate numbers conflict.** Boiler room + MASTER PROMPT: promote if retention ≥ 1 − tolerance, default tolerance 5% (i.e. threshold 95%). But COST OF SAFETY says `PROMOTION THRESHOLD 80%` and graveyard kills show 58%/61% retention — consistent with a 20% tolerance, not 5%. Demo copy inconsistency; the 5% default is the locked rule.
3. **Trace arithmetic is wrong** (`1 − 0.8996 = 2.5%`, actually 10.0%) and card metrics generally don't follow from the shown odds (§7.3). Implementations must compute from the formulas; do not port the demo numbers as test expectations against those odds.
4. **EV stake $20 vs Kelly ≈ $60** (§7.3).
5. **Pending cards show metric boxes.** MASTER PROMPT rule 1 says pending cards show "book + selection + odds only", but the mockup's pending cards also show the tinted `MARGIN:`/`EDGE:` box (no stakes, though). Mockup is visual truth: keep the metric box.
6. **ALL TRADES has no column-header row.** MASTER PROMPT lists columns "CAT · EVENT · LEGS · METRIC · STATUS"; the mockup renders data rows only.
7. **REFRESH? is inert and is a chip, not a functioning button**; also FRESH hitting 0:00 does not auto-flip to STALE in the mockup — the real app must implement both (FRESH counts down from FRESH WINDOW 120 S; STALE counts up; stale verified trades auto-remove after the SCAN RULES stepper value, default 10 min).
8. **Sky @ Fever appears twice with different identities**: ALL TRADES row 13 says `ARB … KILLED — ROUNDING`; graveyard says `EV · Sky @ Fever — FAILED_VERIFICATION (58% RETENTION)`. Also `Canadiens @ Senators` is in the graveyard but not in ALL TRADES. Demo filler mismatch — harmless.
9. **EV grade 37 vs journal "grade cut to 31"** (journal JUL 10 entry). Demo filler mismatch.
10. **Journal shows 6 entries but the toggle says 47** (and SETTINGS BRAIN MEMORY agrees: `47 JOURNAL ENTRIES`). The 47 is intended total, list is truncated demo data.
11. **Two greens.** Spec names only #43d17a; the mockup additionally uses #37c86f for won-money text, history CONFIRMED chips, and RETURN/ANNUALIZED. Preserve both.
12. **`NEXT SCAN JUL 13 · 10:47 PM` is static** in the mockup; MASTER PROMPT implies a live status. (All other timers tick.)
13. **MASTER PROMPT says the limited-flow log goes "to Advanced Analytics + Brain updated"** — the mockup implements the Analytics log prepend only (Brain heat/journal are static demo data).
14. **The task brief said demo values live in support.js — they don't.** support.js is a generic runtime; all demo state/handlers are the inline `data-dc-script` in the HTML.
15. Minor one-offs to reproduce or normalize: live card 2 has `padding:18px 14px` (vs 12px); pending EV card and stacked cards use `border-top:none` joins; WhatsApp input focus is yellow while every other input focuses white.
