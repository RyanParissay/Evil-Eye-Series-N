import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { OPPORTUNITY_ARCHIVE_AFTER_MS } from '../config/constants';
import { opportunityFingerprint } from './opportunityId';
import { OpportunityService } from './opportunityService';
import type { OpportunityData, OpportunityDataStore } from './opportunityStore';

const NOW = new Date('2026-07-09T12:00:00Z');
const SCOPE = { sportsScanned: ['basketball_nba'], regionTab: 'ca' };

class FakeStore implements OpportunityDataStore {
  constructor(public data: OpportunityData = { records: [] }) {}
  async read(): Promise<OpportunityData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: OpportunityData,
    ) => { data: OpportunityData; result: T } | Promise<{ data: OpportunityData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeArchive {
  appended: OpportunityRecord[][] = [];
  failNext = false;
  async append(records: OpportunityRecord[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('disk full');
    }
    this.appended.push(records);
  }
}

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
      { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'Celtics', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    sameBookmaker: false,
    suspicious: false,
    ...overrides,
  };
}

describe('OpportunityService', () => {
  it('recordScan persists new records; get and list find them', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);

    const listed = await service.list('active');
    expect(listed).toHaveLength(1);
    expect(await service.get(listed[0].id)).toMatchObject({ eventName: 'Lakers @ Celtics' });
    expect(await service.get('nope')).toBeNull();
  });

  it('markAlerted flags matching fingerprints once', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    const arb = makeArb();
    await service.recordScan([arb], SCOPE);

    await service.markAlerted([opportunityFingerprint(arb)]);
    const [record] = await service.list();
    expect(record.alerted).toBe(true);
    expect(record.alertedAt).toBe(NOW.toISOString());

    // A second call must not move alertedAt.
    const later = new OpportunityService(store, new FakeArchive(), () => new Date(NOW.getTime() + 60_000));
    await later.markAlerted([opportunityFingerprint(arb)]);
    expect((await service.list())[0].alertedAt).toBe(NOW.toISOString());
  });

  it('updateStatus completes a record by id and reports the updated record', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();

    const outcome = await service.updateStatus(record.id, 'completed');
    expect(outcome).toMatchObject({ ok: true, record: { id: record.id, status: 'completed' } });
    expect((await service.get(record.id))?.status).toBe('completed');
  });

  it('updateStatus distinguishes unknown ids from invalid transitions', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();
    await service.recordScan([], SCOPE); // kills it: sport rescanned, fingerprint gone

    expect(await service.updateStatus('nope', 'completed')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(await service.updateStatus(record.id, 'degraded')).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect((await service.get(record.id))?.status).toBe('dead');
  });

  it('stamps new records with the arb strategy discriminator', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    expect((await service.list())[0].strategy).toBe('arb');
  });

  it('completing with filled legs books the execution money', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();

    const outcome = await service.updateStatus(record.id, 'completed', [
      { odds: 2.08, stake: 240 },
      { odds: 2.05, stake: 260 },
    ]);
    expect(outcome.ok).toBe(true);
    const stored = await service.get(record.id);
    expect(stored?.execution).toMatchObject({
      totalStaked: 500,
      recordedAt: NOW.toISOString(),
    });
    // Worst payout: min(240×2.08, 260×2.05) = min(499.2, 533) → −0.80.
    expect(stored?.execution?.lockedProfit).toBeCloseTo(-0.8, 2);
  });

  it('rejects filled legs that do not align with the record legs', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();
    const outcome = await service.updateStatus(record.id, 'completed', [{ odds: 2.1, stake: 100 }]);
    expect(outcome).toMatchObject({ ok: false, reason: 'bad_request' });
    expect((await service.get(record.id))?.status).toBe('active');
  });

  it('funnel steps are first-write-wins and stale ids report not_found', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();

    expect(await service.recordFunnelStep(record.id, 'cockpitOpenedAt')).toMatchObject({ ok: true });
    const later = new OpportunityService(store, new FakeArchive(), () => new Date(NOW.getTime() + 60_000));
    await later.recordFunnelStep(record.id, 'cockpitOpenedAt'); // second tap: no-op
    expect((await service.get(record.id))?.funnel?.cockpitOpenedAt).toBe(NOW.toISOString());
    expect(await service.recordFunnelStep('nope', 'cockpitOpenedAt')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('applyVerification stamps the funnel and appends the verify outcome', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();

    await service.applyVerification(record.id, [2.05, 2.02]); // shrinks → degraded
    const stored = await service.get(record.id);
    expect(stored?.funnel?.verifyPressedAt).toBe(NOW.toISOString());
    expect(stored?.verifies).toHaveLength(1);
    expect(stored?.verifies?.[0]).toMatchObject({ at: NOW.toISOString(), outcome: 'degraded' });
    expect(stored?.verifies?.[0].profitPct).toBeCloseTo(stored!.profitPct, 6);
  });

  it('grading an EV completion sets realized money exactly: won / lost / void', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    const evArb = makeArb({
      legs: [{ outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 100, link: null }],
      ev: { benchmarkKey: 'pinnacle', benchmarkOdds: 1.95, fairProbability: 0.5, edgePct: 7.5, benchmarkLastUpdate: NOW.toISOString() },
    });
    await service.recordScan([evArb], SCOPE);
    const [record] = await service.list();
    await service.updateStatus(record.id, 'completed', [{ odds: 2.1, stake: 400 }]);

    const won = await service.grade(record.id, 'won');
    expect(won.ok).toBe(true);
    expect((await service.get(record.id))?.execution?.lockedProfit).toBeCloseTo(400 * 1.1, 2);

    // Regrade allowed while balances are unapplied.
    await service.grade(record.id, 'lost');
    expect((await service.get(record.id))?.execution?.lockedProfit).toBeCloseTo(-400, 2);
    await service.grade(record.id, 'void');
    expect((await service.get(record.id))?.execution?.lockedProfit).toBe(0);
  });

  it('grading guards: arbs never grade; ungraded and uncompleted refuse cleanly', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE); // a true arb
    const [arb] = await service.list();
    await service.updateStatus(arb.id, 'completed', [
      { odds: 2.1, stake: 240 },
      { odds: 2.05, stake: 260 },
    ]);
    expect(await service.grade(arb.id, 'won')).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await service.grade('nope', 'won')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('per-leg grading (middles): hit, single-side, and push reconcile to the cent', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    const middleArb = makeArb({
      profitPct: -2.5,
      middle: {
        lowLine: 220.5, highLine: 224.5, windowSize: 4, costPct: 2.5, payoutPct: 95,
        breakevenPct: 2.56, freeMiddle: false, pushPossible: false, keyNumbers: [],
      },
    });
    await service.recordScan([middleArb], SCOPE);
    const [record] = await service.list();
    await service.updateStatus(record.id, 'completed', [
      { odds: 1.95, stake: 250 },
      { odds: 1.95, stake: 250 },
    ]);

    // Middle hit: both legs won → +237.50 each side = +475.
    const hit = await service.gradeLegs(record.id, ['won', 'won']);
    expect(hit.ok).toBe(true);
    expect((await service.get(record.id))?.execution?.lockedProfit).toBeCloseTo(475, 2);

    // Side A only: +237.50 − 250 = −12.50 (the classic middle cost).
    await service.gradeLegs(record.id, ['won', 'lost']);
    expect((await service.get(record.id))?.execution?.lockedProfit).toBeCloseTo(-12.5, 2);

    // Push on leg A (void), side B won: 0 + 237.50.
    await service.gradeLegs(record.id, ['void', 'won']);
    expect((await service.get(record.id))?.execution?.lockedProfit).toBeCloseTo(237.5, 2);
    expect((await service.get(record.id))?.execution?.legGrades).toEqual(['void', 'won']);
  });

  it('gradeLegs guards: arbs and EV refuse; alignment enforced', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [arb] = await service.list();
    await service.updateStatus(arb.id, 'completed', [
      { odds: 2.1, stake: 240 },
      { odds: 2.05, stake: 260 },
    ]);
    expect(await service.gradeLegs(arb.id, ['won', 'won'])).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
  });

  it('applyGrading and setGradingFlag report not_found for unknown ids', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    expect(
      await service.applyGrading('nope', {
        result: 'win',
        legResults: ['win'],
        pnlPer100: 100,
        flags: [],
        gradedAt: NOW.toISOString(),
        source: 'auto',
        audit: [],
      }),
    ).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await service.setGradingFlag('nope', 'needs_rules')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('setGradingFlag accumulates distinct flags without duplicating them', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();

    await service.setGradingFlag(record.id, 'needs_rules');
    await service.setGradingFlag(record.id, 'needs_rules'); // idempotent
    await service.setGradingFlag(record.id, 'ungraded_stale');

    expect((await service.get(record.id))?.gradingFlags).toEqual(['needs_rules', 'ungraded_stale']);
  });

  it('applyGrading writes record.grading and clears gradingFlags', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    const [record] = await service.list();
    await service.setGradingFlag(record.id, 'needs_rules');

    const outcome = await service.applyGrading(record.id, {
      result: 'win',
      legResults: ['win', 'win'],
      pnlPer100: 100,
      flags: [],
      gradedAt: NOW.toISOString(),
      source: 'auto',
      audit: [{ at: NOW.toISOString(), old: null, next: 'win' }],
    });
    expect(outcome.ok).toBe(true);
    const stored = await service.get(record.id);
    expect(stored?.grading?.result).toBe('win');
    expect(stored?.gradingFlags).toEqual([]);
  });

  it('ages settled records into the archive and drops them from the active file', async () => {
    const store = new FakeStore();
    const archive = new FakeArchive();
    const service = new OpportunityService(store, archive, () => NOW);
    await service.recordScan([makeArb()], SCOPE);

    // Kill it, then age it past the window and rescan to trigger archiving.
    await service.recordScan([], SCOPE);
    store.data.records[0].statusChangedAt = new Date(
      NOW.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS - 1,
    ).toISOString();
    await service.recordScan([], SCOPE);

    expect(archive.appended.flat()).toHaveLength(1);
    expect(store.data.records).toHaveLength(0);
  });

  it('keeps records in the active file when the archive append fails', async () => {
    const store = new FakeStore();
    const archive = new FakeArchive();
    const service = new OpportunityService(store, archive, () => NOW);
    await service.recordScan([makeArb()], SCOPE);
    await service.recordScan([], SCOPE);
    store.data.records[0].statusChangedAt = new Date(
      NOW.getTime() - OPPORTUNITY_ARCHIVE_AFTER_MS - 1,
    ).toISOString();

    archive.failNext = true;
    await service.recordScan([], SCOPE);
    expect(store.data.records).toHaveLength(1); // nothing lost
  });
});

describe('OpportunityService — confirmation pipeline (Phase 16 Part A)', () => {
  it('recordScan reports the pending-candidate count — the scan-B trigger', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    const withCandidate = await service.recordScan([makeArb()], SCOPE);
    expect(withCandidate.pendingCandidates).toBe(1);

    const suspiciousOnly = await service.recordScan(
      [makeArb({ eventId: 'evt-sus', suspicious: true })],
      SCOPE,
    );
    expect(suspiciousOnly.pendingCandidates).toBe(0);
  });

  it('pendingConfirmations returns exactly the records awaiting scan B', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb(), makeArb({ eventId: 'evt-sus', suspicious: true })], SCOPE);

    const pending = await service.pendingConfirmations();
    expect(pending).toHaveLength(1);
    expect(pending[0].confirmation?.status).toBe('pending');
    expect(pending[0].eventId).toBe('evt-1');
  });

  it('applyConfirmations moves only still-pending records and returns the confirmed ones', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb(), makeArb({ eventId: 'evt-2' })], SCOPE);
    const [a, b] = store.data.records;

    const scanBAt = '2026-07-09T12:01:00Z';
    const confirmed = await service.applyConfirmations([
      { fingerprint: a.fingerprint, status: 'confirmed', scanBAt, edgeDeltaPp: 0.2 },
      { fingerprint: b.fingerprint, status: 'single_sighting', scanBAt },
      { fingerprint: 'unknown', status: 'confirmed', scanBAt },
    ]);
    expect(confirmed.map((r) => r.fingerprint)).toEqual([a.fingerprint]);
    expect(a.confirmation).toMatchObject({ status: 'confirmed', scanBAt, edgeDeltaPp: 0.2 });
    expect(b.confirmation).toMatchObject({ status: 'single_sighting', scanBAt });
    expect(b.confirmation?.edgeDeltaPp).toBeUndefined();

    // Terminal states never move again (idempotent under scan/B races).
    const again = await service.applyConfirmations([
      { fingerprint: a.fingerprint, status: 'single_sighting', scanBAt: '2026-07-09T13:00:00Z' },
    ]);
    expect(again).toEqual([]);
    expect(a.confirmation?.status).toBe('confirmed');
  });

  it('expirePendingConfirmations resolves every pending record to single_sighting', async () => {
    const store = new FakeStore();
    const service = new OpportunityService(store, new FakeArchive(), () => NOW);
    await service.recordScan([makeArb(), makeArb({ eventId: 'evt-2' })], SCOPE);

    const expired = await service.expirePendingConfirmations();
    expect(expired).toBe(2);
    for (const record of store.data.records) {
      expect(record.confirmation).toMatchObject({
        status: 'single_sighting',
        scanBAt: NOW.toISOString(),
      });
    }
    expect(await service.expirePendingConfirmations()).toBe(0);
  });
});
