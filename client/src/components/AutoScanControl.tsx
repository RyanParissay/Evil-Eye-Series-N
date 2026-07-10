/**
 * The auto-update switch and its settings. Green is reserved app-wide for
 * exactly one meaning: surveillance is live. The switch turns green when on
 * and reveals the interval slider, a countdown to the next scan, and the
 * projected credit burn at the current cadence.
 *
 * All timing DECISIONS live in autoScan.ts; this component only renders and
 * ticks a 1-second clock for the countdown.
 */
import { useEffect, useState } from 'react';
import {
  MAX_INTERVAL_MINS,
  MIN_INTERVAL_MINS,
  clampIntervalMins,
  creditsPerHour,
  formatCountdown,
  msUntilNextScan,
  type AutoScanSettings,
} from '../autoScan';

interface AutoScanControlProps {
  settings: AutoScanSettings;
  onChange: (next: AutoScanSettings) => void;
  /** Epoch ms of the last completed scan attempt; null before any scan. */
  lastScanAt: number | null;
  scanning: boolean;
  /** Credits the last scan cost, for the burn projection; null before any scan. */
  creditsPerScan: number | null;
}

export function AutoScanControl({
  settings,
  onChange,
  lastScanAt,
  scanning,
  creditsPerScan,
}: AutoScanControlProps) {
  // 1 Hz clock, running only while auto mode is on, so the countdown moves.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!settings.enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [settings.enabled]);

  const remaining = msUntilNextScan(lastScanAt, settings.intervalMins, now);

  return (
    <div className="auto-block">
      <div className="auto-head">
        <span className="micro-label" id="auto-update-label">
          Auto update
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-labelledby="auto-update-label"
          className="switch"
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
        >
          <span className="switch-thumb" aria-hidden="true" />
        </button>
        {settings.enabled && (
          <span className="auto-live micro-label" role="status">
            <span className={`live-dot${scanning ? '' : ' live-dot-pulse'}`} aria-hidden="true" />
            {scanning ? 'Scanning' : `Next scan ${formatCountdown(remaining)}`}
          </span>
        )}
      </div>

      {settings.enabled && (
        <div className="slider-block auto-settings">
          <label
            className="micro-label"
            htmlFor="auto-interval"
            title="How often a scan runs while this page is open. Each scan costs the same credits as pressing Run scan; the ≈/hr figure projects that burn at this cadence."
          >
            Update every <span className="slider-value">{settings.intervalMins}</span> min
            {creditsPerScan != null && (
              <span className="auto-burn">
                {' '}
                · ≈{creditsPerHour(creditsPerScan, settings.intervalMins)} credits/hr
              </span>
            )}
          </label>
          <input
            id="auto-interval"
            type="range"
            min={MIN_INTERVAL_MINS}
            max={MAX_INTERVAL_MINS}
            step={1}
            value={settings.intervalMins}
            onChange={(e) =>
              onChange({ ...settings, intervalMins: clampIntervalMins(Number(e.currentTarget.value)) })
            }
          />
          <div className="slider-scale" aria-hidden="true">
            <span>{MIN_INTERVAL_MINS} min</span>
            <span>{MAX_INTERVAL_MINS} min</span>
          </div>
        </div>
      )}
    </div>
  );
}
