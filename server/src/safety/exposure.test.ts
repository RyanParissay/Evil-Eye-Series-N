import { describe, expect, it } from 'vitest';
import type { ArbLeg, GradeResult, OpportunityRecord } from '@shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../ops/safetyStore';
import { assembleExposureView } from './exposure';

const NOW = new Date('2026-07-12T20:00:00Z'); // 13:00 PDT, July 12
const DAY_MS = 24 * 3_600_000;

function leg(bookmakerKey: string, outcome = 'A'): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds: 2.05, stake: 50, link: null };
}

let seq = 0;
function rec(o: {
  id?: string;
  books: string[];
  alerted?: boolean;
  alertedAt?: string | null;
  lastSeenAt?: string;
  legResults?: GradeResult[];
}): OpportunityRecord {
  const id = o.id ?? `r${seq++}`;
  return {
    id,
    fingerprint: `fp-${id}`,
    strategy: 'arb',
    eventId: `evt-${id}`,
    sportKey: 'tennis_atp',
    sportTitle: 'ATP',
    eventName: 'A vs B',
    commenceTime: '2026-07-20T00:00:00Z',
    marketKey: 'h2h',
    legs: o.books.map((b, i) => leg(b, i === 0 ? 'A' : 'B')),
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: o.lastSeenAt ?? '2026-07-12T18:00:00Z',
    lastSeenAt: o.lastSeenAt ?? '2026-07-12T18:00:00Z',
    statusChangedAt: '2026-07-12T18:00:00Z',
    alerted: o.alerted ?? false,
    alertedAt: o.alertedAt ?? null,
    ...(o.legResults && {
      grading: {
        result: 'win' as GradeResult,
        legResults: o.legResults,
        pnlPer100: 0,
        flags: [],
        gradedAt: '2026-07-13T00:00:00Z',
        source: 'auto' as const,
        audit: [],
      },
    }),
  };
}

const target = { id: 'target', legs: [leg('bet365', 'A'), leg('draftkings', 'B')] };

function view(history: OpportunityRecord[], hubIds: string[] = []) {
  return assembleExposureView({
    target,
    history,
    hubPurchasedIds: new Set(hubIds),
    settings: DEFAULT_SAFETY_SETTINGS,
    now: NOW,
  });
}

describe('assembleExposureView — acted-on derivation', () => {
  it('counts a record acted on via alerted OR a Hub purchase; ignores neither', () => {
    const v = view(
      [
        rec({ id: 'alerted', books: ['bet365'], alerted: true, alertedAt: '2026-07-12T18:00:00Z' }),
        rec({ id: 'hub', books: ['bet365'], lastSeenAt: '2026-07-12T18:00:00Z' }), // via hub id
        rec({ id: 'neither', books: ['bet365'], lastSeenAt: '2026-07-12T18:00:00Z' }),
      ],
      ['hub'],
    );
    expect(v.books.bet365.dayCount).toBe(2);
    expect(v.books.bet365.weekCount).toBe(2);
  });

  it('excludes the record being scored from its own counts', () => {
    const v = view([
      rec({ id: 'target', books: ['bet365'], alerted: true, alertedAt: '2026-07-12T18:00:00Z' }),
      rec({ id: 'other', books: ['bet365'], alerted: true, alertedAt: '2026-07-12T18:00:00Z' }),
    ]);
    expect(v.books.bet365.dayCount).toBe(1);
  });

  it('produces an entry for every target book, even with zero exposure', () => {
    const v = view([]);
    expect(v.books.bet365).toEqual({ dayCount: 0, weekCount: 0, winningStreak: 0, cooldownUntilMs: null });
    expect(v.books.draftkings).toEqual({ dayCount: 0, weekCount: 0, winningStreak: 0, cooldownUntilMs: null });
  });
});

describe('assembleExposureView — day (Vancouver-local) vs week windows', () => {
  it('separates a same-Vancouver-day hit from an in-week-but-earlier one; drops >7d', () => {
    const v = view([
      rec({ id: 'today', books: ['bet365'], alerted: true, alertedAt: '2026-07-12T18:00:00Z' }),
      rec({ id: 'in-week', books: ['bet365'], alerted: true, alertedAt: '2026-07-08T18:00:00Z' }),
      rec({ id: 'old', books: ['bet365'], alerted: true, alertedAt: '2026-07-03T18:00:00Z' }),
    ]);
    expect(v.books.bet365.dayCount).toBe(1);
    expect(v.books.bet365.weekCount).toBe(2);
  });
});

describe('assembleExposureView — winning-side streak + cooldown', () => {
  const wins = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      rec({
        id: `win${i}`,
        books: ['bet365', 'draftkings'],
        alerted: true,
        alertedAt: new Date(NOW.getTime() - (n - 1 - i) * DAY_MS).toISOString(),
        legResults: ['win', 'loss'], // bet365 (leg 0) is the winning side
      }),
    );

  it('derives a hot streak of ≥ hotStreakCount and a cooldown-until = latest win + cooldownDays', () => {
    const streak = wins(5); // latest is at NOW
    const v = view(streak);
    expect(v.books.bet365.winningStreak).toBe(5);
    const latestWinMs = Math.max(...streak.map((r) => Date.parse(r.alertedAt!)));
    expect(v.books.bet365.cooldownUntilMs).toBe(latestWinMs + 3 * DAY_MS);
    // draftkings held the LOSING side each time → no streak.
    expect(v.books.draftkings.winningStreak).toBe(0);
    expect(v.books.draftkings.cooldownUntilMs).toBeNull();
  });

  it('below hotStreakCount wins → no cooldown', () => {
    const v = view(wins(4));
    expect(v.books.bet365.winningStreak).toBe(4);
    expect(v.books.bet365.cooldownUntilMs).toBeNull();
  });

  it('only counts winning-side records inside the trailing 7 days', () => {
    const streak = [
      ...wins(4),
      rec({
        id: 'old-win',
        books: ['bet365', 'draftkings'],
        alerted: true,
        alertedAt: '2026-07-03T18:00:00Z', // >7d
        legResults: ['win', 'loss'],
      }),
    ];
    expect(view(streak).books.bet365.winningStreak).toBe(4);
  });
});

describe('assembleExposureView — determinism', () => {
  it('same inputs twice → byte-identical view', () => {
    const build = () => [
      rec({ id: 'a', books: ['bet365'], alerted: true, alertedAt: '2026-07-12T18:00:00Z' }),
      rec({ id: 'b', books: ['bet365', 'draftkings'], alerted: true, alertedAt: '2026-07-10T18:00:00Z', legResults: ['loss', 'win'] }),
    ];
    seq = 0;
    const one = view(build());
    seq = 0;
    const two = view(build());
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
