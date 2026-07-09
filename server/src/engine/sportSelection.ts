/**
 * Maps the Top-N slider to scan breadth. Pure functions — no framework
 * imports.
 *
 * Credits are spent per sport scanned (each sport is one odds call costing
 * markets × regions credits), not per result returned. So the slider
 * controls how many sports we scan:
 *
 *   slider = 1  → the top MIN_SPORTS_PER_SCAN (~3) sports from the ranked
 *                 priority list — cheapest, narrowest scan
 *   slider = 10 → every in-season sport — deepest, costliest scan
 *   in between  → linear interpolation
 *
 * The final result list is *also* sliced to N, so the slider controls both
 * spend and output length.
 */
import type { SportInfo } from '../../../shared/types';

const MIN_BREADTH = 3;
const SLIDER_MAX = 10;

/**
 * Rank sports by the priority list: exact key match or key-prefix match,
 * earlier entries first; unmatched sports keep their original order at the
 * end.
 */
export function rankSports(
  sports: SportInfo[],
  priorityPatterns: readonly string[],
): SportInfo[] {
  const score = (s: SportInfo): number => {
    const idx = priorityPatterns.findIndex(
      (p) => s.key === p || s.key.startsWith(p),
    );
    return idx === -1 ? priorityPatterns.length : idx;
  };
  // .sort() is stable, so equally-scored sports keep their input order.
  return [...sports].sort((a, b) => score(a) - score(b));
}

/**
 * Number of sports to scan for a slider value: 3 at slider=1, everything at
 * slider=10, linear in between. Clamped to what's actually available.
 */
export function breadthForSlider(sliderValue: number, totalSports: number): number {
  const n = Math.min(Math.max(Math.round(sliderValue), 1), SLIDER_MAX);
  const min = Math.min(MIN_BREADTH, totalSports);
  const span = totalSports - min;
  const breadth = min + Math.ceil((span * (n - 1)) / (SLIDER_MAX - 1));
  return Math.min(Math.max(breadth, min), totalSports);
}

/**
 * The sports an actual scan should hit for a slider value: in-season,
 * non-outright sports, ranked by priority, cut to the slider's breadth.
 */
export function sportsForScan(
  catalogue: SportInfo[],
  sliderValue: number,
  priorityPatterns: readonly string[],
): SportInfo[] {
  const eligible = catalogue.filter((s) => s.active && !s.hasOutrights);
  const ranked = rankSports(eligible, priorityPatterns);
  return ranked.slice(0, breadthForSlider(sliderValue, ranked.length));
}
