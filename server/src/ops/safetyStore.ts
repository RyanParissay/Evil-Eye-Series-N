/**
 * Safety Score settings persistence (Phase 17) — the ONE settings-editable
 * SafetySettings config object, standard JsonStore (crash-safe
 * write-then-rename, serialized read-modify-write).
 *
 * DEFAULT_SAFETY_SETTINGS carries the spec defaults EXACTLY (docs/prompts/
 * phase-17.md + the design contract): safeMode ON, threshold 55, maxSafeEdge
 * 4.5, consensus bands 2/4/6 with −15/−30 and a 5-book thin floor (−15),
 * sharp anchor +20/+25, market tiers +10/−20 with the seeded lists, budgets
 * 3/12/5/3, roundTo 5, and the seeded neverLimitBooks (Pinnacle + the
 * exchanges present in the feed). normalize() deep-merges a partial or legacy
 * file onto the defaults so nothing at rest is ever missing a knob.
 */
import type { SafetySettings } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

/** Tier-1 (+10) sports: NFL/NBA/NHL/MLB + the five major soccer leagues,
 *  on h2h AND totals only — spreads on these sports fall to tier 2 (0),
 *  matching the design's "secondary … spreads → 0". */
const TIER1_SPORTS = [
  'americanfootball_nfl',
  'basketball_nba',
  'icehockey_nhl',
  'baseball_mlb',
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
];

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  safeMode: true,
  safetyThreshold: 55,
  maxSafeEdge: 4.5,
  consensus: {
    noPenaltyMaxPct: 2,
    minorPenaltyMaxPct: 4,
    majorPenaltyMaxPct: 6,
    minorPenalty: -15,
    majorPenalty: -30,
    minBooks: 5,
    thinPenalty: -15,
  },
  // Pinnacle + the betting exchanges that reach the feed (design seed).
  neverLimitBooks: [
    'pinnacle',
    'betfair_ex_uk',
    'betfair_ex_eu',
    'betfair_ex_au',
    'matchbook',
    'smarkets',
  ],
  sharpAnchor: { oneLeg: 20, bothLegs: 25 },
  marketTiers: {
    tier1: TIER1_SPORTS.flatMap((sportPrefix) => [
      { sportPrefix, marketKey: 'h2h' },
      { sportPrefix, marketKey: 'totals' },
    ]),
    // Explicit obscure/low-liquidity league seed (any market on these is
    // tier 3). Settings-editable — this is a conservative starting list.
    tier3: [
      { sportPrefix: 'soccer_china_superleague' },
      { sportPrefix: 'soccer_league_of_ireland' },
      { sportPrefix: 'soccer_finland_veikkausliiga' },
      { sportPrefix: 'soccer_norway_eliteserien' },
      { sportPrefix: 'soccer_sweden_allsvenskan' },
      { sportPrefix: 'soccer_greece_super_league' },
    ],
    tier1Bonus: 10,
    tier3Penalty: -20,
  },
  budgets: { maxArbsPerDay: 3, maxArbsPerWeek: 12, hotStreakCount: 5, cooldownDays: 3 },
  roundTo: 5,
};

/** Structural interface so tests + routes can substitute an in-memory store. */
export interface SafetySettingsStore {
  read(): Promise<SafetySettings>;
  update<T>(
    mutate: (
      data: SafetySettings,
    ) => { data: SafetySettings; result: T } | Promise<{ data: SafetySettings; result: T }>,
  ): Promise<T>;
}

/** Deep-merge a parsed (possibly partial/legacy) file onto the defaults —
 *  the JsonStore normalize idiom, so a hand-edited or older safety.json
 *  migrates in cleanly and no nested knob is ever missing. */
function normalize(parsed: unknown): SafetySettings {
  const raw = (parsed ?? {}) as Partial<SafetySettings>;
  const d = DEFAULT_SAFETY_SETTINGS;
  return {
    ...d,
    ...raw,
    consensus: { ...d.consensus, ...(raw.consensus ?? {}) },
    sharpAnchor: { ...d.sharpAnchor, ...(raw.sharpAnchor ?? {}) },
    marketTiers: { ...d.marketTiers, ...(raw.marketTiers ?? {}) },
    budgets: { ...d.budgets, ...(raw.budgets ?? {}) },
    // Arrays are replaced wholesale when present (a user list is authoritative).
    neverLimitBooks: Array.isArray(raw.neverLimitBooks) ? raw.neverLimitBooks : d.neverLimitBooks,
  };
}

export class SafetyStore extends JsonStore<SafetySettings> implements SafetySettingsStore {
  constructor(filePath: string) {
    super(filePath, () => ({ ...DEFAULT_SAFETY_SETTINGS }), normalize);
  }
}
