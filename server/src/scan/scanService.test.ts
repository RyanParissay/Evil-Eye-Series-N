import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { regionTabByKey } from '@shared/regionTabs';
import type {
  FetchOddsParams,
  OddsProvider,
  OddsResult,
  SportsResult,
} from '../providers/OddsProvider';
import { ProviderError } from '../providers/OddsProvider';
import { runScan, type ScanDeps } from './scanService';
import type { ScanStore } from './scanStore';

const NOW = new Date('2026-07-08T12:00:00Z');
const FUTURE = '2026-07-08T14:00:00Z';

/** In-memory stand-in for the file-backed ScanStore. */
class FakeStore {
  written: unknown = null;
  async read() {
    return null;
  }
  async write(meta: unknown) {
    this.written = meta;
  }
}

/**
 * Minimal provider stub: one sport, caller-supplied events, fixed usage
 * numbers so the credit math is assertable.
 */
function stubProvider(
  events: OddsEvent[],
  opts: { failSports?: string[]; sports?: string[] } = {},
): OddsProvider {
  const sportKeys = opts.sports ?? ['basketball_nba'];
  let used = 100;
  return {
    mode: 'mock' as const,
    async listSports(): Promise<SportsResult> {
      return {
        sports: sportKeys.map((key) => ({
          key,
          title: key,
          group: 'g',
          active: true,
          hasOutrights: false,
        })),
        usage: { requestsUsedTotal: used, requestsRemainingTotal: 900, creditsCharged: 0 },
      };
    },
    async fetchOdds(sportKey: string, params: FetchOddsParams): Promise<OddsResult> {
      if (opts.failSports?.includes(sportKey)) {
        throw new ProviderError('boom', 'provider_error', 500);
      }
      const credits = params.markets.length * params.regions.length;
      used += credits;
      return {
        events: events.filter((e) => e.sportKey === sportKey),
        usage: { requestsUsedTotal: used, requestsRemainingTotal: 900 - used, creditsCharged: credits },
      };
    },
    async fetchScores(): Promise<never> {
      throw new Error('scan never fetches scores');
    },
  };
}

function deps(provider: OddsProvider, extra: Partial<ScanDeps> = {}): ScanDeps {
  return {
    provider,
    store: new FakeStore() as unknown as ScanStore,
    now: () => NOW,
    ...extra,
  };
}

const CA_TAB = regionTabByKey('ca')!;

/** An event carrying a totals-market arb between two CA-accessible books. */
function totalsArbEvent(): OddsEvent {
  const outcomes = (over: number, under: number) => [
    { name: 'Over', price: over, point: 220.5 },
    { name: 'Under', price: under, point: 220.5 },
  ];
  return {
    id: 'ev-totals',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: FUTURE,
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: [
      { key: 'bet365', title: 'Bet365', lastUpdate: NOW.toISOString(), markets: [{ key: 'totals', outcomes: outcomes(2.1, 1.8) }] },
      { key: 'pinnacle', title: 'Pinnacle', lastUpdate: NOW.toISOString(), markets: [{ key: 'totals', outcomes: outcomes(1.85, 2.12) }] },
    ],
  };
}

describe('runScan', () => {
  // Per-sport failures are console.warn'ed by design; keep test output quiet.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('evaluates exactly the markets it fetched — a totals arb surfaces when markets include totals', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), { markets: ['h2h', 'totals'] }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].marketKey).toBe('totals');
  });

  it('proceeds when one sport fails, recording it in sportsFailed', async () => {
    const provider = stubProvider([totalsArbEvent()], {
      sports: ['basketball_nba', 'icehockey_nhl'],
      failSports: ['icehockey_nhl'],
    });
    const result = await runScan(deps(provider, { markets: ['totals'] }), {
      topN: 5,
      tab: CA_TAB,
    });
    expect(result.meta.sportsFailed).toEqual(['icehockey_nhl']);
    expect(result.opportunities).toHaveLength(1);
  });

  it('throws the underlying failure when every sport fails', async () => {
    const provider = stubProvider([], { failSports: ['basketball_nba'] });
    await expect(runScan(deps(provider), { topN: 5, tab: CA_TAB })).rejects.toThrow('boom');
  });

  it('reports computed credits and the header delta from the usage baseline', async () => {
    // 1 sport × 1 market × 2 regions (ca tab = eu,uk) = 2 credits.
    const result = await runScan(deps(stubProvider([]), { markets: ['h2h'] }), {
      topN: 5,
      tab: CA_TAB,
    });
    expect(result.meta.usage.creditsComputedThisScan).toBe(2);
    expect(result.meta.usage.creditsHeaderDeltaThisScan).toBe(2);
    expect(result.meta.usage.apiCallCount).toBe(2); // free sports call + 1 odds call
  });

  it('fetches by book list when the plan says so, and registers seen books', async () => {
    const seen: string[][] = [];
    const fetched: Array<readonly string[] | undefined> = [];
    const provider = stubProvider([totalsArbEvent()]);
    const origFetch = provider.fetchOdds.bind(provider);
    provider.fetchOdds = (sportKey, params) => {
      fetched.push(params.bookmakers);
      return origFetch(sportKey, params);
    };

    const result = await runScan(
      deps(provider, {
        markets: ['totals'],
        books: {
          async fetchPlan() {
            return { bookmakersParam: ['bet365', 'pinnacle'], allowedKeys: ['bet365', 'pinnacle'] };
          },
          async recordSeen(events) {
            seen.push(events.flatMap((e) => e.bookmakers.map((b) => b.key)));
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );

    expect(fetched).toEqual([['bet365', 'pinnacle']]);
    expect(seen).toEqual([['bet365', 'pinnacle']]);
    expect(result.opportunities).toHaveLength(1);
  });

  it('the plan’s allowed keys drive the defensive filter (disabled book kills the arb)', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        books: {
          async fetchPlan() {
            // Pinnacle disabled: fetch untouched (regions), but detection
            // must not use it — the totals arb needs both books, so it dies.
            return { bookmakersParam: undefined, allowedKeys: ['bet365'] };
          },
          async recordSeen() {},
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(0);
  });

  it('a failing registry update never fails the scan', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        books: {
          async fetchPlan() {
            return { bookmakersParam: undefined, allowedKeys: [...CA_TAB.allowedBookmakers] };
          },
          async recordSeen() {
            throw new Error('disk full');
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(1);
  });

  it('persists the raw snapshot and records opportunities before returning', async () => {
    const written: Array<{ regionTab: string; events: unknown[] }> = [];
    const recorded: Array<{ count: number; scope: { sportsScanned: string[]; regionTab: string } }> = [];
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        snapshots: {
          async save(snapshot) {
            written.push({ regionTab: snapshot.regionTab, events: snapshot.events });
          },
        },
        opportunityLog: {
          async recordScan(opportunities, scope) {
            recorded.push({ count: opportunities.length, scope });
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(written).toHaveLength(1);
    expect(written[0].regionTab).toBe('ca');
    expect(written[0].events).toHaveLength(1); // raw, pre-filter
    expect(recorded).toEqual([
      { count: 1, scope: { sportsScanned: ['basketball_nba'], regionTab: 'ca' } },
    ]);
    expect(result.opportunities).toHaveLength(1);
  });

  it('failing persistence never fails the scan', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        snapshots: {
          async save() {
            throw new Error('disk full');
          },
        },
        opportunityLog: {
          async recordScan() {
            throw new Error('disk full');
          },
        },
        scanLog: {
          async append() {
            throw new Error('disk full');
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(1);
  });

  it('benchmark in the fetch changes NOTHING about arb output, and its odds reach the snapshot', async () => {
    // Feed carries a pinnacle-priced event alongside the arb event.
    const events = [totalsArbEvent()];
    const run = (bookmakersParam: string[] | undefined) =>
      runScan(
        deps(stubProvider(events), {
          markets: ['totals'],
          books: {
            async fetchPlan() {
              return { bookmakersParam, allowedKeys: ['bet365'] };
            },
            async recordSeen() {},
          },
          snapshots: {
            async save(snapshot) {
              snapshots.push(snapshot.events);
            },
          },
        }),
        { topN: 5, tab: CA_TAB },
      );
    const snapshots: unknown[][] = [];
    const withBenchmark = await run(['bet365', 'pinnacle']);
    const without = await run(['bet365']);
    // Byte-identical arb output: the detection allowlist is what matters.
    expect(withBenchmark.opportunities).toEqual(without.opportunities);
    // The raw snapshot keeps every book in the feed — benchmark included.
    const books = (snapshots[0] as Array<{ bookmakers: Array<{ key: string }> }>).flatMap((e) =>
      e.bookmakers.map((b) => b.key),
    );
    expect(books).toContain('pinnacle');
  });

  it('EV detection rides the scan: persisted + notified, but NEVER in the arb response', async () => {
    // Feed: the totals arb (bet365/pinnacle) — pinnacle's fresh side also
    // makes bet365's 2.1 price an EV bet against the de-vigged benchmark.
    const recorded: unknown[][] = [];
    const notified: unknown[][] = [];
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        ev: {
          settings: async () => ({
            showMinEdgePct: 1,
            alertMinEdgePct: 3,
            maxOdds: 4,
            maxBenchmarkAgeMins: 60,
          }),
        },
        opportunityLog: {
          async recordScan(opportunities) {
            recorded.push(opportunities as unknown[]);
          },
        },
        notifier: (opportunities) => {
          notified.push(opportunities as unknown[]);
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    // The scan response stays arb-only — the arb UI never sees EV rows.
    expect(result.opportunities.every((o) => o.ev === undefined)).toBe(true);
    // Persistence and the notifier see both strategies.
    const persisted = recorded[0] as Array<{ ev?: unknown }>;
    expect(persisted.some((o) => o.ev !== undefined)).toBe(true);
    expect(persisted.some((o) => o.ev === undefined)).toBe(true);
    const pushed = notified[0] as Array<{ ev?: unknown }>;
    expect(pushed.some((o) => o.ev !== undefined)).toBe(true);
  });

  it('market toggles govern the fetch: OFF is byte-identical to today, ON adds the market', async () => {
    const fetched: string[][] = [];
    const provider = stubProvider([totalsArbEvent()]);
    const spyProvider = {
      ...provider,
      fetchOdds: async (sport: string, params: Parameters<typeof provider.fetchOdds>[1]) => {
        fetched.push([...params.markets]);
        return provider.fetchOdds(sport, params);
      },
    };
    await runScan(
      deps(spyProvider, {
        marketSettings: { read: async () => ({ totals: false, spreads: false }) },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(fetched[0]).toEqual(['h2h']);

    await runScan(
      deps(spyProvider, {
        marketSettings: { read: async () => ({ totals: true, spreads: true }) },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(fetched[1]).toEqual(['h2h', 'totals', 'spreads']);
  });

  it('middles ride the scan when their market is fetched: persisted + notified, never in the response', async () => {
    // The totals arb event carries bet365 Over 220.5 / pinnacle Under 220.5;
    // add a gapped Under at another book to create a middle.
    const event = totalsArbEvent();
    event.bookmakers.push({
      key: 'coolbet',
      title: 'Coolbet',
      lastUpdate: NOW.toISOString(),
      markets: [
        { key: 'totals', outcomes: [{ name: 'Under', price: 1.95, point: 224.5 }] },
      ],
    });
    const recorded: Array<Array<{ middle?: unknown; ev?: unknown }>> = [];
    const result = await runScan(
      deps(stubProvider([event]), {
        marketSettings: { read: async () => ({ totals: true, spreads: false }) },
        middles: {
          settings: async () => ({ maxCostPct: 5, minWindow: 0.5, alertMaxBreakevenPct: 4 }),
        },
        opportunityLog: {
          async recordScan(opportunities) {
            recorded.push(opportunities as never);
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities.every((o) => o.middle === undefined)).toBe(true);
    const middles = recorded[0].filter((o) => o.middle !== undefined);
    expect(middles.length).toBeGreaterThan(0);
  });

  it('appends a scan-history line with the raw feed facts (Phase 8)', async () => {
    const appended: unknown[] = [];
    await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        scanLog: {
          async append(entry) {
            appended.push(entry);
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      scannedAt: NOW.toISOString(),
      regionTab: 'ca',
      sportsScanned: ['basketball_nba'],
      distinctBooks: ['bet365', 'pinnacle'],
      eventCount: 1,
    });
  });

  it('logs the confirmation-candidate count from persistence on the scan-history line (Phase 16 Part A)', async () => {
    const appended: unknown[] = [];
    await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        opportunityLog: {
          async recordScan() {
            return { pendingCandidates: 3 };
          },
        },
        scanLog: {
          async append(entry) {
            appended.push(entry);
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(appended[0]).toMatchObject({ confirmationCandidates: 3 });
  });

  it('a legacy/void opportunityLog (or none at all) logs zero candidates', async () => {
    const appended: Array<{ confirmationCandidates?: number }> = [];
    await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        opportunityLog: { async recordScan() {} },
        scanLog: {
          async append(entry) {
            appended.push(entry);
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(appended[0].confirmationCandidates).toBe(0);
  });

  it('accrues the book leaderboard with the raw feed and all detected strategies (Phase 15 #1)', async () => {
    const accrued: Array<{ events: unknown[]; opportunities: unknown[] }> = [];
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        leaderboard: {
          async accrue(input) {
            accrued.push(input as { events: unknown[]; opportunities: unknown[] });
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(accrued).toHaveLength(1);
    expect(accrued[0].events).toHaveLength(1); // raw, pre-filter
    expect(accrued[0].opportunities).toHaveLength(result.opportunities.length);
  });

  it('a failing leaderboard accrual never fails the scan', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        leaderboard: {
          async accrue() {
            throw new Error('disk full');
          },
        },
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(1);
  });

  it('hands each scan’s opportunities to the notifier', async () => {
    const seen: unknown[] = [];
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        notifier: (opportunities) => void seen.push(opportunities),
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(result.opportunities);
  });

  it('a rejecting notifier never fails the scan', async () => {
    const result = await runScan(
      deps(stubProvider([totalsArbEvent()]), {
        markets: ['totals'],
        notifier: () => Promise.reject(new Error('twilio down')),
      }),
      { topN: 5, tab: CA_TAB },
    );
    expect(result.opportunities).toHaveLength(1);
  });

  it('filters bookmakers to the tab allowlist before detection', async () => {
    // Same arb, but the best Under price sits at a non-CA book: the arb must
    // not survive on the CA tab (Betfair is not in its allowlist).
    const ev = totalsArbEvent();
    ev.bookmakers[1] = { ...ev.bookmakers[1], key: 'betfair_ex_uk', title: 'Betfair' };
    const result = await runScan(deps(stubProvider([ev]), { markets: ['totals'] }), {
      topN: 5,
      tab: CA_TAB,
    });
    expect(result.opportunities).toHaveLength(0);
  });
});
