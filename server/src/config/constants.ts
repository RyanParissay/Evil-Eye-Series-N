/**
 * All tunable knobs in one place.
 */

/*
 * Regions are no longer a single constant: each region tab in
 * shared/regionTabs.ts declares its own minimal API region set (the credit
 * dial) plus its Canadian-accessible bookmaker allowlist (the filter).
 */

/** Markets scanned. 'h2h' only for now; add 'spreads' / 'totals' here later. */
export const MARKETS = ['h2h'] as const;

/**
 * Sports ranked by arb-richness/liquidity. The slider maps to how far down
 * this list a scan reaches (see sportSelection.ts). Entries are matched by
 * exact key first, then as a key prefix — so 'soccer' catches every soccer
 * league not explicitly listed above it.
 */
export const SPORT_PRIORITY: readonly string[] = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_usa_mls',
  'soccer',
  'basketball_nba',
  'americanfootball_nfl',
  'baseball_mlb',
  'icehockey_nhl',
  'tennis',
  'basketball',
  'americanfootball',
  'mma_mixed_martial_arts',
  'boxing_boxing',
];

/** Opportunities below this profit % are dropped. */
export const MIN_PROFIT_PCT = 0;

/** Opportunities above this profit % are flagged "too good to be true". */
export const SUSPICIOUS_PROFIT_PCT = 15;

/** Slider=1 scans this many sports (or fewer if fewer are in season). */
export const MIN_SPORTS_PER_SCAN = 3;

/** Upper bound of the Top-N slider. */
export const MAX_TOP_N = 10;

/**
 * Your Odds API plan, used to price a scan in dollars:
 *   cost_per_credit = PLAN_MONTHLY_PRICE / PLAN_MONTHLY_CREDITS
 * Edit these to match the tier you actually pay for.
 */
export const PLAN_MONTHLY_PRICE = 30; // USD per month
export const PLAN_MONTHLY_CREDITS = 20_000; // credits per month

export const DEFAULT_PORT = 8787;

/** Where last-scan metadata persists across server restarts (gitignored). */
export const LAST_SCAN_FILE = 'data/last-scan.json';

/* ————— WhatsApp alerts ————— */

/** Where subscriptions + sent-alert records persist (gitignored). */
export const WHATSAPP_DATA_FILE = 'data/whatsapp.json';

/** Verification codes die this long after being issued. */
export const WHATSAPP_CODE_TTL_MS = 10 * 60_000;

/** Wrong guesses allowed before a verification code is burned. */
export const WHATSAPP_MAX_VERIFY_ATTEMPTS = 5;

/** Alert messages per subscriber per rolling hour; excess is dropped. */
export const WHATSAPP_MAX_ALERTS_PER_HOUR = 10;

/** Consecutive send failures before a subscription deactivates itself. */
export const WHATSAPP_MAX_CONSECUTIVE_FAILURES = 3;

/** Sent-alert dedup records older than this are pruned. */
export const WHATSAPP_SENT_ALERT_RETENTION_MS = 7 * 24 * 3_600_000;
