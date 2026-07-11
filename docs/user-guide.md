# Evil Eye Arbitrage — operator's guide

How to actually run the machine, day to day. Written for the one user it
has. The app finds guaranteed-profit odds spreads and tracks whether
acting on them makes money — it never places bets or touches bookmaker
accounts.

## 0 · Start it

```bash
cd ~/evil-eye-arbitrage
npm run dev:server     # Express :8787 — reads .env, LIVE if ODDS_API_KEY is set
npm run dev:client     # Vite :5173 — the app
```

Open http://localhost:5173. Free playground mode (fixture odds, zero
credits, WhatsApp to console): `DEV_MODE=true npm run dev:server`.

One-time `.env` additions for the real loop:

```
TWILIO_ACCOUNT_SID=…      TWILIO_AUTH_TOKEN=…      TWILIO_WHATSAPP_FROM=…
APP_URL=http://localhost:5173      # what alert deep links point at
```

Without Twilio, alerts print to the server console (dev mode) — the app
still works, your phone just doesn't buzz.

## 1 · First-evening setup (10 minutes, do once)

1. **Fund position** (scanner page): set total bankroll, default
   per-opportunity stake (this is what alerts quote in dollars), and
   unallocated cash.
2. **Bookmakers panel**: for every book you hold money at, enter the
   balance. This drives the stake caps, the low/stale-balance warnings,
   and the feed-coverage audit. Disable books you can't use; mark
   limited/dead ones (they stay visible but never alert).
3. **WhatsApp panel**: enter your number + minimum return %, confirm the
   6-digit code (dev mode: read it from the server console).
4. **Ledger page → Paper fund**: flip **Paper mode ON**. From now on
   every alert-worthy opportunity enters the simulated book
   automatically. Leave haircut on "assumed 20%" — switch it to
   "measured" after a couple of weeks when survival data qualifies.
5. **Scanner → windows & budget**: check the scan windows (weekday
   18:30–22:30, weekend 12:00–22:30, every 5 min inside) and the monthly
   credit budget (20,000 ≈ the $30 plan). Then flip **Auto update ON**.

The mode line tells you what's happening at all times:
`IN WINDOW — next scan 0:47` · `OUT OF WINDOW — sleeping` ·
`AUTO-SCAN OFF` · `BUDGET STOP` (auto-scan halted at 95% of budget —
manual scans always work).

**Credits are real money.** Every scan costs ~markets × regions credits
per sport (the UI shows cost before you press). Scans only happen while
the page is open — that's a design invariant, not a bug. Leave the tab
open during your windows.

## 2 · The core loop: alert → cockpit → done

1. **Phone buzzes**: "🔔 New arb: … 3.30% return. Bet365: Arsenal @3 →
   $115.00 / … Stake $400 for +$11.03 guaranteed." Tap the link.
2. **Cockpit opens** (mobile-first). Big number = live profit %. The
   stake box defaults to your fund's default stake; edit it and the legs
   rescale. If a leg says *position rescaled — X's balance is the
   ceiling*, top that book up or accept the smaller position.
3. **Re-verify prices** (~1 credit) — one cheap live fetch of exactly
   your legs. Still live → go; degraded → your call; gone → walk away.
4. Tap **Open [book]** per leg, place the bets at the shown stakes.
5. **Both legs placed — record the fills**: confirm (or correct) the
   actual odds and stakes you got, then **Book it**. This is the moment
   real P&L is born — an unpriced completion counts for capture rate but
   adds $0 to the ledger, forever.
6. **After the event**: reopen the record (Ledger → CSV has ids, or your
   alert link), pick the winning leg, **Apply to balances**. Book
   balances update by exactly the filled amounts; Revert undoes it
   exactly if you fat-fingered.

Flags to respect: **⚠ same book** (both legs one bookmaker — usually a
data quirk, never alerted) and **⚠ too good — verify** (>15% profit is
usually a stale price).

## 3 · The pages

- **Scanner (/)** — RUN SCAN, breadth slider (sports scanned = cost),
  region tabs, cadence mode line, fund position, WhatsApp + bookmaker
  panels, results with per-$100 stakes and Cockpit links.
- **Advanced (/advanced)** — replay the last scan against any book
  subset, free (it's the stored snapshot, not the API). Presets: "All
  enabled", "Funded only", or save your own. Use it to answer "what
  would I see with just my funded books?" without spending a credit.
- **Ledger (/ledger)** — the proof layer, top to bottom:
  - **Proving-month scoreboard**: paper ideal/haircut (SIMULATED), real
    P&L, capture rate, median arb lifetime, median reaction time, credit
    burn vs budget. This is the decision view.
  - **Feed coverage**: whether books you funded actually appear in the
    feed. *FUNDED, NOT IN FEED* means money parked where no odds flow —
    move it or fix the region tab.
  - **Arb survival**: % of arbs still alive one scan later, gone-lifetime
    medians. This is what your edge's shelf life actually is.
  - **Reaction time**: alert → open → re-verify → completed medians.
    If lifetime < reaction, you're structurally too slow — tighten the
    loop before blaming the market.
  - Realized P&L, equity curve, monthly/book/sport tables, edge decay,
    **CSV export** (Excel-safe, one row per opportunity).
  - **Paper fund**: the SIMULATED counterfactual — what acting on 100%
    of alerts instantly would have earned, with a haircut curve for
    realism. Reset it any time; it never touches real numbers.
- **Cockpit (/opportunity/:id)** — see §2.

## 3½ · Risk Mode (yellow — expected value, NOT guaranteed)

The yellow **RISK MODE** tab shows single bets where a soft book's price
beats Pinnacle's de-vigged fair line. Different contract from arbs:
roughly half of these bets LOSE — the edge is statistical.

- The board sorts live edges best-first: offered vs fair, edge %, win
  probability, flat stake (Kelly arrives in the next phase), expected
  profit, benchmark age. Guards up top: show/alert thresholds, max odds
  (longshots are model-error bait), benchmark freshness.
- Tap into the cockpit (yellow variant): place the bet, record the fill,
  and after the event **grade it WON / LOST / VOID** — grading is what
  creates realized P&L. Ungraded bets sit on the ledger's EXPECTED
  (model) line and add $0 to real money, forever.
- EV WhatsApp alerts are OFF by default — flip the "EV alerts" switch in
  the WhatsApp panel to opt in. The messages say "Not guaranteed" and
  mean it.
- No edges showing? Check the Ledger's benchmark-reach audit — sports
  Pinnacle doesn't cover can never produce one.

## 4 · Reading the month (the three numbers)

After 3–4 weeks: **ideal paper curve** (was there money at all?),
**haircut/measured curve** (what a realistic actor keeps), **real
capture rate** (what YOU actually kept). Ideal high + capture low =
latency problem → tune windows/cadence. Ideal flat = surface problem →
the roadmap (Pinnacle merge, +EV) is the answer, not more scanning.
Bring the scoreboard to a strategy session
(`docs/fable-strategy-prompt.md`).

## 5 · Troubleshooting

- **"Out of API credits" / auto-update turned itself off** — quota or key
  problem; auto mode deliberately doesn't retry into it. Fix, flip back on.
- **Alerts not arriving** — check the WhatsApp panel status; dev mode
  prints to the server console; three consecutive send failures
  deactivate the subscription (reconnect re-arms it).
- **Cockpit link says "Nothing on file"** — the record aged into the
  archive (settled >7 days). It's still in the ledger and CSV.
- **Balances look wrong** — every apply-to-balances is exactly
  revertible from the record; the bookmaker panel edits anything.
- **Server logs** are the source of truth for scan/alert/persistence
  warnings — nothing user-facing ever hides a failure silently.
- Sanity checks: `npm test` (245 tests) and `npm run typecheck` from the
  repo root should always be green.
