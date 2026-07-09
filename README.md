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

Edge handling: events already commenced are dropped as stale; single-outcome
markets can't fake an arb; ties at the best price prefer distinct bookmakers;
arbs where one book holds every best price get a **same book** warning badge;
arbs above ~15% profit are flagged **too good — verify** (usually stale or
errored odds) rather than presented uncritically.

## Architecture

```
shared/types.ts                     domain types used by both sides
shared/regionTabs.ts                region tabs: API regions + CA-accessible books
server/src/
  engine/                           pure logic — no Express imports
    arbitrage.ts                    the arb detector (+ tests)
    bookmakerFilter.ts              post-call accessibility filter (+ tests)
    creditCost.ts                   credit → dollar math (+ tests)
    sportSelection.ts               slider → breadth mapping (+ tests)
  providers/
    OddsProvider.ts                 the adapter interface + typed errors
    TheOddsApiProvider.ts           live adapter (headers, links, error mapping)
    MockOddsProvider.ts             fixture adapter for keyless demos
  scan/
    scanService.ts                  orchestrates catalogue → odds → engine → usage
    scanStore.ts                    file persistence for last-scan metadata
  routes/api.ts                     POST /api/scan, GET /api/last-scan
  config/constants.ts               every tunable knob
  config/bookmakerLinks.ts          homepage fallbacks when the API sends no link
client/src/                         React + Vite, plain CSS, no UI framework
```

Run the tests: `npm test` (31 Vitest cases covering 2-way/3-way arbs, no-arb
markets, stake splits, same-book and suspicious flags, stale filtering, ties,
credit math, the slider mapping, and the bookmaker accessibility filter).

## How to extend

**Add a market (spreads/totals):** add the key to `MARKETS` in
`constants.ts`. The engine already iterates `marketKeys` and prices any
outcome set; point-based markets need matching by point value too — extend
`evaluateMarket` to group outcomes by `(marketKey, point)` before comparing.

**Add a provider:** implement `OddsProvider` (two methods:
`listSports`, `fetchOdds`) in `server/src/providers/`, map your source's wire
format to the shared types, throw `ProviderError` with the right code for
auth/quota/network failures, and swap it in at `server/src/index.ts`. Engine
and UI need no changes.

**Add a filter:** `findArbitrageOpportunities` takes options
(`minProfitPct`, `suspiciousProfitPct`, `topN`, `marketKeys`) — thread a new
option from `scanService.ts`, or filter the returned list there and expose it
in the request body of `POST /api/scan`.

## API errors surfaced in the UI

| Cause | Code | UI behavior |
| --- | --- | --- |
| Bad `ODDS_API_KEY` | `invalid_api_key` (401) | "Check ODDS_API_KEY in your .env" |
| Credits exhausted | `quota_exhausted` (429) | "Wait for reset or upgrade the plan" |
| Network down | `network` (502) | "Check your connection…" |
| Anything else | `provider_error` / `internal` | Retry hint + server logs |

One failing sport doesn't sink a scan — it's listed in `sportsFailed` and the
scan proceeds; only a total failure surfaces as an error.
