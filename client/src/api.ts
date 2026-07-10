/**
 * Thin typed client for the Express API. The API key never reaches this
 * side of the wire — the server proxies The Odds API.
 */
import type { RegionTabKey } from '../../shared/regionTabs';
import type {
  ApiErrorBody,
  ApiErrorCode,
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
  return (await response.json()) as T;
}
