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
