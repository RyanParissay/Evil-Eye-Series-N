/**
 * Closing-line capture (Phase 18). The pure pass builds a RecordClosing from a
 * snapshot's own-book prices + de-vigged benchmark; a record whose event isn't
 * in the snapshot is untouched; a commenced record is frozen (no update). The
 * acceptance fixture drives capture → OpportunityService.applyClosings across
 * three scans: a closer scan OVERWRITES the candidate, a post-commence scan
 * does NOT (the last pre-commence write is frozen).
 */
import { describe, expect, it } from 'vitest';
import type { ArbLeg, OddsEvent, OpportunityRecord } from '@shared/types';
import { OpportunityService } from '../opportunities/opportunityService';
import type { OpportunityData, OpportunityDataStore } from '../opportunities/opportunityStore';
import { captureClosings } from './clvCapture';

class MemStore implements OpportunityDataStore {
  constructor(public data: OpportunityData) {}
  async read(): Promise<OpportunityData> {
    return this.data;
  }
  async update<T>(
    mutate: (d: OpportunityData) => { data: OpportunityData; result: T } | Promise<{ data: OpportunityData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

function leg(outcome: string, bookmakerKey: string, odds: number): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds, stake: 50, link: null };
}

/** An h2h event: bet365 + coolbet price both sides, Pinnacle is the benchmark. */
function makeEvent(opts: {
  id?: string;
  commenceTime: string;
  bet365Celtics: number;
  coolbetLakers: number;
  pinnacle?: [number, number]; // [Celtics, Lakers]
}): OddsEvent {
  const books = [
    {
      key: 'bet365',
      title: 'Bet365',
      lastUpdate: '2026-07-12T23:00:00Z',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Celtics', price: opts.bet365Celtics },
            { name: 'Lakers', price: 1.7 },
          ],
        },
      ],
    },
    {
      key: 'coolbet',
      title: 'Coolbet',
      lastUpdate: '2026-07-12T23:00:00Z',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Celtics', price: 1.7 },
            { name: 'Lakers', price: opts.coolbetLakers },
          ],
        },
      ],
    },
  ];
  if (opts.pinnacle) {
    books.push({
      key: 'pinnacle',
      title: 'Pinnacle',
      lastUpdate: '2026-07-12T23:00:00Z',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Celtics', price: opts.pinnacle[0] },
            { name: 'Lakers', price: opts.pinnacle[1] },
          ],
        },
      ],
    });
  }
  return {
    id: opts.id ?? 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: opts.commenceTime,
    homeTeam: 'Celtics',
    awayTeam: 'Lakers',
    bookmakers: books,
  };
}

function makeRecord(commenceTime: string, over: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: 'rec-1',
    fingerprint: 'fp-1',
    strategy: 'arb',
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime,
    marketKey: 'h2h',
    legs: [leg('Celtics', 'bet365', 2.05), leg('Lakers', 'coolbet', 2.05)],
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-12T20:00:00Z',
    lastSeenAt: '2026-07-12T22:00:00Z',
    statusChangedAt: '2026-07-12T20:00:00Z',
    alerted: false,
    alertedAt: null,
    ...over,
  };
}

const COMMENCE = '2026-07-13T00:00:00Z';

describe('captureClosings (pure)', () => {
  it('records own-book prices, benchmark prices, de-vigged fair probs, minutes-to-commence', () => {
    const now = new Date('2026-07-12T23:00:00Z'); // 60 min before commence
    const event = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 2.02, coolbetLakers: 2.08, pinnacle: [1.9, 2.1] });
    const [update] = captureClosings([event], [makeRecord(COMMENCE)], now);

    expect(update.id).toBe('rec-1');
    // Each leg's OWN book: Celtics@bet365 2.02, Lakers@coolbet 2.08.
    expect(update.closing.legOdds).toEqual([2.02, 2.08]);
    // Benchmark (Pinnacle) prices per leg outcome.
    expect(update.closing.benchmarkLegOdds).toEqual([1.9, 2.1]);
    // De-vig 1.90/2.10 → 0.525 / 0.475 (exact: 2.10/4.00, 1.90/4.00).
    expect(update.closing.benchmarkFairProb![0]).toBeCloseTo(0.525, 12);
    expect(update.closing.benchmarkFairProb![1]).toBeCloseTo(0.475, 12);
    expect(update.closing.minutesToCommence).toBe(60);
    expect(update.closing.capturedAt).toBe(now.toISOString());
  });

  it('a leg whose book no longer prices the outcome → null legOdds (never zeroed), benchmark absent → no benchmark fields', () => {
    const now = new Date('2026-07-12T23:00:00Z');
    // No pinnacle, and coolbet drops Lakers by pricing a different outcome.
    const event = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 2.02, coolbetLakers: 2.08 });
    event.bookmakers[1].markets[0].outcomes = [{ name: 'Celtics', price: 1.7 }]; // coolbet: no Lakers
    const [update] = captureClosings([event], [makeRecord(COMMENCE)], now);
    expect(update.closing.legOdds).toEqual([2.02, null]);
    expect(update.closing.benchmarkLegOdds).toBeUndefined();
    expect(update.closing.benchmarkFairProb).toBeUndefined();
  });

  it('a record whose event is absent from the snapshot yields no update (prior closing untouched)', () => {
    const now = new Date('2026-07-12T23:00:00Z');
    const other = makeEvent({ id: 'evt-other', commenceTime: COMMENCE, bet365Celtics: 2, coolbetLakers: 2 });
    expect(captureClosings([other], [makeRecord(COMMENCE)], now)).toEqual([]);
  });

  it('a commenced record is frozen — no update even though its event is in the snapshot', () => {
    const now = new Date('2026-07-13T00:00:01Z'); // past commence
    const event = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 2.02, coolbetLakers: 2.08 });
    expect(captureClosings([event], [makeRecord(COMMENCE)], now)).toEqual([]);
  });

  it('a totals leg de-vigs only the same-line mirror (never a different point)', () => {
    const now = new Date('2026-07-12T23:00:00Z');
    const event: OddsEvent = {
      id: 'evt-1',
      sportKey: 'basketball_nba',
      sportTitle: 'NBA',
      commenceTime: COMMENCE,
      homeTeam: 'Celtics',
      awayTeam: 'Lakers',
      bookmakers: [
        {
          key: 'bet365',
          title: 'Bet365',
          lastUpdate: '2026-07-12T23:00:00Z',
          markets: [{ key: 'totals', outcomes: [{ name: 'Over', price: 1.95, point: 220.5 }] }],
        },
        {
          key: 'pinnacle',
          title: 'Pinnacle',
          lastUpdate: '2026-07-12T23:00:00Z',
          markets: [
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', price: 1.9, point: 220.5 },
                { name: 'Under', price: 2.1, point: 220.5 },
                { name: 'Over', price: 3.0, point: 224.5 }, // alt line — must be ignored
              ],
            },
          ],
        },
      ],
    };
    const record = makeRecord(COMMENCE, {
      marketKey: 'totals',
      legs: [{ outcome: 'Over', point: 220.5, bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 1.95, stake: 50, link: null }],
    });
    const [update] = captureClosings([event], [record], now);
    expect(update.closing.legOdds).toEqual([1.95]);
    // Fair from the 220.5 mirror only (1.90/2.10 → 0.525), never the 224.5 alt.
    expect(update.closing.benchmarkFairProb![0]).toBeCloseTo(0.525, 12);
  });
});

describe('capture → applyClosings: rolling overwrite, then frozen (acceptance)', () => {
  it('a scan closer to commence OVERWRITES; a post-commence scan does NOT', async () => {
    const record = makeRecord(COMMENCE);
    const store = new MemStore({ records: [record] });
    let clock = new Date('2026-07-12T23:00:00Z');
    const svc = new OpportunityService(store, { append: async () => {} }, () => clock);

    // Scan 1 (60 min out): first capture.
    const e1 = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 2.02, coolbetLakers: 2.08 });
    expect(await svc.applyClosings(captureClosings([e1], store.data.records, clock))).toBe(1);
    expect(store.data.records[0].closing!.legOdds).toEqual([2.02, 2.08]);
    expect(store.data.records[0].closing!.minutesToCommence).toBe(60);

    // Scan 2 (5 min out, prices moved): OVERWRITES with the closer capture.
    clock = new Date('2026-07-12T23:55:00Z');
    const e2 = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 2.15, coolbetLakers: 1.95 });
    expect(await svc.applyClosings(captureClosings([e2], store.data.records, clock))).toBe(1);
    expect(store.data.records[0].closing!.legOdds).toEqual([2.15, 1.95]);
    expect(store.data.records[0].closing!.minutesToCommence).toBe(5);

    // Scan 3 (past commence): capture yields no update → frozen at scan 2.
    clock = new Date('2026-07-13T00:05:00Z');
    const e3 = makeEvent({ commenceTime: COMMENCE, bet365Celtics: 9, coolbetLakers: 9 });
    expect(captureClosings([e3], store.data.records, clock)).toEqual([]);
    expect(await svc.applyClosings([])).toBe(0);
    expect(store.data.records[0].closing!.legOdds).toEqual([2.15, 1.95]); // unchanged
  });

  it('applyClosings refuses a handed update for an already-commenced record (structural freeze)', async () => {
    const record = makeRecord('2026-07-12T22:00:00Z'); // commenced an hour ago
    const store = new MemStore({ records: [record] });
    const clock = new Date('2026-07-12T23:00:00Z');
    const svc = new OpportunityService(store, { append: async () => {} }, () => clock);
    const written = await svc.applyClosings([
      { id: 'rec-1', closing: { legOdds: [9, 9], capturedAt: clock.toISOString(), minutesToCommence: -60 } },
    ]);
    expect(written).toBe(0);
    expect(store.data.records[0].closing).toBeUndefined();
  });
});
