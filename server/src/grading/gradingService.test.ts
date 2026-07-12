/**
 * GradingService (Phase 13). GRADING_RULES.md §4 is binding. Several of
 * these tests correspond 1:1 to grading.golden.test.ts's numbering
 * (acceptance/2, 11, 13, 14, 15) — see docs/prompts/phase-13.md deliverable
 * 7. Never calls the live provider: fetchScores is always a hand-built fake.
 */
import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord, RecordGrading } from '@shared/types';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityArchiveWriter, OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import { GradingService, gradedRecordsCsv, gradingBuckets, type ScoresProvider } from './gradingService';
import type { GradingData, GradingDataStore } from './gradingStore';

const NOW = new Date('2026-07-11T23:00:00Z');
const COMMENCE = '2026-07-11T19:00:00Z'; // 4h before NOW — NBA first-poll (2.5h+0.5h) is due
const SCOPE = { sportsScanned: ['basketball_nba'], regionTab: 'ca' };

class FakeOppStore implements OpportunityDataStore {
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

class FakeArchive implements OpportunityArchiveWriter {
  async append(): Promise<void> {}
}

class FakeGradingStore implements GradingDataStore {
  constructor(public data: GradingData = { daily: { date: '', credits: 0 }, events: {} }) {}
  async read(): Promise<GradingData> {
    return this.data;
  }
  async update<T>(
    mutate: (data: GradingData) => { data: GradingData; result: T } | Promise<{ data: GradingData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

interface FakeScore {
  eventId: string;
  completed: boolean;
  home: number | null;
  away: number | null;
  homeTeam: string;
  awayTeam: string;
}

/** Never hits the network — the binding rule for these tests. */
function fakeProvider(bySport: Record<string, FakeScore[]>): ScoresProvider & {
  calls: Array<{ sportKey: string; eventIds?: readonly string[] }>;
} {
  const calls: Array<{ sportKey: string; eventIds?: readonly string[] }> = [];
  return {
    calls,
    async fetchScores(sportKey, params) {
      calls.push({ sportKey, eventIds: params.eventIds });
      const all = bySport[sportKey] ?? [];
      const wanted = params.eventIds ? new Set(params.eventIds) : null;
      const scores = wanted ? all.filter((s) => wanted.has(s.eventId)) : all;
      return { scores, usage: { requestsUsedTotal: 1, requestsRemainingTotal: 999, creditsCharged: 1 } };
    },
  };
}

function makeEv(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Boston Celtics @ Los Angeles Lakers',
    commenceTime: COMMENCE,
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Boston Celtics',
    marketKey: 'h2h',
    arbIndex: 1,
    profitPct: 7.5,
    legs: [
      { outcome: 'Los Angeles Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 100, link: null },
    ],
    sameBookmaker: false,
    suspicious: false,
    ev: {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 1.95,
      fairProbability: 0.5,
      edgePct: 7.5,
      benchmarkLastUpdate: COMMENCE,
    },
    ...overrides,
  };
}

async function seed(
  arb: ArbOpportunity = makeEv(),
): Promise<{ opportunities: OpportunityService; record: OpportunityRecord }> {
  const opportunities = new OpportunityService(new FakeOppStore(), new FakeArchive(), () => NOW);
  await opportunities.recordScan([arb], SCOPE);
  const [record] = await opportunities.list();
  return { opportunities, record };
}

const LAKERS_WIN: FakeScore = {
  eventId: 'evt-1',
  completed: true,
  home: 112,
  away: 104,
  homeTeam: 'Los Angeles Lakers',
  awayTeam: 'Boston Celtics',
};

describe('GradingService.poll', () => {
  it('golden 2/acceptance: grades a due EV record from mock scores', async () => {
    const { opportunities, record } = await seed();
    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 1, polled: 1, capped: false });
    expect(provider.calls).toEqual([{ sportKey: 'basketball_nba', eventIds: ['evt-1'] }]);
    const graded = await opportunities.get(record.id);
    expect(graded?.grading).toMatchObject({ result: 'win', source: 'auto', pnlPer100: 115 });
    expect(graded?.gradingFlags).toEqual([]);
  });

  it('golden 15: idempotent — a graded record is never re-polled', async () => {
    const { opportunities } = await seed();
    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    await service.poll();
    expect(provider.calls).toHaveLength(1);

    const second = await service.poll();
    expect(second).toEqual({ graded: 0, polled: 0, capped: false });
    expect(provider.calls).toHaveLength(1); // no second fetch attempted
  });

  it('golden 11: manual override always wins — a later poll leaves it untouched', async () => {
    const { opportunities, record } = await seed();
    const manualDeps = new GradingService(fakeProvider({}), opportunities, new FakeGradingStore(), () => NOW);
    const manual = await manualDeps.manualGrade(record.id, 'loss', 'confirmed off-book');
    expect(manual.ok).toBe(true);

    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] }); // would grade WIN if it ran
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);
    const summary = await service.poll();

    expect(summary.graded).toBe(0);
    expect(provider.calls).toHaveLength(0); // already-graded record never enters a fetch group

    const after = await opportunities.get(record.id);
    expect(after?.grading).toMatchObject({ result: 'loss', source: 'manual', flags: ['manually_graded'] });
    expect(after?.grading?.audit).toEqual([
      { at: NOW.toISOString(), old: null, next: 'loss', note: 'confirmed off-book' },
    ]);
  });

  it('golden 14: gives up after 24h past commence → ungraded_stale, no scores call spent', async () => {
    const farPast = '2026-07-08T00:00:00Z';
    const laterNow = new Date('2026-07-10T00:00:00Z'); // 48h after commence
    const { opportunities, record } = await seed(makeEv({ commenceTime: farPast }));
    const provider = fakeProvider({ basketball_nba: [] });
    const gradingStore = new FakeGradingStore();
    const service = new GradingService(provider, opportunities, gradingStore, () => laterNow);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 0, capped: false });
    expect(provider.calls).toHaveLength(0);
    expect((await opportunities.get(record.id))?.gradingFlags).toContain('ungraded_stale');
    expect(gradingStore.data.events['evt-1']?.staleAt).toBe(laterNow.toISOString());
  });

  it('daily cap: stops polling and reports capped without calling the provider', async () => {
    const { opportunities } = await seed();
    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] });
    const gradingStore = new FakeGradingStore({
      daily: { date: NOW.toISOString().slice(0, 10), credits: 500 },
      events: {},
    });
    const service = new GradingService(provider, opportunities, gradingStore, () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 0, capped: true });
    expect(provider.calls).toHaveLength(0);
  });

  it('sport missing from the rules table: flags needs_rules without spending a scores call', async () => {
    const { opportunities, record } = await seed(makeEv({ sportKey: 'cricket_ipl', sportTitle: 'IPL' }));
    const provider = fakeProvider({});
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 0, capped: false });
    expect(provider.calls).toHaveLength(0);
    expect((await opportunities.get(record.id))?.gradingFlags).toContain('needs_rules');
  });

  it('a completed-but-unresolvable outcome flags needs_rules AFTER spending the scores call', async () => {
    const { opportunities, record } = await seed(
      makeEv({
        legs: [
          { outcome: 'Some Other Team', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.0, stake: 100, link: null },
        ],
      }),
    );
    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 1, capped: false });
    expect(provider.calls).toHaveLength(1); // unlike the missing-sport path, this one costs a credit
    expect((await opportunities.get(record.id))?.gradingFlags).toContain('needs_rules');
  });

  it('not due yet: skips a record whose first-poll moment is still in the future', async () => {
    const { opportunities } = await seed(
      makeEv({ commenceTime: new Date(NOW.getTime() - 60 * 60_000).toISOString() }), // only 1h old; NBA needs 3h
    );
    const provider = fakeProvider({ basketball_nba: [] });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 0, capped: false });
    expect(provider.calls).toHaveLength(0);
  });

  it('respects the 45-min retry spacing via lastPollAt', async () => {
    const { opportunities } = await seed();
    const gradingStore = new FakeGradingStore({
      daily: { date: '', credits: 0 },
      events: { 'evt-1': { attempts: 1, lastPollAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), staleAt: null } },
    });
    const provider = fakeProvider({ basketball_nba: [LAKERS_WIN] });
    const service = new GradingService(provider, opportunities, gradingStore, () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 0, capped: false });
    expect(provider.calls).toHaveLength(0);
  });

  it('score not yet completed: stays open for the next retry', async () => {
    const { opportunities, record } = await seed();
    const provider = fakeProvider({
      basketball_nba: [{ eventId: 'evt-1', completed: false, home: null, away: null, homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics' }],
    });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 0, polled: 1, capped: false });
    const after = await opportunities.get(record.id);
    expect(after?.grading).toBeUndefined();
    expect(after?.gradingFlags ?? []).toHaveLength(0);
  });

  it('a completed game with no scores (cancelled) grades void', async () => {
    const { opportunities, record } = await seed();
    const provider = fakeProvider({
      basketball_nba: [{ eventId: 'evt-1', completed: true, home: null, away: null, homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics' }],
    });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary.graded).toBe(1);
    expect((await opportunities.get(record.id))?.grading).toMatchObject({ result: 'void', pnlPer100: 0 });
  });

  it('groups due records by sport — one fetchScores call per sport', async () => {
    const opportunities = new OpportunityService(new FakeOppStore(), new FakeArchive(), () => NOW);
    await opportunities.recordScan(
      [
        makeEv({ eventId: 'evt-1' }),
        makeEv({
          eventId: 'evt-2',
          sportKey: 'baseball_mlb',
          sportTitle: 'MLB',
          commenceTime: '2026-07-11T15:00:00Z', // 8h before NOW — MLB needs 3.5h+0.5h
          homeTeam: 'New York Yankees',
          awayTeam: 'Houston Astros',
          legs: [{ outcome: 'New York Yankees', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 1.9, stake: 100, link: null }],
        }),
      ],
      SCOPE,
    );
    const provider = fakeProvider({
      basketball_nba: [LAKERS_WIN],
      baseball_mlb: [{ eventId: 'evt-2', completed: true, home: 5, away: 3, homeTeam: 'New York Yankees', awayTeam: 'Houston Astros' }],
    });
    const service = new GradingService(provider, opportunities, new FakeGradingStore(), () => NOW);

    const summary = await service.poll();

    expect(summary).toEqual({ graded: 2, polled: 2, capped: false });
    expect(provider.calls.map((c) => c.sportKey).sort()).toEqual(['baseball_mlb', 'basketball_nba']);
  });
});

describe('OpportunityService.applyGrading refusal (defense-in-depth)', () => {
  it('refuses to let an AUTO grading overwrite a manually_graded record', async () => {
    const { opportunities, record } = await seed();
    const manual: RecordGrading = {
      result: 'loss',
      legResults: ['loss'],
      pnlPer100: -100,
      flags: ['manually_graded'],
      gradedAt: NOW.toISOString(),
      source: 'manual',
      audit: [{ at: NOW.toISOString(), old: null, next: 'loss' }],
    };
    await opportunities.applyGrading(record.id, manual);

    const auto: RecordGrading = {
      result: 'win',
      legResults: ['win'],
      pnlPer100: 115,
      flags: [],
      gradedAt: NOW.toISOString(),
      source: 'auto',
      audit: [{ at: NOW.toISOString(), old: null, next: 'win' }],
    };
    const refused = await opportunities.applyGrading(record.id, auto);

    expect(refused).toMatchObject({ ok: false, reason: 'conflict' });
    expect((await opportunities.get(record.id))?.grading?.result).toBe('loss');
  });
});

describe('gradingBuckets', () => {
  function baseRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
    return {
      id: 'abc123',
      fingerprint: 'abc123def456',
      strategy: 'ev',
      eventId: 'evt-1',
      sportKey: 'basketball_nba',
      sportTitle: 'NBA',
      eventName: 'Boston Celtics @ Los Angeles Lakers',
      commenceTime: COMMENCE,
      marketKey: 'h2h',
      legs: [],
      profitPctAtDetection: 5,
      profitPct: 5,
      arbIndex: 1,
      status: 'active',
      suspicious: false,
      sameBookmaker: false,
      regionTab: 'ca',
      detectedAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      statusChangedAt: NOW.toISOString(),
      alerted: false,
      alertedAt: null,
      ...overrides,
    };
  }

  it('golden 13: a record with no schemaVersion and no grading counts as preV13', () => {
    const preV13 = baseRecord(); // no schemaVersion, no grading — legacy record
    const open = baseRecord({ schemaVersion: 2 });
    const graded = baseRecord({
      schemaVersion: 2,
      grading: {
        result: 'win',
        legResults: ['win'],
        pnlPer100: 100,
        flags: [],
        gradedAt: NOW.toISOString(),
        source: 'auto',
        audit: [],
      },
    });
    const needsRules = baseRecord({ schemaVersion: 2, gradingFlags: ['needs_rules'] });
    const stale = baseRecord({ schemaVersion: 2, gradingFlags: ['ungraded_stale'] });

    expect(gradingBuckets([preV13, open, graded, needsRules, stale])).toEqual({
      graded: 1,
      open: 1,
      needsRules: 1,
      stale: 1,
      preV13: 1,
    });
  });

  it('empty input is all zeros', () => {
    expect(gradingBuckets([])).toEqual({ graded: 0, open: 0, needsRules: 0, stale: 0, preV13: 0 });
  });
});

describe('gradedRecordsCsv', () => {
  function baseRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
    return {
      id: 'abc123',
      fingerprint: 'abc123def456',
      strategy: 'arb',
      eventId: 'evt-1',
      sportKey: 'basketball_nba',
      sportTitle: 'NBA',
      eventName: 'Boston Celtics @ Los Angeles Lakers',
      commenceTime: COMMENCE,
      marketKey: 'h2h',
      legs: [],
      profitPctAtDetection: 5,
      profitPct: 5,
      arbIndex: 1,
      status: 'active',
      suspicious: false,
      sameBookmaker: false,
      regionTab: 'ca',
      detectedAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      statusChangedAt: NOW.toISOString(),
      alerted: false,
      alertedAt: null,
      ...overrides,
    };
  }

  function collect(records: OpportunityRecord[]): string[] {
    const chunks: string[] = [];
    gradedRecordsCsv(records, (chunk) => chunks.push(chunk));
    return chunks.join('').split('\n').filter((l) => l.length > 0);
  }

  it('emits a header plus one row per graded record, skipping ungraded ones', () => {
    const graded = baseRecord({
      id: 'graded1',
      grading: {
        result: 'win',
        legResults: ['win'],
        pnlPer100: 12.5,
        flags: ['manually_graded'],
        gradedAt: '2026-07-11T10:00:00Z',
        source: 'manual',
        audit: [],
      },
    });
    const ungraded = baseRecord({ id: 'open1' });

    const lines = collect([graded, ungraded]);
    expect(lines).toHaveLength(2); // header + one graded row
    expect(lines[0]).toBe(
      'id,strategy,sport,event,commence,result,pnl_per_100,source,flags,graded_at',
    );
    expect(lines[1]).toBe(
      [
        '"graded1"',
        '"arb"',
        '"NBA"',
        '"Boston Celtics @ Los Angeles Lakers"',
        `"${COMMENCE}"`,
        '"win"',
        '12.5',
        '"manual"',
        '"manually_graded"',
        '"2026-07-11T10:00:00Z"',
      ].join(','),
    );
  });

  it('formula-defangs and quotes event names for Excel safety', () => {
    const graded = baseRecord({
      id: 'graded2',
      eventName: '=HYPERLINK("evil")',
      grading: {
        result: 'loss',
        legResults: ['loss'],
        pnlPer100: -100,
        flags: [],
        gradedAt: '2026-07-11T10:00:00Z',
        source: 'auto',
        audit: [],
      },
    });
    const lines = collect([graded]);
    expect(lines[1]).toContain('"\'=HYPERLINK(""evil"")"');
  });

  it('empty input is just the header', () => {
    expect(collect([])).toEqual([
      'id,strategy,sport,event,commence,result,pnl_per_100,source,flags,graded_at',
    ]);
  });
});
