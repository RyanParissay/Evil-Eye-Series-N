import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArbOpportunity, OddsEvent } from '@shared/types';
import { LeaderboardStore } from './leaderboardStore';

const NOW = new Date('2026-07-20T12:00:00Z');

function event(bookmakers: Array<{ key: string; title: string }>): OddsEvent {
  return {
    id: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: '2026-07-21T00:00:00Z',
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: bookmakers.map((b) => ({
      key: b.key,
      title: b.title,
      lastUpdate: NOW.toISOString(),
      markets: [],
    })),
  };
}

function opp(overrides: Partial<ArbOpportunity>): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: '2026-07-21T00:00:00Z',
    marketKey: 'h2h',
    arbIndex: 0.97,
    profitPct: 3,
    sameBookmaker: false,
    suspicious: false,
    legs: [
      { outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48, link: null },
      { outcome: 'B', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 52, link: null },
    ],
    ...overrides,
  };
}

describe('LeaderboardStore', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'leaderboard-'));
    file = join(dir, 'leaderboard.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stamps createdAt on first accrual and never moves it again', async () => {
    const store = new LeaderboardStore(file, () => NOW);
    await store.accrue({ events: [], opportunities: [] });
    const first = await store.read();
    expect(first.createdAt).toBe(NOW.toISOString());

    const later = new Date('2026-07-21T00:00:00Z');
    const storeLater = new LeaderboardStore(file, () => later);
    await storeLater.accrue({ events: [], opportunities: [] });
    const second = await storeLater.read();
    expect(second.createdAt).toBe(NOW.toISOString()); // unchanged
    expect(second.totalScans).toBe(2);
  });

  it('counts appearances from the raw feed and leg counts by strategy from detections', async () => {
    const store = new LeaderboardStore(file, () => NOW);
    await store.accrue({
      events: [event([{ key: 'bet365', title: 'Bet365' }, { key: 'pinnacle', title: 'Pinnacle' }])],
      opportunities: [
        opp({}), // arb: legs at bet365 + pinnacle
        opp({ ev: { benchmarkKey: 'pinnacle', benchmarkOdds: 2.0, fairProbability: 0.5, edgePct: 5, benchmarkLastUpdate: NOW.toISOString() }, legs: [{ outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.2, stake: 100, link: null }] }),
      ],
    });

    const report = await store.read();
    expect(report.totalScans).toBe(1);
    const bet365 = report.books.find((b) => b.key === 'bet365')!;
    const pinnacle = report.books.find((b) => b.key === 'pinnacle')!;
    expect(bet365.appearances).toBe(1);
    expect(bet365.share).toBe(1);
    expect(bet365.legCounts).toEqual({ arb: 1, ev: 1, middle: 0 });
    expect(pinnacle.legCounts).toEqual({ arb: 1, ev: 0, middle: 0 });
    expect(bet365.firstSeenAt).toBe(NOW.toISOString());
    expect(bet365.lastSeenAt).toBe(NOW.toISOString());
  });

  it('share is recomputed against the CURRENT totalScans, not frozen at accrual time', async () => {
    let n = 0;
    const clock = () => new Date(NOW.getTime() + n * 60_000);
    const store = new LeaderboardStore(file, () => clock());

    n = 0;
    await store.accrue({ events: [event([{ key: 'bet365', title: 'Bet365' }])], opportunities: [] });
    n = 1;
    await store.accrue({ events: [], opportunities: [] }); // bet365 absent this scan
    n = 2;
    await store.accrue({ events: [], opportunities: [] });

    const report = await store.read();
    expect(report.totalScans).toBe(3);
    const bet365 = report.books.find((b) => b.key === 'bet365')!;
    expect(bet365.appearances).toBe(1);
    expect(bet365.share).toBe(0.333); // rounded to 3dp, like BookCoverage.share
  });

  it('a leg from a book absent from the raw feed still records a leg count (defensive)', async () => {
    const store = new LeaderboardStore(file, () => NOW);
    await store.accrue({
      events: [],
      opportunities: [opp({ legs: [{ outcome: 'A', bookmakerKey: 'ghost', bookmakerTitle: 'Ghost', odds: 2, stake: 50, link: null }] })],
    });
    const report = await store.read();
    const ghost = report.books.find((b) => b.key === 'ghost')!;
    expect(ghost.appearances).toBe(0);
    expect(ghost.legCounts.arb).toBe(1);
  });

  it('sorts most-active book first by total leg count, tie-broken by appearances', async () => {
    const store = new LeaderboardStore(file, () => NOW);
    await store.accrue({
      events: [event([{ key: 'quiet', title: 'Quiet' }, { key: 'busy', title: 'Busy' }])],
      opportunities: [
        opp({ legs: [{ outcome: 'A', bookmakerKey: 'busy', bookmakerTitle: 'Busy', odds: 2, stake: 50, link: null }] }),
        opp({ legs: [{ outcome: 'A', bookmakerKey: 'busy', bookmakerTitle: 'Busy', odds: 2, stake: 50, link: null }] }),
      ],
    });
    const report = await store.read();
    expect(report.books.map((b) => b.key)).toEqual(['busy', 'quiet']);
  });

  it('starts empty with zero totalScans and no books', async () => {
    const store = new LeaderboardStore(file, () => NOW);
    const report = await store.read();
    expect(report).toEqual({ createdAt: expect.any(String), totalScans: 0, books: [] });
  });
});
