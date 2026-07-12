import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GradeResult, OpportunityRecord, RecordGrading } from '@shared/types';
import { HubService, parseProfileInput } from './hubService';
import { HubProfileStore } from './profileStore';

function grading(result: GradeResult, pnlPer100: number, flags: string[] = [], source: 'auto' | 'manual' = 'auto'): RecordGrading {
  return {
    result,
    legResults: [result],
    pnlPer100,
    flags,
    gradedAt: '2026-07-20T00:00:00Z',
    source,
    audit: [{ at: '2026-07-20T00:00:00Z', old: null, next: result }],
  };
}

function rec(overrides: Partial<OpportunityRecord> & { id: string }): OpportunityRecord {
  return {
    fingerprint: overrides.id.padEnd(64, '0'),
    strategy: 'arb',
    eventId: `evt-${overrides.id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Away @ Home',
    commenceTime: '2026-07-21T00:00:00Z',
    marketKey: 'h2h',
    legs: [{ outcome: 'Home', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2, stake: 100, link: null }],
    profitPctAtDetection: 3,
    profitPct: 3,
    arbIndex: 0.97,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca_us',
    detectedAt: '2026-07-20T00:00:00Z',
    lastSeenAt: '2026-07-20T00:00:00Z',
    statusChangedAt: '2026-07-20T00:00:00Z',
    alerted: false,
    alertedAt: null,
    schemaVersion: 2,
    ...overrides,
  };
}

function arb(id: string, edge: number, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({ id, strategy: 'arb', profitPctAtDetection: edge, profitPct: edge, grading: g, ...extra });
}

function ev(id: string, edgePct: number, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({
    id,
    strategy: 'ev',
    grading: g,
    ev: { benchmarkKey: 'pinnacle', benchmarkOdds: 2, fairProbability: 0.5, edgePct, benchmarkLastUpdate: '2026-07-20T00:00:00Z' },
    ...extra,
  });
}

function middle(id: string, payoutPct: number, g?: RecordGrading, extra: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return rec({
    id,
    strategy: 'middle',
    grading: g,
    middle: { lowLine: 219.5, highLine: 220.5, windowSize: 1, costPct: -1, payoutPct, breakevenPct: -1, freeMiddle: true, pushPossible: false, keyNumbers: [] },
    ...extra,
  });
}

describe('HubService', () => {
  let dir: string;
  let records: OpportunityRecord[];
  let clockMs: number;

  function makeService(): HubService {
    return new HubService({
      store: new HubProfileStore(join(dir, 'hub.json')),
      records: async () => records,
      now: () => new Date(clockMs),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-'));
    records = [];
    clockMs = Date.parse('2026-07-20T12:00:00Z');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('seeds the three premade profiles on first read, editable but not deletable', async () => {
    const hub = makeService();
    const profiles = await hub.listProfiles();
    expect(profiles.map((p) => p.name)).toEqual(['Arb', 'EV', 'Middles']);
    for (const p of profiles) {
      expect(p.premade).toBe(true);
      expect(p.startingBankroll).toBe(1000);
      expect(p.stake).toEqual({ type: 'flat', value: 50 });
      expect(p.minEdgePct).toBe(0);
    }
    expect(profiles.find((p) => p.name === 'Arb')!.strategies).toEqual(['arb']);
    expect(profiles.find((p) => p.name === 'EV')!.strategies).toEqual(['ev']);
    expect(profiles.find((p) => p.name === 'Middles')!.strategies).toEqual(['middle']);

    // Seeding is idempotent — a second read does not duplicate premades.
    expect((await hub.listProfiles()).length).toBe(3);
  });

  it('refuses to delete a premade (409 signal) but deletes customs', async () => {
    const hub = makeService();
    const [arbPremade] = await hub.listProfiles();
    expect(await hub.deleteProfile(arbPremade.id)).toBe('premade');
    expect(await hub.deleteProfile('nope')).toBe('not_found');

    const custom = await hub.createProfile({ name: 'Mine', startingBankroll: 500, stake: { type: 'flat', value: 25 }, strategies: ['arb'], minEdgePct: 1 });
    expect(await hub.deleteProfile(custom.id)).toBe('ok');
    expect((await hub.listProfiles()).some((p) => p.id === custom.id)).toBe(false);
  });

  it('purchases only confirmed records matching a profile filter (strategy + minEdgePct)', async () => {
    const hub = makeService();
    const custom = await hub.createProfile({ name: 'Arb≥2', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb'], minEdgePct: 2 });

    records = [
      arb('a1', 3), // matches
      arb('a2', 1), // edge below 2 → skipped by filter
      ev('e1', 9), // wrong strategy
      arb('a3', 2, undefined, { suspicious: true }), // suspicious → never bet
    ];
    await hub.onConfirmed(records);

    const report = (await hub.reports()).find((r) => r.profile.id === custom.id)!;
    expect(report.positions.map((p) => p.purchase.recordId)).toEqual(['a1']);
    expect(report.betCount).toBe(1);
    expect(report.pending).toBe(1);
    expect(report.exposure).toBe(50);
  });

  it('routes middles by payoutPct as the headline edge', async () => {
    const hub = makeService();
    const mid = await hub.createProfile({ name: 'FatMiddles', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['middle'], minEdgePct: 2 });
    records = [middle('m1', 3), middle('m2', 1)];
    await hub.onConfirmed(records);
    const report = (await hub.reports()).find((r) => r.profile.id === mid.id)!;
    expect(report.positions.map((p) => p.purchase.recordId)).toEqual(['m1']);
  });

  it('stakes flat dollars and percent-of-STARTING bankroll (no compounding)', async () => {
    const hub = makeService();
    const flat = await hub.createProfile({ name: 'Flat', startingBankroll: 1000, stake: { type: 'flat', value: 40 }, strategies: ['arb'], minEdgePct: 0 });
    const pct = await hub.createProfile({ name: 'Pct', startingBankroll: 2000, stake: { type: 'pctOfStart', value: 5 }, strategies: ['arb'], minEdgePct: 0 });

    // First bet wins big; a %-of-START stake must NOT grow off the new bankroll.
    records = [arb('a1', 3, grading('win', 100)), arb('a2', 3, grading('win', 100))];
    await hub.onConfirmed(records);
    const reports = await hub.reports();
    const flatR = reports.find((r) => r.profile.id === flat.id)!;
    const pctR = reports.find((r) => r.profile.id === pct.id)!;
    expect(flatR.positions.every((p) => p.purchase.stake === 40)).toBe(true);
    expect(pctR.positions.every((p) => p.purchase.stake === 100)).toBe(true); // 5% of 2000, both bets
  });

  it('settles graded fixtures (win/loss/push/void) into equity, W/L/push/void, ROI, drawdown', async () => {
    const hub = makeService();
    const p = await hub.createProfile({ name: 'S', startingBankroll: 1000, stake: { type: 'flat', value: 100 }, strategies: ['arb'], minEdgePct: 0 });

    records = [
      arb('a1', 3, grading('win', 5)), // +5
      arb('a2', 3, grading('loss', -100)), // -100
      arb('a3', 3, grading('push', 0)), // 0
      arb('a4', 3, grading('void', 0)), // 0
    ];
    // Purchase each in its own tick so the equity curve is strictly ordered.
    for (const r of records) {
      clockMs += 1000;
      await hub.onConfirmed([r]);
    }

    const report = (await hub.reports()).find((r) => r.profile.id === p.id)!;
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(1);
    expect(report.pushes).toBe(1);
    expect(report.voids).toBe(1);
    expect(report.pending).toBe(0);
    expect(report.pnl).toBe(-95); // +5 -100 +0 +0
    expect(report.bankroll).toBe(905);
    expect(report.roiPct).toBe(-9.5);
    expect(report.equity.map((e) => e.bankroll)).toEqual([1005, 905, 905, 905]);
    expect(report.maxDrawdown).toBe(100); // peak 1005 → trough 905
    const positions = report.positions;
    expect(positions[0]).toMatchObject({ result: 'win', pnl: 5, gradeSource: 'auto' });
    expect(positions[1]).toMatchObject({ result: 'loss', pnl: -100 });
  });

  it('counts pending (ungraded) positions as exposure, not equity', async () => {
    const hub = makeService();
    const p = await hub.createProfile({ name: 'X', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb'], minEdgePct: 0 });
    records = [arb('a1', 3, grading('win', 10)), arb('a2', 3 /* pending */), arb('a3', 3 /* pending */)];
    await hub.onConfirmed(records);
    const report = (await hub.reports()).find((r) => r.profile.id === p.id)!;
    expect(report.betCount).toBe(3);
    expect(report.pending).toBe(2);
    expect(report.exposure).toBe(100); // 2 × $50
    expect(report.equity).toHaveLength(1); // only the graded win
    expect(report.pnl).toBe(5);
  });

  it('logs a skipped_insufficient_bankroll event when realized bankroll < stake', async () => {
    const hub = makeService();
    const p = await hub.createProfile({ name: 'Broke', startingBankroll: 100, stake: { type: 'flat', value: 60 }, strategies: ['arb'], minEdgePct: 0 });

    // First bet loses everything stakeable-ish; the store's realized bankroll
    // drops to 40, below the $60 stake → the next confirmation is skipped.
    records = [arb('a1', 3, grading('loss', -100))]; // -$60 → bankroll 40
    clockMs += 1000;
    await hub.onConfirmed(records);
    records = [records[0], arb('a2', 3, grading('win', 5))];
    clockMs += 1000;
    await hub.onConfirmed(records);

    const report = (await hub.reports()).find((r) => r.profile.id === p.id)!;
    expect(report.betCount).toBe(1); // only a1 was actually purchased
    expect(report.skipped.count).toBe(1);
    expect(report.skipped.events[0].recordId).toBe('a2');
  });

  it('is idempotent across re-runs — a record is purchased or skipped at most once', async () => {
    const hub = makeService();
    await hub.listProfiles(); // seed
    records = [arb('a1', 3, grading('win', 5))];
    await hub.onConfirmed(records);
    await hub.onConfirmed(records);
    await hub.onConfirmed(records);
    const arbReport = (await hub.reports()).find((r) => r.profile.name === 'Arb')!;
    expect(arbReport.betCount).toBe(1);
  });

  it('runs a custom profile end-to-end: create → purchase (pending) → grade → report', async () => {
    const hub = makeService();
    const custom = await hub.createProfile({ name: 'E2E', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb', 'ev'], minEdgePct: 3 });

    const r = arb('a1', 4); // pending, no grading yet
    records = [r];
    await hub.onConfirmed(records);
    let report = (await hub.reports()).find((x) => x.profile.id === custom.id)!;
    expect(report.pending).toBe(1);
    expect(report.exposure).toBe(50);
    expect(report.pnl).toBe(0);

    // Grade the SAME record in place; the report re-derives from record.grading.
    r.grading = grading('win', 8);
    report = (await hub.reports()).find((x) => x.profile.id === custom.id)!;
    expect(report.pending).toBe(0);
    expect(report.wins).toBe(1);
    expect(report.pnl).toBe(4); // 50 × 8 / 100
    expect(report.simulated).toBe(true);
    expect(report.positions[0]).toMatchObject({ result: 'win', pnl: 4, gradeSource: 'auto', gradeFlags: [] });
  });

  it('every report payload is labelled simulated: true', async () => {
    const hub = makeService();
    const reports = await hub.reports();
    expect(reports.length).toBe(3);
    expect(reports.every((r) => r.simulated === true)).toBe(true);
  });

  it('updates a profile (premade stake/filters editable)', async () => {
    const hub = makeService();
    const [arbPremade] = await hub.listProfiles();
    const updated = await hub.updateProfile(arbPremade.id, { stake: { type: 'pctOfStart', value: 3 }, minEdgePct: 1.5 });
    expect(updated).toMatchObject({ id: arbPremade.id, premade: true, minEdgePct: 1.5, stake: { type: 'pctOfStart', value: 3 } });
    expect(await hub.updateProfile('nope', { minEdgePct: 1 })).toBeNull();
  });
});

describe('parseProfileInput', () => {
  it('accepts a well-formed profile', () => {
    const parsed = parseProfileInput({ name: 'Good', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb', 'ev'], minEdgePct: 2 });
    expect(parsed.ok).toBe(true);
  });

  it('rejects bad shapes', () => {
    expect(parseProfileInput({ name: '', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb'], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 0, stake: { type: 'flat', value: 50 }, strategies: ['arb'], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 1000, stake: { type: 'weird', value: 50 }, strategies: ['arb'], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 1000, stake: { type: 'flat', value: -1 }, strategies: ['arb'], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: [], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['nope'], minEdgePct: 0 }).ok).toBe(false);
    expect(parseProfileInput({ name: 'x', startingBankroll: 1000, stake: { type: 'flat', value: 50 }, strategies: ['arb'], minEdgePct: -1 }).ok).toBe(false);
  });
});
