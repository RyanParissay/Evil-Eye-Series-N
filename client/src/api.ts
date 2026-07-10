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
  LedgerSummary,
  OpportunityRecord,
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
