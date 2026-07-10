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

/** Machine-readable error codes surfaced to the UI. */
export type ApiErrorCode =
  | 'invalid_api_key'
  | 'quota_exhausted'
  | 'network'
  | 'provider_error'
  | 'bad_request'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
