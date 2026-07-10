import { describe, expect, it } from 'vitest';
import type { SportInfo } from '@shared/types';
import { breadthForSlider, rankSports, sportsForScan } from './sportSelection';

function sport(key: string, overrides: Partial<SportInfo> = {}): SportInfo {
  return { key, title: key, group: 'test', active: true, hasOutrights: false, ...overrides };
}

const PRIORITY = ['soccer_epl', 'soccer', 'basketball_nba', 'tennis'];

describe('rankSports', () => {
  it('orders by priority list, exact key match first, then prefix match', () => {
    const ranked = rankSports(
      [sport('cricket_ipl'), sport('basketball_nba'), sport('soccer_france_ligue_one'), sport('soccer_epl')],
      PRIORITY,
    );
    expect(ranked.map((s) => s.key)).toEqual([
      'soccer_epl', // exact match, priority index 0
      'soccer_france_ligue_one', // prefix match on 'soccer', index 1
      'basketball_nba', // exact match, index 2
      'cricket_ipl', // unmatched → after all priority entries
    ]);
  });

  it('keeps original order among equally-ranked sports', () => {
    const ranked = rankSports([sport('cricket_ipl'), sport('rugby_nrl')], PRIORITY);
    expect(ranked.map((s) => s.key)).toEqual(['cricket_ipl', 'rugby_nrl']);
  });
});

describe('breadthForSlider', () => {
  // Mapping: slider 1 → MIN_SPORTS_PER_SCAN (3) sports, slider 10 → all
  // in-season sports, linear in between. Lower = cheaper, narrower scan.
  it('scans ~3 sports at slider=1', () => {
    expect(breadthForSlider(1, 30)).toBe(3);
  });

  it('scans everything at slider=10', () => {
    expect(breadthForSlider(10, 30)).toBe(30);
  });

  it('is monotonically non-decreasing in the slider value', () => {
    for (let n = 1; n < 10; n++) {
      expect(breadthForSlider(n + 1, 30)).toBeGreaterThanOrEqual(breadthForSlider(n, 30));
    }
  });

  it('never exceeds the number of available sports', () => {
    expect(breadthForSlider(1, 2)).toBe(2);
    expect(breadthForSlider(10, 2)).toBe(2);
  });

  it('clamps out-of-range slider values', () => {
    expect(breadthForSlider(0, 30)).toBe(3);
    expect(breadthForSlider(99, 30)).toBe(30);
  });
});

describe('sportsForScan', () => {
  it('excludes inactive and outright-only sports, then ranks and slices', () => {
    const catalogue = [
      sport('soccer_epl'),
      sport('soccer_uefa_nations_league', { hasOutrights: true }),
      sport('basketball_nba'),
      sport('basketball_wnba', { active: false }),
      sport('tennis_atp_wimbledon'),
      sport('cricket_ipl'),
      sport('rugby_nrl'),
    ];
    const chosen = sportsForScan(catalogue, 1, PRIORITY);
    // slider=1 → 3 sports, from the top of the ranked list, no outrights/inactive
    expect(chosen.map((s) => s.key)).toEqual(['soccer_epl', 'basketball_nba', 'tennis_atp_wimbledon']);
  });
});
