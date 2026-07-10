import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_SCAN,
  MAX_INTERVAL_MINS,
  MIN_INTERVAL_MINS,
  clampIntervalMins,
  creditsPerHour,
  formatCountdown,
  loadAutoScanSettings,
  msUntilNextScan,
  saveAutoScanSettings,
  shouldDisableAutoScan,
} from './autoScan';

/** Minimal Storage stand-in. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('defaults and persistence', () => {
  it('is off by default with a sane interval', () => {
    expect(DEFAULT_AUTO_SCAN.enabled).toBe(false);
    expect(DEFAULT_AUTO_SCAN.intervalMins).toBeGreaterThanOrEqual(MIN_INTERVAL_MINS);
    expect(DEFAULT_AUTO_SCAN.intervalMins).toBeLessThanOrEqual(MAX_INTERVAL_MINS);
  });

  it('round-trips settings through storage', () => {
    const storage = fakeStorage();
    saveAutoScanSettings(storage, { enabled: true, intervalMins: 25 });
    expect(loadAutoScanSettings(storage)).toEqual({ enabled: true, intervalMins: 25 });
  });

  it('falls back to defaults on missing or corrupt stored values', () => {
    expect(loadAutoScanSettings(fakeStorage())).toEqual(DEFAULT_AUTO_SCAN);
    for (const raw of ['not json', '42', '{"enabled":"yes"}', '{"intervalMins":{}}']) {
      const storage = fakeStorage({ 'evil-eye.auto-scan.v1': raw });
      expect(loadAutoScanSettings(storage)).toEqual(DEFAULT_AUTO_SCAN);
    }
  });

  it('clamps a stored out-of-range interval instead of rejecting it', () => {
    const storage = fakeStorage({
      'evil-eye.auto-scan.v1': JSON.stringify({ enabled: true, intervalMins: 999 }),
    });
    expect(loadAutoScanSettings(storage)).toEqual({ enabled: true, intervalMins: MAX_INTERVAL_MINS });
  });
});

describe('clampIntervalMins', () => {
  it('clamps to the slider range and rounds to whole minutes', () => {
    expect(clampIntervalMins(0)).toBe(MIN_INTERVAL_MINS);
    expect(clampIntervalMins(999)).toBe(MAX_INTERVAL_MINS);
    expect(clampIntervalMins(10.6)).toBe(11);
  });

  it('falls back to the default interval on non-finite input', () => {
    expect(clampIntervalMins(Number.NaN)).toBe(DEFAULT_AUTO_SCAN.intervalMins);
  });
});

describe('msUntilNextScan', () => {
  const NOW = 1_000_000_000;

  it('is due immediately when nothing has ever been scanned', () => {
    expect(msUntilNextScan(null, 10, NOW)).toBe(0);
  });

  it('is due immediately when the last scan is older than the interval', () => {
    expect(msUntilNextScan(NOW - 11 * 60_000, 10, NOW)).toBe(0);
  });

  it('counts down from the last completed scan', () => {
    expect(msUntilNextScan(NOW - 4 * 60_000, 10, NOW)).toBe(6 * 60_000);
  });
});

describe('shouldDisableAutoScan', () => {
  it('turns auto mode off for errors that retries cannot fix', () => {
    expect(shouldDisableAutoScan('invalid_api_key')).toBe(true);
    expect(shouldDisableAutoScan('quota_exhausted')).toBe(true);
  });

  it('keeps auto mode on for transient errors', () => {
    expect(shouldDisableAutoScan('network')).toBe(false);
    expect(shouldDisableAutoScan('provider_error')).toBe(false);
    expect(shouldDisableAutoScan('internal')).toBe(false);
  });
});

describe('display helpers', () => {
  it('projects hourly credit burn from the last scan cost', () => {
    expect(creditsPerHour(12, 10)).toBe(72); // 12 credits × 6 scans/hr
    expect(creditsPerHour(2, 60)).toBe(2);
  });

  it('formats a countdown as m:ss', () => {
    expect(formatCountdown(6 * 60_000)).toBe('6:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-500)).toBe('0:00');
  });
});
