import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { OPPORTUNITY_ARCHIVE_AFTER_MS } from '../config/constants';
import { opportunityFingerprint, opportunityIdFromFingerprint } from './opportunityId';
import {
  applyScanToRecords,
  applyStatusChange,
  applyVerification,
  partitionForArchive,
} from './opportunityLifecycle';

const NOW = new Date('2026-07-09T12:00:00Z');
const FUTURE = '2026-07-09T23:00:00Z';
const SCOPE = { sportsScanned: ['basketball_nba'], regionTab: 'ca' };

function makeArb(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: FUTURE,
    marketKey: 'h2h',
    arbIndex: 0.977,
    profitPct: 2.34,
    legs: [
      { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'Celtics', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    sameBookmaker: false,
    suspicious: false,
    ...overrides,
  };
}

function recordFor(arb: ArbOpportunity, overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  const fingerprint = opportunityFingerprint(arb);
  return {
    id: opportunityIdFromFingerprint(fingerprint),
    fingerprint,
    strategy: 'arb',
    eventId: arb.eventId,
    sportKey: arb.sportKey,
    sportTitle: arb.sportTitle,
    eventName: arb.eventName,
    commenceTime: arb.commenceTime,
    marketKey: arb.marketKey,
    legs: arb.legs,
    profitPctAtDetection: arb.profitPct,
    profitPct: arb.profitPct,
    arbIndex: arb.arbIndex,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-09T10:00:00Z',
    lastSeenAt: '2026-07-09T10:00:00Z',
    statusChangedAt: '2026-07-09T10:00:00Z',
    alerted: false,
    alertedAt: null,
    ...overrides,
  };
}

describe('applyScanToRecords', () => {
  it('creates a new active record with detection-time profit preserved', () => {
    const { records, newCount } = applyScanToRecords([], [makeArb()], SCOPE, NOW);
    expect(newCount).toBe(1);
    expect(records[0]).toMatchObject({
      id: records[0].fingerprint.slice(0, 16),
      status: 'active',
      profitPctAtDetection: 2.34,
      regionTab: 'ca',
      detectedAt: NOW.toISOString(),
      alerted: false,
    });
  });

  it('a re-detection updates the record in place — no duplicate, detection profit kept', () => {
    const first = applyScanToRecords([], [makeArb()], SCOPE, NOW).records;
    const later = new Date(NOW.getTime() + 60_000);
    const { records, newCount } = applyScanToRecords(
      first,
      [makeArb({ profitPct: 1.9, arbIndex: 0.981 })],
      SCOPE,
      later,
    );
    expect(newCount).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].profitPct).toBe(1.9);
    expect(records[0].profitPctAtDetection).toBe(2.34);
    expect(records[0].lastSeenAt).toBe(later.toISOString());
  });

  it('re-detection revives a dead record but never a completed one', () => {
    const dead = recordFor(makeArb(), { status: 'dead' });
    const done = recordFor(makeArb({ eventId: 'evt-2' }), { status: 'completed' });
    const { records } = applyScanToRecords(
      [dead, done],
      [makeArb(), makeArb({ eventId: 'evt-2' })],
      SCOPE,
      NOW,
    );
    const byEvent = new Map(records.map((r) => [r.eventId, r.status]));
    expect(byEvent.get('evt-1')).toBe('active');
    expect(byEvent.get('evt-2')).toBe('completed');
  });

  it('marks a record dead when its sport was rescanned on the same tab and it is gone', () => {
    const existing = recordFor(makeArb());
    const { records, deadCount } = applyScanToRecords([existing], [], SCOPE, NOW);
    expect(deadCount).toBe(1);
    expect(records[0].status).toBe('dead');
    expect(records[0].statusChangedAt).toBe(NOW.toISOString());
  });

  it('says nothing about unscanned sports or other tabs', () => {
    const otherSport = recordFor(makeArb({ eventId: 'evt-hockey', sportKey: 'icehockey_nhl' }));
    const otherTab = recordFor(makeArb({ eventId: 'evt-tab' }), { regionTab: 'ca_us' });
    const { records, deadCount } = applyScanToRecords([otherSport, otherTab], [], SCOPE, NOW);
    expect(deadCount).toBe(0);
    expect(records.every((r) => r.status === 'active')).toBe(true);
  });

  it('kills commenced events regardless of scan scope', () => {
    const started = recordFor(
      makeArb({ eventId: 'evt-started', sportKey: 'icehockey_nhl', commenceTime: '2026-07-09T11:00:00Z' }),
    );
    const { records } = applyScanToRecords([started], [], SCOPE, NOW);
    expect(records[0].status).toBe('dead');
  });
});

describe('applyScanToRecords — EV records (strategy discriminator)', () => {
  const EV_BLOCK = {
    benchmarkKey: 'pinnacle',
    benchmarkOdds: 1.95,
    fairProbability: 0.5,
    edgePct: 7.5,
    benchmarkLastUpdate: '2026-07-09T11:55:00Z',
  };
  const evArb = (edgePct = 7.5) =>
    makeArb({
      legs: [
        { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 100, link: null },
      ],
      profitPct: edgePct,
      ev: { ...EV_BLOCK, edgePct },
    });

  it('creates an ev-strategy record carrying the ev context', () => {
    const { records } = applyScanToRecords([], [evArb()], SCOPE, NOW);
    expect(records[0].strategy).toBe('ev');
    expect(records[0].ev).toMatchObject({ benchmarkKey: 'pinnacle', edgePct: 7.5 });
  });

  it('re-detection refreshes the ev context in place', () => {
    const first = applyScanToRecords([], [evArb()], SCOPE, NOW).records;
    const { records } = applyScanToRecords(first, [evArb(5.2)], SCOPE, new Date(NOW.getTime() + 60_000));
    expect(records).toHaveLength(1);
    expect(records[0].ev?.edgePct).toBe(5.2);
    expect(records[0].profitPct).toBe(5.2);
  });
});

describe('applyStatusChange', () => {
  it('completes an active record', () => {
    const record = recordFor(makeArb());
    const change = applyStatusChange(record, 'completed', NOW);
    expect(change.ok).toBe(true);
    expect(record.status).toBe('completed');
    expect(record.statusChangedAt).toBe(NOW.toISOString());
  });

  it('degrades an active record', () => {
    const record = recordFor(makeArb());
    const change = applyStatusChange(record, 'degraded', NOW);
    expect(change.ok).toBe(true);
    expect(record.status).toBe('degraded');
  });

  it('completes a dead record — the bets were placed while it lived', () => {
    const record = recordFor(makeArb(), { status: 'dead' });
    expect(applyStatusChange(record, 'completed', NOW).ok).toBe(true);
    expect(record.status).toBe('completed');
  });

  it('setting the current status again is a no-op success, not a conflict', () => {
    const record = recordFor(makeArb(), { status: 'completed', statusChangedAt: '2026-07-09T10:00:00Z' });
    const change = applyStatusChange(record, 'completed', NOW);
    expect(change.ok).toBe(true);
    expect(record.statusChangedAt).toBe('2026-07-09T10:00:00Z');
  });

  it('never degrades a dead or completed record', () => {
    const dead = recordFor(makeArb(), { status: 'dead' });
    const done = recordFor(makeArb(), { status: 'completed' });
    expect(applyStatusChange(dead, 'degraded', NOW)).toMatchObject({ ok: false });
    expect(applyStatusChange(done, 'degraded', NOW)).toMatchObject({ ok: false });
    expect(dead.status).toBe('dead');
    expect(done.status).toBe('completed');
  });
});

describe('applyVerification', () => {
  // Detection was at 2.34% (odds 2.1 / 2.05 → S ≈ 0.9657).

  it('keeps the record active when fresh odds hold up, updating the numbers', () => {
    const record = recordFor(makeArb());
    expect(applyVerification(record, [2.12, 2.06], NOW)).toBe('active');
    expect(record.status).toBe('active');
    expect(record.legs.map((l) => l.odds)).toEqual([2.12, 2.06]);
    expect(record.arbIndex).toBeCloseTo(1 / 2.12 + 1 / 2.06, 6);
    expect(record.profitPct).toBeGreaterThan(record.profitPctAtDetection);
    expect(record.legs[0].stake + record.legs[1].stake).toBeCloseTo(100, 1);
    expect(record.lastSeenAt).toBe(NOW.toISOString());
  });

  it('degrades when profit shrank materially but is still positive', () => {
    const record = recordFor(makeArb());
    // 2.05/2.02 → S ≈ 0.9829 → ~1.74%: positive, > 0.1pp below 2.34%.
    expect(applyVerification(record, [2.05, 2.02], NOW)).toBe('degraded');
    expect(record.status).toBe('degraded');
    expect(record.profitPct).toBeGreaterThan(0);
    expect(record.statusChangedAt).toBe(NOW.toISOString());
  });

  it('tolerates a tiny wobble below detection profit without degrading', () => {
    const record = recordFor(makeArb());
    // 2.1/1.995 → ~2.31%: within the 0.1pp tolerance of 2.34%.
    expect(applyVerification(record, [2.1, 1.995], NOW)).toBe('active');
  });

  it('kills the record when the profit is gone, keeping the honest numbers', () => {
    const record = recordFor(makeArb());
    expect(applyVerification(record, [1.9, 1.9], NOW)).toBe('dead');
    expect(record.status).toBe('dead');
    expect(record.profitPct).toBeLessThan(0);
  });

  it('kills the record when any leg is no longer offered, leaving numbers as stored', () => {
    const record = recordFor(makeArb());
    expect(applyVerification(record, [2.1, null], NOW)).toBe('dead');
    expect(record.status).toBe('dead');
    expect(record.profitPct).toBe(2.34); // stale numbers stay; the status says why
  });

  it('revives a degraded or dead record whose legs price like new', () => {
    const record = recordFor(makeArb(), { status: 'dead' });
    expect(applyVerification(record, [2.1, 2.05], NOW)).toBe('active');
    expect(record.status).toBe('active');
  });
});

describe('partitionForArchive', () => {
  it('archives settled records past the window, keeps everything else', () => {
    const old = new Date(NOW.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS - 1).toISOString();
    const records = [
      recordFor(makeArb({ eventId: 'evt-old-dead' }), { status: 'dead', statusChangedAt: old }),
      recordFor(makeArb({ eventId: 'evt-old-done' }), { status: 'completed', statusChangedAt: old }),
      recordFor(makeArb({ eventId: 'evt-fresh-dead' }), { status: 'dead', statusChangedAt: NOW.toISOString() }),
      recordFor(makeArb({ eventId: 'evt-old-active' }), { status: 'active', statusChangedAt: old }),
    ];
    const { keep, archive } = partitionForArchive(records, NOW);
    expect(archive.map((r) => r.eventId).sort()).toEqual(['evt-old-dead', 'evt-old-done']);
    expect(keep.map((r) => r.eventId).sort()).toEqual(['evt-fresh-dead', 'evt-old-active']);
  });
});
