/**
 * Pure lifecycle transitions for persisted opportunities, applied per scan.
 * What a scan can honestly know: which fingerprints exist right now within
 * the sports it scanned on its tab, and which events have commenced.
 * Everything else (degraded, completed) belongs to the Phase-3 cockpit.
 */
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { OPPORTUNITY_ARCHIVE_AFTER_MS, VERIFY_PROFIT_TOLERANCE_PP } from '../config/constants';
import { lockedProfit, priceLegs } from '../engine/arbitrage';
import { opportunityFingerprint, opportunityIdFromFingerprint } from './opportunityId';

export interface ScanScope {
  sportsScanned: string[];
  regionTab: string;
}

export interface LifecycleResult {
  records: OpportunityRecord[];
  newCount: number;
  deadCount: number;
}

export function applyScanToRecords(
  records: OpportunityRecord[],
  opportunities: ArbOpportunity[],
  scope: ScanScope,
  now: Date,
): LifecycleResult {
  const at = now.toISOString();
  const byFingerprint = new Map(records.map((r) => [r.fingerprint, r]));
  const seenNow = new Set<string>();
  let newCount = 0;
  let deadCount = 0;

  // 1. Upsert everything detected this scan.
  for (const arb of opportunities) {
    const fingerprint = opportunityFingerprint(arb);
    seenNow.add(fingerprint);
    const existing = byFingerprint.get(fingerprint);
    if (existing) {
      existing.legs = arb.legs;
      existing.profitPct = arb.profitPct;
      existing.arbIndex = arb.arbIndex;
      existing.suspicious = arb.suspicious;
      existing.sameBookmaker = arb.sameBookmaker;
      if (arb.ev) existing.ev = arb.ev; // strategy context follows the latest sighting
      if (arb.middle) existing.middle = arb.middle;
      if (arb.homeTeam) existing.homeTeam = arb.homeTeam;
      if (arb.awayTeam) existing.awayTeam = arb.awayTeam;
      existing.lastSeenAt = at;
      // Re-detection revives dead/degraded records; an executed (completed)
      // opportunity is history and never reopens.
      if (existing.status !== 'active' && existing.status !== 'completed') {
        existing.status = 'active';
        existing.statusChangedAt = at;
      }
    } else {
      newCount += 1;
      byFingerprint.set(fingerprint, {
        id: opportunityIdFromFingerprint(fingerprint),
        fingerprint,
        strategy: arb.ev ? 'ev' : arb.middle ? 'middle' : 'arb',
        ...(arb.ev && { ev: arb.ev }),
        ...(arb.middle && { middle: arb.middle }),
        eventId: arb.eventId,
        sportKey: arb.sportKey,
        sportTitle: arb.sportTitle,
        eventName: arb.eventName,
        commenceTime: arb.commenceTime,
        marketKey: arb.marketKey,
        ...(arb.homeTeam && { homeTeam: arb.homeTeam }),
        ...(arb.awayTeam && { awayTeam: arb.awayTeam }),
        schemaVersion: 2,
        legs: arb.legs,
        profitPctAtDetection: arb.profitPct,
        profitPct: arb.profitPct,
        arbIndex: arb.arbIndex,
        status: 'active',
        suspicious: arb.suspicious,
        sameBookmaker: arb.sameBookmaker,
        regionTab: scope.regionTab,
        detectedAt: at,
        lastSeenAt: at,
        statusChangedAt: at,
        alerted: false,
        alertedAt: null,
      });
    }
  }

  // 2. Kill what this scan proves gone. Only records this scan actually
  //    covered — same tab (same allowlist) and a rescanned sport — can be
  //    declared dead by absence. Commencement kills unconditionally.
  const scannedSports = new Set(scope.sportsScanned);
  for (const record of byFingerprint.values()) {
    if (record.status !== 'active' && record.status !== 'degraded') continue;
    const commenced = Date.parse(record.commenceTime) <= now.getTime();
    const provenGone =
      record.regionTab === scope.regionTab &&
      scannedSports.has(record.sportKey) &&
      !seenNow.has(record.fingerprint);
    if (commenced || provenGone) {
      record.status = 'dead';
      record.statusChangedAt = at;
      deadCount += 1;
    }
  }

  return { records: [...byFingerprint.values()], newCount, deadCount };
}

/**
 * Re-verify: fold freshly fetched odds for the record's exact legs back
 * into it. `legOdds` aligns with record.legs; null = that leg is no longer
 * offered. Any missing leg (or a commenced event upstream passing all
 * nulls) kills the record without touching the stored numbers — the status
 * says why, the numbers say what was last seen. When every leg is priced,
 * odds/stakes/profit update to the fresh truth and the status follows:
 * profit gone → dead; shrunk beyond the tolerance → degraded; else active
 * (reviving degraded/dead, exactly like scan re-detection).
 */
export function applyVerification(
  record: OpportunityRecord,
  legOdds: Array<number | null>,
  now: Date,
): 'active' | 'degraded' | 'dead' {
  const setStatus = (status: 'active' | 'degraded' | 'dead') => {
    if (record.status !== status) {
      record.status = status;
      record.statusChangedAt = now.toISOString();
    }
    return status;
  };

  if (legOdds.length !== record.legs.length || legOdds.some((o) => o == null)) {
    return setStatus('dead');
  }

  const odds = legOdds as number[];
  const { arbIndex, profitPct, stakes } = priceLegs(odds);
  record.legs.forEach((leg, i) => {
    leg.odds = odds[i];
    leg.stake = stakes[i];
  });
  record.arbIndex = arbIndex;
  record.profitPct = profitPct;
  record.lastSeenAt = now.toISOString();

  // Middles live as long as both legs are priced: a costed middle is not
  // "dead" for costing money — that IS a middle. Recompute its economics
  // (S = arbIndex): cost/payout/breakeven, and the worst-case floor.
  if (record.strategy === 'middle' && record.middle) {
    const S = arbIndex;
    record.middle = {
      ...record.middle,
      costPct: (1 - 1 / S) * 100,
      payoutPct: (2 / S - 1) * 100,
      breakevenPct: (S - 1) * 100,
      freeMiddle: (1 - 1 / S) * 100 <= 0,
    };
    record.profitPct = -record.middle.costPct;
    return setStatus('active');
  }

  if (profitPct <= 0) return setStatus('dead');
  if (profitPct < record.profitPctAtDetection - VERIFY_PROFIT_TOLERANCE_PP) {
    return setStatus('degraded');
  }
  return setStatus('active');
}

/** Statuses the cockpit may set by hand; scans own active/dead. */
export type CockpitStatus = 'degraded' | 'completed';

/**
 * Book the actual filled numbers onto a record being completed. Pure;
 * callers validate alignment first. The money math is the engine's.
 */
export function applyExecution(
  record: OpportunityRecord,
  filledLegs: Array<{ odds: number; stake: number }>,
  now: Date,
): void {
  record.execution = {
    filledLegs: filledLegs.map((leg) => ({ odds: leg.odds, stake: leg.stake })),
    totalStaked: round2(filledLegs.reduce((sum, leg) => sum + leg.stake, 0)),
    lockedProfit: round2(lockedProfit(filledLegs)),
    recordedAt: now.toISOString(),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type StatusChange = { ok: true } | { ok: false; message: string };

/**
 * Cockpit-driven transition, mutating in place like applyScanToRecords.
 * Completing is always allowed (even on a dead record — the bets were placed
 * while it lived, and history is history). Degrading only makes sense while
 * the opportunity is still live. Re-setting the current status is a no-op
 * success so a double-tapped button never surfaces an error.
 */
export function applyStatusChange(
  record: OpportunityRecord,
  target: CockpitStatus,
  now: Date,
): StatusChange {
  if (record.status === target) return { ok: true };
  if (target === 'degraded' && record.status !== 'active') {
    return { ok: false, message: `Cannot degrade a ${record.status} opportunity` };
  }
  record.status = target;
  record.statusChangedAt = now.toISOString();
  return { ok: true };
}

/**
 * Dead/completed records past the archive window leave the active file for
 * the append-only monthly archive (Phase 5 streams those for dashboards).
 */
export function partitionForArchive(
  records: OpportunityRecord[],
  now: Date,
): { keep: OpportunityRecord[]; archive: OpportunityRecord[] } {
  const cutoff = now.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS;
  const keep: OpportunityRecord[] = [];
  const archive: OpportunityRecord[] = [];
  for (const record of records) {
    const settled = record.status === 'dead' || record.status === 'completed';
    (settled && Date.parse(record.statusChangedAt) < cutoff ? archive : keep).push(record);
  }
  return { keep, archive };
}
