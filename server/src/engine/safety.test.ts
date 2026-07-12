import { describe, expect, it } from 'vitest';
import type { ArbLeg, SafetySettings } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import {
  lockedProfit,
} from './arbitrage';
import {
  passesSafetyGate,
  scoreSafety,
  type ExposureView,
  type SafetyInput,
  type SafetyScoreRecord,
} from './safety';

const FIXED_NOW = new Date('2026-07-12T20:00:00Z');

function leg(bookmakerKey: string, odds: number, outcome = 'A'): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds, stake: 50, link: null };
}

/** A consensus sample of 6 identical prices → median = that implied prob. */
function inConsensus(odds: number): number[] {
  return [odds, odds, odds, odds, odds, odds];
}

function makeInput(o: {
  record?: Partial<SafetyScoreRecord>;
  legConsensus?: number[][];
  plannedStakes?: number[];
  minEdgePct?: number;
  settings?: SafetySettings;
  exposure?: ExposureView;
  scoredAt?: Date;
} = {}): SafetyInput {
  const record: SafetyScoreRecord = {
    strategy: 'arb',
    sportKey: 'tennis_atp', // unlisted → tier 2
    marketKey: 'h2h',
    profitPct: 2.0,
    legs: [leg('bet365', 2.1, 'A'), leg('draftkings', 2.05, 'B')],
    ...o.record,
  };
  return {
    record,
    legConsensus: o.legConsensus ?? record.legs.map((l) => inConsensus(l.odds)),
    plannedStakes: o.plannedStakes ?? record.legs.map(() => 50),
    minEdgePct: o.minEdgePct ?? 0,
    settings: o.settings ?? DEFAULT_SAFETY_SETTINGS,
    exposure: o.exposure ?? { books: {} },
    scoredAt: o.scoredAt ?? FIXED_NOW,
  };
}

const componentOf = (r: ReturnType<typeof scoreSafety>, key: string) =>
  r.components.filter((c) => c.key === key);

describe('scoreSafety — base + edge cap (a)', () => {
  it('a clean tier-2 soft-soft arb scores the 50 base with no reasons', () => {
    const r = scoreSafety(makeInput());
    expect(r.score).toBe(50);
    expect(r.reasons).toEqual([]);
    expect(r.components.map((c) => c.key)).toEqual([
      'edge_cap',
      'consensus',
      'consensus',
      'sharp_anchor',
      'market_tier',
      'exposure',
      'exposure',
      'stake_rounding',
    ]);
  });

  it('5% arb edge hard-rejects with suspicious_edge → score 0', () => {
    const r = scoreSafety(makeInput({ record: { profitPct: 5.0 }, minEdgePct: -100 }));
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(['suspicious_edge']);
    expect(componentOf(r, 'edge_cap')[0].detail).toContain('exceeds max safe 4.5%');
  });

  it('edge cap is arb-only — a 9% EV edge is not rejected on this component', () => {
    const r = scoreSafety(
      makeInput({
        record: { strategy: 'ev', profitPct: 9, legs: [leg('bet365', 2.15)] },
        legConsensus: [inConsensus(2.15)],
        plannedStakes: [50],
        minEdgePct: -100,
      }),
    );
    expect(r.reasons).not.toContain('suspicious_edge');
    expect(componentOf(r, 'edge_cap')[0].detail).toContain('arbs only');
  });
});

describe('scoreSafety — consensus (b)', () => {
  it('3% deviation → −15 (minor penalty), no reject', () => {
    const legProb = 0.5 * 1.03; // 0.515
    const r = scoreSafety(
      makeInput({
        record: { legs: [leg('bet365', 1 / legProb, 'A'), leg('draftkings', 2.05, 'B')] },
        legConsensus: [Array(6).fill(2.0), inConsensus(2.05)],
        minEdgePct: -100,
      }),
    );
    expect(r.reasons).toEqual([]);
    expect(componentOf(r, 'consensus')[0]).toMatchObject({ delta: -15 });
    expect(componentOf(r, 'consensus')[0].detail).toContain('3.0% off consensus');
    expect(r.score).toBe(35);
  });

  it('5% deviation → −30 (major penalty)', () => {
    const legProb = 0.5 * 1.05; // 0.525
    const r = scoreSafety(
      makeInput({
        record: { legs: [leg('bet365', 1 / legProb, 'A'), leg('draftkings', 2.05, 'B')] },
        legConsensus: [Array(6).fill(2.0), inConsensus(2.05)],
        minEdgePct: -100,
      }),
    );
    expect(componentOf(r, 'consensus')[0]).toMatchObject({ delta: -30 });
    expect(componentOf(r, 'consensus')[0].detail).toContain('5.0% off consensus');
    expect(r.score).toBe(20);
  });

  it('6.5% off-consensus leg → hard reject off_consensus → score 0', () => {
    const legProb = 0.5 * 1.065; // 0.5325
    const r = scoreSafety(
      makeInput({
        record: { legs: [leg('bet365', 1 / legProb, 'A'), leg('draftkings', 2.05, 'B')] },
        legConsensus: [Array(6).fill(2.0), inConsensus(2.05)],
        minEdgePct: -100,
      }),
    );
    expect(r.score).toBe(0);
    expect(r.reasons).toContain('off_consensus');
    expect(componentOf(r, 'consensus')[0].detail).toContain('6.5% off consensus');
  });

  it('thin consensus (<minBooks priced) → −15 thin penalty, not a reject', () => {
    const r = scoreSafety(
      makeInput({
        legConsensus: [[2.1, 2.1], inConsensus(2.05)], // 2 books < 5
        minEdgePct: -100,
      }),
    );
    expect(r.reasons).toEqual([]);
    expect(componentOf(r, 'consensus')[0]).toMatchObject({ delta: -15 });
    expect(componentOf(r, 'consensus')[0].detail).toContain('only 2 priced books');
    expect(r.score).toBe(35);
  });
});

describe('scoreSafety — sharp anchor (c)', () => {
  it('a Pinnacle-anchored arb scores ≥ its soft-soft twin', () => {
    const anchored = scoreSafety(
      makeInput({ record: { legs: [leg('pinnacle', 2.1, 'A'), leg('draftkings', 2.05, 'B')] } }),
    );
    const twin = scoreSafety(makeInput());
    expect(componentOf(anchored, 'sharp_anchor')[0]).toMatchObject({ delta: 20 });
    expect(anchored.score).toBe(70);
    expect(anchored.score).toBeGreaterThanOrEqual(twin.score);
  });

  it('both legs on sharp/exchange books → +25', () => {
    const r = scoreSafety(
      makeInput({ record: { legs: [leg('betfair_ex_uk', 2.1, 'A'), leg('smarkets', 2.05, 'B')] } }),
    );
    expect(componentOf(r, 'sharp_anchor')[0]).toMatchObject({ delta: 25 });
    expect(r.score).toBe(75);
  });
});

describe('scoreSafety — market tier (d)', () => {
  it('tier 1 (NBA h2h) → +10', () => {
    const r = scoreSafety(makeInput({ record: { sportKey: 'basketball_nba', marketKey: 'h2h' } }));
    expect(componentOf(r, 'market_tier')[0]).toMatchObject({ delta: 10 });
    expect(componentOf(r, 'market_tier')[0].detail).toContain('tier-1');
    expect(r.score).toBe(60);
  });

  it('tier 3 (obscure league) → −20', () => {
    const r = scoreSafety(
      makeInput({ record: { sportKey: 'soccer_china_superleague', marketKey: 'h2h' } }),
    );
    expect(componentOf(r, 'market_tier')[0]).toMatchObject({ delta: -20 });
    expect(componentOf(r, 'market_tier')[0].detail).toContain('tier-3');
    expect(r.score).toBe(30);
  });

  it('spreads on a tier-1 sport falls to tier 2 (0)', () => {
    const r = scoreSafety(makeInput({ record: { sportKey: 'basketball_nba', marketKey: 'spreads' } }));
    expect(componentOf(r, 'market_tier')[0]).toMatchObject({ delta: 0 });
  });
});

describe('scoreSafety — exposure budgets + cooldown (e)', () => {
  it('a book at its daily cap → hard reject book_exposure', () => {
    const r = scoreSafety(
      makeInput({
        exposure: { books: { bet365: { dayCount: 3, weekCount: 3, winningStreak: 0, cooldownUntilMs: null } } },
      }),
    );
    expect(r.score).toBe(0);
    expect(r.reasons).toContain('book_exposure');
    expect(r.components.find((c) => c.detail.includes('daily cap'))).toBeTruthy();
  });

  it('a book at its weekly cap → hard reject book_exposure', () => {
    const r = scoreSafety(
      makeInput({
        exposure: { books: { bet365: { dayCount: 0, weekCount: 12, winningStreak: 0, cooldownUntilMs: null } } },
      }),
    );
    expect(r.score).toBe(0);
    expect(r.reasons).toContain('book_exposure');
    expect(r.components.find((c) => c.detail.includes('weekly cap'))).toBeTruthy();
  });

  it('hot-streak cooldown FIRES just before its end and EXPIRES at the boundary', () => {
    const cooldownUntilMs = FIXED_NOW.getTime() + 60_000;
    const resting = scoreSafety(
      makeInput({
        exposure: { books: { bet365: { dayCount: 0, weekCount: 5, winningStreak: 5, cooldownUntilMs } } },
      }),
    );
    expect(resting.score).toBe(0);
    expect(resting.reasons).toContain('book_cooldown');

    // At exactly the cooldown-until instant the book is no longer resting.
    const expired = scoreSafety(
      makeInput({
        exposure: {
          books: {
            bet365: { dayCount: 0, weekCount: 5, winningStreak: 5, cooldownUntilMs: FIXED_NOW.getTime() },
          },
        },
      }),
    );
    expect(expired.reasons).not.toContain('book_cooldown');
    expect(expired.score).toBe(50);
  });

  it('neverLimit books are exempt from budgets AND cooldown', () => {
    const r = scoreSafety(
      makeInput({
        record: { legs: [leg('pinnacle', 2.1, 'A'), leg('draftkings', 2.05, 'B')] },
        exposure: {
          books: {
            pinnacle: { dayCount: 99, weekCount: 99, winningStreak: 99, cooldownUntilMs: FIXED_NOW.getTime() + 1e9 },
          },
        },
      }),
    );
    expect(r.reasons).not.toContain('book_exposure');
    expect(r.reasons).not.toContain('book_cooldown');
    expect(r.score).toBe(70); // +20 sharp, no exposure penalty
  });
});

describe('scoreSafety — camouflage stake rounding (f)', () => {
  it('rounds each leg to the nearest $5 (primary displayed amounts)', () => {
    const r = scoreSafety(makeInput({ plannedStakes: [66.67, 33.33] }));
    expect(r.roundedStakes).toEqual([65, 35]);
  });

  it('rounded stakes recompute guaranteed profit to the cent', () => {
    const r = scoreSafety(makeInput({ plannedStakes: [49.4, 50.6] }));
    expect(r.roundedStakes).toEqual([50, 50]);
    // Independently: worst-leg payout − total staked, to the cent = $2.50.
    const profit = lockedProfit([{ odds: 2.1, stake: 50 }, { odds: 2.05, stake: 50 }]);
    expect(Math.round(profit * 100) / 100).toBe(2.5);
    expect(componentOf(r, 'stake_rounding')[0].detail).toContain('2.50%');
  });

  it('rounding that pushes guaranteed edge below the min threshold → hard reject', () => {
    const r = scoreSafety(makeInput({ plannedStakes: [49.4, 50.6], minEdgePct: 3.0 }));
    expect(r.score).toBe(0);
    expect(r.reasons).toContain('rounding_kills_edge');
    expect(componentOf(r, 'stake_rounding')[0].detail).toContain('cuts guaranteed edge');
  });

  it('EV single-leg rounding is display-only — never kills edge', () => {
    const r = scoreSafety(
      makeInput({
        record: { strategy: 'ev', legs: [leg('bet365', 2.15)] },
        legConsensus: [inConsensus(2.15)],
        plannedStakes: [33],
        minEdgePct: 100,
      }),
    );
    expect(r.roundedStakes).toEqual([35]);
    expect(r.reasons).not.toContain('rounding_kills_edge');
    expect(componentOf(r, 'stake_rounding')[0].detail).toContain('not rounding-sensitive');
  });
});

describe('scoreSafety — determinism', () => {
  it('same inputs twice → byte-identical JSON', () => {
    const build = () =>
      makeInput({
        record: { sportKey: 'basketball_nba', legs: [leg('pinnacle', 2.1, 'A'), leg('draftkings', 2.05, 'B')] },
        exposure: { books: { draftkings: { dayCount: 1, weekCount: 2, winningStreak: 0, cooldownUntilMs: null } } },
        plannedStakes: [48.7, 51.3],
      });
    expect(JSON.stringify(scoreSafety(build()))).toBe(JSON.stringify(scoreSafety(build())));
  });
});

describe('passesSafetyGate', () => {
  const scored = (score: number) => ({
    safety: { score, components: [], reasons: [], scoredAt: FIXED_NOW.toISOString() },
  });

  it('safeMode OFF → always passes, even a 0-score reject', () => {
    expect(passesSafetyGate(scored(0), { safeMode: false, safetyThreshold: 55 })).toBe(true);
  });

  it('safeMode ON, record without a safety field (pre-Phase-17) → passes (never retro-gated)', () => {
    expect(passesSafetyGate({}, { safeMode: true, safetyThreshold: 55 })).toBe(true);
  });

  it('safeMode ON → gates on score ≥ threshold', () => {
    expect(passesSafetyGate(scored(60), { safeMode: true, safetyThreshold: 55 })).toBe(true);
    expect(passesSafetyGate(scored(55), { safeMode: true, safetyThreshold: 55 })).toBe(true);
    expect(passesSafetyGate(scored(40), { safeMode: true, safetyThreshold: 55 })).toBe(false);
  });
});
