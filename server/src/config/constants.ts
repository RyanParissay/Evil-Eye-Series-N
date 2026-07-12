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

/**
 * Sharp books carried in every fetch as the fair-price benchmark
 * (Speculative Mode). Dual-role: being listed here never affects a
 * book's bettability — only guarantees its odds reach the feed.
 */
export const BENCHMARK_BOOKS: readonly string[] = ['pinnacle'];

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

/* ————— Scheduler (Phase 16) ————— */

/** Longest the scheduler sleeps before re-reading settings, so an enable
 *  toggle or a budget release is picked up even absent an explicit wake(). */
export const SCHEDULER_MAX_SLEEP_MS = 60_000;

/** How often the scheduler runs a grading score poll while enabled and
 *  outside quiet hours — replaces the retired client grading tick. */
export const SCHEDULER_SCORE_POLL_INTERVAL_MS = 5 * 60_000;

/* ————— Confirmation pairs (Phase 16 Part A) ————— */

/** Default seconds between scan A and its conditional confirmation scan B
 *  (SchedulerSettings.confirmationIntervalSecs normalizes to this). */
export const DEFAULT_CONFIRMATION_INTERVAL_SECS = 60;

/** A pair confirms only when the headline edge (arb → profitPct, EV →
 *  ev.edgePct, middle → middle.costPct) moved no more than this many
 *  percentage points between scans A and B. Inclusive on both sides. */
export const CONFIRMATION_EDGE_TOLERANCE_PP = 0.5;

/** If scan B cannot fire within this many confirmation intervals of its due
 *  time (quiet hours, scheduler stop, restart), the pending candidates
 *  resolve to 'single_sighting' — an unconfirmed opportunity is never acted
 *  on. Zero credits: resolving is bookkeeping, not a provider call. */
export const CONFIRMATION_GRACE_INTERVALS = 5;

/** Confirmation hit rate (share of scans with ≥1 candidate) is MEASURED
 *  from the last 14 days of scan history once this many logged scans carry
 *  the candidates field; before that it is labeled ASSUMED at 30%. */
export const CONFIRMATION_HIT_RATE_WINDOW_MS = 14 * 24 * 3_600_000;
export const CONFIRMATION_HIT_RATE_MIN_SAMPLES = 50;
export const CONFIRMATION_ASSUMED_HIT_RATE = 0.3;

/* ————— Dense data-gathering week (Phase 16 Part C.3) ————— */

/** A dense week runs this many days from `denseWeek.startedAt`, then the
 *  scheduler falls back to normal blocks automatically. */
export const DENSE_WEEK_DAYS = 7;

/** Hard cap on scan-history credits spent per Vancouver-local day while a
 *  dense week is active. Reaching it stops scheduled scanning for that local
 *  day (manual scans stay allowed); it resumes at the next local midnight. */
export const DENSE_WEEK_DAY_CAP = 4_500;

/** Hard cap on scan-history credits spent across the whole dense week.
 *  Reaching it stops scheduled scanning for the remainder of the week. */
export const DENSE_WEEK_WEEK_CAP = 30_000;

/** The dense-week interval never drops below this many minutes, however
 *  cheap a pair window is — the elevated-frequency floor. */
export const DENSE_WEEK_MIN_INTERVAL_MINS = 5;

/** Conservative per-scan credit cost used to derive the dense-week interval
 *  and project proposal spend when no scan history exists yet (a fresh
 *  install). The hard caps stop scanning regardless of this estimate. */
export const DEFAULT_PER_SCAN_COST = 30;

/* ————— Weekly deterministic optimizer (Phase 16 Part C.4) ————— */

/** The optimizer proposes blocks only once this many days of scan history
 *  exist; GET /api/scheduler/proposal 409s below it. */
export const PROPOSAL_MIN_HISTORY_DAYS = 7;

/** The proposal's projected monthly spend must fit under this fraction of
 *  the monthly budget — the 10% reserve. */
export const PROPOSAL_SPEND_CEILING_FRACTION = 0.9;

/** The optimizer's shortest proposed block interval (busiest cells). */
export const PROPOSAL_MIN_INTERVAL_MINS = 10;

/** Where last-scan metadata persists across server restarts (gitignored). */
export const LAST_SCAN_FILE = 'data/last-scan.json';

/** Where the bookmaker registry/config persists (gitignored). */
export const BOOKMAKERS_FILE = 'data/bookmakers.json';

/** Active opportunity records (gitignored). */
export const OPPORTUNITIES_FILE = 'data/opportunities.json';

/** Monthly JSONL archives of settled opportunities (gitignored). */
export const OPPORTUNITY_ARCHIVE_DIR = 'data/opportunity-archive';

/** Dead/completed records move from the active file to the archive after this. */
export const OPPORTUNITY_ARCHIVE_AFTER_MS = 7 * 24 * 3_600_000;

/** The latest raw odds snapshot, for offline recomputation (gitignored). */
export const LAST_SNAPSHOT_FILE = 'data/last-snapshot.json';

/** Advanced-mode book presets (gitignored). */
export const PRESETS_FILE = 'data/presets.json';

/** The SIMULATED paper fund — settings + entries (gitignored). */
export const PAPER_FILE = 'data/paper.json';

/** Fund settings: real bankroll, default stake, unallocated cash (gitignored). */
export const FUND_FILE = 'data/fund.json';

/** Risk Mode (EV) settings (gitignored). */
export const EV_FILE = 'data/ev.json';

/** Middles settings (gitignored). */
export const MIDDLES_FILE = 'data/middles.json';

/**
 * Key numbers per sport-key prefix — margins where games land often.
 * A middle window containing one gets a factual badge, nothing more.
 */
export const KEY_NUMBERS: Record<string, readonly number[]> = {
  americanfootball: [3, 7, 10],
};

/** Nudge when a book's balance hasn't been touched for this long. */
export const STALE_BALANCE_AFTER_MS = 14 * 24 * 3_600_000;

/** Ops settings: scan windows, cadences, credit budget (gitignored). */
export const OPS_FILE = 'data/ops.json';

/** Per-scan history JSONL, monthly files (gitignored). */
export const SCAN_HISTORY_DIR = 'data/scan-history';

/** Book leaderboards: per-book appearances + leg counts, accrued per scan (gitignored). */
export const LEADERBOARD_FILE = 'data/leaderboard.json';

/** Score-polling ledger: daily credit spend + per-event poll state (gitignored). */
export const GRADING_FILE = 'data/grading.json';

/** Analytics Hub (Phase 16): profiles + immutable purchase/skip events (gitignored). */
export const HUB_FILE = 'data/hub.json';

/** Safety Score settings (Phase 17): the one SafetySettings config object (gitignored). */
export const SAFETY_FILE = 'data/safety.json';

/** Everything under here gets backed up daily (gitignored). */
export const DATA_DIR = 'data';

/** Default BACKUP_DIR when the env var is unset — override via BACKUP_DIR. */
export const DEFAULT_BACKUP_DIR = 'data/backups';

/**
 * Re-verify marks a record degraded only when fresh profit fell more than
 * this many percentage points below the detection profit — a 2.34% → 2.31%
 * wobble is noise, not degradation.
 */
export const VERIFY_PROFIT_TOLERANCE_PP = 0.1;

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

/**
 * Same-message immediate retries (no delay — this path owns no timer; the
 * only timer in server/src is the scheduler's) before a send counts as a
 * delivery failure for this dispatch.
 */
export const WHATSAPP_MAX_SEND_RETRIES = 2;

/** Sent-alert dedup records older than this are pruned. */
export const WHATSAPP_SENT_ALERT_RETENTION_MS = 7 * 24 * 3_600_000;
