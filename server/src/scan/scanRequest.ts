/**
 * Parsing/validation of the POST /api/scan request body.
 *
 * This is THE place to add a new scan option: extend ScanRequest, validate
 * the raw field here, then consume it in scanService.ts. Routes and the
 * service never re-validate — a ScanRequest is trusted downstream, and the
 * region tab arrives already resolved to its config (regions + allowlist).
 */
import {
  DEFAULT_REGION_TAB,
  regionTabByKey,
  type RegionTabConfig,
} from '@shared/regionTabs';
import { MAX_TOP_N } from '../config/constants';

/** A validated scan request. Everything downstream trusts these fields. */
export interface ScanRequest {
  /** Breadth/output slider value, integer 1..MAX_TOP_N. */
  topN: number;
  /** Resolved region tab: API regions to pay for + bookmaker allowlist. */
  tab: RegionTabConfig;
}

export type ParseScanRequestResult =
  | { ok: true; request: ScanRequest }
  | { ok: false; message: string };

export function parseScanRequest(body: unknown): ParseScanRequestResult {
  const raw = (body ?? {}) as Record<string, unknown>;

  const topN = Number(raw.topN);
  if (!Number.isInteger(topN) || topN < 1 || topN > MAX_TOP_N) {
    return { ok: false, message: `topN must be an integer from 1 to ${MAX_TOP_N}` };
  }

  const tabKey = raw.regionTab ?? DEFAULT_REGION_TAB;
  const tab = regionTabByKey(typeof tabKey === 'string' ? tabKey : undefined);
  if (!tab) {
    return { ok: false, message: `Unknown regionTab: ${String(raw.regionTab)}` };
  }

  return { ok: true, request: { topN, tab } };
}
