import { describe, expect, it } from 'vitest';
import type { ArbOpportunity } from '@shared/types';
import {
  WHATSAPP_MAX_ALERTS_PER_HOUR,
  WHATSAPP_MAX_CONSECUTIVE_FAILURES,
  WHATSAPP_SENT_ALERT_RETENTION_MS,
} from '../config/constants';
import {
  alertWorthy,
  formatAlertMessage,
  notifyNewOpportunities,
  opportunityFingerprint,
  selectAlerts,
} from './alertService';
import type {
  WhatsAppData,
  WhatsAppDataStore,
  WhatsAppSubscription,
} from './subscriptionStore';
import type { WhatsAppSender } from './whatsappSender';

const NOW = new Date('2026-07-09T12:00:00Z');

function makeArb(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-09T23:00:00Z',
    marketKey: 'h2h',
    arbIndex: 0.977,
    profitPct: 2.34,
    legs: [
      {
        outcome: 'Los Angeles Lakers',
        bookmakerKey: 'bet365',
        bookmakerTitle: 'Bet365',
        odds: 2.1,
        stake: 48.78,
        link: null,
      },
      {
        outcome: 'Boston Celtics',
        bookmakerKey: 'pinnacle',
        bookmakerTitle: 'Pinnacle',
        odds: 2.05,
        stake: 51.22,
        link: null,
      },
    ],
    sameBookmaker: false,
    suspicious: false,
    ...overrides,
  };
}

function makeSubscription(
  overrides: Partial<WhatsAppSubscription> = {},
): WhatsAppSubscription {
  return {
    phoneE164: '+14165551234',
    thresholdPercent: 2,
    verified: true,
    active: true,
    failedSendCount: 0,
    verification: null,
    sendTimestamps: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeData(overrides: Partial<WhatsAppData> = {}): WhatsAppData {
  return { subscriptions: [makeSubscription()], sentAlerts: [], ...overrides };
}

/** In-memory stand-in for WhatsAppStore. */
class FakeStore implements WhatsAppDataStore {
  constructor(public data: WhatsAppData) {}
  async read(): Promise<WhatsAppData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: WhatsAppData,
    ) => { data: WhatsAppData; result: T } | Promise<{ data: WhatsAppData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeSender implements WhatsAppSender {
  readonly mode = 'console' as const;
  sent: Array<{ to: string; body: string }> = [];
  failNext = 0;
  async send(to: string, body: string): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('simulated send failure');
    }
    this.sent.push({ to, body });
  }
}

describe('opportunityFingerprint', () => {
  it('is stable across leg order and profit fluctuation', () => {
    const a = makeArb({ profitPct: 2.31 });
    const b = makeArb({ profitPct: 2.34, legs: [...a.legs].reverse() });
    expect(opportunityFingerprint(a)).toBe(opportunityFingerprint(b));
  });

  it('changes when a leg moves to a different bookmaker or line', () => {
    const base = makeArb();
    const otherBook = makeArb({
      legs: [{ ...base.legs[0], bookmakerKey: 'betway' }, base.legs[1]],
    });
    const otherLine = makeArb({
      legs: [{ ...base.legs[0], point: -3.5 }, base.legs[1]],
    });
    expect(opportunityFingerprint(otherBook)).not.toBe(opportunityFingerprint(base));
    expect(opportunityFingerprint(otherLine)).not.toBe(opportunityFingerprint(base));
  });
});

describe('selectAlerts', () => {
  it('alerts only at or above the subscriber threshold', () => {
    const data = makeData({
      subscriptions: [makeSubscription({ thresholdPercent: 2.5 })],
    });
    const below = makeArb({ eventId: 'evt-low', profitPct: 2.49 });
    const at = makeArb({ eventId: 'evt-at', profitPct: 2.5 });
    const { planned } = selectAlerts([below, at], data, NOW);
    expect(planned.map((p) => p.opportunity.eventId)).toEqual(['evt-at']);
  });

  it('skips unverified, inactive, suspicious and same-book cases', () => {
    const data = makeData({
      subscriptions: [
        makeSubscription({ phoneE164: '+14165550001', verified: false }),
        makeSubscription({ phoneE164: '+14165550002', active: false }),
        makeSubscription({ phoneE164: '+14165550003' }),
      ],
    });
    const arbs = [
      makeArb({ eventId: 'evt-sus', suspicious: true }),
      makeArb({ eventId: 'evt-same', sameBookmaker: true }),
      makeArb({ eventId: 'evt-good' }),
    ];
    const { planned } = selectAlerts(arbs, data, NOW);
    expect(planned).toHaveLength(1);
    expect(planned[0].subscription.phoneE164).toBe('+14165550003');
    expect(planned[0].opportunity.eventId).toBe('evt-good');
  });

  it('dedups against sent alerts regardless of profit changes', () => {
    const arb = makeArb({ profitPct: 2.31 });
    const data = makeData({
      sentAlerts: [
        {
          phoneE164: '+14165551234',
          fingerprint: opportunityFingerprint(arb),
          profitPct: 2.34,
          sentAt: NOW.toISOString(),
        },
      ],
    });
    expect(selectAlerts([arb], data, NOW).planned).toHaveLength(0);
  });

  it('enforces the hourly rate limit and counts the dropped alerts', () => {
    const recent = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const data = makeData({
      subscriptions: [
        makeSubscription({
          sendTimestamps: Array(WHATSAPP_MAX_ALERTS_PER_HOUR - 1).fill(recent),
        }),
      ],
    });
    const arbs = [
      makeArb({ eventId: 'evt-a' }),
      makeArb({ eventId: 'evt-b' }),
      makeArb({ eventId: 'evt-c' }),
    ];
    const { planned, droppedByRateLimit } = selectAlerts(arbs, data, NOW);
    expect(planned).toHaveLength(1);
    expect(droppedByRateLimit).toBe(2);
  });

  it('ignores sends older than an hour when applying the rate limit', () => {
    const stale = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
    const data = makeData({
      subscriptions: [
        makeSubscription({
          sendTimestamps: Array(WHATSAPP_MAX_ALERTS_PER_HOUR).fill(stale),
        }),
      ],
    });
    expect(selectAlerts([makeArb()], data, NOW).planned).toHaveLength(1);
  });
});

describe('alertWorthy (the strategy-agnostic selection core)', () => {
  it('applies threshold, flags, and dedup in one place', () => {
    const seen = new Set([opportunityFingerprint(makeArb())]);
    const picks = alertWorthy(
      [
        makeArb(), // already seen → skipped
        makeArb({ eventId: 'evt-sus', suspicious: true }),
        makeArb({ eventId: 'evt-same', sameBookmaker: true }),
        makeArb({ eventId: 'evt-low', profitPct: 1.5 }),
        makeArb({ eventId: 'evt-good' }),
      ],
      2,
      (fp) => seen.has(fp),
    );
    expect(picks.map((p) => p.opportunity.eventId)).toEqual(['evt-good']);
    expect(picks[0].fingerprint).toBe(opportunityFingerprint(makeArb({ eventId: 'evt-good' })));
  });
});

describe('formatAlertMessage', () => {
  it('includes event, market, profit and both legs', () => {
    const message = formatAlertMessage(makeArb());
    expect(message).toContain('Lakers @ Celtics');
    expect(message).toContain('h2h');
    expect(message).toContain('2.34%');
    expect(message).toContain('Bet365: Los Angeles Lakers @2.1');
    expect(message).toContain('Pinnacle: Boston Celtics @2.05');
  });

  it('appends the cockpit deep link when an app URL is configured', () => {
    const arb = makeArb();
    const id = opportunityFingerprint(arb).slice(0, 16);
    const message = formatAlertMessage(arb, 'http://localhost:5173');
    expect(message).toContain(`http://localhost:5173/opportunity/${id}`);
    // No URL configured → no dangling link.
    expect(formatAlertMessage(arb)).not.toContain('/opportunity/');
  });

  it('renders exact dollar stakes when a plan is supplied, flagging caps', () => {
    const plan = {
      stakes: [246.99, 253.01],
      totalStaked: 500,
      guaranteedProfit: 18.68,
      capped: false,
      cappedBy: null,
    };
    const message = formatAlertMessage(makeArb(), undefined, plan);
    expect(message).toContain('Bet365: Los Angeles Lakers @2.1 → $246.99');
    expect(message).toContain('Pinnacle: Boston Celtics @2.05 → $253.01');
    expect(message).toContain('Stake $500.00 for +$18.68 guaranteed');

    const capped = formatAlertMessage(makeArb(), undefined, {
      ...plan,
      stakes: [98.79, 101.21],
      totalStaked: 200,
      guaranteedProfit: 7.47,
      capped: true,
      cappedBy: 'pinnacle',
    });
    expect(capped).toContain('capped by pinnacle balance');
  });

  it('shows signed lines for point-based legs', () => {
    const arb = makeArb({
      marketKey: 'spreads',
      legs: [
        { ...makeArb().legs[0], point: -3.5 },
        { ...makeArb().legs[1], point: 3.5 },
      ],
    });
    const message = formatAlertMessage(arb);
    expect(message).toContain('-3.5');
    expect(message).toContain('+3.5');
  });
});

describe('notifyNewOpportunities', () => {
  it('sends, records the sent alert, and never re-sends on the next scan', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    const deps = { store, sender, now: () => NOW };

    const first = await notifyNewOpportunities(deps, [makeArb()]);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('+14165551234');
    expect(store.data.sentAlerts).toHaveLength(1);
    expect(first.sentFingerprints).toEqual([opportunityFingerprint(makeArb())]);

    // Same opportunity next scan, profit wobbled — no second message.
    const second = await notifyNewOpportunities(deps, [makeArb({ profitPct: 2.4 })]);
    expect(sender.sent).toHaveLength(1);
    expect(second.sentFingerprints).toEqual([]);
  });

  it('sends the deep link when deps carry the app URL', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    await notifyNewOpportunities(
      { store, sender, now: () => NOW, appUrl: 'https://evil.eye' },
      [makeArb()],
    );
    expect(sender.sent[0].body).toContain(
      `https://evil.eye/opportunity/${opportunityFingerprint(makeArb()).slice(0, 16)}`,
    );
  });

  it('reports a failed send as not sent', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = 1;
    const { sentFingerprints } = await notifyNewOpportunities(
      { store, sender, now: () => NOW },
      [makeArb()],
    );
    expect(sentFingerprints).toEqual([]);
  });

  it('deactivates the subscription after consecutive send failures', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = WHATSAPP_MAX_CONSECUTIVE_FAILURES;
    const deps = { store, sender, now: () => NOW };

    for (let i = 0; i < WHATSAPP_MAX_CONSECUTIVE_FAILURES; i++) {
      await notifyNewOpportunities(deps, [makeArb({ eventId: `evt-${i}` })]);
    }
    expect(store.data.subscriptions[0].active).toBe(false);
    expect(store.data.subscriptions[0].failedSendCount).toBe(
      WHATSAPP_MAX_CONSECUTIVE_FAILURES,
    );
    expect(sender.sent).toHaveLength(0);
  });

  it('a success resets the consecutive-failure count', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = 1;
    const deps = { store, sender, now: () => NOW };

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-fail' })]);
    expect(store.data.subscriptions[0].failedSendCount).toBe(1);

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-ok' })]);
    expect(store.data.subscriptions[0].failedSendCount).toBe(0);
    expect(store.data.subscriptions[0].active).toBe(true);
  });

  it('prunes sent-alert records past the retention window', async () => {
    const ancient = new Date(
      NOW.getTime() - WHATSAPP_SENT_ALERT_RETENTION_MS - 1,
    ).toISOString();
    const store = new FakeStore(
      makeData({
        sentAlerts: [
          { phoneE164: '+14165551234', fingerprint: 'old', profitPct: 3, sentAt: ancient },
        ],
      }),
    );
    const deps = { store, sender: new FakeSender(), now: () => NOW };
    await notifyNewOpportunities(deps, []);
    expect(store.data.sentAlerts).toHaveLength(0);
  });
});
