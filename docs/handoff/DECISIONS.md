# Evil Eye V2 — design project notes

## Master prompt notes (accumulate these; user will ask for a full "master prompt" to code the real app later)

1. **No prices/stakes until verification.** Pending-verification cards show only book + selection + odds (no stake suggestions). The moment a bet passes verification (promoted to VERIFIED LIVE), the app recommends exact amounts to bet and shows prices per leg ("BET $35 ↗" style).
2. **Line-move tolerance gate (pending → verified).** Default: edge/margin may weaken by up to 5% (relative) between first sighting and the verification recheck and still be promoted. This tolerance is user-configurable in SETTINGS from 0% to 100% — 100% means the edge can get up to twice as weak and still be accepted. Exposed in SETTINGS as "LINE MOVE TOLERANCE" (RISK & BANKROLL panel).

## Other locked-in product decisions (from chat)
- No "skip" feature anywhere (no skip reply code, no SKIPPED status).
- Bankroll is one total amount ($10,000 CAD), not per book. Kelly fraction/cap measured against total bankroll.
- No PROMO strategy (removed from strategy mix).
- Trades cards: metric box bottom-right — ARB = "MARGIN: X%" (green tint), MIDDLE/EV = "EDGE: +X%" (yellow tint). Legs are stacked buttons (one per line) that will eventually deep-link to the bet.
- Freshness: FRESH counts down; STALE counts up + white translucent REFRESH? button. No "EXPIRING" label.
- Soccer arbs can have 3 legs (home/draw/away).
- WhatsApp settings include user's phone number input.
- Tabs: TRADES · BRAIN · ANALYTICS · SETTINGS. Sim mode badge top-right.
