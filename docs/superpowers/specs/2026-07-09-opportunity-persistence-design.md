# Opportunity Persistence — Design (Buildout Phase 2)

Approved 2026-07-09. Every detected opportunity becomes a durable record
with a stable ID and a lifecycle; each scan also persists its raw snapshot
(Phase 4 groundwork). Storage: JSON active file + monthly JSONL archive
(explicitly chosen over SQLite).

## Identity

`opportunityFingerprint` (sha256 of event + market + legs, profit excluded)
already defines opportunity identity for alert dedup. It moves to
`opportunities/opportunityId.ts` (alertService re-exports it), and
`id = fingerprint.slice(0, 16)` — deterministic, so re-detections across
scans hit the same record; URL-safe for Phase 3's `/opportunity/:id`.

## Record

`OpportunityRecord` (shared/types.ts): id, fingerprint, event fields,
marketKey, legs (latest odds/stakes), profitPctAtDetection, profitPct +
arbIndex (latest), status, suspicious/sameBookmaker, regionTab that
surfaced it, detectedAt / lastSeenAt / statusChangedAt, alerted / alertedAt.
Phase 3 adds execution + realized fields.

## Lifecycle (scan-driven; Phase 3 adds the rest)

- New fingerprint → `active`.
- Reappearing fingerprint → refresh odds/profit/lastSeenAt; `active` again
  (revives dead/degraded). `completed` never reopens.
- `dead` when: the record's sport was rescanned on the SAME region tab and
  the fingerprint is gone, or the event has commenced. A scan on a
  different tab or that skipped the sport says nothing — records untouched.
- `degraded` and `completed` are Phase 3 transitions (re-verify /
  leg-tracking); scans alone can't distinguish them, so they don't try.
- Dead/completed records older than 7 days move from the active file to
  `data/opportunity-archive/YYYY-MM.jsonl` (append-only, kept forever —
  Phase 5 streams these for dashboards). An archive-append failure keeps
  the records in the active file rather than losing them.

## Alerted tracking

`notifyNewOpportunities` returns the set of fingerprints actually sent
(post threshold/dedup/rate-limit). The notifier composition in index.ts
marks those records alerted. The cockpit deep link in the message text is
deliberately deferred to Phase 3 (IDs are stable; no dead links meanwhile).

## Snapshot persistence

`scan/snapshotStore.ts` writes the latest raw pre-filter feed per scan:
`{ fetchedAt, regionTab, markets, sportsScanned, events }` to
`data/last-snapshot.json`. Latest-only, no history. Phase 4 recomputes
against arbitrary book subsets from this without an API call.

## API

`GET /api/opportunities?status=` (validated enum) and
`GET /api/opportunities/:id` (404 unknown). No UI changes this phase.

## scanService

Two new optional deps following the books/notifier pattern:
`opportunityLog.recordScan(opportunities, {sportsScanned, regionTab})`
(awaited, failure logged not fatal) and `snapshotStore.write(snapshot)`
(same). Order: record scan → fire notifier, so records exist before
markAlerted can run.
