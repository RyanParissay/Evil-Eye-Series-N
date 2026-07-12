/**
 * Decides who gets a WhatsApp alert for which opportunity, and dispatches.
 * Selection (opportunityFingerprint / selectAlerts / formatAlertMessage) is
 * pure so it unit-tests without I/O; notifyNewOpportunities is the
 * orchestrator runScan fires and forgets — it must never fail a scan.
 */
import type { ArbOpportunity } from '@shared/types';
import type { StakePlan } from '@shared/stakePlanning';
import {
  WHATSAPP_MAX_ALERTS_PER_HOUR,
  WHATSAPP_MAX_CONSECUTIVE_FAILURES,
  WHATSAPP_MAX_SEND_RETRIES,
  WHATSAPP_SENT_ALERT_RETENTION_MS,
} from '../config/constants';
import { opportunityFingerprint, opportunityIdFromFingerprint } from '../opportunities/opportunityId';
import type {
  WhatsAppData,
  WhatsAppDataStore,
  WhatsAppSubscription,
} from './subscriptionStore';
import { maskPhone } from './whatsappRequests';
import type { WhatsAppSender } from './whatsappSender';

const HOUR_MS = 3_600_000;

// Identity lives in opportunities/opportunityId.ts (persistence shares it);
// re-exported here because it IS this module's dedup key.
export { opportunityFingerprint } from '../opportunities/opportunityId';

/**
 * Same-message immediate retries (no delay — no server-side timers) before
 * a send counts as a delivery failure for this dispatch. Lives inside the
 * existing fire-and-forget notifier call, not a scheduler.
 */
async function sendWithRetries(sender: WhatsAppSender, toE164: string, body: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= WHATSAPP_MAX_SEND_RETRIES; attempt++) {
    try {
      await sender.send(toE164, body);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Strips anything that looks like a phone number, Twilio SID, or token from
 * a delivery-failure detail before it's persisted — same credential-privacy
 * rule as the odds key (CLAUDE.md). Kept short so it stays a status blurb,
 * not a log dump.
 */
export function sanitizeFailureDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/\+?\d{7,15}/g, '[number]')
    .replace(/\b[A-Za-z0-9]{20,}\b/g, '[id]')
    .slice(0, 300);
}

export interface PlannedAlert {
  subscription: WhatsAppSubscription;
  opportunity: ArbOpportunity;
  fingerprint: string;
}

export interface AlertSelection {
  planned: PlannedAlert[];
  /** Alerts dropped by the per-subscriber hourly rate limit. */
  droppedByRateLimit: number;
}

/**
 * The strategy-agnostic selection core: which opportunities deserve acting
 * on, given a threshold and a memory of what was already acted on. The
 * WhatsApp path AND the paper-trading book both go through this — the
 * rules (non-suspicious, non-same-book, threshold, fingerprint dedup)
 * exist exactly once.
 */
export function alertWorthy(
  opportunities: ArbOpportunity[],
  thresholdPercent: number,
  alreadySeen: (fingerprint: string) => boolean,
): Array<{ opportunity: ArbOpportunity; fingerprint: string }> {
  const picks: Array<{ opportunity: ArbOpportunity; fingerprint: string }> = [];
  for (const opportunity of opportunities) {
    // Flagged arbs stay visible in the UI but don't page anyone's phone.
    if (opportunity.suspicious || opportunity.sameBookmaker) continue;
    if (opportunity.profitPct < thresholdPercent) continue;
    const fingerprint = opportunityFingerprint(opportunity);
    if (alreadySeen(fingerprint)) continue;
    picks.push({ opportunity, fingerprint });
  }
  return picks;
}

/**
 * Second-sighting confirmation gate (ops toggle, default off; applies to
 * arb, EV, and middle alerts alike — index.ts wires it from ops settings
 * before splitting the candidate set by strategy). When ON, an opportunity
 * may go on to alertWorthy only once it's been sighted in ≥2 scans
 * (lastSeenAt strictly after detectedAt) — a record gated at first sighting
 * clears on the scan that re-sees it. Unknown sighting history never
 * guesses its way past the gate. Pure: the caller supplies the lookup so
 * this stays I/O-free and unit-testable.
 */
export function filterConfirmedSightings(
  opportunities: ArbOpportunity[],
  confirmSecondSighting: boolean,
  sightingOf: (fingerprint: string) => { detectedAt: string; lastSeenAt: string } | undefined,
): ArbOpportunity[] {
  if (!confirmSecondSighting) return opportunities;
  return opportunities.filter((opportunity) => {
    const sighting = sightingOf(opportunityFingerprint(opportunity));
    return sighting != null && sighting.lastSeenAt > sighting.detectedAt;
  });
}

export function selectAlerts(
  opportunities: ArbOpportunity[],
  data: WhatsAppData,
  now: Date,
): AlertSelection {
  const rateCutoff = now.getTime() - HOUR_MS;
  const alreadySent = new Set(data.sentAlerts.map((r) => `${r.phoneE164}|${r.fingerprint}`));
  const planned: PlannedAlert[] = [];
  let droppedByRateLimit = 0;

  for (const subscription of data.subscriptions) {
    if (!subscription.verified || !subscription.active) continue;
    let budget =
      WHATSAPP_MAX_ALERTS_PER_HOUR -
      subscription.sendTimestamps.filter((t) => Date.parse(t) > rateCutoff).length;
    const worthy = alertWorthy(opportunities, subscription.thresholdPercent, (fingerprint) =>
      alreadySent.has(`${subscription.phoneE164}|${fingerprint}`),
    );
    for (const { opportunity, fingerprint } of worthy) {
      if (budget <= 0) {
        droppedByRateLimit += 1;
        continue;
      }
      budget -= 1;
      planned.push({ subscription, opportunity, fingerprint });
    }
  }
  return { planned, droppedByRateLimit };
}

/**
 * Exact pinned format (Phase 15 design doc) — nothing else, no emoji, no
 * event line, no sport:
 *   <Book> | <side> @ <odds> | $<amount>
 *   <Book> | <side> @ <odds> | $<amount>
 *   Profit: $X.XX (Y.YY%)
 *   odds as of HH:MM
 *   <APP_URL>/opportunity/<id>   (omitted when APP_URL is unset)
 */
export function formatAlertMessage(
  arb: ArbOpportunity,
  appUrl?: string,
  plan?: StakePlan | null,
  oddsAsOf: Date = new Date(),
): string {
  // A plan that collapsed to zero (a book's balance blocks any stake) — or
  // no plan at all — falls back to the engine's own $100-basis split
  // rather than printing $0 nonsense.
  const stakeable = plan != null && plan.totalStaked > 0;
  const fallbackTotal = arb.legs.reduce((sum, leg) => sum + leg.stake, 0);
  const legLines = arb.legs.map((leg, i) => {
    const side = `${leg.outcome}${leg.point != null ? ` ${formatPoint(leg.point)}` : ''}`;
    const amount = stakeable ? plan.stakes[i] : leg.stake;
    return `${leg.bookmakerTitle} | ${side} @ ${leg.odds} | $${amount.toFixed(2)}`;
  });
  const profitDollars = stakeable ? plan.guaranteedProfit : fallbackTotal * (arb.profitPct / 100);
  const lines = [
    ...legLines,
    `Profit: $${profitDollars.toFixed(2)} (${arb.profitPct.toFixed(2)}%)`,
    `odds as of ${formatHHMM(oddsAsOf)}`,
  ];
  // The cockpit deep link: record ids are the fingerprint's 16-char prefix,
  // so the URL is stable across re-detections.
  if (appUrl) {
    const id = opportunityIdFromFingerprint(opportunityFingerprint(arb));
    lines.push(`${appUrl.replace(/\/$/, '')}/opportunity/${id}`);
  }
  return lines.join('\n');
}

function formatPoint(point: number): string {
  return point > 0 ? `+${point}` : String(point);
}

/** 24h local server time — "odds as of" reads as when the price was seen. */
function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface AlertDeps {
  store: WhatsAppDataStore;
  sender: WhatsAppSender;
  now?: () => Date;
  /** Public base URL of the client; when set, alerts carry a cockpit deep link. */
  appUrl?: string;
  /** Exact-dollar stake plan per opportunity (fund settings + balances). */
  planStakes?: (arb: ArbOpportunity) => StakePlan | null;
}

export interface NotifyResult {
  /** Fingerprints actually sent to at least one subscriber this dispatch. */
  sentFingerprints: string[];
}

export async function notifyNewOpportunities(
  deps: AlertDeps,
  opportunities: ArbOpportunity[],
): Promise<NotifyResult> {
  const now = (deps.now ?? (() => new Date()))();

  return deps.store.update(async (data) => {
    const { planned, droppedByRateLimit } = selectAlerts(opportunities, data, now);
    if (droppedByRateLimit > 0) {
      console.warn(`WhatsApp: dropped ${droppedByRateLimit} alert(s) — hourly rate limit`);
    }
    const sent = new Set<string>();

    for (const { subscription, opportunity, fingerprint } of planned) {
      // An earlier failure in this batch may have deactivated it.
      if (!subscription.active) continue;
      try {
        await sendWithRetries(
          deps.sender,
          subscription.phoneE164,
          formatAlertMessage(opportunity, deps.appUrl, deps.planStakes?.(opportunity), now),
        );
        subscription.failedSendCount = 0;
        subscription.sendTimestamps.push(now.toISOString());
        data.lastDeliveryFailure = null;
        sent.add(fingerprint);
        data.sentAlerts.push({
          phoneE164: subscription.phoneE164,
          fingerprint,
          profitPct: opportunity.profitPct,
          sentAt: now.toISOString(),
        });
      } catch (err) {
        subscription.failedSendCount += 1;
        data.lastDeliveryFailure = { at: now.toISOString(), detail: sanitizeFailureDetail(err) };
        console.warn(`WhatsApp send failed for ${maskPhone(subscription.phoneE164)}:`, err);
        if (subscription.failedSendCount >= WHATSAPP_MAX_CONSECUTIVE_FAILURES) {
          subscription.active = false;
          console.warn(
            `WhatsApp: ${maskPhone(subscription.phoneE164)} deactivated after ` +
              `${subscription.failedSendCount} consecutive send failures`,
          );
        }
      }
      subscription.updatedAt = now.toISOString();
    }

    prune(data, now);
    return { data, result: { sentFingerprints: [...sent] } };
  });
}

/**
 * Risk Mode alert: honest by construction — edge and win probability up
 * front, "Not guaranteed" always, the word "guaranteed" never unqualified.
 */
export function formatEvAlertMessage(
  opportunity: ArbOpportunity,
  stake?: number,
  appUrl?: string,
): string {
  const [leg] = opportunity.legs;
  const ev = opportunity.ev!;
  const line = leg.point != null ? ` ${formatPoint(leg.point)}` : '';
  const link = appUrl
    ? ` ${appUrl.replace(/\/$/, '')}/opportunity/${opportunityIdFromFingerprint(opportunityFingerprint(opportunity))}`
    : '';
  const stakePart = stake != null && stake > 0 ? ` Stake $${stake.toFixed(2)}.` : '';
  return (
    `🎲 EV bet: ${opportunity.eventName} (${opportunity.marketKey}) — ` +
    `${leg.outcome}${line} @${leg.odds} at ${leg.bookmakerTitle}. ` +
    `Edge ${ev.edgePct.toFixed(1)}%, win probability ${Math.round(ev.fairProbability * 100)}%.` +
    `${stakePart} Not guaranteed — expected value.${link}`
  );
}

export interface EvAlertDeps extends AlertDeps {
  /** Global EV alert threshold (settings), applied per opted-in subscriber. */
  evThresholdPercent: number;
  /** Flat stake quoted in the message (fund default), when configured. */
  stake?: number;
}

/**
 * EV alerts are OFF unless a subscription opted in (evEnabled) — the
 * emotional contract differs from arbs, so delivery is a choice. Shares
 * the sent-alert dedup store and the hourly rate-limit budget.
 */
export async function notifyEvBets(
  deps: EvAlertDeps,
  evOpportunities: ArbOpportunity[],
): Promise<NotifyResult> {
  const now = (deps.now ?? (() => new Date()))();

  return deps.store.update(async (data) => {
    const rateCutoff = now.getTime() - HOUR_MS;
    const alreadySent = new Set(data.sentAlerts.map((r) => `${r.phoneE164}|${r.fingerprint}`));
    const sent = new Set<string>();

    for (const subscription of data.subscriptions) {
      if (!subscription.verified || !subscription.active || !subscription.evEnabled) continue;
      let budget =
        WHATSAPP_MAX_ALERTS_PER_HOUR -
        subscription.sendTimestamps.filter((t) => Date.parse(t) > rateCutoff).length;
      const worthy = alertWorthy(evOpportunities, deps.evThresholdPercent, (fingerprint) =>
        alreadySent.has(`${subscription.phoneE164}|${fingerprint}`),
      );
      for (const { opportunity, fingerprint } of worthy) {
        if (budget <= 0) break;
        if (!subscription.active) break;
        try {
          await sendWithRetries(
            deps.sender,
            subscription.phoneE164,
            formatEvAlertMessage(opportunity, deps.stake, deps.appUrl),
          );
          budget -= 1;
          subscription.failedSendCount = 0;
          subscription.sendTimestamps.push(now.toISOString());
          data.lastDeliveryFailure = null;
          sent.add(fingerprint);
          data.sentAlerts.push({
            phoneE164: subscription.phoneE164,
            fingerprint,
            profitPct: opportunity.profitPct,
            sentAt: now.toISOString(),
          });
        } catch (err) {
          subscription.failedSendCount += 1;
          data.lastDeliveryFailure = { at: now.toISOString(), detail: sanitizeFailureDetail(err) };
          console.warn(`WhatsApp EV send failed for ${maskPhone(subscription.phoneE164)}:`, err);
          if (subscription.failedSendCount >= WHATSAPP_MAX_CONSECUTIVE_FAILURES) {
            subscription.active = false;
          }
        }
        subscription.updatedAt = now.toISOString();
      }
    }

    prune(data, now);
    return { data, result: { sentFingerprints: [...sent] } };
  });
}

/**
 * Middle alert: cost/payout/breakeven framing. "Guaranteed" is banned —
 * except free middles, whose worst case genuinely is a locked floor.
 */
export function formatMiddleAlertMessage(
  opportunity: ArbOpportunity,
  stake?: number,
  appUrl?: string,
): string {
  const middle = opportunity.middle!;
  const legs = opportunity.legs
    .map(
      (leg) =>
        `${leg.bookmakerTitle}: ${leg.outcome}${leg.point != null ? ` ${formatPoint(leg.point)}` : ''} @${leg.odds}`,
    )
    .join(' / ');
  const link = appUrl
    ? ` ${appUrl.replace(/\/$/, '')}/opportunity/${opportunityIdFromFingerprint(opportunityFingerprint(opportunity))}`
    : '';
  const window = `(${middle.lowLine}–${middle.highLine})`;
  const keys = middle.keyNumbers.length > 0 ? ` Key number ${middle.keyNumbers.join(', ')} inside.` : '';
  if (middle.freeMiddle) {
    const floor = stake != null ? ` guaranteed +$${((stake * -middle.costPct) / 100).toFixed(2)} floor,` : ' guaranteed floor,';
    const pays = stake != null ? ` pays +$${((stake * middle.payoutPct) / 100).toFixed(2)}` : ' pays more';
    return `🎯 Free middle: ${opportunity.eventName} (${opportunity.marketKey}) — ${legs}.${floor}${pays} if it lands in ${window}.${keys}${link}`;
  }
  const cost = stake != null ? `$${((stake * middle.costPct) / 100).toFixed(2)}` : `${middle.costPct.toFixed(1)}% of stake`;
  const pays = stake != null ? `$${((stake * middle.payoutPct) / 100).toFixed(2)}` : `${middle.payoutPct.toFixed(0)}% of stake`;
  return (
    `🎯 Middle: ${opportunity.eventName} (${opportunity.marketKey}) — ${legs}. ` +
    `Costs ${cost} if it misses, pays ${pays} if it lands in ${window} — ` +
    `needs to hit ${middle.breakevenPct.toFixed(1)}% of the time to profit.${keys}${link}`
  );
}

export interface MiddleAlertDeps extends AlertDeps {
  /** Costed middles alert only at/below this breakeven %. */
  maxBreakevenPct: number;
  /** Flat stake for the dollar framing, when configured. */
  stake?: number;
}

/**
 * Costed middles are opt-in per subscription (middleEnabled, default
 * off). FREE middles bypass the opt-in — they are risk-free, so they
 * ride to everyone like an arb would. Same-book middles never alert.
 */
export async function notifyMiddleBets(
  deps: MiddleAlertDeps,
  middleOpportunities: ArbOpportunity[],
): Promise<NotifyResult> {
  const now = (deps.now ?? (() => new Date()))();

  return deps.store.update(async (data) => {
    const rateCutoff = now.getTime() - HOUR_MS;
    const alreadySent = new Set(data.sentAlerts.map((r) => `${r.phoneE164}|${r.fingerprint}`));
    const sent = new Set<string>();

    for (const subscription of data.subscriptions) {
      if (!subscription.verified || !subscription.active) continue;
      let budget =
        WHATSAPP_MAX_ALERTS_PER_HOUR -
        subscription.sendTimestamps.filter((t) => Date.parse(t) > rateCutoff).length;
      for (const opportunity of middleOpportunities) {
        const middle = opportunity.middle;
        if (!middle || opportunity.sameBookmaker || opportunity.suspicious) continue;
        if (!middle.freeMiddle) {
          if (!subscription.middleEnabled) continue;
          if (middle.breakevenPct > deps.maxBreakevenPct) continue;
        }
        const fingerprint = opportunityFingerprint(opportunity);
        if (alreadySent.has(`${subscription.phoneE164}|${fingerprint}`)) continue;
        if (budget <= 0) break;
        try {
          await sendWithRetries(
            deps.sender,
            subscription.phoneE164,
            formatMiddleAlertMessage(opportunity, deps.stake, deps.appUrl),
          );
          budget -= 1;
          subscription.failedSendCount = 0;
          subscription.sendTimestamps.push(now.toISOString());
          data.lastDeliveryFailure = null;
          sent.add(fingerprint);
          data.sentAlerts.push({
            phoneE164: subscription.phoneE164,
            fingerprint,
            profitPct: opportunity.profitPct,
            sentAt: now.toISOString(),
          });
        } catch (err) {
          subscription.failedSendCount += 1;
          data.lastDeliveryFailure = { at: now.toISOString(), detail: sanitizeFailureDetail(err) };
          console.warn(`WhatsApp middle send failed for ${maskPhone(subscription.phoneE164)}:`, err);
          if (subscription.failedSendCount >= WHATSAPP_MAX_CONSECUTIVE_FAILURES) {
            subscription.active = false;
          }
        }
        subscription.updatedAt = now.toISOString();
      }
    }

    prune(data, now);
    return { data, result: { sentFingerprints: [...sent] } };
  });
}

/** Sent-alert records and rate-limit timestamps both age out. */
function prune(data: WhatsAppData, now: Date): void {
  const sentCutoff = now.getTime() - WHATSAPP_SENT_ALERT_RETENTION_MS;
  data.sentAlerts = data.sentAlerts.filter((r) => Date.parse(r.sentAt) > sentCutoff);
  const rateCutoff = now.getTime() - HOUR_MS;
  for (const subscription of data.subscriptions) {
    subscription.sendTimestamps = subscription.sendTimestamps.filter(
      (t) => Date.parse(t) > rateCutoff,
    );
  }
}
