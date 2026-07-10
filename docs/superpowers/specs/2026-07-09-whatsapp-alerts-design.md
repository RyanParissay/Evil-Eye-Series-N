# WhatsApp Alerts — Design

Approved 2026-07-09. Send a WhatsApp message when a scan finds an arbitrage
opportunity at or above the subscriber's chosen return threshold.

## Decisions

- **Trigger model: piggyback on existing scans.** The alert check runs
  server-side inside `runScan` after opportunities are computed, so it fires
  on every scan — manual button or client auto-scan. The server never
  initiates scans on its own (existing product invariant, credit spend).
  No alerts happen while nothing is scanning; that is accepted.
- **Single-user simplifications.** No auth exists, so subscriptions are keyed
  by phone number (E.164). No database exists, so persistence is one JSON
  file, `server/data/whatsapp.json`, using the `ScanStore` write-then-rename
  pattern. It holds both "tables" from the original spec: subscriptions and
  sent alerts.
- **Provider: Twilio WhatsApp API via plain `fetch`** with Basic auth — no
  npm dependency, matching how `TheOddsApiProvider` does HTTP. Behind a
  `WhatsAppSender` interface so the provider can be swapped. A console
  sender is used when `WHATSAPP_DEV_MODE=true` or credentials are missing.
- **Suspicious and same-bookmaker opportunities are not alerted.** The UI
  still shows them flagged (invariant: flagged, never hidden); pushing
  probably-fake arbs to a phone is spam.

## Modules — `server/src/notifications/`

- `whatsappSender.ts` — `WhatsAppSender { send(toE164, body) }`;
  `TwilioWhatsAppSender` (fetch to
  `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`),
  `ConsoleWhatsAppSender` (dev mode), `senderFromEnv()` factory.
  The auth token is never logged, echoed in errors, or sent to the client.
- `verification.ts` — pure: 6-digit code generation, sha256 hashing,
  10-minute expiry, max 5 attempts.
- `alertService.ts` — selection + orchestration:
  - eligible = verified && active && thresholdPercent <= profitPct
  - skip suspicious / sameBookmaker opportunities
  - dedup via stable fingerprint: sha256 of eventId | marketKey | sorted
    legs (bookmakerKey:outcome:point). Profit is excluded from the hash, so
    return fluctuations never re-alert (the debounce).
  - rate limit: max 10 sends per subscriber per rolling hour; excess dropped
    and logged
  - 3 consecutive send failures → subscription deactivated
  - sent-alert records pruned after 7 days
- `subscriptionStore.ts` — JSON persistence (subscriptions + sentAlerts),
  write-then-rename.
- `whatsappRequests.ts` — request-body validation incl. E.164 normalization
  (mirrors `scanRequest.ts`'s role).

## HTTP — `server/src/routes/whatsapp.ts`, mounted at `/api/whatsapp`

`GET /status`, `POST /connect`, `POST /verify`, `PATCH /threshold`,
`POST /test`, `DELETE /disconnect`. Same error-body shape as the existing
router. The phone number returned by `/status` is masked.

## Scan hook

`ScanDeps` gains optional `notifier`; `runScan` calls it fire-and-forget
after computing opportunities. A notification failure never slows or fails
the scan.

## Client

`WhatsAppPanel.tsx`, three states: disconnected (phone + threshold form) →
code sent (6-digit entry) → connected (masked number, editable threshold,
"Send test message", "Disconnect"). API calls in `api.ts`.

## Config

Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`,
`WHATSAPP_DEV_MODE` — placeholders in `.env.example`. Tunables (rate limit,
code TTL, attempts, prune age) in `config/constants.ts`.

## Tests

Vitest, server workspace: `verification.test.ts`, `alertService.test.ts`
(threshold filter, fingerprint dedup, rate limit, failure deactivation),
store round-trip.
