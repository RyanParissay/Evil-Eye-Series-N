/**
 * Phase 16 Part A — confirmation-pair matching (pure).
 *
 * Every scan is a scan A. Its candidates — active, non-suspicious,
 * non-same-book records left `confirmation.status === 'pending'` — wait
 * `confirmationIntervalSecs` for scan B (same fetch scope, fired by the
 * scheduler). A candidate CONFIRMS when the same opportunity identity
 * (the fingerprint: eventId + marketKey + sorted leg identities incl.
 * points — see opportunityId.ts) is present in both scans AND the headline
 * edge moved no more than ±CONFIRMATION_EDGE_TOLERANCE_PP. Anything else —
 * drifted beyond tolerance, absent from B, dead before B, or B never
 * fired — resolves to the TERMINAL 'single_sighting': kept for survival
 * telemetry, never acted on (alerts and Hub purchases gate on 'confirmed').
 *
 * Presence is judged exactly the way Phase 15's second-sighting gate judged
 * it — lastSeenAt advanced past the pre-B snapshot — which is what converts
 * that machinery into the pair matcher (design contract, Part A). The edge
 * comparison leans on the store's own semantics: a record's headline fields
 * are refreshed at every sighting, so the PRE-B snapshot carries scan A's
 * edge and the post-B store carries scan B's.
 */
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { CONFIRMATION_EDGE_TOLERANCE_PP } from '../config/constants';

/** The headline edge the ±tolerance rule compares (percentage points):
 *  arb → profitPct, EV → ev.edgePct, middle → middle.costPct. */
export function headlineEdgePct(
  record: Pick<OpportunityRecord, 'profitPct' | 'ev' | 'middle'>,
): number {
  if (record.middle) return record.middle.costPct;
  if (record.ev) return record.ev.edgePct;
  return record.profitPct;
}

/** One pair-matcher verdict, ready for OpportunityService.applyConfirmations. */
export interface ConfirmationOutcome {
  fingerprint: string;
  status: 'confirmed' | 'single_sighting';
  scanBAt: string;
  /** Signed headline drift A→B in pp; present only when B re-sighted it. */
  edgeDeltaPp?: number;
}

/**
 * Judge every pending record in the pre-B snapshot against the post-B
 * store. `before` is read BEFORE scan B runs (its headline fields are scan
 * A's); `after` is read once scan B's recordScan has landed (re-sighted
 * records carry scan B's lastSeenAt and headline). Non-pending records in
 * `before` are passed through untouched — never judged, never revived.
 *
 * `coveredSports` is the set of sports scan B SUCCESSFULLY fetched (the
 * scan's attempted list minus its failures). A candidate whose sport is
 * not in it is EXCLUDED from the outcomes entirely — absence of evidence
 * is not evidence of absence, so it stays pending: the still-due pair
 * re-fires B on a later tick, and the 5×-interval lapse rule remains the
 * honest terminal fallback for a persistently unfetchable sport. Without
 * this gate an under-covered B (rate-limited / partially failed) would
 * mute healthy records as terminal single_sighting.
 */
export function matchConfirmationPair(
  before: OpportunityRecord[],
  after: OpportunityRecord[],
  at: Date,
  coveredSports: ReadonlySet<string>,
): ConfirmationOutcome[] {
  const scanBAt = at.toISOString();
  const afterByFingerprint = new Map(after.map((r) => [r.fingerprint, r]));
  const outcomes: ConfirmationOutcome[] = [];
  for (const record of before) {
    if (record.confirmation?.status !== 'pending') continue;
    // Coverage gate: scan B can only judge sports it actually fetched.
    // (Optional-chained so a hot-reload window between composition edits
    // fails CLOSED — no coverage means no verdicts, never false terminals.)
    if (!coveredSports?.has(record.sportKey)) continue;
    const seen = afterByFingerprint.get(record.fingerprint);
    // The Phase 15 second-sighting judgement: present in scan B ⇔ its
    // lastSeenAt advanced past the pre-B snapshot's.
    if (!seen || seen.lastSeenAt <= record.lastSeenAt) {
      outcomes.push({ fingerprint: record.fingerprint, status: 'single_sighting', scanBAt });
      continue;
    }
    const edgeDeltaPp = headlineEdgePct(seen) - headlineEdgePct(record);
    outcomes.push({
      fingerprint: record.fingerprint,
      status:
        Math.abs(edgeDeltaPp) <= CONFIRMATION_EDGE_TOLERANCE_PP ? 'confirmed' : 'single_sighting',
      scanBAt,
      edgeDeltaPp,
    });
  }
  return outcomes;
}

/**
 * A record that makes its scan a scan A: still pending, still alive, and
 * never suspicious/same-book (those are flagged, never acted on, so they
 * must not spend credits on a scan B either). Pre-Phase-16 records have no
 * confirmation field and are never candidates — never retro-alerted.
 */
export function isPendingCandidate(record: OpportunityRecord): boolean {
  return (
    record.confirmation?.status === 'pending' &&
    record.status === 'active' &&
    !record.suspicious &&
    !record.sameBookmaker &&
    !record.alerted
  );
}

/**
 * A confirmed record as the alert pipeline's input shape. Field-for-field —
 * the fingerprint (and so the alert dedup key and cockpit deep link)
 * survives the round trip.
 */
export function recordToOpportunity(record: OpportunityRecord): ArbOpportunity {
  return {
    id: record.id,
    ...(record.ev && { ev: record.ev }),
    ...(record.middle && { middle: record.middle }),
    // Phase 17: the safety score rides along so alert copy can render the
    // Safety line and the rounded (primary) stakes.
    ...(record.safety && { safety: record.safety }),
    eventId: record.eventId,
    sportKey: record.sportKey,
    sportTitle: record.sportTitle,
    eventName: record.eventName,
    commenceTime: record.commenceTime,
    marketKey: record.marketKey,
    ...(record.homeTeam && { homeTeam: record.homeTeam }),
    ...(record.awayTeam && { awayTeam: record.awayTeam }),
    arbIndex: record.arbIndex,
    profitPct: record.profitPct,
    legs: record.legs,
    sameBookmaker: record.sameBookmaker,
    suspicious: record.suspicious,
  };
}
