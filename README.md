# EVIL EYE ARBITRAGE 👁

A sports-betting arbitrage finder. On demand — one button, never on a timer —
it scans live odds across bookmakers via [The Odds API](https://the-odds-api.com),
finds outcome sets whose best prices disagree enough to guarantee profit, and
shows exactly how to split a $100 stake across books.

**Odds comparison and information tool only.** It does not place bets,
automate betting, or touch bookmaker accounts.

## Setup

Requires Node 18+ (built and tested on Node 26).

```bash
npm install            # installs server + client workspaces
cp .env.example .env   # optional — the app runs in mock mode without it
npm run dev:server     # Express API on http://localhost:8787
npm run dev:client     # Vite dev server on http://localhost:5173  (second terminal)
```

Open http://localhost:5173 and press **Run scan**.

### Getting an API key

Sign up at https://the-odds-api.com (free tier: 500 credits/month). Put the
key in `.env` as `ODDS_API_KEY=...` and restart the server. With no key (or
`ODDS_API_KEY=mock`) the server uses `MockOddsProvider` — fixture data with a
real 2-way arb, a real 3-way arb, a same-book arb, a suspicious >15% arb, and
efficient markets, so every UI state is demo-able for free. The usage panel
shows a "mock data" chip so you can't mistake fixtures for live odds.

The key lives only in the server process. The browser talks to
`/api/*`; the Express server proxies The Odds API and never echoes the key.

## The credit / cost model

The Odds API bills in **request credits**, not calls:

- `GET /v4/sports` (the catalogue) is **free**
- `GET /v4/sports/{sport}/odds` costs **markets × regions** credits — with the
  default 1 market (`h2h`) × 2 regions (`us,eu`), each sport scanned costs 2 credits

Every response carries `x-requests-used` / `x-requests-remaining` headers. The
server sums the computed per-call cost **and** cross-checks it against the
header delta; both appear in the usage panel, along with an estimated dollar
cost:

```
estimated $ = credits_used × (PLAN_MONTHLY_PRICE / PLAN_MONTHLY_CREDITS)
```

Edit `PLAN_MONTHLY_PRICE` / `PLAN_MONTHLY_CREDITS` in
`server/src/config/constants.ts` to match your tier. Markets live in the same
file; regions are owned by the region tabs (below).

Last-scan metadata (timestamp, credits, account totals) persists to
`server/data/last-scan.json` so the usage panel survives refreshes and
restarts. No database.

## Region tabs (Canadian accessibility)

The Odds API has no `ca` region, so Canadian coverage works in two layers
(`shared/regionTabs.ts`):

1. **Pre-call, credit efficiency** — each tab requests only the minimal API
   regions containing its books. Regions multiply every call's cost, so this
   is the spend dial:

   | Tab | API regions | Credits/sport | Adds |
   | --- | --- | --- | --- |
   | Canada | `eu,uk` | 2 | Ontario-licensed & Canada-friendly books (bet365, Pinnacle, Coolbet, Betway, BetVictor, LeoVegas…) |
   | Canada + USA | `us,eu,uk` | 3 | US brands with Ontario platforms (FanDuel, DraftKings, BetMGM, Caesars, BetRivers) |
   | Canada + EU Intl | `eu,uk` | 2 | International books accepting Canadians (1xBet, Marathon Bet — grey market, verify locally) |

2. **Post-call, correctness** — before arbitrage detection, every response is
   filtered to the tab's allowlist of bookmakers a Canadian can register at
   with Canadian ID (`server/src/engine/bookmakerFilter.ts`). Filtering
   happens *before* best-odds selection, so no arb leg can ever point at an
   inaccessible book.

The allowlists are best-effort config, not legal advice — books enter and
leave the Canadian market constantly, so verify before relying on one, and
edit the lists freely in `shared/regionTabs.ts`.

## The slider → breadth mapping

Credits are spent per **sport scanned**, not per result returned, so the
Top-N slider controls spend by controlling breadth
(`server/src/engine/sportSelection.ts`):

- In-season sports are ranked by `SPORT_PRIORITY` (soccer leagues, NBA, NFL,
  MLB, NHL, tennis first — the liquid, arb-rich markets)
- Slider = 1 → scan the top ~3 sports (cheapest, narrowest)
- Slider = 10 → scan everything in season (deepest, costliest)
- In between → linear interpolation
- The final result list is *also* sliced to N

## The arbitrage math

For each event and market (`server/src/engine/arbitrage.ts` — pure, zero
framework imports, fully unit-tested):

1. Take the best (highest) decimal odds per outcome across all bookmakers
2. Arbitrage index `S = Σ 1/best_odds_i`
3. `S < 1` → guaranteed profit of `(1/S − 1) × 100`%
4. Stake split for $100: `stake_i = 100 × (1/odds_i) / S` — every leg then
   pays out the same `100/S` regardless of result

Point-based markets (spreads/totals) are handled by **line grouping**: the
engine only combines outcomes whose lines mirror each other (Over/Under 220.5
together, −3.5 with +3.5 — grouped by |point|). Over 219.5 + Under 221.5 has
S < 1 numerically but both bets lose when the total lands between the lines,
so lines are never mixed. Each line of a market is priced independently.

Edge handling: events already commenced are dropped as stale; single-outcome
markets can't fake an arb; ties at the best price prefer distinct bookmakers;
arbs where one book holds every best price get a **same book** warning badge;
arbs above ~15% profit are flagged **too good — verify** (usually stale or
errored odds) rather than presented uncritically.

## Bookmaker configuration

The **Bookmakers** panel lists every book the odds feed has ever carried —
the registry populates itself from scans, nothing is hardcoded. Per book you
can set:

- **Enabled** — disabled books are excluded from fetching and detection
  entirely. Bonus: when the enabled allowlist is small enough, the scan
  fetches by book list instead of by region (The Odds API bills every 10
  books as one region-equivalent), which makes scans cheaper — with ≤10
  enabled books the default Canada tab halves its odds-call credits.
- **Status** — `active` / `limited` / `dead`. Limited and dead books stay
  visible in results with a ⚠ badge on the affected leg, but opportunities
  touching them are never sent as WhatsApp alerts and shouldn't be staked.
- **Balance** — manually-tracked bankroll per book (used by stake
  suggestions in a later phase).
- **Notes** — anything worth remembering ("stake capped at $50").

Caveat, by design: while the book-list fetch is active the feed only
contains those books, so brand-new books won't be discovered until a scan
runs by regions (e.g. after enabling more books). Region tabs remain the
outer accessibility boundary — book config refines them, never widens them.

## Opportunity persistence

Every detected opportunity becomes a durable record with a stable ID —
`sha256(event + market + legs)` truncated to 16 hex chars — so re-detections
across scans update one record instead of duplicating it. Records live in
`server/data/opportunities.json` and carry lifecycle status:

- **active** — created on detection; re-detections refresh odds/profit and
  revive dead records (detection-time profit is kept separately).
- **dead** — its sport was rescanned on the same region tab and the
  fingerprint is gone, or the event has commenced. Scans that didn't cover
  the record (other tab, other sports) say nothing.
- **degraded** / **completed** — reserved for the execution cockpit's
  re-verify and leg-tracking (next phase); scans alone can't set them.

Records also track whether a WhatsApp alert was actually sent (`alerted`),
feeding the capture-rate math in the P&L phase. Dead/completed records move
to append-only monthly archives (`server/data/opportunity-archive/*.jsonl`)
after 7 days. Read them back via `GET /api/opportunities?status=active` or
`GET /api/opportunities/:id`.

Each scan also saves its **raw pre-filter snapshot** to
`server/data/last-snapshot.json` (latest only) so later features can
recompute opportunities against arbitrary bookmaker subsets without another
paid API call.

## WhatsApp alerts

Connect a phone number in the UI ("WhatsApp alerts" panel) and the server
messages you whenever a scan finds an opportunity at or above your chosen
minimum return. Alerts ride on the scans you already run — the manual button
or auto update — the server never scans (or spends credits) on its own.

The flow: enter your number and threshold → a 6-digit code arrives on
WhatsApp → confirm it → alerts are live. Codes are stored hashed, expire in
10 minutes, and allow 5 attempts. Once connected you can edit the threshold,
send a test message, or disconnect.

Safety rails, all tunable in `config/constants.ts`:

- **Dedup/debounce** — an opportunity is fingerprinted by event + market +
  legs; you're alerted once per fingerprint, so a return wobbling
  2.31% → 2.34% never re-alerts. Sent records age out after 7 days.
- **Rate limit** — max 10 alerts per hour; excess is dropped and logged.
- **Failure handling** — after 3 consecutive send failures the subscription
  pauses itself; a successful "Send test" re-enables it.
- Suspicious (>15%) and same-book arbs stay in the UI but are never pushed.

### Dev mode (no Twilio account needed)

With no `TWILIO_*` variables set — or with `WHATSAPP_DEV_MODE=true` — the
server logs every would-be message to its console instead of sending. The
panel shows a **dev mode** chip. Grab the verification code from the server
log to complete the connect flow.

### Real messages via the Twilio sandbox (free)

1. Sign up at https://www.twilio.com and open the console.
2. Copy the **Account SID** and **Auth Token** (Console → Account Info) into
   `.env` as `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`.
3. Activate the WhatsApp sandbox: **Messaging → Try it out → Send a WhatsApp
   message**. Twilio shows a shared sandbox number (e.g. `+1 415 523 8886`)
   and a join code like `join yellow-lion`.
4. From your phone, WhatsApp the join code to the sandbox number. You're now
   allowed to receive sandbox messages for 72 h (re-send the join code to
   renew).
5. Put the sandbox number in `.env` as `TWILIO_WHATSAPP_FROM=+14155238886`,
   set `WHATSAPP_DEV_MODE=false`, restart the server — the startup log should
   say `WhatsApp: Twilio configured`.
6. Connect your number in the UI, confirm the code that arrives on WhatsApp,
   then press **Send test**.

The sandbox is enough for personal use. Going to production (your own number,
no join-code ritual, messages outside the 24 h session window) requires a
Twilio-approved WhatsApp sender and message templates.

## Architecture

```
shared/types.ts                     domain types used by both sides
shared/regionTabs.ts                region tabs: API regions + CA-accessible books
server/src/                         (imports shared/ via the @shared alias)
  engine/                           pure logic — no Express imports
    arbitrage.ts                    the arb detector, line-group aware (+ tests)
    bookmakerFilter.ts              post-call accessibility filter (+ tests)
    creditCost.ts                   credit → dollar math (+ tests)
    sportSelection.ts               slider → breadth mapping (+ tests)
  providers/
    OddsProvider.ts                 the adapter interface + typed errors
    TheOddsApiProvider.ts           live adapter (headers, links, error mapping)
    MockOddsProvider.ts             fixture adapter for keyless demos
  scan/
    scanRequest.ts                  request validation — new scan options start here (+ tests)
    scanService.ts                  orchestrates catalogue → odds → engine → usage (+ tests)
    scanStore.ts                    file persistence for last-scan metadata
    snapshotStore.ts                latest raw snapshot for offline recomputation
  bookmakers/
    bookmakerStore.ts               registry persistence (self-populates from the feed)
    effectiveBookmakers.ts          fetch plan + alertable rules, pure (+ tests)
    bookmakerService.ts             façade for scans, routes, alerts (+ tests)
    bookmakerRequests.ts            PATCH validation (+ tests)
  opportunities/
    opportunityId.ts                fingerprint identity (shared with alert dedup)
    opportunityLifecycle.ts         pure status transitions per scan (+ tests)
    opportunityService.ts           recordScan / markAlerted / get / list (+ tests)
    opportunityStore.ts             active JSON file + monthly JSONL archive
  lib/jsonStore.ts                  generic crash-safe serialized JSON store
  notifications/
    whatsappSender.ts               WhatsAppSender interface: Twilio (fetch) + console dev mode
    alertService.ts                 threshold match, fingerprint dedup, rate limit (+ tests)
    verification.ts                 6-digit codes: hash, expiry, attempts (+ tests)
    subscriptionStore.ts            file persistence for subscriptions + sent alerts (+ tests)
    whatsappRequests.ts             request validation, E.164 normalize/mask (+ tests)
  routes/api.ts                     POST /api/scan, GET /api/last-scan
  routes/whatsapp.ts                /api/whatsapp: status, connect, verify, threshold, test, disconnect
  routes/bookmakers.ts              GET /api/bookmakers, PATCH /api/bookmakers/:key
  routes/opportunities.ts           GET /api/opportunities[?status=], GET /api/opportunities/:id
  config/constants.ts               every tunable knob
  config/bookmakerLinks.ts          homepage fallbacks when the API sends no link
client/src/                         React + Vite, plain CSS, no UI framework
```

The `@shared/*` alias is declared twice — `server/tsconfig.json` (tsc + tsx)
and `server/vitest.config.ts` (vitest doesn't read tsconfig paths). Keep them
in sync.

Run the tests: `npm test` (118 Vitest cases covering 2-way/3-way arbs, totals
and spreads line grouping, no-arb markets, stake splits, same-book and
suspicious flags, stale filtering, ties, credit math, the slider mapping, the
bookmaker accessibility filter, request validation, scan orchestration
including partial-failure handling, and the WhatsApp alert pipeline —
verification codes, fingerprint dedup, rate limiting, failure deactivation,
store serialization).

## How to extend

**Add a market (spreads/totals):** add the key to `MARKETS` in
`constants.ts` — done. The scan service threads the market list to both the
provider fetch and the engine, the provider maps each outcome's `point`, and
the engine groups outcomes by line before pricing (see "line grouping"
above). Exception: alternate-line markets (`alternate_spreads`, …) need real
pairing logic — flipped pairs currently land in one |point| group and are
safely skipped rather than priced.

**Add a scan option (min profit, market picker, …):** validate it in
`server/src/scan/scanRequest.ts`, consume it in `scanService.ts`, send it
from `client/src/api.ts`. Routes and the engine need no structural changes —
`findArbitrageOpportunities` already takes `minProfitPct`,
`suspiciousProfitPct`, `topN`, and `marketKeys` options.

**Add a provider:** implement `OddsProvider` (two methods:
`listSports`, `fetchOdds`) in `server/src/providers/`, map your source's wire
format to the shared types, throw `ProviderError` with the right code for
auth/quota/network failures, and swap it in at `server/src/index.ts`. Engine
and UI need no changes.

## API errors surfaced in the UI

| Cause | Code | UI behavior |
| --- | --- | --- |
| Bad `ODDS_API_KEY` | `invalid_api_key` (401) | "Check ODDS_API_KEY in your .env" |
| Credits exhausted | `quota_exhausted` (429) | "Wait for reset or upgrade the plan" |
| Network down | `network` (502) | "Check your connection…" |
| Anything else | `provider_error` / `internal` | Retry hint + server logs |

One failing sport doesn't sink a scan — it's listed in `sportsFailed` and the
scan proceeds; only a total failure surfaces as an error.
