// client/src/lib/api.ts — client mirror of the Plan 1 API contract + fetch helpers.
// Fetch helpers NEVER throw: any network/HTTP failure → null (queries) or false (posts).
import { formatScanTime } from './format';

export type Strategy = 'ARB' | 'MIDDLE' | 'EV';
export type TradeStatus =
  | 'PENDING' | 'VERIFIED' | 'CONFIRMED' | 'UNCONFIRMED' | 'EXPIRED' | 'KILLED' | 'SETTLED';
export type KillReason =
  | 'ONE_SPORT_RULE' | 'HEAT_GATE' | 'SHARP_VELOCITY_CAP' | 'MARKET_BREADTH_CAP'
  | 'ROUNDING_DESTROYS_MARGIN' | 'QUOTE_STALE' | 'FAILED_VERIFICATION';

export interface Leg {
  book: string;
  selection: string;
  odds: number;
  stakeCents: number | null; // null until status ≥ VERIFIED
}

export interface TradeView {
  id: string;
  profileId: number;
  category: Strategy;
  event: string;
  sport: string;
  legs: Leg[];
  marginInitial: number;
  marginRecheck: number | null;
  marginFinal: number | null;
  status: TradeStatus;
  killReason: KillReason | null;
  resultCents: number | null;
  createdAt: number;      // all timestamps epoch ms
  verifyDueAt: number;
  verifiedAt: number | null;
  freshUntil: number | null;
  settledAt: number | null;
  eventStartsAt: number;
  marginPct: number | null; // display fields, 2dp numbers from the server
  edgePct: number | null;
}

export interface AppState {
  mode: 'SIMULATED';
  now: number;
  nextScanAt: number;
  quietHours: boolean;
  trades: { verified: TradeView[]; pending: TradeView[] };
  counts: { verifiedToday: number; killedToday: number };
}

/** ARB cards show marginPct; EV/MIDDLE show edgePct. Missing value → 0. */
export function metricPct(
  t: Pick<TradeView, 'category' | 'marginPct' | 'edgePct'>,
): number {
  return t.category === 'ARB' ? t.marginPct ?? 0 : t.edgePct ?? 0;
}

export interface StatusLineView {
  nextScanText: string;
  modeLabel: string;
}

/** Server down (state null) → "NEXT SCAN —" and a default SIMULATED badge. */
export function deriveStatusLine(state: AppState | null): StatusLineView {
  if (state === null) return { nextScanText: '—', modeLabel: 'SIMULATED' };
  return { nextScanText: formatScanTime(state.nextScanAt), modeLabel: state.mode };
}

export async function fetchState(): Promise<AppState | null> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return null;
    return (await res.json()) as AppState;
  } catch {
    return null;
  }
}

/** Accepts either a bare array or { trades: [...] } (envelope unspecified in Plan 1). */
export async function fetchTrades(view: 'all' | 'history'): Promise<TradeView[] | null> {
  try {
    const res = await fetch(`/api/trades?view=${view}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (Array.isArray(data)) return data as TradeView[];
    if (data !== null && typeof data === 'object') {
      const trades = (data as { trades?: unknown }).trades;
      if (Array.isArray(trades)) return trades as TradeView[];
    }
    return null;
  } catch {
    return null;
  }
}

async function postAction(path: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const confirmTrade = (id: string): Promise<boolean> =>
  postAction(`/api/trades/${id}/confirm`);
export const unconfirmTrade = (id: string): Promise<boolean> =>
  postAction(`/api/trades/${id}/unconfirm`);
export const reportLimited = (
  id: string, book: string, maxAllowedCents: number,
): Promise<boolean> =>
  postAction(`/api/trades/${id}/limited`, { book, maxAllowedCents });
export const requestScan = (): Promise<boolean> => postAction('/api/scan');
