/**
 * Fixture-scores coverage (Phase 13). mock-nba-arb must land inside the
 * 220.5–224.5 middle window seeded in fetchOdds' totals fixtures — that's
 * what lets a middle on it grade a HIT in end-to-end grading tests.
 */
import { describe, expect, it } from 'vitest';
import { MockOddsProvider } from './MockOddsProvider';

describe('MockOddsProvider.fetchScores', () => {
  it('returns deterministic completed finals for mock event ids', async () => {
    const provider = new MockOddsProvider();
    const { scores, usage } = await provider.fetchScores('basketball_nba', { eventIds: ['mock-nba-arb'] });
    expect(scores).toEqual([
      {
        eventId: 'mock-nba-arb',
        completed: true,
        home: 113,
        away: 109,
        homeTeam: 'Los Angeles Lakers',
        awayTeam: 'Boston Celtics',
      },
    ]);
    expect(usage.creditsCharged).toBe(1);
    // The total lands inside the 220.5–224.5 middle window seeded in the
    // odds fixtures — a middle on this event must grade as a HIT.
    expect(scores[0].home! + scores[0].away!).toBeGreaterThan(220.5);
    expect(scores[0].home! + scores[0].away!).toBeLessThan(224.5);
  });

  it('daysFrom doubles the credit charge, matching the live adapter', async () => {
    const provider = new MockOddsProvider();
    const { usage } = await provider.fetchScores('basketball_nba', { daysFrom: 2 });
    expect(usage.creditsCharged).toBe(2);
  });

  it('filters to the requested eventIds; unknown sports return nothing', async () => {
    const provider = new MockOddsProvider();
    const all = await provider.fetchScores('basketball_nba', {});
    expect(all.scores.length).toBeGreaterThan(1);
    const filtered = await provider.fetchScores('basketball_nba', { eventIds: ['mock-nba-efficient'] });
    expect(filtered.scores.map((s) => s.eventId)).toEqual(['mock-nba-efficient']);
    expect((await provider.fetchScores('mma_mixed_martial_arts', {})).scores).toEqual([]);
    expect((await provider.fetchScores('nonexistent_sport', {})).scores).toEqual([]);
  });
});
