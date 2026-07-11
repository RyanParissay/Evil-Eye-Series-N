/**
 * Sports rules table — seed data straight from GRADING_RULES.md §1.
 * Grading is table-driven: a sport with no entry is `needs_rules`, never
 * a guess. Keys match by sport-key prefix (like SPORT_PRIORITY).
 */
export interface SportGradingRules {
  /** Do totals/spreads settle including overtime? */
  includesOvertime: boolean;
  /** Typical game duration in hours — drives first-poll timing (§4). */
  typicalDurationHours: number;
  /** Human note carried into UI tooltips. */
  note?: string;
  /** Per-market overrides (e.g. a market keyed to regulation time). */
  marketOverrides?: Record<string, Partial<Pick<SportGradingRules, 'includesOvertime' | 'note'>>>;
}

export const GRADING_RULES: Record<string, SportGradingRules> = {
  basketball_nba: { includesOvertime: true, typicalDurationHours: 2.5 },
  americanfootball_nfl: { includesOvertime: true, typicalDurationHours: 3.5 },
  americanfootball_ncaaf: { includesOvertime: true, typicalDurationHours: 3.5 },
  basketball_ncaab: { includesOvertime: true, typicalDurationHours: 2.5 },
  icehockey_nhl: {
    includesOvertime: true,
    typicalDurationHours: 3,
    note: 'OT/SO included for ML; totals per book standard (3-way excluded, 2-way included)',
  },
  baseball_mlb: { includesOvertime: true, typicalDurationHours: 3.5, note: 'extra innings included' },
  soccer: {
    includesOvertime: false,
    typicalDurationHours: 2.5,
    note: 'Regulation only (90′ + stoppage). ET/pens excluded — supply regulation scores.',
  },
  tennis: { includesOvertime: true, typicalDurationHours: 3 },
};

/** Prefix lookup with per-market override merge; null = needs_rules. */
export function rulesForSport(sportKey: string, marketKey?: string): SportGradingRules | null {
  const match = Object.keys(GRADING_RULES)
    .filter((prefix) => sportKey.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return null;
  const base = GRADING_RULES[match];
  const override = marketKey ? base.marketOverrides?.[marketKey] : undefined;
  return override ? { ...base, ...override } : base;
}

/** §4 first-poll moment: scheduled start + typical duration + 30 min. */
export function firstPollAt(commenceTime: string, rules: SportGradingRules): number {
  return Date.parse(commenceTime) + rules.typicalDurationHours * 3_600_000 + 30 * 60_000;
}

export const SCORE_RETRY_MS = 45 * 60_000; // §4
export const SCORE_GIVE_UP_MS = 24 * 3_600_000; // §4 → ungraded_stale
export const SCORES_DAILY_CREDIT_CAP = 500; // §4
