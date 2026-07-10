/**
 * Decides who gets a WhatsApp alert for which opportunity, and dispatches.
 * Selection (opportunityFingerprint / selectAlerts / formatAlertMessage) is
 * pure so it unit-tests without I/O; notifyNewOpportunities is the
 * orchestrator runScan fires and forgets — it must never fail a scan.
 */
import type { ArbOpportunity } from '@shared/types';
import {
  WHATSAPP_MAX_ALERTS_PER_HOUR,
  WHATSAPP_MAX_CONSECUTIVE_FAILURES,
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
    for (const opportunity of opportunities) {
      // Flagged arbs stay visible in the UI but don't page anyone's phone.
      if (opportunity.suspicious || opportunity.sameBookmaker) continue;
      if (opportunity.profitPct < subscription.thresholdPercent) continue;
      const fingerprint = opportunityFingerprint(opportunity);
      if (alreadySent.has(`${subscription.phoneE164}|${fingerprint}`)) continue;
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

export function formatAlertMessage(arb: ArbOpportunity, appUrl?: string): string {
  const legs = arb.legs
    .map(
      (leg) =>
        `${leg.bookmakerTitle}: ${leg.outcome}${leg.point != null ? ` ${formatPoint(leg.point)}` : ''} @${leg.odds}`,
    )
    .join(' / ');
  const starts = new Date(arb.commenceTime).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  // The cockpit deep link: record ids are the fingerprint's 16-char prefix,
  // so the URL is stable across re-detections.
  const link = appUrl
    ? ` ${appUrl.replace(/\/$/, '')}/opportunity/${opportunityIdFromFingerprint(opportunityFingerprint(arb))}`
    : '';
  return `🔔 New arb: ${arb.eventName} (${arb.marketKey}) — ${arb.profitPct.toFixed(2)}% return. ${legs}. Starts ${starts}.${link}`;
}

function formatPoint(point: number): string {
  return point > 0 ? `+${point}` : String(point);
}

export interface AlertDeps {
  store: WhatsAppDataStore;
  sender: WhatsAppSender;
  now?: () => Date;
  /** Public base URL of the client; when set, alerts carry a cockpit deep link. */
  appUrl?: string;
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
        await deps.sender.send(subscription.phoneE164, formatAlertMessage(opportunity, deps.appUrl));
        subscription.failedSendCount = 0;
        subscription.sendTimestamps.push(now.toISOString());
        sent.add(fingerprint);
        data.sentAlerts.push({
          phoneE164: subscription.phoneE164,
          fingerprint,
          profitPct: opportunity.profitPct,
          sentAt: now.toISOString(),
        });
      } catch (err) {
        subscription.failedSendCount += 1;
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
