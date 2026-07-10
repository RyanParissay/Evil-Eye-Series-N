/**
 * Opportunity identity, shared by alert dedup and the persistence layer.
 *
 * The fingerprint hashes event + market + the exact leg set (book/outcome/
 * line). Profit is deliberately NOT part of the identity — a return
 * wobbling 2.31% → 2.34% is the same opportunity (that's the alert
 * debounce, and what lets re-detections update the same stored record).
 * New legs = new opportunity.
 */
import { createHash } from 'node:crypto';
import type { ArbOpportunity } from '@shared/types';

export function opportunityFingerprint(arb: ArbOpportunity): string {
  const legs = arb.legs
    .map((leg) => `${leg.bookmakerKey}:${leg.outcome}:${leg.point ?? ''}`)
    .sort()
    .join('|');
  return createHash('sha256')
    .update(`${arb.eventId}|${arb.marketKey}|${legs}`)
    .digest('hex');
}

/** The persisted/URL id: a 16-hex-char prefix is plenty at this scale. */
export function opportunityIdFromFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 16);
}
