import { describe, expect, it } from 'vitest';
import type { ArbOpportunity } from '@shared/types';
import {
  WHATSAPP_MAX_ALERTS_PER_HOUR,
  WHATSAPP_MAX_CONSECUTIVE_FAILURES,
  WHATSAPP_MAX_SEND_RETRIES,
  WHATSAPP_SENT_ALERT_RETENTION_MS,
} from '../config/constants';
import {
  alertWorthy,
  formatAlertMessage,
  formatEvAlertMessage,
  formatMiddleAlertMessage,
  notifyEvBets,
  notifyMiddleBets,
  notifyNewOpportunities,
  opportunityFingerprint,
  sanitizeFailureDetail,
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
  return {
    subscriptions: [makeSubscription()],
    sentAlerts: [],
    lastDeliveryFailure: null,
    ...overrides,
  };
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
      // A realistic-looking Twilio error: embeds the full "to" number and a
      // SID-shaped token, both of which the sanitizer must strip.
      throw new Error(
        `WhatsApp send failed: HTTP 400 — Twilio 21211: The 'To' number ${to} is not ` +
          `a valid phone number for account AC1234567890abcdef1234567890abcd.`,
      );
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

describe('formatAlertMessage (Phase 15 exact arb copy, AMENDED by Phase 17)', () => {
  const plan = {
    stakes: [246.99, 253.01],
    totalStaked: 500,
    guaranteedProfit: 18.68,
    capped: false,
    cappedBy: null,
  };
  // A scored record's safety block: rounded stakes are the PRIMARY alerted
  // amounts (camouflage $5 rounding); exact-optimal stays cockpit-only.
  const SAFETY = {
    score: 72,
    components: [],
    reasons: [],
    roundedStakes: [245, 255],
    scoredAt: '2026-07-09T12:01:00Z',
  };
  // Constructed from local components (not a UTC ISO string) so the
  // expected HH:MM is identical no matter the host machine's timezone.
  const ODDS_AS_OF = new Date(2026, 6, 9, 14, 5);

  it('produces the exact pinned format (Phase 17): ROUNDED stakes, post-rounding profit, one Safety line — nothing else', () => {
    const arb = makeArb({ safety: SAFETY });
    const id = opportunityFingerprint(arb).slice(0, 16);
    const message = formatAlertMessage(arb, 'http://localhost:5173', plan, ODDS_AS_OF);
    // Profit recomputed at the displayed (rounded) stakes so dollars and %
    // agree with the amounts on the page: worst payout min(245×2.1, 255×2.05)
    // = 514.50 − 500 staked = $14.50 = 2.90%.
    expect(message).toBe(
      [
        'Bet365 | Los Angeles Lakers @ 2.1 | $245.00',
        'Pinnacle | Boston Celtics @ 2.05 | $255.00',
        'Profit: $14.50 (2.90%)',
        'Safety 72/100',
        'odds as of 14:05',
        `http://localhost:5173/opportunity/${id}`,
      ].join('\n'),
    );
  });

  it('produces the exact pinned pre-Phase-17 format for an unscored record — byte-identical to the Phase 15 pin', () => {
    const arb = makeArb();
    const id = opportunityFingerprint(arb).slice(0, 16);
    const message = formatAlertMessage(arb, 'http://localhost:5173', plan, ODDS_AS_OF);
    expect(message).toBe(
      [
        'Bet365 | Los Angeles Lakers @ 2.1 | $246.99',
        'Pinnacle | Boston Celtics @ 2.05 | $253.01',
        'Profit: $18.68 (2.34%)',
        'odds as of 14:05',
        `http://localhost:5173/opportunity/${id}`,
      ].join('\n'),
    );
  });

  it('a rounding that zeroed a leg falls back to plan dollars (never $0 nonsense) — safety line intact', () => {
    // Only reachable with safeMode OFF (rounding_kills_edge hard-rejects).
    const arb = makeArb({
      safety: { ...SAFETY, score: 0, reasons: ['rounding_kills_edge'], roundedStakes: [0, 255] },
    });
    const message = formatAlertMessage(arb, undefined, plan, ODDS_AS_OF);
    expect(message).toContain('$246.99');
    expect(message).not.toContain('$0.00');
    expect(message).toContain('Safety 0/100');
  });

  it('omits the cockpit link line when no APP_URL is configured', () => {
    const message = formatAlertMessage(makeArb(), undefined, plan, ODDS_AS_OF);
    expect(message).not.toContain('/opportunity/');
    expect(message.split('\n')).toHaveLength(4); // 2 legs + profit + odds-as-of, no link
  });

  it('falls back to the engine per-$100 split when no dollar plan is available', () => {
    const message = formatAlertMessage(makeArb(), undefined, undefined, ODDS_AS_OF);
    expect(message).toContain('Bet365 | Los Angeles Lakers @ 2.1 | $48.78');
    expect(message).toContain('Pinnacle | Boston Celtics @ 2.05 | $51.22');
    expect(message).toContain('Profit: $2.34 (2.34%)');

    // A collapsed plan (a book blocks any stake) falls back the same way —
    // never $0 nonsense.
    const blocked = formatAlertMessage(makeArb(), undefined, {
      stakes: [0, 0],
      totalStaked: 0,
      guaranteedProfit: 0,
      capped: true,
      cappedBy: 'pinnacle',
    }, ODDS_AS_OF);
    expect(blocked).not.toContain('$0.00');
    expect(blocked).toContain('$48.78');
  });

  it('shows signed lines for point-based legs', () => {
    const arb = makeArb({
      marketKey: 'spreads',
      legs: [
        { ...makeArb().legs[0], point: -3.5 },
        { ...makeArb().legs[1], point: 3.5 },
      ],
    });
    const message = formatAlertMessage(arb, undefined, undefined, ODDS_AS_OF);
    expect(message).toContain('-3.5');
    expect(message).toContain('+3.5');
  });

  it('contains nothing else — no emoji, event name, sport, or the word "guaranteed" (scored or not)', () => {
    for (const arb of [makeArb(), makeArb({ safety: SAFETY })]) {
      const message = formatAlertMessage(arb, 'http://localhost:5173', plan, ODDS_AS_OF);
      expect(message).not.toContain(arb.eventName);
      expect(message).not.toContain(arb.sportTitle);
      expect(message).not.toContain('🔔');
      expect(message.toLowerCase()).not.toContain('guaranteed');
    }
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

  it('EV alerts: honest format, own threshold, OFF unless the subscription opted in', async () => {
    const evOpp = makeArb({
      eventId: 'evt-ev',
      profitPct: 5.5,
      legs: [
        { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 400, link: null },
      ],
      ev: {
        benchmarkKey: 'pinnacle',
        benchmarkOdds: 1.95,
        fairProbability: 0.5,
        edgePct: 5.5,
        benchmarkLastUpdate: NOW.toISOString(),
      },
    });

    // Format: expected-value framing, no unqualified "guaranteed", ever.
    const message = formatEvAlertMessage(evOpp, 400, 'http://localhost:5173');
    expect(message).toContain('Bet365');
    expect(message).toContain('@2.15');
    expect(message).toContain('Edge 5.5');
    expect(message).toContain('win probability 50%');
    expect(message).toContain('Not guaranteed');
    expect(message.toLowerCase()).not.toMatch(/(?<!not )guaranteed profit/);
    expect(message).toContain('/opportunity/');
    expect(message).not.toContain('Safety'); // unscored → byte-identical Phase 15 copy

    // Phase 17: a scored record gains EXACTLY one trailing Safety line.
    const scored = formatEvAlertMessage(
      {
        ...evOpp,
        safety: { score: 65, components: [], reasons: [], scoredAt: NOW.toISOString() },
      },
      400,
      'http://localhost:5173',
    );
    expect(scored).toBe(`${message}\nSafety 65/100`);

    // Default subscription: EV disabled → nothing sends.
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    const off = await notifyEvBets(
      { store, sender, now: () => NOW, evThresholdPercent: 3 },
      [evOpp],
    );
    expect(off.sentFingerprints).toEqual([]);
    expect(sender.sent).toHaveLength(0);

    // Opted in: sends once, dedups on re-sighting.
    store.data.subscriptions[0].evEnabled = true;
    const on = await notifyEvBets(
      { store, sender, now: () => NOW, evThresholdPercent: 3 },
      [evOpp],
    );
    expect(on.sentFingerprints).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
    const again = await notifyEvBets(
      { store, sender, now: () => NOW, evThresholdPercent: 3 },
      [evOpp],
    );
    expect(again.sentFingerprints).toEqual([]);
  });

  it('middle alerts: cost/payout/breakeven framing, opt-in gated, free middles bypass', async () => {
    const middleBlock = {
      lowLine: 220.5, highLine: 224.5, windowSize: 4, costPct: 2.5, payoutPct: 95,
      breakevenPct: 2.56, freeMiddle: false, pushPossible: false, keyNumbers: [7],
    };
    const middleOpp = makeArb({
      eventId: 'evt-mid',
      profitPct: -2.5,
      legs: [
        { outcome: 'Over', point: 220.5, bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 1.95, stake: 50, link: null },
        { outcome: 'Under', point: 224.5, bookmakerKey: 'coolbet', bookmakerTitle: 'Coolbet', odds: 1.95, stake: 50, link: null },
      ],
      middle: middleBlock,
    });

    const message = formatMiddleAlertMessage(middleOpp, 400);
    expect(message).toContain('Costs $10.00 if it misses');
    expect(message).toContain('pays $380.00');
    expect(message).toContain('(220.5–224.5)');
    expect(message).toContain('hit 2.6%');
    expect(message.toLowerCase()).not.toContain('guaranteed');
    expect(message).not.toContain('Safety'); // unscored → byte-identical Phase 15 copy

    // Phase 17: a scored record uses the ROUNDED stakes as the leg dollar
    // amounts and gains exactly one trailing Safety line.
    const scored = formatMiddleAlertMessage(
      {
        ...middleOpp,
        safety: {
          score: 61,
          components: [],
          reasons: [],
          roundedStakes: [250, 250],
          scoredAt: NOW.toISOString(),
        },
      },
      400,
    );
    expect(scored).toContain(
      'Bet365: Over +220.5 @1.95 ($250.00) / Coolbet: Under +224.5 @1.95 ($250.00)',
    );
    expect(scored.endsWith('\nSafety 61/100')).toBe(true);

    // Costed middles need the opt-in; default subscription has none.
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    const off = await notifyMiddleBets(
      { store, sender, now: () => NOW, maxBreakevenPct: 4, stake: 400 },
      [middleOpp],
    );
    expect(off.sentFingerprints).toEqual([]);

    store.data.subscriptions[0].middleEnabled = true;
    const on = await notifyMiddleBets(
      { store, sender, now: () => NOW, maxBreakevenPct: 4, stake: 400 },
      [middleOpp],
    );
    expect(on.sentFingerprints).toHaveLength(1);

    // Free middles bypass the opt-in and MAY say guaranteed.
    const freeOpp = makeArb({
      eventId: 'evt-free',
      profitPct: 3.74,
      middle: { ...middleBlock, costPct: -3.74, breakevenPct: -3.6, freeMiddle: true },
    });
    store.data.subscriptions[0].middleEnabled = false;
    const free = await notifyMiddleBets(
      { store, sender, now: () => NOW, maxBreakevenPct: 4, stake: 400 },
      [freeOpp],
    );
    expect(free.sentFingerprints).toHaveLength(1);
    expect(sender.sent[sender.sent.length - 1].body.toLowerCase()).toContain('free middle');
    expect(sender.sent[sender.sent.length - 1].body.toLowerCase()).toContain('guaranteed');
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

  it('reports a failed send as not sent once retries are exhausted', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = WHATSAPP_MAX_SEND_RETRIES + 1; // every attempt fails
    const { sentFingerprints } = await notifyNewOpportunities(
      { store, sender, now: () => NOW },
      [makeArb()],
    );
    expect(sentFingerprints).toEqual([]);
  });

  it('retries a transient failure up to the cap and still delivers', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = WHATSAPP_MAX_SEND_RETRIES; // fails every attempt but the last
    const { sentFingerprints } = await notifyNewOpportunities(
      { store, sender, now: () => NOW },
      [makeArb()],
    );
    expect(sentFingerprints).toEqual([opportunityFingerprint(makeArb())]);
    expect(sender.sent).toHaveLength(1);
    // A recovered send is a success — no lingering failure record.
    expect(store.data.lastDeliveryFailure).toBeNull();
  });

  it('deactivates the subscription after consecutive send failures', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = WHATSAPP_MAX_CONSECUTIVE_FAILURES * (WHATSAPP_MAX_SEND_RETRIES + 1);
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
    sender.failNext = WHATSAPP_MAX_SEND_RETRIES + 1;
    const deps = { store, sender, now: () => NOW };

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-fail' })]);
    expect(store.data.subscriptions[0].failedSendCount).toBe(1);

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-ok' })]);
    expect(store.data.subscriptions[0].failedSendCount).toBe(0);
    expect(store.data.subscriptions[0].active).toBe(true);
  });

  it('persists a sanitized lastDeliveryFailure once retries are exhausted, cleared by the next success', async () => {
    const store = new FakeStore(makeData());
    const sender = new FakeSender();
    sender.failNext = WHATSAPP_MAX_SEND_RETRIES + 1;
    const deps = { store, sender, now: () => NOW };

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-fail' })]);
    expect(store.data.lastDeliveryFailure).not.toBeNull();
    expect(store.data.lastDeliveryFailure!.at).toBe(NOW.toISOString());
    expect(store.data.lastDeliveryFailure!.detail).not.toContain('+14165551234');

    await notifyNewOpportunities(deps, [makeArb({ eventId: 'evt-ok' })]);
    expect(store.data.lastDeliveryFailure).toBeNull();
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

describe('sanitizeFailureDetail', () => {
  it('strips phone numbers and SID/token-shaped strings, keeps the rest', () => {
    const detail = sanitizeFailureDetail(
      new Error(
        "WhatsApp send failed: HTTP 400 — Twilio 21211: The 'To' number +14165551234 is " +
          'not a valid phone number for account AC1234567890abcdef1234567890abcd.',
      ),
    );
    expect(detail).not.toContain('+14165551234');
    expect(detail).not.toContain('AC1234567890abcdef1234567890abcd');
    expect(detail).toContain('not a valid phone number');
  });

  it('handles non-Error throwables', () => {
    expect(sanitizeFailureDetail('plain string failure')).toContain('plain string failure');
  });
});
