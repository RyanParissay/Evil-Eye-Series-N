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

export interface ArbOpportunity {
  /**
   * The persisted OpportunityRecord id (fingerprint prefix), filled by the
   * detection slice so scan results can deep-link `/opportunity/:id`.
   * Absent only on engine output that hasn't passed through detection.
   */
  id?: string;
  eventId: string;
  sportKey: string;
  sportTitle: string;
  /** "Away @ Home" for US sports, "Home vs Away" otherwise. */
  eventName: string;
  commenceTime: string;
  marketKey: string;
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
export type OpportunityStrategy = 'arb';

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
  /** True when the server logs messages instead of sending via Twilio. */
  devMode: boolean;
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
  /** Entry threshold — independent of any WhatsApp subscription. */
  thresholdPercent: number;
}

/** Stored facts of one simulated entry; all money derives on read. */
export interface PaperEntry {
  id: string;
  fingerprint: string;
  eventId: string;
  eventName: string;
  sportKey: string;
  sportTitle: string;
  marketKey: string;
  /** Profit % at alert time — entry uses alert-time odds. */
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
  book: PaperBook;
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
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
