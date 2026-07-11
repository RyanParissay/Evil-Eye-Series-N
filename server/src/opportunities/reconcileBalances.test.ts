import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, BookmakerConfig } from '@shared/types';
import { BookmakerService } from '../bookmakers/bookmakerService';
import type { BookmakerData, BookmakerDataStore } from '../bookmakers/bookmakerStore';
import { OpportunityService } from './opportunityService';
import type { OpportunityData, OpportunityDataStore } from './opportunityStore';
import { applyToBalances, revertBalances } from './reconcileBalances';

const NOW = new Date('2026-07-10T12:00:00Z');

class MemStore<T> {
  constructor(public data: T) {}
  async read(): Promise<T> {
    return this.data;
  }
  async update<R>(
    mutate: (data: T) => { data: T; result: R } | Promise<{ data: T; result: R }>,
  ): Promise<R> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeArchive {
  async append(): Promise<void> {}
}

function makeArb(): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-09T00:00:00Z',
    marketKey: 'h2h',
    arbIndex: 0.977,
    profitPct: 2.34,
    legs: [
      { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'Celtics', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    sameBookmaker: false,
    suspicious: false,
  };
}

function book(key: string, balance: number): BookmakerConfig {
  return {
    key,
    title: key,
    enabled: true,
    balance,
    status: 'active',
    notes: '',
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
  };
}

async function harness() {
  const oppStore = new MemStore<OpportunityData>({ records: [] });
  const bookStore = new MemStore<BookmakerData>({
    bookmakers: [book('bet365', 1000), book('pinnacle', 1000)],
  });
  const opportunities = new OpportunityService(
    oppStore as unknown as OpportunityDataStore,
    new FakeArchive(),
    () => NOW,
  );
  const books = new BookmakerService(bookStore as unknown as BookmakerDataStore, () => NOW);
  await opportunities.recordScan([makeArb()], { sportsScanned: ['basketball_nba'], regionTab: 'ca' });
  const [record] = await opportunities.list();
  // Completed with filled numbers: bet365 $240 @2.08, pinnacle $260 @2.05.
  await opportunities.updateStatus(record.id, 'completed', [
    { odds: 2.08, stake: 240 },
    { odds: 2.05, stake: 260 },
  ]);
  return { opportunities, books, bookStore, record };
}

describe('apply-to-balances / revert', () => {
  it('moves exactly the filled amounts and reverts byte-identically', async () => {
    const { opportunities, books, bookStore, record } = await harness();
    const deps = { opportunities, books };

    // Winner = leg 1 (pinnacle): bet365 loses its stake, pinnacle nets payout − stake.
    const applied = await applyToBalances(deps, record.id, 1);
    expect(applied.ok).toBe(true);
    const after = Object.fromEntries(bookStore.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(after.bet365).toBeCloseTo(1000 - 240, 2);
    expect(after.pinnacle).toBeCloseTo(1000 - 260 + 260 * 2.05, 2);
    expect((await opportunities.get(record.id))?.execution?.balancesAppliedAt).toBe(
      NOW.toISOString(),
    );

    // Double-apply refuses.
    expect(await applyToBalances(deps, record.id, 1)).toMatchObject({
      ok: false,
      reason: 'conflict',
    });

    // Revert restores the exact starting balances and clears the marker.
    const reverted = await revertBalances(deps, record.id);
    expect(reverted.ok).toBe(true);
    const restored = Object.fromEntries(bookStore.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(restored.bet365).toBeCloseTo(1000, 2);
    expect(restored.pinnacle).toBeCloseTo(1000, 2);
    expect((await opportunities.get(record.id))?.execution?.balancesAppliedAt).toBeNull();
    expect(await revertBalances(deps, record.id)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('EV records reconcile from their grade: won pays out, lost only deducts, void returns the stake', async () => {
    const oppStore = new MemStore<OpportunityData>({ records: [] });
    const bookStore = new MemStore<BookmakerData>({ bookmakers: [book('bet365', 1000)] });
    const opportunities = new OpportunityService(
      oppStore as unknown as OpportunityDataStore,
      new FakeArchive(),
      () => NOW,
    );
    const books = new BookmakerService(bookStore as unknown as BookmakerDataStore, () => NOW);
    const deps = { opportunities, books };
    const evArb = {
      ...makeArb(),
      commenceTime: '2026-07-11T00:00:00Z',
      legs: [{ outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.15, stake: 100, link: null }],
      ev: { benchmarkKey: 'pinnacle', benchmarkOdds: 1.95, fairProbability: 0.5, edgePct: 7.5, benchmarkLastUpdate: NOW.toISOString() },
    };
    await opportunities.recordScan([evArb], { sportsScanned: ['basketball_nba'], regionTab: 'ca' });
    const [record] = await opportunities.list();
    await opportunities.updateStatus(record.id, 'completed', [{ odds: 2.1, stake: 400 }]);

    // Ungraded EV refuses to reconcile.
    expect(await applyToBalances(deps, record.id, 0)).toMatchObject({ ok: false, reason: 'conflict' });

    // Won: −400 stake, +840 payout → net +440.
    await opportunities.grade(record.id, 'won');
    await applyToBalances(deps, record.id, 0);
    expect(bookStore.data.bookmakers[0].balance).toBeCloseTo(1000 - 400 + 400 * 2.1, 2);
    await revertBalances(deps, record.id);
    expect(bookStore.data.bookmakers[0].balance).toBeCloseTo(1000, 2);

    // Lost: only the stake leaves.
    await opportunities.grade(record.id, 'lost');
    await applyToBalances(deps, record.id, 0);
    expect(bookStore.data.bookmakers[0].balance).toBeCloseTo(600, 2);
    await revertBalances(deps, record.id);

    // Void: money goes nowhere.
    await opportunities.grade(record.id, 'void');
    await applyToBalances(deps, record.id, 0);
    expect(bookStore.data.bookmakers[0].balance).toBeCloseTo(1000, 2);
  });

  it('middles reconcile per-leg: hit pays both, single-side pays one, push returns the stake', async () => {
    const oppStore = new MemStore<OpportunityData>({ records: [] });
    const bookStore = new MemStore<BookmakerData>({
      bookmakers: [book('bet365', 1000), book('coolbet', 1000)],
    });
    const opportunities = new OpportunityService(
      oppStore as unknown as OpportunityDataStore,
      new FakeArchive(),
      () => NOW,
    );
    const books = new BookmakerService(bookStore as unknown as BookmakerDataStore, () => NOW);
    const deps = { opportunities, books };
    const middleArb = {
      ...makeArb(),
      commenceTime: '2026-07-11T00:00:00Z',
      legs: [
        { outcome: 'Over', point: 220.5, bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 1.95, stake: 50, link: null },
        { outcome: 'Under', point: 224.5, bookmakerKey: 'coolbet', bookmakerTitle: 'Coolbet', odds: 1.95, stake: 50, link: null },
      ],
      profitPct: -2.5,
      middle: {
        lowLine: 220.5, highLine: 224.5, windowSize: 4, costPct: 2.5, payoutPct: 95,
        breakevenPct: 2.56, freeMiddle: false, pushPossible: false, keyNumbers: [],
      },
    };
    await opportunities.recordScan([middleArb], { sportsScanned: ['basketball_nba'], regionTab: 'ca' });
    const [record] = await opportunities.list();
    await opportunities.updateStatus(record.id, 'completed', [
      { odds: 1.95, stake: 250 },
      { odds: 1.95, stake: 250 },
    ]);

    // Ungraded refuses.
    expect(await applyToBalances(deps, record.id, 0)).toMatchObject({ ok: false, reason: 'conflict' });

    // Middle hit: both books net +stake×(odds−1).
    await opportunities.gradeLegs(record.id, ['won', 'won']);
    await applyToBalances(deps, record.id, 0);
    let balances = Object.fromEntries(bookStore.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(balances.bet365).toBeCloseTo(1000 - 250 + 250 * 1.95, 2);
    expect(balances.coolbet).toBeCloseTo(1000 - 250 + 250 * 1.95, 2);
    await revertBalances(deps, record.id);

    // Push on leg A, side B won: A stake returned, B pays out.
    await opportunities.gradeLegs(record.id, ['void', 'won']);
    await applyToBalances(deps, record.id, 0);
    balances = Object.fromEntries(bookStore.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(balances.bet365).toBeCloseTo(1000, 2);
    expect(balances.coolbet).toBeCloseTo(1000 - 250 + 250 * 1.95, 2);
    await revertBalances(deps, record.id);
    balances = Object.fromEntries(bookStore.data.bookmakers.map((b) => [b.key, b.balance]));
    expect(balances.bet365).toBeCloseTo(1000, 2);
    expect(balances.coolbet).toBeCloseTo(1000, 2);
  });

  it('guards: unknown id, not completed, no execution, bad winner index', async () => {
    const { opportunities, books } = await harness();
    const deps = { opportunities, books };
    expect(await applyToBalances(deps, 'nope', 0)).toMatchObject({ ok: false, reason: 'not_found' });

    await opportunities.recordScan(
      [{ ...makeArb(), eventId: 'evt-2', commenceTime: '2026-07-11T00:00:00Z' }],
      { sportsScanned: ['basketball_nba'], regionTab: 'ca' },
    );
    const active = (await opportunities.list()).find((r) => r.status === 'active')!;
    expect(await applyToBalances(deps, active.id, 0)).toMatchObject({
      ok: false,
      reason: 'conflict',
    });

    const [completed] = (await opportunities.list()).filter((r) => r.status === 'completed');
    expect(await applyToBalances(deps, completed.id, 5)).toMatchObject({
      ok: false,
      reason: 'bad_request',
    });
  });
});
