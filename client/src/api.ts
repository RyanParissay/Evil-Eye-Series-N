/**
 * Thin typed client for the Express API. The API key never reaches this
 * side of the wire — the server proxies The Odds API.
 */
import type { ConfirmationCostView } from './creditWidget';
import type { RegionTabKey } from '../../shared/regionTabs';
import type {
  ApiErrorBody,
  ApiErrorCode,
  ArbOpportunity,
  BookPreset,
  BookmakerConfig,
  BookmakerStatusValue,
  ClvSummary,
  CoverageReport,
  DenseWeekStatus,
  EvSettings,
  FundPosition,
  FundSettings,
  HubLeaderboards,
  HubProfile,
  HubProfileReport,
  HubStake,
  Leaderboard,
  LedgerSummary,
  MiddlesSettings,
  OpportunityRecord,
  OpportunityStrategy,
  OpsSettings,
  PaperSettings,
  PaperView,
  SafetyCostReport,
  SafetySettings,
  SchedulerProposal,
  SchedulerSettings,
  ScanBrowserEntry,
  Scoreboard,
  SurvivalStats,
  TelemetryStats,
  ScanMeta,
  ScanResponse,
  WhatsAppStatus,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function runScan(topN: number, regionTab: RegionTabKey): Promise<ScanResponse> {
  return request<ScanResponse>('/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topN, regionTab }),
  });
}

export async function fetchLastScan(): Promise<ScanMeta | null> {
  const { meta } = await request<{ meta: ScanMeta | null }>('/api/last-scan');
  return meta;
}

/* ————— Bookmaker configuration ————— */

export interface BookmakerPatchBody {
  enabled?: boolean;
  balance?: number | null;
  status?: BookmakerStatusValue;
  notes?: string;
}

export async function fetchBookmakers(): Promise<BookmakerConfig[]> {
  const { bookmakers } = await request<{ bookmakers: BookmakerConfig[] }>('/api/bookmakers');
  return bookmakers;
}

export async function patchBookmaker(
  key: string,
  patch: BookmakerPatchBody,
): Promise<BookmakerConfig> {
  return request<BookmakerConfig>(`/api/bookmakers/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/* ————— Advanced mode (presets over the latest snapshot) ————— */

export interface RecomputeResponse {
  snapshot: { fetchedAt: string; regionTab: string; sportsScanned: string[] } | null;
  opportunities: ArbOpportunity[];
  /** Opportunity ids that have persisted records — the only valid cockpit links. */
  knownRecordIds: string[];
  /** The book keys actually evaluated (dynamic presets resolved server-side). */
  bookmakerKeys: string[];
}

export async function fetchPresets(): Promise<BookPreset[]> {
  const { presets } = await request<{ presets: BookPreset[] }>('/api/presets');
  return presets;
}

export async function createPreset(name: string, bookmakerKeys: string[]): Promise<BookPreset> {
  return request<BookPreset>('/api/presets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, bookmakerKeys }),
  });
}

export async function renamePreset(id: string, name: string): Promise<BookPreset> {
  return request<BookPreset>(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deletePreset(id: string): Promise<void> {
  await requestVoid(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Zero-credit: recomputes from the stored snapshot, never the provider. */
export async function recompute(
  body: { presetId: string } | { bookmakerKeys: string[] },
): Promise<RecomputeResponse> {
  return request<RecomputeResponse>('/api/advanced/recompute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ————— Opportunities (the cockpit) ————— */

export interface VerifyResponse {
  record: OpportunityRecord;
  /** Fresh odds aligned with record.legs; null = leg no longer offered. */
  legOdds: Array<number | null>;
  creditsCharged: number;
}

export async function fetchOpportunity(id: string): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(`/api/opportunities/${encodeURIComponent(id)}`);
}

/** Re-price the record's exact legs with a fresh (cheap) provider call. */
export async function verifyOpportunity(id: string): Promise<VerifyResponse> {
  return request<VerifyResponse>(`/api/opportunities/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
  });
}

/** Completion books the ACTUAL filled numbers — they become realized P&L. */
export async function completeOpportunity(
  id: string,
  filledLegs: Array<{ odds: number; stake: number }>,
): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(`/api/opportunities/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'completed', filledLegs }),
  });
}

/* ————— Ledger ————— */

export async function fetchLedgerSummary(): Promise<LedgerSummary> {
  return request<LedgerSummary>('/api/ledger/summary');
}

/* ————— Fund position ————— */

export async function fetchFundPosition(): Promise<FundPosition> {
  return request<FundPosition>('/api/fund/position');
}

export async function patchFundSettings(patch: Partial<FundSettings>): Promise<FundPosition> {
  return request<FundPosition>('/api/fund/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** After the event: fold the filled numbers into recorded book balances. */
export async function applyBalances(
  id: string,
  winningLegIndex: number,
): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(
    `/api/opportunities/${encodeURIComponent(id)}/apply-balances`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ winningLegIndex }),
    },
  );
}

export async function revertBalances(id: string): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(
    `/api/opportunities/${encodeURIComponent(id)}/revert-balances`,
    { method: 'POST' },
  );
}

/* ————— Ops: cadence, coverage, survival, telemetry, scoreboard ————— */

export async function fetchOpsSettings(): Promise<OpsSettings> {
  return request<OpsSettings>('/api/ops/settings');
}

export async function patchOpsSettings(patch: Partial<OpsSettings>): Promise<OpsSettings> {
  return request<OpsSettings>('/api/ops/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Phase 16: the auto-scan switch drives the SERVER scheduler now. Sends a
 *  partial scheduler patch (enabled / scanParams / disabledReason) — the
 *  server deep-merges it and wakes the running scheduler. */
export async function patchScheduler(patch: Partial<SchedulerSettings>): Promise<OpsSettings> {
  return request<OpsSettings>('/api/ops/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheduler: patch }),
  });
}

export async function fetchCoverage(): Promise<CoverageReport> {
  return request<CoverageReport>('/api/ops/coverage');
}

export async function fetchSurvival(): Promise<SurvivalStats> {
  return request<SurvivalStats>('/api/ops/survival');
}

export async function fetchTelemetry(): Promise<TelemetryStats> {
  return request<TelemetryStats>('/api/ops/telemetry');
}

export async function fetchScoreboard(): Promise<Scoreboard> {
  return request<Scoreboard>('/api/ops/scoreboard');
}

/** Phase 18: the CLV read model — zero credits, server-computed. */
export async function fetchClvSummary(): Promise<ClvSummary> {
  return request<ClvSummary>('/api/clv/summary');
}

/** Reaction-funnel ping; first write wins server-side. Fire-and-forget. */
export function pingFunnel(id: string, step: 'cockpit_opened' | 'fills_opened'): void {
  void fetch(`/api/opportunities/${encodeURIComponent(id)}/funnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step }),
  }).catch(() => {
    // Telemetry must never break the cockpit.
  });
}

/* ————— Risk Mode (EV — expected value, not guaranteed) ————— */

export interface EvBoard {
  bets: OpportunityRecord[];
  settings: EvSettings;
  defaultStake: number;
}

export async function fetchEvBoard(): Promise<EvBoard> {
  return request<EvBoard>('/api/ev/board');
}

export async function patchEvSettings(patch: Partial<EvSettings>): Promise<EvSettings> {
  return request<EvSettings>('/api/ev/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Grading turns an EV completion into realized money. */
export async function gradeOpportunity(
  id: string,
  grade: 'won' | 'lost' | 'void',
): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(`/api/opportunities/${encodeURIComponent(id)}/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grade }),
  });
}

export async function whatsappSetEv(enabled: boolean): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/api/whatsapp/ev', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

/* ————— Middles (yellow family — costs money when it misses) ————— */

export interface MiddlesBoard {
  bets: OpportunityRecord[];
  settings: MiddlesSettings;
  defaultStake: number;
}

export async function fetchMiddlesBoard(): Promise<MiddlesBoard> {
  return request<MiddlesBoard>('/api/middles/board');
}

export async function patchMiddlesSettings(
  patch: Partial<MiddlesSettings>,
): Promise<MiddlesSettings> {
  return request<MiddlesSettings>('/api/middles/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Per-leg grading (middles): both won = the middle hit. */
export async function gradeOpportunityLegs(
  id: string,
  legGrades: Array<'won' | 'lost' | 'void'>,
): Promise<OpportunityRecord> {
  return request<OpportunityRecord>(`/api/opportunities/${encodeURIComponent(id)}/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ legGrades }),
  });
}

export async function whatsappSetMiddles(enabled: boolean): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/api/whatsapp/middles', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

/* ————— Grading (Phase 13: score polling + auto-grading) ————— */

export interface GradingBuckets {
  graded: number;
  open: number;
  needsRules: number;
  stale: number;
  /** No schemaVersion and no grading — a record from before Phase 13. */
  preV13: number;
}

export interface ScanGap {
  from: string;
  to: string;
  minutes: number;
}

export interface GradingStatus {
  buckets: GradingBuckets;
  scoresSpendToday: number;
  cap: number;
  capped: boolean;
  gaps: ScanGap[];
}

export interface GradingPollResult {
  graded: number;
  polled: number;
  capped: boolean;
  scoresSpendToday: number;
  cap: number;
}

/** Manual score-poll trigger. The Phase-16 scheduler drives grading polls
 *  server-side now (the client grading tick was retired), but this endpoint
 *  stays for on-demand polling. Callers should .catch() — it's a real fetch. */
export async function pollGrading(): Promise<GradingPollResult> {
  return request<GradingPollResult>('/api/grading/poll', { method: 'POST' });
}

export async function fetchGradingStatus(): Promise<GradingStatus> {
  return request<GradingStatus>('/api/grading/status');
}

export async function manualGradeOpportunity(
  id: string,
  result: 'win' | 'loss' | 'push' | 'void',
  note?: string,
): Promise<OpportunityRecord> {
  return request<OpportunityRecord>('/api/grading/manual-grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, result, ...(note && { note }) }),
  });
}

export interface CostEstimate {
  regionTab: string;
  topN: number;
  marketCount: number;
  regionEquivalents: number;
  creditsPerSport: number;
  creditsPerScan: number;
  /** Phase 16 Part A: the conditional pair — cost(A) + hitRate × cost(B). */
  confirmation: ConfirmationCostView;
}

export async function fetchCostEstimate(regionTab: string, topN: number): Promise<CostEstimate> {
  return request<CostEstimate>(
    `/api/ops/cost-estimate?regionTab=${encodeURIComponent(regionTab)}&topN=${topN}`,
  );
}

/* ————— Scan history browser (Phase 15 #2) ————— */

export async function fetchScanBrowser(lastN: number): Promise<ScanBrowserEntry[]> {
  const { scans } = await request<{ scans: ScanBrowserEntry[] }>(
    `/api/ops/scans?lastN=${lastN}`,
  );
  return scans;
}

/* ————— Book leaderboards (Phase 15 #1 — zero credits) ————— */

export async function fetchLeaderboard(): Promise<Leaderboard> {
  return request<Leaderboard>('/api/ops/leaderboard');
}

/* ————— Portfolios (Phase 14 — SIMULATED paper series + combo optimizer) ————— */

export interface PortfolioBuckets {
  preV13: number;
  needsRules: number;
  stale: number;
  open: number;
  excluded: number;
}

export interface PortfolioSkippedEvent {
  at: string;
  recordId: string;
}

export type PortfolioGroup = 'arb' | 'ev' | 'middle';

export interface PortfolioSeries {
  key: string;
  label: string;
  group: PortfolioGroup;
  startingBankroll: number;
  bankroll: number;
  pnl: number;
  roiPct: number;
  records: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  skipped: { count: number; events: PortfolioSkippedEvent[] };
  buckets: PortfolioBuckets;
  maxDrawdown: number;
  equity: Array<{ at: string; bankroll: number }>;
}

export interface PortfolioScanGap {
  from: string;
  to: string;
  minutes: number;
}

export interface PortfolioGroupGate {
  records: { have: number; need: number };
  days: { have: number; need: number };
  met: boolean;
}

export interface PortfolioOptimizerGates {
  arb: PortfolioGroupGate;
  ev: PortfolioGroupGate;
  middle: PortfolioGroupGate;
  met: boolean;
}

export interface PortfoliosReport {
  series: PortfolioSeries[];
  gaps: PortfolioScanGap[];
  optimizerGates: PortfolioOptimizerGates;
}

export interface PortfolioOptimizeResult {
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  model: true;
}

export async function fetchPortfolios(): Promise<PortfoliosReport> {
  return request<PortfoliosReport>('/api/portfolios');
}

/** Omit `weights` to run the deterministic grid-search optimizer; pass
 *  [arbPct, evPct, middlePct] (summing to 100) to evaluate a specific mix
 *  instead. Both paths 400 until every group clears the data-sufficiency
 *  gate. */
export async function optimizePortfolio(weights?: number[]): Promise<PortfolioOptimizeResult> {
  return request<PortfolioOptimizeResult>('/api/portfolios/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(weights ? { weights } : {}),
  });
}

/* ————— Paper fund (SIMULATED) ————— */

export async function fetchPaper(): Promise<PaperView> {
  return request<PaperView>('/api/paper');
}

export async function patchPaperSettings(patch: Partial<PaperSettings>): Promise<PaperView> {
  return request<PaperView>('/api/paper/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function resetPaper(): Promise<PaperView> {
  return request<PaperView>('/api/paper/reset', { method: 'POST' });
}

/* ————— WhatsApp alerts ————— */

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>('/api/whatsapp/status');
}

/** Starts (or restarts) verification: sends a 6-digit code to the number. */
export async function whatsappConnect(
  phone: string,
  thresholdPercent: number,
): Promise<WhatsAppStatus> {
  return whatsappRequest('/api/whatsapp/connect', 'POST', { phone, thresholdPercent });
}

export async function whatsappVerify(code: string): Promise<WhatsAppStatus> {
  return whatsappRequest('/api/whatsapp/verify', 'POST', { code });
}

export async function whatsappSetThreshold(thresholdPercent: number): Promise<WhatsAppStatus> {
  return whatsappRequest('/api/whatsapp/threshold', 'PATCH', { thresholdPercent });
}

export async function whatsappSendTest(): Promise<WhatsAppStatus> {
  return whatsappRequest('/api/whatsapp/test', 'POST');
}

export async function whatsappDisconnect(): Promise<WhatsAppStatus> {
  return whatsappRequest('/api/whatsapp/disconnect', 'DELETE');
}

async function whatsappRequest(
  url: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<WhatsAppStatus> {
  return request<WhatsAppStatus>(url, {
    method,
    ...(body && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

/* ————— Adaptive scheduler: dense week + weekly proposal (Phase 16 Part C) ————— */

/** Live dense-week status (day X of 7, credits vs caps, cap-hit banner). */
export async function fetchDenseWeek(): Promise<DenseWeekStatus> {
  return request<DenseWeekStatus>('/api/scheduler/dense-week');
}

/** Start a dense data-gathering week. 409 (conflict) if one is already active. */
export async function startDenseWeek(): Promise<DenseWeekStatus> {
  return request<DenseWeekStatus>('/api/scheduler/dense-week', { method: 'POST' });
}

/** Cancel the dense week early. */
export async function cancelDenseWeek(): Promise<DenseWeekStatus> {
  return request<DenseWeekStatus>('/api/scheduler/dense-week', { method: 'DELETE' });
}

/** The weekly deterministic schedule proposal (MODEL, propose-only). 409
 *  (conflict) until ≥7 days of scan history exist. */
export async function fetchProposal(): Promise<SchedulerProposal> {
  return request<SchedulerProposal>('/api/scheduler/proposal');
}

/** Apply the proposal's blocks to scheduler.blocks — the ONLY write path;
 *  never auto-applied. */
export async function applyProposal(blocks: SchedulerProposal['blocks']): Promise<OpsSettings> {
  return request<OpsSettings>('/api/scheduler/proposal/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await requestVoid(url, init);
  return (await response.json()) as T;
}

/** Same error mapping as request<T>, for endpoints with no response body (204). */
async function requestVoid(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError('Could not reach the scan server. Is it running?', 'network');
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // fall through to generic error
    }
    throw new ApiError(
      body?.error.message ?? `Request failed with status ${response.status}`,
      body?.error.code ?? 'internal',
    );
  }
  return response;
}

/* ————— Analytics Hub (Phase 16 Part B — everything here is SIMULATED) ————— */

export interface HubProfileInput {
  name: string;
  startingBankroll: number;
  stake: HubStake;
  strategies: OpportunityStrategy[];
  minEdgePct: number;
}

/** GET /api/hub → one HubProfileReport per profile (premades always present
 *  after the server's first seed). Zero credits — reads persisted purchases
 *  + the current record grading, never the provider. */
export async function fetchHubReports(): Promise<HubProfileReport[]> {
  const { reports } = await request<{ reports: HubProfileReport[] }>('/api/hub');
  return reports;
}

export async function createHubProfile(input: HubProfileInput): Promise<HubProfile> {
  return request<HubProfile>('/api/hub/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Premades are editable too — only delete is premade-restricted. */
export async function updateHubProfile(
  id: string,
  patch: Partial<HubProfileInput>,
): Promise<HubProfile> {
  return request<HubProfile>(`/api/hub/profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** 409s server-side for premade profiles — callers should hide/disable the
 *  delete action for those rather than relying on the error alone. */
export async function deleteHubProfile(id: string): Promise<void> {
  await requestVoid(`/api/hub/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchHubLeaderboards(): Promise<HubLeaderboards> {
  return request<HubLeaderboards>('/api/hub/leaderboards');
}

/* ————— Safety Score (Phase 17 — deterministic account-longevity filter) ————— */

/** Mirrors server/src/safety/rotation.ts's RotationBookStat — not in
 *  shared/types (rotation is a server-computed report, not a domain type),
 *  so the client shape is declared locally per the existing api.ts idiom
 *  (EvBoard, MiddlesBoard, RecomputeResponse, …). */
export interface SafetyRotationBookStat {
  bookmakerKey: string;
  samples: number;
  sides: Array<{ side: string; count: number }>;
  topSide: string;
  topShare: number;
  imbalanced: boolean;
  hint: string | null;
}

export interface SafetyRotationReport {
  windowDays: number;
  minSamples: number;
  imbalanceThreshold: number;
  books: SafetyRotationBookStat[];
}

export async function fetchSafetySettings(): Promise<SafetySettings> {
  return request<SafetySettings>('/api/safety/settings');
}

/** Deep-partial patch, mirroring routes/safety.ts's parseSafetyPatch. */
export interface SafetySettingsPatch {
  safeMode?: boolean;
  safetyThreshold?: number;
  maxSafeEdge?: number;
  roundTo?: number;
  neverLimitBooks?: string[];
  consensus?: Partial<SafetySettings['consensus']>;
  sharpAnchor?: Partial<SafetySettings['sharpAnchor']>;
  budgets?: Partial<SafetySettings['budgets']>;
  marketTiers?: Partial<SafetySettings['marketTiers']>;
}

export async function patchSafetySettings(patch: SafetySettingsPatch): Promise<SafetySettings> {
  return request<SafetySettings>('/api/safety/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Advisory book-rotation telemetry — never blocking, never a score input. */
export async function fetchSafetyRotation(): Promise<SafetyRotationReport> {
  return request<SafetyRotationReport>('/api/safety/rotation');
}

/** What the safety gate declined at CURRENT settings, priced hypothetically
 *  (simulated: true). Zero credits — reads persisted records only. */
export async function fetchSafetyCost(): Promise<SafetyCostReport> {
  return request<SafetyCostReport>('/api/safety/cost');
}
