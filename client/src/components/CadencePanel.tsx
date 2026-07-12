import { useEffect, useState } from 'react';
import type { OpsSettings, SchedulerBlock, SurvivalStats } from '../../../shared/types';
import { describePairCost } from '../creditWidget';
import {
  fetchCostEstimate,
  fetchSurvival,
  patchOpsSettings,
  patchScheduler,
  type CostEstimate,
} from '../api';

/**
 * Scheduler status + the settings the scheduler actually uses (Phase 16).
 * Display only — every scan/score-poll TIMING decision is now the server
 * scheduler's job (server/src/scheduler/), so this panel no longer computes
 * client-side cadence or runs any timer. The legacy weekday/weekend window
 * editors are gone (the scheduler ignores those fields); the block schedule
 * below is read-only in WP1 — WP3's optimizer becomes its editor.
 */
export function CadencePanel({
  settings,
  onSettings,
  regionTab,
  topN,
}: {
  settings: OpsSettings;
  onSettings: (next: OpsSettings) => void;
  regionTab: string;
  topN: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [survival, setSurvival] = useState<SurvivalStats | null>(null);

  // Pre-scan cost, from the live fetch plan + enabled markets — the number
  // that moves when a market toggle does. Never silent.
  useEffect(() => {
    fetchCostEstimate(regionTab, topN)
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [regionTab, topN, settings.markets.totals, settings.markets.spreads]);

  useEffect(() => {
    fetchSurvival()
      .then(setSurvival)
      .catch(() => setSurvival(null));
  }, []);

  async function apply(patch: Partial<OpsSettings>) {
    setError(null);
    try {
      onSettings(await patchOpsSettings(patch));
    } catch {
      setError('Could not save settings.');
    }
  }

  /** Partial scheduler patch (Phase 16) — the server deep-merges it. */
  async function applyScheduler(patch: Parameters<typeof patchScheduler>[0]) {
    setError(null);
    try {
      onSettings(await patchScheduler(patch));
    } catch {
      setError('Could not save settings.');
    }
  }

  const sched = settings.scheduler;
  const mode = sched.disabledReason
    ? 'SCHEDULER OFF — stopped itself'
    : sched.enabled
      ? 'SCHEDULER ON — server-scheduled scans'
      : 'SCHEDULER OFF';

  return (
    <section className="cadence" aria-label="Scheduler">
      <div className="cadence-row">
        <span
          className={`cadence-mode micro-label${sched.enabled && !sched.disabledReason ? ' is-live' : ''}`}
          role="status"
        >
          {mode}
        </span>
        {estimate && (
          <span className="micro-label" title="markets × region-equivalents × sports">
            ≈{estimate.creditsPerScan} credits/scan ({estimate.marketCount} market
            {estimate.marketCount === 1 ? '' : 's'} × {estimate.regionEquivalents} RE × {estimate.topN})
          </span>
        )}
        {estimate && (
          <span
            className="micro-label"
            title="a scan window = scan A + (hit rate × confirmation scan B)"
          >
            {describePairCost(estimate.confirmation)}
          </span>
        )}
        <button type="button" className="cadence-edit micro-label" onClick={() => setOpen(!open)}>
          {open ? 'close' : 'schedule & budget'}
        </button>
      </div>

      {open && (
        <div className="cadence-settings">
          <div className="cadence-blocks micro-label">
            <span>schedule · America/Vancouver</span>
            <ul>
              {[...sched.blocks]
                .sort((a, b) => a.startMin - b.startMin)
                .map((b, i) => (
                  <li key={i}>{formatBlock(b)}</li>
                ))}
            </ul>
            <span>01:00–08:00 quiet — no scans or re-verifies of any kind</span>
          </div>
          <label className="micro-label">
            monthly budget
            <input
              type="number"
              min={100}
              step={1000}
              defaultValue={settings.monthlyCreditBudget}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 100 && v !== settings.monthlyCreditBudget) {
                  void apply({ monthlyCreditBudget: v });
                }
              }}
            />
          </label>
          <label className="micro-label">
            auto-stop at %
            <input
              type="number"
              min={10}
              max={100}
              defaultValue={settings.autoStopPct}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 10 && v <= 100 && v !== settings.autoStopPct) {
                  void apply({ autoStopPct: v });
                }
              }}
            />
          </label>
          <label className="micro-label cadence-market">
            totals market
            <input
              type="checkbox"
              checked={settings.markets.totals}
              onChange={(e) => void apply({ markets: { ...settings.markets, totals: e.target.checked } })}
            />
          </label>
          <label className="micro-label cadence-market">
            spreads market
            <input
              type="checkbox"
              checked={settings.markets.spreads}
              onChange={(e) => void apply({ markets: { ...settings.markets, spreads: e.target.checked } })}
            />
          </label>
          <div className="cadence-second-sight">
            <label className="micro-label">
              confirmation interval (s)
              <input
                type="number"
                min={10}
                max={600}
                step={10}
                defaultValue={sched.confirmationIntervalSecs ?? 60}
                onBlur={(e) => {
                  const v = e.target.valueAsNumber;
                  if (
                    Number.isInteger(v) &&
                    v >= 10 &&
                    v <= 600 &&
                    v !== (sched.confirmationIntervalSecs ?? 60)
                  ) {
                    void applyScheduler({ confirmationIntervalSecs: v });
                  }
                }}
              />
            </label>
            <span className="micro-label">
              scan B re-confirms candidates this long after scan A (±0.5pp) — only confirmed
              opportunities alert; unconfirmed are never acted on
              {survival && survival.overall.samples > 0 && (
                <>
                  {' · '}
                  {survival.overall.rate == null
                    ? '—'
                    : `${Math.round(survival.overall.rate * 100)}%`}{' '}
                  survive one scan interval · {survival.overall.samples} samples
                </>
              )}
            </span>
          </div>
        </div>
      )}
      {error && <p className="micro-label cadence-error">{error}</p>}
    </section>
  );
}

function formatBlock(b: SchedulerBlock): string {
  return `${hhmm(b.startMin)}–${hhmm(b.endMin)} · every ${b.intervalMins}m`;
}

function hhmm(minutes: number): string {
  const m = minutes % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
