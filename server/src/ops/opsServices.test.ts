import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookmakerConfig, OpportunityRecord, ScanLogEntry } from '@shared/types';
import { computeCoverage } from './coverageService';
import { ScanHistoryStore } from './scanHistoryStore';
import { computeSurvival } from './survivalService';
import { computeTelemetry } from './telemetryService';

const NOW = new Date('2026-07-20T12:00:00Z');

/* ————— fixtures ————— */

function logEntry(overrides: Partial<ScanLogEntry>): ScanLogEntry {
  return {
    scannedAt: '2026-07-20T10:00:00Z',
    regionTab: 'ca',
    sportsScanned: ['basketball_nba'],
    creditsComputed: 10,
    requestsUsedTotal: 100,
    distinctBooks: ['bet365', 'pinnacle'],
    eventCount: 12,
    ...overrides,
  };
}

function book(key: string, overrides: Partial<BookmakerConfig> = {}): BookmakerConfig {
  return {
    key,
    title: key,
    enabled: true,
    balance: null,
    status: 'active',
    notes: '',
    firstSeenAt: '2026-07-01T00:00:00Z',
    lastSeenAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function record(overrides: Partial<OpportunityRecord>): OpportunityRecord {
  return {
    id: Math.random().toString(16).slice(2, 18),
    fingerprint: 'f'.repeat(64),
    strategy: 'arb',
    eventId: 'evt',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: '2026-07-21T00:00:00Z',
    marketKey: 'h2h',
    legs: [
      { outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'B', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    profitPctAtDetection: 2.34,
    profitPct: 2.34,
    arbIndex: 0.977,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-20T10:00:00Z',
    lastSeenAt: '2026-07-20T10:00:00Z',
    statusChangedAt: '2026-07-20T10:00:00Z',
    alerted: false,
    alertedAt: null,
    ...overrides,
  };
}

/* ————— scan history store ————— */

describe('ScanHistoryStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scanlog-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('appends monthly JSONL and streams back across month files in order', async () => {
    const store = new ScanHistoryStore(dir);
    await store.append(logEntry({ scannedAt: '2026-06-30T23:00:00Z' }));
    await store.append(logEntry({ scannedAt: '2026-07-01T10:00:00Z' }));
    await store.append(logEntry({ scannedAt: '2026-07-02T10:00:00Z' }));

    const all: ScanLogEntry[] = [];
    for await (const entry of store.entries()) all.push(entry);
    expect(all.map((e) => e.scannedAt)).toEqual([
      '2026-06-30T23:00:00Z',
      '2026-07-01T10:00:00Z',
      '2026-07-02T10:00:00Z',
    ]);
    expect(await store.lastN(2)).toHaveLength(2);
    expect((await store.lastN(2))[1].scannedAt).toBe('2026-07-02T10:00:00Z');
  });
});

/* ————— coverage ————— */

describe('computeCoverage', () => {
  const scans = [
    logEntry({ scannedAt: '2026-07-20T09:00:00Z', distinctBooks: ['bet365', 'pinnacle', 'coolbet'] }),
    logEntry({ scannedAt: '2026-07-20T10:00:00Z', distinctBooks: ['bet365', 'pinnacle'] }),
    logEntry({ scannedAt: '2026-07-20T11:00:00Z', distinctBooks: ['bet365'] }),
    logEntry({ scannedAt: '2026-07-20T11:30:00Z', distinctBooks: ['bet365', 'pinnacle'] }),
  ];
  const books = [
    book('bet365', { balance: 500 }),
    book('pinnacle', { balance: 300 }),
    book('coolbet', { balance: 200 }),
    book('fanduel', { balance: 100 }),
    book('betmgm'), // unfunded, absent — never flagged
    book('disabled', { enabled: false, balance: 50 }), // disabled → excluded
  ];

  it('reconciles appearances, shares, and flags to hand-computed values', () => {
    const report = computeCoverage(scans, books, 10);
    expect(report.scansConsidered).toBe(4);
    const byKey = Object.fromEntries(report.books.map((b) => [b.key, b]));
    expect(byKey.bet365).toMatchObject({ appearances: 4, share: 1, flag: 'ok' });
    expect(byKey.pinnacle).toMatchObject({ appearances: 3, share: 0.75, flag: 'ok' });
    // coolbet: funded, 1/4 = 25% < 50% → thin, with the correct last sighting.
    expect(byKey.coolbet).toMatchObject({
      appearances: 1,
      share: 0.25,
      flag: 'thin',
      lastSeenInFeedAt: '2026-07-20T09:00:00Z',
    });
    // fanduel: funded, zero appearances → missing.
    expect(byKey.fanduel).toMatchObject({ appearances: 0, flag: 'missing' });
    expect(byKey.betmgm.flag).toBe('ok');
    expect(byKey.disabled).toBeUndefined();
    expect(report.distinctBooksPerScan.map((d) => d.count)).toEqual([3, 2, 1, 2]);
  });

  it('benchmark reach: scan share + per-sport presence from the latest snapshot', () => {
    const report = computeCoverage(scans, books, 10, {
      keys: ['pinnacle'],
      snapshot: {
        sportsScanned: ['basketball_nba', 'soccer_epl'],
        events: [
          // NBA: 1 of 2 events carries the benchmark.
          { id: 'e1', sportKey: 'basketball_nba', sportTitle: 'NBA', commenceTime: '', homeTeam: '', awayTeam: '', bookmakers: [{ key: 'pinnacle', title: 'Pinnacle', lastUpdate: '', markets: [] }] },
          { id: 'e2', sportKey: 'basketball_nba', sportTitle: 'NBA', commenceTime: '', homeTeam: '', awayTeam: '', bookmakers: [{ key: 'bet365', title: 'Bet365', lastUpdate: '', markets: [] }] },
          // EPL: benchmark absent entirely → speculative detection impossible.
          { id: 'e3', sportKey: 'soccer_epl', sportTitle: 'EPL', commenceTime: '', homeTeam: '', awayTeam: '', bookmakers: [{ key: 'bet365', title: 'Bet365', lastUpdate: '', markets: [] }] },
        ],
      },
    });
    expect(report.benchmark).toHaveLength(1);
    const pinnacle = report.benchmark![0];
    // pinnacle appears in 3 of the 4 fixture scans' distinctBooks.
    expect(pinnacle.scanShare).toBeCloseTo(0.75, 6);
    expect(pinnacle.perSport).toEqual([
      { sportKey: 'basketball_nba', sportTitle: 'NBA', events: 2, eventsWithBenchmark: 1 },
      { sportKey: 'soccer_epl', sportTitle: 'EPL', events: 1, eventsWithBenchmark: 0 },
    ]);
  });
});

/* ————— survival ————— */

describe('computeSurvival', () => {
  // Scans at 10:00, 10:05, 10:10 on tab ca / NBA.
  const scans = ['10:00', '10:05', '10:10'].map((t) =>
    logEntry({ scannedAt: `2026-07-20T${t}:00Z` }),
  );

  it('reconciles survival, exclusions, censoring, and the haircut mapping exactly', () => {
    const records = [
      // Survived: detected 10:00, still seen at 10:05, gone at 10:10.
      record({ detectedAt: '2026-07-20T10:00:00Z', lastSeenAt: '2026-07-20T10:05:00Z', status: 'dead', statusChangedAt: '2026-07-20T10:10:00Z' }),
      // Died at next scan: detected 10:00, never seen again.
      record({ detectedAt: '2026-07-20T10:00:00Z', lastSeenAt: '2026-07-20T10:00:00Z', status: 'dead', statusChangedAt: '2026-07-20T10:05:00Z' }),
      // No covering scan after detection (detected at the last scan) → excluded.
      record({ detectedAt: '2026-07-20T10:10:00Z', lastSeenAt: '2026-07-20T10:10:00Z' }),
      // Different tab → its scans aren't covering; excluded.
      record({ regionTab: 'ca_us', detectedAt: '2026-07-20T10:00:00Z', lastSeenAt: '2026-07-20T10:00:00Z' }),
      // Commencement kill → censored, kept out of the lifetime distribution.
      record({
        detectedAt: '2026-07-20T10:00:00Z',
        lastSeenAt: '2026-07-20T10:05:00Z',
        commenceTime: '2026-07-20T10:07:00Z',
        status: 'dead',
        statusChangedAt: '2026-07-20T10:10:00Z',
      }),
    ];
    const stats = computeSurvival(records, scans, NOW);
    // Samples: records 1, 2, and 5 have a covering next scan → 3; survived: 1 and 5.
    expect(stats.overall).toEqual({ samples: 3, rate: 2 / 3 });
    expect(stats.byPair[0]).toMatchObject({ pair: 'bet365+pinnacle', samples: 3 });
    // Lifetimes: only absence-deaths count → records 1 (10m) and 2 (5m).
    expect(stats.lifetime.samples).toBe(2);
    expect(stats.lifetime.medianMs).toBe(7.5 * 60_000);
    expect(stats.lifetime.censored).toBe(1);
    // Haircut: unqualified (span < 14 days and < 50 samples), mapping stated.
    expect(stats.haircut.qualified).toBe(false);
    expect(stats.haircut.measuredPct).toBeNull();
  });

  it('qualifies the haircut at ≥14 days of span and ≥50 samples', () => {
    const manyScans = [];
    const manyRecords = [];
    for (let day = 1; day <= 15; day++) {
      const d = String(day).padStart(2, '0');
      manyScans.push(logEntry({ scannedAt: `2026-07-${d}T10:00:00Z` }));
      manyScans.push(logEntry({ scannedAt: `2026-07-${d}T10:05:00Z` }));
      for (let i = 0; i < 4; i++) {
        // Half survive to the 10:05 scan, half die.
        manyRecords.push(
          record({
            detectedAt: `2026-07-${d}T10:00:00Z`,
            lastSeenAt: i % 2 === 0 ? `2026-07-${d}T10:05:00Z` : `2026-07-${d}T10:00:00Z`,
            status: 'dead',
            statusChangedAt: `2026-07-${d}T10:05:00Z`,
          }),
        );
      }
    }
    const stats = computeSurvival(manyRecords, manyScans, NOW);
    expect(stats.overall.samples).toBe(60);
    expect(stats.overall.rate).toBeCloseTo(0.5, 6);
    expect(stats.haircut.qualified).toBe(true);
    expect(stats.haircut.measuredPct).toBeCloseTo(50, 6);
  });
});

/* ————— telemetry ————— */

describe('computeTelemetry', () => {
  it('aggregates funnel deltas excluding missing steps, and verify outcomes per book', () => {
    const records = [
      record({
        alerted: true,
        alertedAt: '2026-07-20T10:00:00Z',
        funnel: {
          cockpitOpenedAt: '2026-07-20T10:01:00Z',
          verifyPressedAt: '2026-07-20T10:02:00Z',
        },
        verifies: [{ at: '2026-07-20T10:02:00Z', outcome: 'active', profitPct: 2.0 }],
        execution: {
          filledLegs: [{ odds: 2.1, stake: 250 }, { odds: 2.05, stake: 250 }],
          totalStaked: 500,
          lockedProfit: 10,
          recordedAt: '2026-07-20T10:05:00Z',
        },
        status: 'completed',
      }),
      record({
        alerted: true,
        alertedAt: '2026-07-20T11:00:00Z',
        funnel: { verifyPressedAt: '2026-07-20T11:04:00Z' }, // never opened → alertToOpen excluded
        verifies: [{ at: '2026-07-20T11:04:00Z', outcome: 'dead', profitPct: -1 }],
      }),
      record({ alerted: true, alertedAt: '2026-07-20T12:00:00Z' }), // no funnel at all
    ];
    const stats = computeTelemetry(records);
    expect(stats.alertToVerify).toEqual({ samples: 2, medianMs: 3 * 60_000 });
    expect(stats.alertToOpen).toEqual({ samples: 1, medianMs: 60_000 });
    expect(stats.verifyToCompleted).toEqual({ samples: 1, medianMs: 3 * 60_000 });
    expect(stats.verifyOutcomes.total).toBe(2);
    expect(stats.verifyOutcomes.active).toBe(1);
    expect(stats.verifyOutcomes.dead).toBe(1);
    // Deltas vs detection (2.34): (2.0 − 2.34) and (−1 − 2.34) → mean −1.84pp.
    expect(stats.verifyOutcomes.avgProfitDeltaPp).toBeCloseTo((-0.34 + -3.34) / 2, 2);
    const bet365 = stats.verifyOutcomes.byBook.find((b) => b.bookmakerKey === 'bet365')!;
    expect(bet365.total).toBe(2);
  });
});
