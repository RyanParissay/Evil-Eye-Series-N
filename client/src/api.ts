/**
 * Thin typed client for the Express API. The API key never reaches this
 * side of the wire — the server proxies The Odds API.
 */
import type { RegionTabKey } from '../../shared/regionTabs';
import type {
  ApiErrorBody,
  ApiErrorCode,
  ArbOpportunity,
  BookPreset,
  BookmakerConfig,
  BookmakerStatusValue,
  CoverageReport,
  EvSettings,
  FundPosition,
  FundSettings,
  LedgerSummary,
  MiddlesSettings,
  OpportunityRecord,
  OpsSettings,
  PaperSettings,
  PaperView,
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

export interface CostEstimate {
  regionTab: string;
  topN: number;
  marketCount: number;
  regionEquivalents: number;
  creditsPerSport: number;
  creditsPerScan: number;
}

export async function fetchCostEstimate(regionTab: string, topN: number): Promise<CostEstimate> {
  return request<CostEstimate>(
    `/api/ops/cost-estimate?regionTab=${encodeURIComponent(regionTab)}&topN=${topN}`,
  );
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
