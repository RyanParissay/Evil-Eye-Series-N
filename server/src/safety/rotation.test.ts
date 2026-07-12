import { describe, expect, it } from 'vitest';
import type { ArbLeg, OpportunityRecord } from '@shared/types';
import { computeRotation } from './rotation';

const NOW = new Date('2026-07-12T20:00:00Z');
const NEVER = DEFAULT_NEVER();
function DEFAULT_NEVER() {
  return ['pinnacle', 'betfair_ex_uk', 'smarkets'];
}

let seq = 0;
function leg(bookmakerKey: string, outcome: string): ArbLeg {
  return { outcome, bookmakerKey, bookmakerTitle: bookmakerKey, odds: 2.05, stake: 50, link: null };
}

function rec(o: {
  legs: Array<[string, string]>; // [bookmakerKey, outcome]
  alerted?: boolean;
  alertedAt?: string;
  homeTeam?: string;
  awayTeam?: string;
  marketKey?: string;
}): OpportunityRecord {
  const id = `r${seq++}`;
  return {
    id,
    fingerprint: `fp-${id}`,
    strategy: 'arb',
    eventId: `evt-${id}`,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'Celtics @ Lakers',
    commenceTime: '2026-07-20T00:00:00Z',
    marketKey: o.marketKey ?? 'h2h',
    legs: o.legs.map(([b, out]) => leg(b, out)),
    profitPctAtDetection: 2,
    profitPct: 2,
    arbIndex: 0.98,
    status: 'active',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: o.alertedAt ?? '2026-07-12T18:00:00Z',
    lastSeenAt: o.alertedAt ?? '2026-07-12T18:00:00Z',
    statusChangedAt: '2026-07-12T18:00:00Z',
    alerted: o.alerted ?? true,
    alertedAt: o.alertedAt ?? '2026-07-12T18:00:00Z',
    homeTeam: o.homeTeam ?? 'Lakers',
    awayTeam: o.awayTeam ?? 'Celtics',
  };
}

function run(history: OpportunityRecord[]) {
  seq = 0;
  return computeRotation({ history, hubPurchasedIds: new Set(), neverLimitBooks: NEVER, now: NOW });
}

describe('computeRotation', () => {
  it('flags a book on the same side ≥80% of ≥5 samples with a rotation hint', () => {
    const history = [
      ...Array.from({ length: 9 }, () => rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']] })),
      rec({ legs: [['bet365', 'Celtics'], ['draftkings', 'Lakers']] }),
    ];
    const report = run(history);
    const bet365 = report.books.find((b) => b.bookmakerKey === 'bet365')!;
    expect(bet365.samples).toBe(10);
    expect(bet365.topSide).toBe('home');
    expect(bet365.topShare).toBe(0.9);
    expect(bet365.imbalanced).toBe(true);
    expect(bet365.hint).toBe('bet365 has taken the home side 9 of last 10 arbs — consider rotating');
  });

  it('does not flag a balanced book, nor one below the sample floor', () => {
    const balanced = run([
      ...Array.from({ length: 3 }, () => rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']] })),
      ...Array.from({ length: 2 }, () => rec({ legs: [['bet365', 'Celtics'], ['draftkings', 'Lakers']] })),
    ]);
    expect(balanced.books.find((b) => b.bookmakerKey === 'bet365')!.imbalanced).toBe(false);

    const tooFew = run(
      Array.from({ length: 4 }, () => rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']] })),
    );
    expect(tooFew.books.find((b) => b.bookmakerKey === 'bet365')!.imbalanced).toBe(false);
  });

  it('excludes neverLimit (sharp/exchange) books entirely', () => {
    const report = run(
      Array.from({ length: 10 }, () => rec({ legs: [['pinnacle', 'Lakers'], ['draftkings', 'Celtics']] })),
    );
    expect(report.books.find((b) => b.bookmakerKey === 'pinnacle')).toBeUndefined();
    expect(report.books.find((b) => b.bookmakerKey === 'draftkings')).toBeTruthy();
  });

  it('ignores records outside the trailing 30-day window and non-acted-on ones', () => {
    const report = run([
      ...Array.from({ length: 6 }, () => rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']] })),
      rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']], alertedAt: '2026-06-01T00:00:00Z' }), // >30d
      rec({ legs: [['bet365', 'Lakers'], ['draftkings', 'Celtics']], alerted: false }), // not acted on
    ]);
    expect(report.books.find((b) => b.bookmakerKey === 'bet365')!.samples).toBe(6);
  });

  it('normalizes Over/Under sides for totals markets', () => {
    const report = run(
      Array.from({ length: 5 }, () => rec({ marketKey: 'totals', legs: [['bet365', 'Over'], ['draftkings', 'Under']] })),
    );
    const bet365 = report.books.find((b) => b.bookmakerKey === 'bet365')!;
    expect(bet365.topSide).toBe('Over');
    expect(bet365.imbalanced).toBe(true);
  });
});
