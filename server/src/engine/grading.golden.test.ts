/**
 * GOLDEN-FILE grading tests (Phase 13, deliverable 7). Every case is a
 * hand-specified bet with a known final score. These pin GRADING_RULES.md
 * — a red test here means grading is WRONG, not that the test is stale.
 */
import { describe, expect, it } from 'vitest';
import type { ArbLeg } from '@shared/types';
import { gradeRecord } from './grading';
import { firstPollAt, rulesForSport } from '../config/gradingRules';

const NOW = new Date('2026-07-11T23:00:00Z');

function leg(outcome: string, odds: number, stake: number, point?: number): ArbLeg {
  return { outcome, point, bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds, stake, link: null };
}

function rec(overrides: {
  strategy?: 'arb' | 'ev' | 'middle';
  legs: ArbLeg[];
  marketKey: string;
  sportKey?: string;
  profitPct?: number;
  homeTeam?: string;
  awayTeam?: string;
  eventName?: string;
}) {
  return {
    strategy: overrides.strategy ?? ('ev' as const),
    legs: overrides.legs,
    marketKey: overrides.marketKey,
    sportKey: overrides.sportKey ?? 'basketball_nba',
    eventName: overrides.eventName ?? 'Boston Celtics @ Los Angeles Lakers',
    homeTeam: overrides.homeTeam ?? 'Los Angeles Lakers',
    awayTeam: overrides.awayTeam ?? 'Boston Celtics',
    profitPct: overrides.profitPct ?? 0,
  };
}

const grade = (r: ReturnType<typeof rec>, score: Parameters<typeof gradeRecord>[1], voidLegs?: boolean[]) =>
  gradeRecord(r, score, NOW, voidLegs);

describe('GOLDEN: single-leg results (§2 taxonomy)', () => {
  it('1 · h2h WIN: Lakers ML, Lakers 112–104 → +$115 on $100 @2.15', () => {
    const out = grade(rec({ legs: [leg('Los Angeles Lakers', 2.15, 100)], marketKey: 'h2h' }), { home: 112, away: 104 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'win', pnlPer100: 115, legResults: ['win'] } });
  });

  it('2 · h2h LOSS: Lakers ML, Celtics win 104–112 → −$100', () => {
    const out = grade(rec({ legs: [leg('Los Angeles Lakers', 2.15, 100)], marketKey: 'h2h' }), { home: 104, away: 112 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'loss', pnlPer100: -100 } });
  });

  it('3 · PUSH on whole-number total: Over 220, lands exactly 220 → $0, push', () => {
    const out = grade(rec({ legs: [leg('Over', 1.95, 100, 220)], marketKey: 'totals' }), { home: 110, away: 110 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'push', pnlPer100: 0, legResults: ['push'] } });
  });

  it('4 · PUSH on whole-number spread: Lakers −7, they win by exactly 7', () => {
    const out = grade(rec({ legs: [leg('Los Angeles Lakers', 1.91, 100, -7)], marketKey: 'spreads' }), { home: 110, away: 103 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'push', pnlPer100: 0 } });
  });

  it('5 · HALF-POINT never pushes: Over 219.5 with total 220 → clean win', () => {
    const out = grade(rec({ legs: [leg('Over', 1.95, 100, 219.5)], marketKey: 'totals' }), { home: 110, away: 110 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'win', pnlPer100: 95 } });
  });

  it('6 · OT-decided total INCLUDED (NBA §1): 108–108 → OT → 230 final beats Over 224.5', () => {
    // The final score already includes overtime; NBA rules include it.
    expect(rulesForSport('basketball_nba')!.includesOvertime).toBe(true);
    const out = grade(rec({ legs: [leg('Over', 1.95, 100, 224.5)], marketKey: 'totals' }), { home: 118, away: 112 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'win' } });
  });

  it('7 · Soccer is REGULATION-ONLY (§1): 1–1 at 90′ grades the Draw leg a win, even if ET happened', () => {
    expect(rulesForSport('soccer_epl')!.includesOvertime).toBe(false);
    // Ingestion supplies the regulation score (1–1); ET goals are excluded upstream.
    const out = grade(
      rec({ legs: [leg('Draw', 3.45, 100)], marketKey: 'h2h', sportKey: 'soccer_epl', homeTeam: 'Arsenal', awayTeam: 'Chelsea', eventName: 'Chelsea @ Arsenal' }),
      { home: 1, away: 1 },
    );
    expect(out).toMatchObject({ ok: true, grading: { result: 'win', pnlPer100: 245 } });
  });

  it('8 · VOID: cancelled game → every leg void, record void, $0', () => {
    const out = grade(rec({ legs: [leg('Over', 1.95, 100, 220.5)], marketKey: 'totals' }), { home: 0, away: 0, cancelled: true });
    expect(out).toMatchObject({ ok: true, grading: { result: 'void', legResults: ['void'], pnlPer100: 0 } });
  });

  it('extra · 2-way h2h tie with no draw leg → push (stake back)', () => {
    const out = grade(rec({ legs: [leg('Los Angeles Lakers', 2.15, 100)], marketKey: 'h2h' }), { home: 100, away: 100 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'push' } });
  });
});

describe('GOLDEN: arbs and broken arbs (§2, §5)', () => {
  const arbLegs = [leg('Los Angeles Lakers', 2.1, 48.78), leg('Boston Celtics', 2.05, 51.22)];

  it('arb intact: deterministic win at the recorded profit, scores irrelevant', () => {
    const out = grade(rec({ strategy: 'arb', legs: arbLegs, marketKey: 'h2h', profitPct: 2.34 }), { home: 90, away: 130 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'win', pnlPer100: 2.34, flags: [] } });
  });

  it('9 · BROKEN ARB, survivor WINS: leg0 void, Celtics leg wins for real', () => {
    const out = grade(
      rec({ strategy: 'arb', legs: arbLegs, marketKey: 'h2h', profitPct: 2.34 }),
      { home: 104, away: 112 }, // Celtics (away) win
      [true, false],
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.grading.flags).toContain('broken_arb');
    expect(out.grading.legResults).toEqual(['void', 'win']);
    // Real money: 51.22 × (2.05 − 1) = +53.78 — NOT the arb's 2.34.
    expect(out.grading.pnlPer100).toBeCloseTo(53.78, 2);
    expect(out.grading.result).toBe('win');
  });

  it('10 · BROKEN ARB, survivor LOSES: the paper P&L shows the true loss', () => {
    const out = grade(
      rec({ strategy: 'arb', legs: arbLegs, marketKey: 'h2h', profitPct: 2.34 }),
      { home: 112, away: 104 }, // Lakers win; surviving Celtics leg loses
      [true, false],
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.grading.flags).toContain('broken_arb');
    expect(out.grading.pnlPer100).toBeCloseTo(-51.22, 2);
    expect(out.grading.result).toBe('loss');
  });
});

describe('GOLDEN: middles settle per leg', () => {
  const middleLegs = [leg('Over', 1.95, 50, 220.5), leg('Under', 1.95, 50, 224.5)];

  it('middle HIT: total 222 lands in (220.5–224.5) → both legs win', () => {
    const out = grade(rec({ strategy: 'middle', legs: middleLegs, marketKey: 'totals' }), { home: 111, away: 111 });
    expect(out).toMatchObject({ ok: true, grading: { result: 'win' } });
    if (out.ok) expect(out.grading.pnlPer100).toBeCloseTo(50 * 0.95 * 2, 2);
  });

  it('middle MISS: total 230 → Over wins, Under loses → the small cost', () => {
    const out = grade(rec({ strategy: 'middle', legs: middleLegs, marketKey: 'totals' }), { home: 115, away: 115 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.grading.legResults).toEqual(['win', 'loss']);
    expect(out.grading.pnlPer100).toBeCloseTo(50 * 0.95 - 50, 2);
    expect(out.grading.result).toBe('loss');
  });

  it('middle with an integer push leg: Over 220 pushes at 220, Under 224.5 wins', () => {
    const out = grade(
      rec({ strategy: 'middle', legs: [leg('Over', 1.95, 50, 220), leg('Under', 1.95, 50, 224.5)], marketKey: 'totals' }),
      { home: 110, away: 110 },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.grading.legResults).toEqual(['push', 'win']);
    expect(out.grading.pnlPer100).toBeCloseTo(47.5, 2);
  });
});

describe('GOLDEN: guardrails', () => {
  it('12 · unknown sport → needs_rules, never a guess', () => {
    const out = grade(rec({ legs: [leg('Over', 1.9, 100, 5.5)], marketKey: 'totals', sportKey: 'cricket_ipl' }), { home: 3, away: 4 });
    expect(out).toMatchObject({ ok: false, pending: 'needs_rules' });
  });

  it('unrecognized outcome name → needs_rules', () => {
    const out = grade(rec({ legs: [leg('Someone Else', 1.9, 100)], marketKey: 'h2h' }), { home: 1, away: 0 });
    expect(out).toMatchObject({ ok: false, pending: 'needs_rules' });
  });

  it('15 · idempotent: identical inputs grade identically', () => {
    const r = rec({ legs: [leg('Over', 1.95, 100, 219.5)], marketKey: 'totals' });
    expect(grade(r, { home: 110, away: 110 })).toEqual(grade(r, { home: 110, away: 110 }));
  });

  it('§4 first-poll timing: start + duration + 30 min', () => {
    const rules = rulesForSport('basketball_nba')!;
    expect(firstPollAt('2026-07-11T19:00:00Z', rules)).toBe(
      Date.parse('2026-07-11T19:00:00Z') + 3 * 3_600_000, // 2.5h + 0.5h
    );
  });
});
