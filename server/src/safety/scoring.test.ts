/**
 * Score-at-confirmation assembly (Phase 17 WP-B): scoreConfirmedRecords
 * builds the pure engine's inputs from the stores — snapshot consensus,
 * planned stakes, exposure — at the instant records flip to 'confirmed'.
 * The module's contract: it NEVER throws; any failure is a console.warn and
 * the affected record confirms WITHOUT safety (ungated, pre-Phase-17
 * semantics — the documented failure mode).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FundSettings, OpportunityRecord } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import type { OddsSnapshot } from '../scan/snapshotStore';
import {
  legConsensusFor,
  plannedStakesFor,
  scoreConfirmedRecords,
  type ConfirmationScoringDeps,
} from './scoring';

const SCORED_AT = new Date('2026-07-12T20:01:00Z');

function makeRecord(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: 'rec-1',
    fingerprint: 'fp-rec-1',
    strategy: 'arb',
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-13T00:00:00Z',
    marketKey: 'h2h',
    legs: [
      {
        outcome: 'Celtics',
        bookmakerKey: 'bet365',
        bookmakerTitle: 'Bet365',
        odds: 2.06,
        stake: 50,
        link: null,
      },
      {
        outcome: 'Lakers',
        bookmakerKey: 'pinnacle',
        bookmakerTitle: 'Pinnacle',
        odds: 2.06,
        stake: 50,
        link: null,
      },
    ],
    profitPctAtDetection: 3.0,
    profitPct: 3.0,
    arbIndex: 0.971,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-12T20:00:00Z',
    lastSeenAt: '2026-07-12T20:01:00Z',
    statusChangedAt: '2026-07-12T20:00:00Z',
    alerted: false,
    alertedAt: null,
    confirmation: { status: 'confirmed', scanAAt: '2026-07-12T20:00:00Z' },
    ...overrides,
  };
}

/** A raw snapshot pricing evt-1's h2h across 6 books: the two leg books plus
 *  four consensus-only books at 2.04/2.04 (probabilities within 1% of the
 *  legs' 2.06 → no consensus penalty, and ≥5 books → no thin penalty). */
function makeSnapshot(): OddsSnapshot {
  const consensusBook = (key: string) => ({
    key,
    title: key,
    lastUpdate: '2026-07-12T20:00:30Z',
    markets: [
      {
        key: 'h2h',
        outcomes: [
          { name: 'Celtics', price: 2.04 },
          { name: 'Lakers', price: 2.04 },
        ],
      },
    ],
  });
  return {
    fetchedAt: '2026-07-12T20:01:00Z',
    regionTab: 'ca',
    markets: ['h2h'],
    sportsScanned: ['basketball_nba'],
    events: [
      {
        id: 'evt-1',
        sportKey: 'basketball_nba',
        sportTitle: 'NBA',
        commenceTime: '2026-07-13T00:00:00Z',
        homeTeam: 'Celtics',
        awayTeam: 'Lakers',
        bookmakers: [
          {
            key: 'bet365',
            title: 'Bet365',
            lastUpdate: '2026-07-12T20:00:30Z',
            markets: [
              {
                key: 'h2h',
                outcomes: [
                  { name: 'Celtics', price: 2.06 },
                  { name: 'Lakers', price: 1.7 },
                ],
              },
            ],
          },
          {
            key: 'pinnacle',
            title: 'Pinnacle',
            lastUpdate: '2026-07-12T20:00:30Z',
            markets: [
              {
                key: 'h2h',
                outcomes: [
                  { name: 'Celtics', price: 1.7 },
                  { name: 'Lakers', price: 2.06 },
                ],
              },
            ],
          },
          consensusBook('sharp1'),
          consensusBook('sharp2'),
          consensusBook('sharp3'),
          consensusBook('sharp4'),
        ],
      },
    ],
  };
}

const FUND: FundSettings = { totalBankroll: 5000, defaultStake: 500, unallocatedCash: 0 };

function makeDeps(overrides: Partial<ConfirmationScoringDeps> = {}): ConfirmationScoringDeps {
  return {
    snapshots: { read: async () => makeSnapshot() },
    settings: { read: async () => structuredClone(DEFAULT_SAFETY_SETTINGS) },
    history: async () => [],
    hubPurchasedIds: async () => new Set<string>(),
    fundSettings: async () => ({ ...FUND }),
    bookBalances: async () => new Map<string, number | null>(),
    arbMinEdgePct: async () => 2,
    ...overrides,
  };
}

describe('scoreConfirmedRecords', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('scores a confirmed arb from snapshot consensus + planned stakes + exposure, keyed by fingerprint', async () => {
    const record = makeRecord();
    const scores = await scoreConfirmedRecords(makeDeps(), [record], SCORED_AT);

    const safety = scores.get(record.fingerprint);
    expect(safety).toBeDefined();
    // Hand-computed: 50 base + 10 (NBA h2h tier 1) + 20 (pinnacle anchor)
    // + 0 consensus (both legs <2% off the 6-book median) + 0 exposure
    // (empty history) + 0 rounding ($250/$250 holds 3.0% ≥ the 2% min).
    expect(safety!.score).toBe(80);
    expect(safety!.reasons).toEqual([]);
    // planStakes($500 over equal odds) → $250/$250, already $5-multiples.
    expect(safety!.roundedStakes).toEqual([250, 250]);
    expect(safety!.scoredAt).toBe(SCORED_AT.toISOString());
    expect(console.warn).not.toHaveBeenCalled();

    // Deterministic: same stores, same instant → byte-identical result.
    const again = await scoreConfirmedRecords(makeDeps(), [record], SCORED_AT);
    expect(again.get(record.fingerprint)).toEqual(safety);
  });

  it('the $-rounding preserves the arb alert threshold; EV and middles score with minEdge 0', async () => {
    // An impossible 50% floor makes EVERY rounded arb fail — proving the
    // arb path consumes arbMinEdgePct while EV/middle stay at 0.
    const deps = makeDeps({ arbMinEdgePct: async () => 50 });
    const arb = makeRecord();
    const middle = makeRecord({
      id: 'rec-2',
      fingerprint: 'fp-rec-2',
      strategy: 'middle',
      middle: {
        lowLine: 220.5,
        highLine: 224.5,
        windowSize: 4,
        costPct: 2.5,
        payoutPct: 95,
        breakevenPct: 2.56,
        freeMiddle: false,
        pushPossible: false,
        keyNumbers: [],
      },
    });
    const scores = await scoreConfirmedRecords(deps, [arb, middle], SCORED_AT);
    expect(scores.get('fp-rec-1')!.reasons).toContain('rounding_kills_edge');
    expect(scores.get('fp-rec-1')!.score).toBe(0);
    expect(scores.get('fp-rec-2')!.reasons).not.toContain('rounding_kills_edge');
  });

  it('a missing snapshot → NO scores (records confirm ungated) + console.warn — never a throw', async () => {
    const deps = makeDeps({ snapshots: { read: async () => null } });
    const scores = await scoreConfirmedRecords(deps, [makeRecord()], SCORED_AT);
    expect(scores.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Safety scoring skipped'),
    );
  });

  it('a store failure → NO scores + console.warn — scoring never blocks confirmation', async () => {
    const deps = makeDeps({
      settings: {
        read: async () => {
          throw new Error('disk on fire');
        },
      },
    });
    const scores = await scoreConfirmedRecords(deps, [makeRecord()], SCORED_AT);
    expect(scores.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Safety scoring failed'),
      expect.any(Error),
    );
  });

  it('no records → no store reads at all', async () => {
    let reads = 0;
    const deps = makeDeps({
      snapshots: {
        read: async () => {
          reads += 1;
          return makeSnapshot();
        },
      },
    });
    expect((await scoreConfirmedRecords(deps, [], SCORED_AT)).size).toBe(0);
    expect(reads).toBe(0);
  });
});

describe('legConsensusFor', () => {
  it('collects the EXACT outcome + line across all books, the leg book included', () => {
    const consensus = legConsensusFor(makeSnapshot(), makeRecord());
    // Celtics leg: bet365 2.06, pinnacle 1.7, sharp1–4 at 2.04.
    expect(consensus[0]).toEqual([2.06, 1.7, 2.04, 2.04, 2.04, 2.04]);
    expect(consensus[1]).toEqual([1.7, 2.06, 2.04, 2.04, 2.04, 2.04]);
  });

  it('never mixes lines: a totals leg only samples books quoting ITS point', () => {
    const snapshot = makeSnapshot();
    snapshot.events[0].bookmakers = [
      {
        key: 'bet365',
        title: 'Bet365',
        lastUpdate: '2026-07-12T20:00:30Z',
        markets: [
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: 1.95, point: 220.5 },
              { name: 'Under', price: 1.95, point: 220.5 },
            ],
          },
        ],
      },
      {
        key: 'coolbet',
        title: 'Coolbet',
        lastUpdate: '2026-07-12T20:00:30Z',
        markets: [
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: 1.9, point: 221.5 }, // different line — excluded
              { name: 'Under', price: 2.0, point: 220.5 },
            ],
          },
        ],
      },
    ];
    const record = makeRecord({
      marketKey: 'totals',
      legs: [
        {
          outcome: 'Over',
          point: 220.5,
          bookmakerKey: 'bet365',
          bookmakerTitle: 'Bet365',
          odds: 1.95,
          stake: 50,
          link: null,
        },
        {
          outcome: 'Under',
          point: 220.5,
          bookmakerKey: 'coolbet',
          bookmakerTitle: 'Coolbet',
          odds: 2.0,
          stake: 50,
          link: null,
        },
      ],
    });
    const consensus = legConsensusFor(snapshot, record);
    expect(consensus[0]).toEqual([1.95]); // Over 220.5 only — never 221.5
    expect(consensus[1]).toEqual([1.95, 2.0]);
  });

  it('an event absent from the snapshot yields empty samples (thin-consensus penalty upstream)', () => {
    const consensus = legConsensusFor(makeSnapshot(), makeRecord({ eventId: 'evt-unknown' }));
    expect(consensus).toEqual([[], []]);
  });
});

describe('plannedStakesFor (the same dollars alerts carry)', () => {
  const balances = new Map<string, number | null>();

  it('arb → shared planStakes at the fund default under recorded balances', () => {
    expect(plannedStakesFor(makeRecord(), FUND, balances)).toEqual([250, 250]);
    // A binding balance rescales the WHOLE position (shared cap math).
    const capped = plannedStakesFor(
      makeRecord(),
      FUND,
      new Map<string, number | null>([['bet365', 100]]),
    );
    expect(capped).toEqual([100, 100]);
  });

  it('EV → the flat default stake the EV alert quotes', () => {
    const ev = makeRecord({
      strategy: 'ev',
      legs: [makeRecord().legs[0]],
    });
    expect(plannedStakesFor(ev, FUND, balances)).toEqual([500]);
  });

  it('no fund stake (or a plan collapsed to $0) → the engine $100-basis split, like the alert fallback', () => {
    const noStake = { ...FUND, defaultStake: 0 };
    expect(plannedStakesFor(makeRecord(), noStake, balances)).toEqual([50, 50]);
    const blocked = plannedStakesFor(
      makeRecord(),
      FUND,
      new Map<string, number | null>([['bet365', 0]]),
    );
    expect(blocked).toEqual([50, 50]);
  });
});
