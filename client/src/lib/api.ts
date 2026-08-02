// client/src/lib/api.ts — client mirror of the Plan 1 API contract + fetch helpers.
// Fetch helpers NEVER throw: any network/HTTP failure → null (queries) or false (posts).
import { formatScanTime } from './format';
import type { BrainView } from './brain';
import type { AnalyticsView, ProfileView, RangeKey } from './analytics';
import type { SettingsView } from './settings';

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
  bookLabel?: string;        // human display name — raw book slug still POSTed (limited flow)
  selectionLabel?: string;   // human display name for selection
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

/** §2.2: feed health for the live odds provider. null in the payload means SIM
 *  (the sim provider never fetches, by construction — no error state possible).
 *  lastFetchOk null (within a non-null FeedHealth) means no fetch attempted yet —
 *  honestly distinct from a failed fetch (false). */
export interface FeedHealth {
  lastFetchAt: number | null;
  lastFetchOk: boolean | null;
  lastFetchError: string | null;
  lastSuccessfulFetchAt: number | null;
}

export interface AppState {
  mode: 'SIMULATED' | 'LIVE';
  now: number;
  nextScanAt: number;
  quietHours: boolean;
  trades: { verified: TradeView[]; pending: TradeView[] };
  counts: { verifiedToday: number; killedToday: number };
  feedHealth: FeedHealth | null;
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

export interface FeedHealthView {
  tone: 'sim' | 'muted' | 'green' | 'red';
  text: string;
  detail: string;
}

function secondsAgoText(at: number, now: number): string {
  return `${Math.max(0, Math.round((now - at) / 1000))}S AGO`;
}

/** TRADES-screen feed-health chip (§2.2). SIM (or server down, mirroring
 *  deriveStatusLine's default) never shows an error — the sim provider never
 *  fetches, by construction. In LIVE: no fetch attempted yet is neutral, NOT
 *  an error; OK shows time since the last successful fetch; a failure shows
 *  an honest last-known-good time (never fabricated) instead of the error text. */
export function deriveFeedHealth(state: AppState | null, now: number): FeedHealthView {
  if (state === null || state.mode !== 'LIVE') return { tone: 'sim', text: 'FEED · SIM', detail: '' };
  const h = state.feedHealth;
  if (h === null || h.lastFetchOk === null) {
    return { tone: 'muted', text: 'FEED · AWAITING FIRST FETCH', detail: '' };
  }
  if (h.lastFetchOk) {
    return { tone: 'green', text: 'FEED OK', detail: secondsAgoText(h.lastSuccessfulFetchAt ?? now, now) };
  }
  return {
    tone: 'red',
    text: 'FEED ERROR',
    detail: h.lastSuccessfulFetchAt === null ? 'NO SUCCESSFUL FETCH YET' : `LAST OK ${secondsAgoText(h.lastSuccessfulFetchAt, now)}`,
  };
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

// ---- brain (Plan 3) ----------------------------------------------------------

export async function fetchBrain(): Promise<BrainView | null> {
  try {
    const res = await fetch('/api/brain');
    if (!res.ok) return null;
    return (await res.json()) as BrainView;
  } catch {
    return null;
  }
}

export const postBrainPass = (): Promise<boolean> => postAction('/api/brain/pass');
export const setBrainAnchor = (idx: number): Promise<boolean> =>
  postAction('/api/brain/anchor', { idx });

// ---- analytics (Plan 4) ----------------------------------------------------------

export async function fetchProfiles(): Promise<ProfileView[] | null> {
  try {
    const res = await fetch('/api/profiles');
    if (!res.ok) return null;
    const data = (await res.json()) as { profiles?: ProfileView[] };
    return Array.isArray(data.profiles) ? data.profiles : null;
  } catch {
    return null;
  }
}

// ---- settings (Plan 5) ----------------------------------------------------------

export async function fetchSettingsView(): Promise<SettingsView | null> {
  try {
    const res = await fetch('/api/settings/view');
    if (!res.ok) return null;
    return (await res.json()) as SettingsView;
  } catch {
    return null;
  }
}

export async function createProfile(name: string, startingCashCents: number): Promise<ProfileView | null> {
  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, startingCashCents }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { profile: ProfileView }).profile;
  } catch {
    return null;
  }
}

export async function fetchAnalytics(profileId: number, range: RangeKey): Promise<AnalyticsView | null> {
  try {
    const res = await fetch(`/api/analytics?profileId=${profileId}&range=${range}`);
    if (!res.ok) return null;
    return (await res.json()) as AnalyticsView;
  } catch {
    return null;
  }
}
export async function patchSettings(patch: Record<string, number | string>): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function patchBook(name: string, body: { enabled?: 0 | 1; sport?: string }): Promise<boolean> {
  try {
    const res = await fetch(`/api/books/${name}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const sendWaTest = (): Promise<boolean> => postAction('/api/whatsapp/test');
// ---- demo data (feat-demo-seed) ----------------------------------------------

export const seedDemo = (): Promise<boolean> => postAction('/api/demo/seed');

// ---- mode (Plan 6) ---------------------------------------------------------------
export async function setMode(live: 0 | 1): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ live }),
    });
    if (res.ok) return { ok: true, missing: [] };
    const body = (await res.json()) as { error?: { message?: string } };
    const m = /missing: (.+)$/.exec(body.error?.message ?? '');
    return { ok: false, missing: m ? m[1]!.split(', ') : [] };
  } catch {
    return { ok: false, missing: [] };
  }
}
