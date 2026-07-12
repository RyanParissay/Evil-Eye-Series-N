/**
 * Shared domain types for Evil Eye Arbitrage.
 *
 * Imported by both the server (engine, providers, routes) and the client
 * (rendering). This file must stay dependency-free — no imports from
 * Express, React, or anything else.
 */

/** One priced outcome inside a market, as offered by a single bookmaker. */
export interface MarketOutcome {
  name: string;
  /** Decimal odds (e.g. 2.05). All arbitrage math assumes decimal format. */
  price: number;
  /**
   * The line for point-based markets: 220.5 for totals, −3.5/+3.5 for
   * spreads. Absent for h2h. The engine only ever combines outcomes whose
   * lines mirror each other (same |point|) — see arbitrage.ts.
   */
  point?: number;
  /** Deep link to this outcome at the bookmaker, when the API plan provides it. */
  link?: string;
}

export interface Market {
  /** 'h2h' today; structured so 'spreads' and 'totals' can be added later. */
  key: string;
  outcomes: MarketOutcome[];
  link?: string;
}

export interface Bookmaker {
  key: string;
  title: string;
  /** ISO timestamp of the bookmaker's last odds update. */
  lastUpdate: string;
  link?: string;
  markets: Market[];
}

/** A single event (game/match) with odds from many bookmakers. */
export interface OddsEvent {
  id: string;
  sportKey: string;
  sportTitle: string;
  /** ISO timestamp. Events that have already commenced are treated as stale. */
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: Bookmaker[];
}

/** An entry from the provider's sports catalogue. */
export interface SportInfo {
  key: string;
  title: string;
  group: string;
  active: boolean;
  /** Futures/outright markets — excluded from h2h arb scans. */
  hasOutrights: boolean;
}

/** One leg of an arbitrage: the bet to place at one bookmaker. */
export interface ArbLeg {
  outcome: string;
  /** The line this leg is on (e.g. −3.5, 220.5); absent for h2h legs. */
  point?: number;
  bookmakerKey: string;
  bookmakerTitle: string;
  /** Decimal odds for this leg — the best price found across all bookmakers. */
  odds: number;
  /** Suggested stake out of a nominal $100 total, rounded to cents. */
  stake: number;
  /** Best available link: outcome link → bookmaker link → homepage fallback. */
  link: string | null;
}

/**
 * The speculative payload on an EV opportunity (strategy 'ev'): why this
 * price beats the sharp benchmark. Expected value — NOT guaranteed.
 */
export interface EvContext {
  benchmarkKey: string;
  benchmarkOdds: number;
  /** De-vigged win probability from the benchmark's line group. */
  fairProbability: number;
  /** fairProbability × offeredOdds − 1, in percent. */
  edgePct: number;
  benchmarkLastUpdate: string;
}

/**
 * The middle payload (strategy 'middle'): two opposite bets on DIFFERENT
 * lines, gapped so both can win. Costs money when it misses — pure
 * arithmetic only, no probability estimates.
 */
export interface MiddleContext {
  /** Window in outcome terms: totals (T₁, T₂); spreads (F, D) margins. */
  lowLine: number;
  highLine: number;
  windowSize: number;
  /** Worst-case loss as % of total stake. Negative = free middle. */
  costPct: number;
  /** Both-legs-win profit as % of total stake. */
  payoutPct: number;
  /** Hit rate needed to break even = cost ÷ (cost + payout) = S − 1. */
  breakevenPct: number;
  /** Worst case ≥ $0: an arb with a bonus window. */
  freeMiddle: boolean;
  /** An integer boundary line can push (stake returned). */
  pushPossible: boolean;
  /** Key numbers (per-sport config) strictly inside the window. */
  keyNumbers: number[];
}

export interface ArbOpportunity {
  /**
   * The persisted OpportunityRecord id (fingerprint prefix), filled by the
   * detection slice so scan results can deep-link `/opportunity/:id`.
   * Absent only on engine output that hasn't passed through detection.
   */
  id?: string;
  /** Present on speculative (EV) opportunities; absent on true arbs. */
  ev?: EvContext;
  /** Present on middle opportunities; absent on true arbs. */
  middle?: MiddleContext;
  /**
   * Phase 17: the safety score, carried when this view was built from a
   * SCORED record (recordToOpportunity). Scan responses never contain it —
   * scoring happens only at the confirmation transition. Alert copy reads
   * the score line and the rounded (primary) stakes from here.
   */
  safety?: RecordSafety;
  eventId: string;
  sportKey: string;
  sportTitle: string;
  /** "Away @ Home" for US sports, "Home vs Away" otherwise. */
  eventName: string;
  commenceTime: string;
  marketKey: string;
  /** Phase 13+: for score→outcome mapping (legacy parses eventName). */
  homeTeam?: string;
  awayTeam?: string;
  /** Arbitrage index S = Σ 1/best_odds. Below 1.0 means guaranteed profit. */
  arbIndex: number;
  /** Guaranteed profit percentage: (1/S − 1) × 100. */
  profitPct: number;
  legs: ArbLeg[];
  /**
   * True when two or more legs come from the same bookmaker. These are often
   * not truly executable (a single book rarely arbs against itself; usually
   * a data quirk) and are flagged rather than hidden.
   */
  sameBookmaker: boolean;
  /**
   * True when profit exceeds the "too good to be true" threshold (~15%).
   * Usually stale or errored odds rather than a real opportunity.
   */
  suspicious: boolean;
}

/**
 * Lifecycle of a persisted opportunity. Scans set active/dead; degraded
 * (re-verified, reduced but positive) and completed (both legs placed) are
 * set by the Phase-3 cockpit flows.
 */
export type OpportunityStatus = 'active' | 'degraded' | 'dead' | 'completed';

/**
 * A detected opportunity as persisted across scans. Identity is the
 * fingerprint (event + market + legs, profit excluded), so re-detections
 * update the same record instead of duplicating it.
 */
/**
 * Which detection strategy produced a record. Only 'arb' exists today;
 * the discriminator is here so future strategies (+EV, middles) can share
 * the persistence and alert rails without a migration.
 */
export type OpportunityStrategy = 'arb' | 'ev' | 'middle';

/** Actual filled numbers captured when the user completes an opportunity. */
export interface OpportunityExecution {
  /** Aligned with the record's legs. */
  filledLegs: Array<{ odds: number; stake: number }>;
  totalStaked: number;
  /** Worst-leg payout minus everything staked — locked at placement. */
  lockedProfit: number;
  recordedAt: string;
  /** Set when the user applied this execution to book balances (revertible). */
  balancesAppliedAt?: string | null;
  winningLegIndex?: number | null;
  /**
   * EV records only: the graded outcome. Grading is what turns an EV
   * completion into realized P&L; ungraded completions sum $0 forever.
   */
  grade?: 'won' | 'lost' | 'void' | null;
  /**
   * Middle records only: per-leg grades aligned with filledLegs. Both
   * won = the middle hit; an integer-line push grades that leg void.
   */
  legGrades?: Array<'won' | 'lost' | 'void'> | null;
}

export interface OpportunityRecord {
  /** First 16 hex chars of the fingerprint — stable and URL-safe. */
  id: string;
  fingerprint: string;
  strategy: OpportunityStrategy;
  eventId: string;
  sportKey: string;
  sportTitle: string;
  eventName: string;
  commenceTime: string;
  marketKey: string;
  /** Legs with odds/stakes as of the most recent sighting. */
  legs: ArbLeg[];
  profitPctAtDetection: number;
  /** Profit as of the most recent sighting. */
  profitPct: number;
  arbIndex: number;
  status: OpportunityStatus;
  suspicious: boolean;
  sameBookmaker: boolean;
  /** Region tab whose scan surfaced it (scopes the dead-detection rule). */
  regionTab: string;
  detectedAt: string;
  lastSeenAt: string;
  statusChangedAt: string;
  /** Whether a WhatsApp alert was actually sent for it. */
  alerted: boolean;
  alertedAt: string | null;
  /** Present once the user completed it with actual filled numbers. */
  execution?: OpportunityExecution;
  /** Present on speculative (EV) records; refreshed each re-detection. */
  ev?: EvContext;
  /** Present on middle records; refreshed each re-detection. */
  middle?: MiddleContext;
  /** Reaction-funnel timestamps, first-write-wins; absent steps stay absent. */
  funnel?: {
    cockpitOpenedAt?: string;
    verifyPressedAt?: string;
    fillsOpenedAt?: string;
  };
  /** Every re-verify outcome, appended in order (ages out with the record). */
  verifies?: Array<{ at: string; outcome: 'active' | 'degraded' | 'dead'; profitPct: number }>;
  /** Phase 13+: 2. Absent = pre-v13 record (see GRADING_RULES.md §6). */
  schemaVersion?: number;
  /** Phase 13+: for score→outcome mapping (legacy parses eventName). */
  homeTeam?: string;
  awayTeam?: string;
  /** Signal-level settlement per GRADING_RULES.md (independent of execution). */
  grading?: RecordGrading;
  /** Pending-state flags: 'needs_rules' | 'ungraded_stale'. */
  gradingFlags?: string[];
  /**
   * Phase 16 Part A: confirmation-pair state. Absent on pre-Phase-16
   * records (treat as confirmed for display, but they are never
   * retro-alerted — the alerted flag already gates that).
   */
  confirmation?: RecordConfirmation;
  /**
   * Phase 17: Safety Score, computed + persisted at the confirmation
   * transition (before the fan-out). Present on every record that reached
   * 'confirmed' after Phase 17 — including gate-filtered ones.
   */
  safety?: RecordSafety;
}

/* ————— Confirmation scanning (Phase 16 Part A) ————— */

/**
 * A record is acted on (alerted / Hub-purchased) ONLY at status
 * 'confirmed': re-sighted by scan B with the same event + market + outcome
 * pair + bookmaker pair and a headline edge within ±0.5 pp of scan A's
 * (arb → profitPct, EV → edge %, middle → cost %). 'single_sighting' is
 * terminal: kept for survival telemetry, never acted on.
 */
export interface RecordConfirmation {
  status: 'pending' | 'confirmed' | 'single_sighting';
  /** Scan A sighting time (detection). */
  scanAAt: string;
  /** Scan B evaluation time; absent while pending. */
  scanBAt?: string;
  /** Signed headline-edge drift A→B in percentage points; absent unless matched. */
  edgeDeltaPp?: number;
}

/* ————— Auto-grading (Phase 13, GRADING_RULES.md is binding) ————— */

export type GradeResult = 'win' | 'loss' | 'push' | 'void';

export interface RecordGrading {
  /** Exactly one of win/loss/push/void (taxonomy §2). */
  result: GradeResult;
  /** Aligned with the record's legs. */
  legResults: GradeResult[];
  /** Signal P&L per $100 total stake at recorded odds/stake split. */
  pnlPer100: number;
  /** 'broken_arb' | 'manually_graded' | ... */
  flags: string[];
  score?: { home: number; away: number };
  gradedAt: string;
  source: 'auto' | 'manual';
  /** Append-only audit trail (§3). */
  audit: Array<{ at: string; old: GradeResult | null; next: GradeResult; note?: string }>;
}

/* ————— Ledger (Phase 5) ————— */

export interface DecayStat {
  samples: number;
  /** Mean detection-profit minus latest-evidence-profit, in percentage points. */
  avgDropPp: number | null;
}

/** Server-computed P&L aggregates; the client does zero money arithmetic. */
export interface LedgerSummary {
  realized: {
    totalLockedProfit: number;
    completions: number;
    /** Completions recorded without filled numbers — counted, never summed. */
    unpricedCompletions: number;
  };
  /**
   * EXPECTED (model): Σ(stake × edge) over placed-but-ungraded EV bets.
   * Never mixed into realized totals — it is a model, not money.
   */
  evExpected: { bets: number; profit: number };
  equity: Array<{ at: string; cumulativeProfit: number }>;
  monthly: Array<{ month: string; lockedProfit: number; completions: number }>;
  /** Stake-weighted attribution — an arb's profit is not truly per-book. */
  byBook: Array<{
    bookmakerKey: string;
    title: string;
    staked: number;
    lockedProfitShare: number;
    legs: number;
  }>;
  bySport: Array<{ sportKey: string; title: string; lockedProfit: number; completions: number }>;
  captureRate: { alerted: number; completed: number; rate: number | null };
  decay: {
    overall: DecayStat;
    byBook: Array<{ bookmakerKey: string; title: string } & DecayStat>;
  };
}

/** Credit/cost accounting for a scan. */
export interface UsageReport {
  /** Credits computed from the per-call (markets × regions) math. */
  creditsComputedThisScan: number;
  /**
   * Credits per the x-requests-used header delta across the scan.
   * Null when the provider doesn't report headers (mock mode).
   */
  creditsHeaderDeltaThisScan: number | null;
  /** Account total used, from the most recent x-requests-used header. */
  requestsUsedTotal: number | null;
  /** Account remaining, from the most recent x-requests-remaining header. */
  requestsRemainingTotal: number | null;
  /** creditsComputedThisScan × (plan price / plan credits). */
  estimatedDollarCost: number;
  /** Number of HTTP calls made during the scan (including the free sports call). */
  apiCallCount: number;
}

export interface ScanMeta {
  scannedAt: string;
  sportsScanned: string[];
  /** Sports whose odds fetch failed; scan proceeds without them. */
  sportsFailed: string[];
  regions: string[];
  /** Which accessibility tab drove region selection and bookmaker filtering. */
  regionTab?: string;
  topN: number;
  providerMode: 'live' | 'mock';
  usage: UsageReport;
}

export interface ScanResponse {
  opportunities: ArbOpportunity[];
  meta: ScanMeta;
}

/* ————— Advanced mode (Phase 4) ————— */

/** Rules a dynamic preset resolves against the bookmaker registry. */
export type BookPresetRule = 'all_enabled' | 'funded';

/**
 * A saved book selection for snapshot recomputes. Static presets carry
 * explicit keys; dynamic presets resolve their rule at evaluation time
 * (so "All enabled" always means the CURRENT enabled set).
 */
export interface BookPreset {
  id: string;
  name: string;
  kind: 'static' | 'dynamic';
  /** Static only; empty for dynamic presets. */
  bookmakerKeys: string[];
  rule?: BookPresetRule;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Operational status of a bookmaker account, set manually by the user. */
export type BookmakerStatusValue = 'active' | 'limited' | 'dead';

/**
 * Per-bookmaker operational config. The registry is derived from the odds
 * feed (every book seen in a scan is upserted); the rest is manual entry.
 */
export interface BookmakerConfig {
  key: string;
  title: string;
  /** Disabled books are excluded from fetching and detection entirely. */
  enabled: boolean;
  /** Manually-tracked bankroll at this book, in dollars. Null = not set. */
  balance: number | null;
  /** limited/dead books stay visible (badged) but never alert. */
  status: BookmakerStatusValue;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** When the balance value itself last changed — drives the stale nudge. */
  balanceUpdatedAt?: string | null;
  /**
   * Sharp benchmark source (Speculative Mode). Constant-driven, never
   * user-editable; does NOT affect bettability — the enabled flag does.
   */
  benchmark?: boolean;
}

/* ————— Fund position (Phase 7) ————— */

/** Manual-entry dollars; the app never touches bookmaker accounts. */
export interface FundSettings {
  /** Real total bankroll across everything. */
  totalBankroll: number;
  /** Default per-opportunity stake — drives alert dollars and the cockpit. */
  defaultStake: number;
  /** Cash not sitting at any book. */
  unallocatedCash: number;
}

export interface FundPosition {
  settings: FundSettings;
  /** Σ recorded balances across the registry. */
  totalFloat: number;
  /** Cumulative realized P&L from the ledger (priced completions only). */
  realProfit: number;
  paper: { simulated: true; bankrollIdeal: number; bankrollHaircut: number } | null;
  warnings: {
    /** Enabled books whose balance sits below the default stake. */
    lowBalance: string[];
    /** Books whose balance hasn't been touched in 14+ days. */
    staleBalance: string[];
  };
}

/**
 * WhatsApp alert subscription state as the client is allowed to see it:
 * the phone number only ever crosses the wire masked.
 */
export interface WhatsAppStatus {
  /** A phone number is verified and linked. */
  connected: boolean;
  /** Alerts are currently enabled (auto-off after repeated send failures). */
  active: boolean;
  /** A verification code is out, waiting to be confirmed. */
  pendingVerification: boolean;
  phoneMasked: string | null;
  thresholdPercent: number | null;
  /** Risk Mode opt-in — EV alerts are off by default. */
  evEnabled: boolean;
  /** Middles opt-in — off by default; free middles alert regardless. */
  middleEnabled: boolean;
  /** True when the server logs messages instead of sending via Twilio. */
  devMode: boolean;
  /**
   * Set after a Twilio send exhausts its retries; cleared by the next
   * successful send. `detail` is sanitized — no SIDs, tokens, or full
   * phone numbers (same credential-privacy rule as the odds key).
   */
  deliveryFailure: { at: string; detail: string } | null;
}

/* ————— Risk Mode / EV (Speculative phase 10) ————— */

export interface EvSettings {
  /** Bets below this edge never surface in the Risk Mode board. */
  showMinEdgePct: number;
  /** Alert threshold (per-subscription toggle gates delivery). */
  alertMinEdgePct: number;
  /** Model error dominates longshots — cap candidate odds. */
  maxOdds: number;
  /** Stale benchmark = phantom edges — cap benchmark age. */
  maxBenchmarkAgeMins: number;
}

/* ————— Paper trading (Phase 6) — everything here is SIMULATED ————— */

export interface PaperStakeRule {
  kind: 'flat' | 'percent';
  /** Dollars for flat, percent of paper bankroll for percent. */
  value: number;
}

export interface PaperSettings {
  enabled: boolean;
  /** Clearly fake money. */
  startingBankroll: number;
  stakeRule: PaperStakeRule;
  /** Expectation-style slippage on the secondary curve, in percent of profit. */
  haircutPercent: number;
  /**
   * 'measured' uses the survival-derived haircut once qualified (≥14 days,
   * ≥50 samples), falling back to the manual value labeled ASSUMED.
   */
  haircutSource: 'manual' | 'measured';
  /** Entry threshold — independent of any WhatsApp subscription. */
  thresholdPercent: number;
}

/** Stored facts of one simulated entry; all money derives on read. */
export interface PaperEntry {
  id: string;
  fingerprint: string;
  /** 'arb' (deterministic) or 'middle' (settles at FLOOR until graded). */
  strategy?: OpportunityStrategy;
  eventId: string;
  eventName: string;
  sportKey: string;
  sportTitle: string;
  marketKey: string;
  /**
   * Profit % at alert time. Arbs: the guaranteed %. Middles: the
   * WORST-CASE floor (−cost%) — the honest direction to be wrong in.
   */
  profitPct: number;
  arbIndex: number;
  legs: ArbLeg[];
  enteredAt: string;
  commenceTime: string;
}

export interface SettledPaperEntry extends PaperEntry {
  stake: number;
  idealProfit: number;
  haircutProfit: number;
  /** True once the event commenced — outcome-independent profit realizes. */
  settled: boolean;
  /**
   * Middle entries only: settled at the worst-case FLOOR because no real
   * graded record exists yet — the paper fund understates these.
   */
  floor: boolean;
}

export interface PaperBook {
  entries: SettledPaperEntry[];
  equityIdeal: Array<{ at: string; cumulativeProfit: number }>;
  equityHaircut: Array<{ at: string; cumulativeProfit: number }>;
  monthly: Array<{ month: string; ideal: number; haircut: number }>;
  bankrollIdeal: number;
  bankrollHaircut: number;
  /** Stake tied up in not-yet-commenced entries. */
  openStake: number;
}

export interface PaperData {
  settings: PaperSettings;
  entries: PaperEntry[];
}

export interface PaperView {
  simulated: true;
  settings: PaperSettings;
  /** The haircut actually applied to this view, with its provenance. */
  haircut: { source: 'measured' | 'assumed'; pct: number; detail: string };
  book: PaperBook;
}

/* ————— Ops: evidence instrumentation + cadence (Phase 8) ————— */

/** Minutes from local midnight; end < start spans midnight. */
export interface ScanWindow {
  startMinutes: number;
  endMinutes: number;
}

export interface OpsSettings {
  weekday: ScanWindow;
  weekend: ScanWindow;
  /** Auto-scan cadence inside the window, minutes. */
  inWindowMins: number;
  /** Cadence outside the window; null = auto-scan sleeps out of window. */
  outWindowMins: number | null;
  monthlyCreditBudget: number;
  /** Auto-scan hard-stops at this % of budget; manual scans never blocked. */
  autoStopPct: number;
  /**
   * Extra markets per scan — each multiplies every odds call's credits.
   * Default OFF; flip only with the budget to match.
   */
  markets: { totals: boolean; spreads: boolean };
  /**
   * Phase 16 adaptive scheduler — the ONE owner of all server-side scan +
   * score-poll timing (server/src/scheduler/). The legacy weekday/weekend
   * windows + inWindowMins/outWindowMins above are retained for back-compat
   * but the scheduler ignores them (gap detection now derives its expected
   * cadence from scheduler.blocks).
   */
  scheduler: SchedulerSettings;
}

/**
 * One adaptive-scheduling block in America/Vancouver local time. The
 * scheduler runs a scan every `intervalMins` while `now` sits inside an
 * active block; quiet hours (01:00–08:00 America/Vancouver) are a hard
 * guard, never expressed as a block. Blocks stay within a single local day
 * (startMin < endMin) — a schedule that "spans midnight" is two blocks.
 */
export interface SchedulerBlock {
  /** Days of week this block covers: 0=Sunday … 6=Saturday (Vancouver local). */
  days: number[];
  /** Minutes from local midnight, inclusive (0..1440). */
  startMin: number;
  /** Minutes from local midnight, exclusive; startMin < endMin. */
  endMin: number;
  /** Scan cadence inside the block, whole minutes. */
  intervalMins: number;
}

/**
 * Server-side adaptive scheduler settings (Phase 16). `enabled` DEFAULTS
 * FALSE and migrations must never flip it — the dev server hot-reloads
 * against real credits. See server/src/scheduler/.
 */
export interface SchedulerSettings {
  enabled: boolean;
  blocks: SchedulerBlock[];
  /** Fetch scope for scheduled scans (regionTab is a RegionTabKey). */
  scanParams: { regionTab: string; topN: number };
  /**
   * Set when the scheduler self-disabled after an unrecoverable provider
   * error (spent quota / rejected key); null while healthy. The scanner
   * page surfaces it and lets the user re-enable, which clears it.
   */
  disabledReason: string | null;
  /**
   * Phase 16 Part A: seconds between scan A and the conditional
   * confirmation scan B. Optional in old files; the store normalizes it to
   * 60 (and repairs out-of-range values), so it is always present at rest.
   */
  confirmationIntervalSecs?: number;
  /**
   * Phase 16 Part C.3: the dense data-gathering week, user-started. While
   * active (7 days from startedAt) it replaces normal cadence, hard-capped
   * at 4,500 credits/day and 30,000/week. Absent = not running.
   */
  denseWeek?: { startedAt: string } | null;
  /**
   * Phase 16 Part C.4: when the weekly optimizer's proposal was last APPLIED
   * to `blocks` (POST /api/scheduler/proposal/apply). Drives the ">7 days old,
   * re-run weekly" nudge. Absent/null = never applied.
   */
  proposalAppliedAt?: string | null;
}

/**
 * Phase 16 Part C.3: the dense data-gathering week's live status, served by
 * GET/POST/DELETE /api/scheduler/dense-week. Day/week credits are computed
 * from scan-history lines (creditsComputed), scoped to the dense week; the
 * `stopped` banner is set when a hard cap is reached (scheduled scanning
 * halts, manual scans stay allowed).
 */
export interface DenseWeekStatus {
  active: boolean;
  /** Absent when no dense week is running. */
  startedAt: string | null;
  /** startedAt + 7 days; absent when not running. */
  endsAt: string | null;
  /** 1–7 while active. */
  dayNumber: number;
  /** Credits spent this Vancouver-local day within the dense week. */
  dayCreditsUsed: number;
  /** Credits spent across the whole dense week so far. */
  weekCreditsUsed: number;
  dayCap: number;
  weekCap: number;
  /** The scheduler's derived scan interval (minutes) while dense. */
  intervalMins: number;
  /** Set when a hard cap halted scheduled scanning; null while running. */
  stopped: { scope: 'day' | 'week'; message: string } | null;
}

export interface MiddlesSettings {
  /** Candidates costing more than this % of stake never surface. */
  maxCostPct: number;
  /** Minimum window size in points. */
  minWindow: number;
  /** Alerts (and paper entry) only when breakeven ≤ this %. */
  alertMaxBreakevenPct: number;
}

/** One line per completed scan in data/scan-history/YYYY-MM.jsonl. */
export interface ScanLogEntry {
  scannedAt: string;
  regionTab: string;
  sportsScanned: string[];
  creditsComputed: number;
  requestsUsedTotal: number | null;
  distinctBooks: string[];
  eventCount: number;
  /**
   * Phase 16 Part A: confirmation candidates this scan left pending (≥1 ⇒
   * a scan B followed). Feeds the measured pair hit rate. Absent on
   * pre-Phase-16 lines — those are excluded from the measurement.
   */
  confirmationCandidates?: number;
}

/**
 * Phase 15 #2: one scan-history line enriched for the /scans browser —
 * its Phase-13 gap indicator and the opportunities detected/re-sighted
 * during its slot (the window between it and the previous scan). Every
 * opportunity here is a persisted OpportunityRecord, so `id` is always a
 * valid cockpit deep link — no separate knownRecordIds needed.
 */
export interface ScanBrowserEntry extends ScanLogEntry {
  /** Gap immediately preceding this scan, rendered inline between rows;
   *  null when it followed the prior scan at normal cadence. */
  gapBefore: { from: string; to: string; minutes: number } | null;
  opportunities: OpportunityRecord[];
  counts: { arb: number; ev: number; middle: number; total: number };
}

/**
 * Phase 15 #1: per-book counts accrued PER SCAN (the raw snapshot is
 * latest-only, so historic re-detection is impossible — see CLAUDE.md).
 * Zero credits: fed only from data a scan already fetched.
 */
export interface BookLeaderboardEntry {
  key: string;
  title: string;
  /** Scans whose raw feed carried this book. */
  appearances: number;
  /** appearances / totalScans, rounded like BookCoverage.share. */
  share: number;
  /** Opportunity LEGS involving this book, by detection strategy. */
  legCounts: { arb: number; ev: number; middle: number };
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Leaderboard {
  /** When the store first accrued data — "since <date>" in the UI, NOT
   *  "since paper start". */
  createdAt: string;
  totalScans: number;
  books: BookLeaderboardEntry[];
}

export interface BookCoverage {
  key: string;
  title: string;
  balance: number | null;
  /** Appearances in the last N scans considered. */
  appearances: number;
  share: number;
  lastSeenInFeedAt: string | null;
  /** missing = funded but absent; thin = funded, share < 50%. */
  flag: 'ok' | 'thin' | 'missing';
}

/** Where the sharp benchmark actually reaches — Speculative detection is
 *  silently impossible wherever it doesn't. */
export interface BenchmarkCoverage {
  key: string;
  title: string;
  /** Share of the considered scans whose feed carried this benchmark. */
  scanShare: number;
  /** From the LATEST snapshot: per scanned sport, events carrying it. */
  perSport: Array<{
    sportKey: string;
    sportTitle: string;
    events: number;
    eventsWithBenchmark: number;
  }>;
}

export interface CoverageReport {
  lastN: number;
  scansConsidered: number;
  books: BookCoverage[];
  distinctBooksPerScan: Array<{ at: string; count: number }>;
  benchmark?: BenchmarkCoverage[];
}

export interface RateStat {
  samples: number;
  rate: number | null;
}

export interface SurvivalStats {
  /** Fraction of arbs still present at the next covering scan. */
  overall: RateStat;
  byPair: Array<{ pair: string } & RateStat>;
  /** Six 4-hour local bands, keyed "00-04" … "20-24". */
  byBand: Array<{ band: string } & RateStat>;
  lifetime: {
    samples: number;
    medianMs: number | null;
    p25Ms: number | null;
    p75Ms: number | null;
    /** Killed by commencement — outlived the market window, not "gone". */
    censored: number;
  };
  haircut: {
    qualified: boolean;
    /** 100 × (1 − overall survival); null until qualified. */
    measuredPct: number | null;
    detail: string;
  };
}

export interface DeltaStat {
  samples: number;
  medianMs: number | null;
}

export interface TelemetryStats {
  /** THE headline: median alert → re-verify. */
  alertToVerify: DeltaStat;
  alertToOpen: DeltaStat;
  openToVerify: DeltaStat;
  verifyToCompleted: DeltaStat;
  verifyOutcomes: {
    total: number;
    active: number;
    degraded: number;
    dead: number;
    /** Mean (verify profit − detection profit), percentage points. */
    avgProfitDeltaPp: number | null;
    byBook: Array<{
      bookmakerKey: string;
      title: string;
      total: number;
      active: number;
      degraded: number;
      dead: number;
      avgProfitDeltaPp: number | null;
    }>;
  };
}

/** The proving-month decision view; simulated figures say so. */
export interface Scoreboard {
  paper: {
    simulated: true;
    idealProfit: number;
    haircutProfit: number;
    haircutSource: 'measured' | 'assumed';
    haircutPct: number;
  } | null;
  realProfit: number;
  captureRate: { alerted: number; completed: number; rate: number | null };
  medianArbLifetimeMs: number | null;
  medianAlertToVerifyMs: number | null;
  credits: {
    usedTotal: number | null;
    budget: number;
    projectedMonthEnd: number | null;
    autoStopEngaged: boolean;
  };
}

/** Machine-readable error codes surfaced to the UI. */
export type ApiErrorCode =
  | 'invalid_api_key'
  | 'quota_exhausted'
  | 'network'
  | 'provider_error'
  | 'bad_request'
  /** The addressed resource does not exist (e.g. a stale cockpit deep link). */
  | 'not_found'
  /** The resource exists but the requested change is not valid from its current state. */
  | 'conflict'
  /** Quiet hours (01:00–08:00 America/Vancouver): no Odds API calls of any kind. */
  | 'quiet_hours'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/* ————— Analytics Hub (Phase 16 Part B — everything here is SIMULATED) ————— */

/** Flat dollars or percent OF STARTING bankroll (GRADING_RULES §5: never compounds). */
export interface HubStake {
  type: 'flat' | 'pctOfStart';
  value: number;
}

/**
 * A Hub profile is a PARAMETERIZED ENGINE SERIES (Phase 14 scenario engine)
 * — settlement and P&L math must call the same primitives, never restate
 * them. Premades: Arb / EV / Middles, $1,000 start, flat $50 stake
 * (editable; §5 amendment — profile settings win inside the Hub).
 */
export interface HubProfile {
  id: string;
  name: string;
  premade: boolean;
  startingBankroll: number;
  stake: HubStake;
  /** Which strategies this profile auto-purchases. */
  strategies: OpportunityStrategy[];
  /** Minimum headline edge (pp) a confirmed opportunity needs to be purchased. */
  minEdgePct: number;
  createdAt: string;
}

/** One auto-purchase, written at confirmation time. Immutable once written. */
export interface HubPurchase {
  at: string;
  recordId: string;
  strategy: OpportunityStrategy;
  stake: number;
}

export interface HubEquityPoint {
  at: string;
  bankroll: number;
}

/** Server-computed per-profile report; the client does zero money math. */
export interface HubProfileReport {
  profile: HubProfile;
  simulated: true;
  bankroll: number;
  pnl: number;
  roiPct: number;
  betCount: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  /** Total stake currently in ungraded (pending) positions. */
  exposure: number;
  maxDrawdown: number;
  skipped: { count: number; events: Array<{ at: string; recordId: string }> };
  equity: HubEquityPoint[];
  positions: HubPosition[];
}

export interface HubPosition {
  purchase: HubPurchase;
  eventName: string;
  sportTitle: string;
  commenceTime: string;
  /** From record.grading; absent = pending. */
  result?: GradeResult;
  pnl?: number;
  gradeSource?: 'auto' | 'manual';
  gradeFlags?: string[];
}

/** Top-10 board for one strategy. occurrencePct = appearances ÷ total
 *  opportunities of that strategy (two-leg strategies credit both books). */
export interface HubLeaderboardRow {
  bookmakerKey: string;
  title: string;
  count: number;
  occurrencePct: number;
}

export interface HubLeaderboards {
  sinceAt: string;
  arb: HubLeaderboardRow[];
  ev: HubLeaderboardRow[];
  middle: HubLeaderboardRow[];
}

/* ————— Adaptive schedule proposal (Phase 16 Part C.4 — MODEL, propose-only) ————— */

/** Confirmed-opportunity density for one hour-of-week cell (Vancouver local). */
export interface DensityCell {
  day: number;
  hour: number;
  arb: number;
  ev: number;
  middle: number;
}

/**
 * Deterministic weekly schedule proposal. NEVER auto-applied — POST
 * /api/scheduler/proposal/apply writes proposal.blocks into settings only
 * on explicit user confirmation. model: true is the honesty label.
 */
export interface SchedulerProposal {
  model: true;
  computedAt: string;
  /** Days of scan history the density table was computed from. */
  historyDays: number;
  density: DensityCell[];
  blocks: SchedulerBlock[];
  projectedMonthlyCredits: number;
  monthlyBudget: number;
  /** Budget minus the 10% reserve the proposal must fit under. */
  spendCeiling: number;
}

/* ————— Safety Score (Phase 17 — deterministic account-longevity filter) ————— */

/** One scored component with its signed contribution and human detail. */
export interface SafetyComponent {
  /** 'edge_cap' | 'consensus' | 'sharp_anchor' | 'market_tier' | 'exposure' | 'stake_rounding' */
  key: string;
  /** Signed score contribution (+20, −30, …); 0 for informational entries. */
  delta: number;
  /** Human-readable itemization, e.g. "−30: leg 2 is 5.1% off consensus". */
  detail: string;
}

/**
 * Persisted on every CONFIRMED record at the confirmation transition,
 * BEFORE the fan-out — filtered records keep it too (Cost of Safety needs
 * to price what safety declined). Deterministic: same snapshot + config +
 * exposure inputs → identical result.
 */
export interface RecordSafety {
  /** 0–100; any hard reject → 0. */
  score: number;
  components: SafetyComponent[];
  /** Hard-reject reasons: 'suspicious_edge' | 'off_consensus' | 'book_exposure' | 'book_cooldown' | 'rounding_kills_edge'. Empty = no hard reject. */
  reasons: string[];
  /** Per-leg stakes rounded to the nearest $5 — the PRIMARY displayed/alerted amounts. Aligned with record.legs. */
  roundedStakes?: number[];
  scoredAt: string;
}

/** The ONE settings-editable config object (spec defaults in parentheses). */
export interface SafetySettings {
  /** Gate on/off (ON). OFF still computes + persists scores. */
  safeMode: boolean;
  /** Gate threshold 0–100 (55). */
  safetyThreshold: number;
  /** Arb edge above this % hard-rejects (4.5). */
  maxSafeEdge: number;
  /** Consensus deviation bands, % from median implied probability. */
  consensus: {
    noPenaltyMaxPct: number; // 2
    minorPenaltyMaxPct: number; // 4, delta −15
    majorPenaltyMaxPct: number; // 6, delta −30; beyond → hard reject
    minorPenalty: number; // -15
    majorPenalty: number; // -30
    /** Legs whose outcome has fewer priced books than this get thinPenalty. */
    minBooks: number; // 5
    thinPenalty: number; // -15
  };
  /** Books that never limit winners; exempt from budgets/cooldowns. */
  neverLimitBooks: string[];
  sharpAnchor: { oneLeg: number; bothLegs: number }; // +20 / +25
  /** Market tier matchers: sportKey prefix (+ optional marketKey). Unlisted = tier 2 (0). */
  marketTiers: {
    tier1: Array<{ sportPrefix: string; marketKey?: string }>;
    tier3: Array<{ sportPrefix: string; marketKey?: string }>;
    tier1Bonus: number; // +10
    tier3Penalty: number; // -20
  };
  budgets: {
    maxArbsPerDay: number; // 3
    maxArbsPerWeek: number; // 12
    hotStreakCount: number; // 5
    cooldownDays: number; // 3
  };
  /** Camouflage stake rounding increment in dollars (5). */
  roundTo: number;
}

/** Server-computed Cost of Safety (Hub readout). Everything hypothetical is labeled. */
export interface SafetyCostReport {
  simulated: true;
  week: SafetyCostWindow;
  lifetime: SafetyCostWindow;
}

export interface SafetyCostWindow {
  /** Confirmed opportunities the gate filtered (score < threshold or hard reject). */
  filteredCount: number;
  /**
   * Σ hypothetical profit at the fund default stake, dollars. Honesty rules:
   * arb → profitPct × stake/100 (guaranteed-at-detection); EV → edgePct ×
   * stake/100 (EXPECTED — a model, not money; label it so); middle → $0
   * unless freeMiddle, whose locked floor −costPct × stake/100 is real.
   */
  forgoneProfit: number;
  /** Σ headline edge of filtered records, pp — same honesty rules (costed
   *  middles contribute 0, never their cost). */
  forgoneEdgePp: number;
  /** One bucket per record: its first hard-reject reason, else 'below_threshold'. */
  byReason: Array<{ reason: string; count: number; forgoneProfit: number }>;
  /** Per-strategy split so the UI can label EV dollars EXPECTED and show
   *  middles' count-but-$0 rule. Only strategies present appear. */
  byStrategy?: Array<{ strategy: OpportunityStrategy; count: number; forgoneProfit: number }>;
}
