/**
 * Region tabs: the Canadian-accessibility model.
 *
 * The Odds API has no 'ca' region (only us, us2, uk, au, eu), so Canadian
 * coverage is built in two layers:
 *
 *  1. PRE-CALL, credit efficiency — each tab requests only the minimal set
 *     of API regions containing its books. Every extra region multiplies
 *     the credit cost of every odds call (credits = markets × regions), so
 *     the region list is the spend dial.
 *
 *  2. POST-CALL, correctness — the response is filtered to an allowlist of
 *     bookmakers a Canadian can actually register at with Canadian ID,
 *     BEFORE arbitrage detection. No arb leg can ever point at a book you
 *     cannot use.
 *
 * The allowlists are best-effort as of mid-2026 — bookmakers enter and
 * leave the Canadian market often, so verify before relying on a book, and
 * edit these lists freely; they are plain config.
 *
 * Shared by server (filtering logic) and client (tab labels/tooltips).
 * Keep dependency-free.
 */

export type RegionTabKey = 'ca' | 'ca_us' | 'ca_eu_intl';

export interface RegionTabConfig {
  key: RegionTabKey;
  label: string;
  description: string;
  /** The Odds API regions this tab needs. Length × markets = credits per sport. */
  apiRegions: string[];
  /** Bookmaker keys accessible with Canadian identification. */
  allowedBookmakers: string[];
}

/**
 * Core Canadian books: Ontario-licensed or long-standing Canadian
 * acceptance. All live in the API's 'eu' and 'uk' region groups.
 */
const CA_CORE = [
  'bet365', // Ontario licensed; Canada-wide staple
  'betway', // Ontario licensed
  'betvictor', // Ontario licensed
  'pinnacle', // Ontario licensed; historically Canadian-founded
  'leovegas', // Ontario licensed
  'coolbet', // Canadian-focused (GAN); popular outside Ontario
  'sport888', // 888sport — Ontario presence; verify current status
  'betsson', // accepts Canadians outside Ontario; verify
  'nordicbet', // Betsson group; verify
];

/** US brands with licensed Ontario platforms (same account brand in Canada). */
const US_WITH_ONTARIO = [
  'fanduel', // FanDuel Ontario
  'draftkings', // DraftKings Ontario
  'betmgm', // BetMGM Ontario
  'williamhill_us', // Caesars — Caesars Sportsbook Ontario
  'betrivers', // BetRivers Ontario
];

/**
 * EU/international books that accept Canadian registrations (grey market —
 * legal to use in most provinces, not Ontario-licensed; verify locally).
 * Offshore US-region books that also take Canadians (bovada, betonlineag)
 * are deliberately omitted because including them would force the 'us'
 * region into this tab and raise its per-sport cost; add the keys here and
 * 'us' to apiRegions below if you want them.
 */
const EU_INTERNATIONAL = [
  'onexbet', // 1xBet — accepts Canadians; verify local legality
  'marathonbet', // verify current Canadian acceptance
];

export const REGION_TABS: RegionTabConfig[] = [
  {
    key: 'ca',
    label: 'Canada',
    description: 'Ontario-licensed and Canada-friendly books · eu+uk · 2 credits per sport',
    apiRegions: ['eu', 'uk'],
    allowedBookmakers: [...CA_CORE],
  },
  {
    key: 'ca_us',
    label: 'Canada + USA',
    description: 'Adds US brands with Ontario platforms · us+eu+uk · 3 credits per sport',
    apiRegions: ['us', 'eu', 'uk'],
    allowedBookmakers: [...CA_CORE, ...US_WITH_ONTARIO],
  },
  {
    key: 'ca_eu_intl',
    label: 'Canada + EU Intl',
    description: 'Adds international books accepting Canadians · eu+uk · 2 credits per sport',
    apiRegions: ['eu', 'uk'],
    allowedBookmakers: [...CA_CORE, ...EU_INTERNATIONAL],
  },
];

export const DEFAULT_REGION_TAB: RegionTabKey = 'ca';

export function regionTabByKey(key: string | undefined): RegionTabConfig | undefined {
  return REGION_TABS.find((t) => t.key === key);
}
