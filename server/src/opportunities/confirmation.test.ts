import { describe, expect, it } from 'vitest';
import type { ArbOpportunity, OpportunityRecord } from '@shared/types';
import { opportunityFingerprint, opportunityIdFromFingerprint } from './opportunityId';
import {
  headlineEdgePct,
  isPendingCandidate,
  matchConfirmationPair,
  recordToOpportunity,
} from './confirmation';

const SCAN_A_AT = '2026-07-11T12:00:00Z';
const SCAN_B = new Date('2026-07-11T12:01:00Z');
/** Scan B successfully fetched every sport these fixtures use. */
const FULL_COVERAGE: ReadonlySet<string> = new Set(['basketball_nba']);

function makeArb(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    eventId: 'evt-1',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Lakers @ Celtics',
    commenceTime: '2026-07-11T23:00:00Z',
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

function recordFor(
  arb: ArbOpportunity,
  overrides: Partial<OpportunityRecord> = {},
): OpportunityRecord {
  const fingerprint = opportunityFingerprint(arb);
  return {
    id: opportunityIdFromFingerprint(fingerprint),
    fingerprint,
    strategy: arb.ev ? 'ev' : arb.middle ? 'middle' : 'arb',
    ...(arb.ev && { ev: arb.ev }),
    ...(arb.middle && { middle: arb.middle }),
    eventId: arb.eventId,
    sportKey: arb.sportKey,
    sportTitle: arb.sportTitle,
    eventName: arb.eventName,
    commenceTime: arb.commenceTime,
    marketKey: arb.marketKey,
    ...(arb.homeTeam && { homeTeam: arb.homeTeam }),
    ...(arb.awayTeam && { awayTeam: arb.awayTeam }),
    legs: arb.legs,
    profitPctAtDetection: arb.profitPct,
    profitPct: arb.profitPct,
    arbIndex: arb.arbIndex,
    status: 'active',
    suspicious: arb.suspicious,
    sameBookmaker: arb.sameBookmaker,
    regionTab: 'ca_us',
    detectedAt: SCAN_A_AT,
    lastSeenAt: SCAN_A_AT,
    statusChangedAt: SCAN_A_AT,
    alerted: false,
    alertedAt: null,
    confirmation: { status: 'pending', scanAAt: SCAN_A_AT },
    ...overrides,
  };
}

/** The record as scan B re-sighted it: lastSeenAt advanced, edge moved. */
function resighted(record: OpportunityRecord, overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return { ...record, lastSeenAt: SCAN_B.toISOString(), ...overrides };
}

describe('headlineEdgePct', () => {
  it('arb → profitPct', () => {
    expect(headlineEdgePct(recordFor(makeArb({ profitPct: 2.34 })))).toBe(2.34);
  });

  it('EV → ev.edgePct (never the profitPct alias)', () => {
    const ev = {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 2.0,
      fairProbability: 0.52,
      edgePct: 4.1,
      benchmarkLastUpdate: SCAN_A_AT,
    };
    const record = recordFor(makeArb({ ev, profitPct: 999 }));
    expect(headlineEdgePct(record)).toBe(4.1);
  });

  it('middle → middle.costPct (signed: free middles are negative)', () => {
    const middle = {
      lowLine: 220.5,
      highLine: 224.5,
      windowSize: 4,
      costPct: 3.2,
      payoutPct: 88,
      breakevenPct: 3.5,
      freeMiddle: false,
      pushPossible: false,
      keyNumbers: [],
    };
    const record = recordFor(makeArb({ middle, profitPct: -3.2 }));
    expect(headlineEdgePct(record)).toBe(3.2);
  });
});

describe('matchConfirmationPair — the ±0.5 pp rule on both sides of the boundary', () => {
  it('same identity re-sighted with the edge unchanged → confirmed, delta 0', () => {
    const before = recordFor(makeArb());
    const outcomes = matchConfirmationPair([before], [resighted(before)], SCAN_B, FULL_COVERAGE);
    expect(outcomes).toEqual([
      {
        fingerprint: before.fingerprint,
        status: 'confirmed',
        scanBAt: SCAN_B.toISOString(),
        edgeDeltaPp: 0,
        // Phase 18: scan B's fresh per-leg odds ride along (the signal-CLV basis).
        confirmedLegOdds: before.legs.map((l) => l.odds),
      },
    ]);
  });

  it('edge drift of exactly +0.5 pp and −0.5 pp both confirm (inclusive boundary)', () => {
    const before = recordFor(makeArb({ profitPct: 2.0 }));
    for (const edgeB of [2.5, 1.5]) {
      const [outcome] = matchConfirmationPair(
        [before],
        [resighted(before, { profitPct: edgeB })],
        SCAN_B,
        FULL_COVERAGE,
      );
      expect(outcome.status).toBe('confirmed');
      expect(outcome.edgeDeltaPp).toBeCloseTo(edgeB - 2.0, 10);
    }
  });

  it('edge drift just beyond ±0.5 pp rejects on either side → single_sighting, delta kept', () => {
    const before = recordFor(makeArb({ profitPct: 2.0 }));
    for (const edgeB of [2.51, 1.49]) {
      const [outcome] = matchConfirmationPair(
        [before],
        [resighted(before, { profitPct: edgeB })],
        SCAN_B,
        FULL_COVERAGE,
      );
      expect(outcome.status).toBe('single_sighting');
      expect(outcome.edgeDeltaPp).toBeCloseTo(edgeB - 2.0, 10);
    }
  });

  it('absent from scan B (lastSeenAt did not advance) → single_sighting, no delta', () => {
    const before = recordFor(makeArb());
    // The record still exists in the store, but scan B never re-sighted it —
    // the Phase 15 second-sighting judgement (lastSeenAt vs the snapshot).
    const outcomes = matchConfirmationPair([before], [before], SCAN_B, FULL_COVERAGE);
    expect(outcomes).toEqual([
      { fingerprint: before.fingerprint, status: 'single_sighting', scanBAt: SCAN_B.toISOString() },
    ]);
  });

  it('vanished from the store entirely → single_sighting', () => {
    const before = recordFor(makeArb());
    const [outcome] = matchConfirmationPair([before], [], SCAN_B, FULL_COVERAGE);
    expect(outcome).toMatchObject({ status: 'single_sighting' });
    expect(outcome.edgeDeltaPp).toBeUndefined();
  });

  it('EV pairs compare ev.edgePct, not the profitPct alias', () => {
    const ev = {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 2.0,
      fairProbability: 0.52,
      edgePct: 4.0,
      benchmarkLastUpdate: SCAN_A_AT,
    };
    const before = recordFor(makeArb({ ev, legs: [makeArb().legs[0]] }));
    const within = resighted(before, { ev: { ...ev, edgePct: 4.4 } });
    expect(matchConfirmationPair([before], [within], SCAN_B, FULL_COVERAGE)[0].status).toBe('confirmed');
    const beyond = resighted(before, { ev: { ...ev, edgePct: 4.6 } });
    expect(matchConfirmationPair([before], [beyond], SCAN_B, FULL_COVERAGE)[0].status).toBe('single_sighting');
  });

  it('middle pairs compare middle.costPct', () => {
    const middle = {
      lowLine: 220.5,
      highLine: 224.5,
      windowSize: 4,
      costPct: 3.0,
      payoutPct: 88,
      breakevenPct: 3.5,
      freeMiddle: false,
      pushPossible: false,
      keyNumbers: [],
    };
    const before = recordFor(makeArb({ middle, profitPct: -3.0 }));
    const within = resighted(before, { middle: { ...middle, costPct: 3.5 } });
    expect(matchConfirmationPair([before], [within], SCAN_B, FULL_COVERAGE)[0].status).toBe('confirmed');
    const beyond = resighted(before, { middle: { ...middle, costPct: 3.51 } });
    expect(matchConfirmationPair([before], [beyond], SCAN_B, FULL_COVERAGE)[0].status).toBe('single_sighting');
  });

  it('only pending records are judged — confirmed/single_sighting/absent confirmations pass through untouched', () => {
    const confirmed = recordFor(makeArb({ eventId: 'evt-c' }), {
      confirmation: { status: 'confirmed', scanAAt: SCAN_A_AT, scanBAt: SCAN_A_AT },
    });
    const legacy = recordFor(makeArb({ eventId: 'evt-l' }), { confirmation: undefined });
    expect(matchConfirmationPair([confirmed, legacy], [confirmed, legacy], SCAN_B, FULL_COVERAGE)).toEqual([]);
  });
});

describe('matchConfirmationPair — confirmedLegOdds stamping (Phase 18 signal basis)', () => {
  it('a re-sighted record stamps scan B fresh leg odds (confirmed)', () => {
    const before = recordFor(makeArb());
    // Scan B refreshed the legs to new prices (applyScanToRecords set them).
    const seen = resighted(before, {
      legs: [
        { outcome: 'Lakers', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.12, stake: 48, link: null },
        { outcome: 'Celtics', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.04, stake: 52, link: null },
      ],
      profitPct: 2.34, // no drift → confirmed
    });
    const [outcome] = matchConfirmationPair([before], [seen], SCAN_B, FULL_COVERAGE);
    expect(outcome.status).toBe('confirmed');
    expect(outcome.confirmedLegOdds).toEqual([2.12, 2.04]);
  });

  it('a DRIFTED single_sighting still carries confirmedLegOdds (it was re-sighted)', () => {
    const before = recordFor(makeArb());
    const seen = resighted(before, { profitPct: 5.0 }); // drift ≫ 0.5 pp
    const [outcome] = matchConfirmationPair([before], [seen], SCAN_B, FULL_COVERAGE);
    expect(outcome.status).toBe('single_sighting');
    expect(outcome.confirmedLegOdds).toEqual(seen.legs.map((l) => l.odds));
  });

  it('a vanished / not-advanced record carries NO confirmedLegOdds', () => {
    const before = recordFor(makeArb());
    expect(matchConfirmationPair([before], [before], SCAN_B, FULL_COVERAGE)[0].confirmedLegOdds).toBeUndefined();
    expect(matchConfirmationPair([before], [], SCAN_B, FULL_COVERAGE)[0].confirmedLegOdds).toBeUndefined();
  });
});

describe('matchConfirmationPair — scan B coverage (post-P17 hardening)', () => {
  it('a candidate whose sport scan B never successfully fetched is EXCLUDED — no outcome, stays pending', () => {
    const before = recordFor(makeArb());
    // Absent from B's view of the store — but B never fetched the sport, so
    // absence of evidence is not evidence of absence: no verdict at all.
    expect(matchConfirmationPair([before], [before], SCAN_B, new Set())).toEqual([]);
    expect(matchConfirmationPair([before], [], SCAN_B, new Set())).toEqual([]);
  });

  it('exclusion is by coverage alone — even a store-visible re-sighting is not judged when B did not fetch the sport', () => {
    const before = recordFor(makeArb());
    const outcomes = matchConfirmationPair(
      [before],
      [resighted(before)],
      SCAN_B,
      new Set(['icehockey_nhl']),
    );
    expect(outcomes).toEqual([]);
  });

  it('covered-but-absent still resolves single_sighting while an uncovered sibling stays pending', () => {
    const covered = recordFor(makeArb());
    const uncovered = recordFor(makeArb({ eventId: 'evt-2', sportKey: 'icehockey_nhl' }));
    const outcomes = matchConfirmationPair(
      [covered, uncovered],
      [covered, uncovered],
      SCAN_B,
      FULL_COVERAGE,
    );
    expect(outcomes).toEqual([
      { fingerprint: covered.fingerprint, status: 'single_sighting', scanBAt: SCAN_B.toISOString() },
    ]);
  });
});

describe('isPendingCandidate', () => {
  it('pending + active + unflagged → candidate', () => {
    expect(isPendingCandidate(recordFor(makeArb()))).toBe(true);
  });

  it('suspicious, same-book, non-active, alerted, or non-pending → not a candidate', () => {
    expect(isPendingCandidate(recordFor(makeArb(), { suspicious: true }))).toBe(false);
    expect(isPendingCandidate(recordFor(makeArb(), { sameBookmaker: true }))).toBe(false);
    expect(isPendingCandidate(recordFor(makeArb(), { status: 'dead' }))).toBe(false);
    expect(isPendingCandidate(recordFor(makeArb(), { alerted: true }))).toBe(false);
    expect(isPendingCandidate(recordFor(makeArb(), { confirmation: undefined }))).toBe(false);
    expect(
      isPendingCandidate(
        recordFor(makeArb(), {
          confirmation: { status: 'single_sighting', scanAAt: SCAN_A_AT },
        }),
      ),
    ).toBe(false);
  });
});

describe('recordToOpportunity', () => {
  it('round-trips the fingerprint — the identity survives conversion', () => {
    const arb = makeArb({ homeTeam: 'Boston Celtics', awayTeam: 'Los Angeles Lakers' });
    const record = recordFor(arb);
    const opportunity = recordToOpportunity(record);
    expect(opportunityFingerprint(opportunity)).toBe(record.fingerprint);
    expect(opportunity).toMatchObject({
      id: record.id,
      profitPct: record.profitPct,
      sameBookmaker: false,
      suspicious: false,
      homeTeam: 'Boston Celtics',
    });
  });

  it('carries ev and middle context through for the strategy-specific alert formats', () => {
    const ev = {
      benchmarkKey: 'pinnacle',
      benchmarkOdds: 2.0,
      fairProbability: 0.52,
      edgePct: 4.0,
      benchmarkLastUpdate: SCAN_A_AT,
    };
    const record = recordFor(makeArb({ ev, legs: [makeArb().legs[0]] }));
    expect(recordToOpportunity(record).ev).toEqual(ev);
  });
});
