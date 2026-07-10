/**
 * Auto-update mode: the pure logic behind the green switch.
 *
 * Design decisions this module encodes:
 *  - Auto mode is CLIENT-driven. The server never scans on its own — credits
 *    only burn while someone actually has the page open. (See CLAUDE.md.)
 *  - Off by default; the setting persists in localStorage so flipping it on
 *    survives refreshes and restarts ("it stays on").
 *  - The next scan is scheduled from the LAST COMPLETED scan (manual scans
 *    reset the countdown), so "update every X min" means "data is never
 *    staler than X minutes", not "fire a timer X min after page load".
 *  - Errors that a retry cannot fix (bad key, spent quota) switch auto mode
 *    OFF instead of hammering the API every X minutes. Transient errors
 *    (network blips) leave it on — the next tick simply retries.
 *
 * React-free and DOM-free so it unit-tests without a browser; the Storage
 * parameter is structural (pass window.localStorage in the app).
 */
import type { ApiErrorCode } from '../../shared/types';

export interface AutoScanSettings {
  enabled: boolean;
  /** Minutes between automatic scans, MIN..MAX, whole minutes. */
  intervalMins: number;
}

export const AUTO_SCAN_STORAGE_KEY = 'evil-eye.auto-scan.v1';
export const MIN_INTERVAL_MINS = 1;
export const MAX_INTERVAL_MINS = 60;

export const DEFAULT_AUTO_SCAN: AutoScanSettings = {
  enabled: false, // off by default — scanning costs credits
  intervalMins: 10,
};

/** Clamp to the slider's range; whole minutes; default on garbage. */
export function clampIntervalMins(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUTO_SCAN.intervalMins;
  return Math.min(Math.max(Math.round(value), MIN_INTERVAL_MINS), MAX_INTERVAL_MINS);
}

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

/** Load persisted settings; anything missing/corrupt yields the defaults. */
export function loadAutoScanSettings(storage: StorageReader): AutoScanSettings {
  try {
    const raw = storage.getItem(AUTO_SCAN_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_SCAN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AUTO_SCAN;
    const { enabled, intervalMins } = parsed as Record<string, unknown>;
    if (typeof enabled !== 'boolean' || typeof intervalMins !== 'number') {
      return DEFAULT_AUTO_SCAN;
    }
    return { enabled, intervalMins: clampIntervalMins(intervalMins) };
  } catch {
    return DEFAULT_AUTO_SCAN;
  }
}

export function saveAutoScanSettings(storage: StorageWriter, settings: AutoScanSettings): void {
  try {
    storage.setItem(AUTO_SCAN_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/blocked: auto mode still works for this session.
  }
}

/**
 * Milliseconds until the next automatic scan is due. 0 means "scan now" —
 * either nothing has been scanned yet or the data is older than the interval.
 */
export function msUntilNextScan(
  lastScanAt: number | null,
  intervalMins: number,
  now: number,
): number {
  if (lastScanAt == null) return 0;
  return Math.max(0, lastScanAt + intervalMins * 60_000 - now);
}

/**
 * Should this scan failure switch auto mode off? True for failures a retry
 * cannot fix — retrying into a bad key or a spent quota every X minutes
 * would only spam the API and the error UI.
 */
export function shouldDisableAutoScan(code: ApiErrorCode): boolean {
  return code === 'invalid_api_key' || code === 'quota_exhausted';
}

/** Projected credit burn if every scan costs like the last one did. */
export function creditsPerHour(creditsPerScan: number, intervalMins: number): number {
  return Math.round(creditsPerScan * (60 / intervalMins));
}

/** 390000 → "6:30". Floors at 0:00. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
