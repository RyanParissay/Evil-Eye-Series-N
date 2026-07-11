import { useState } from 'react';
import type { OpsSettings } from '../../../shared/types';
import { patchOpsSettings } from '../api';
import type { BudgetState, CadenceState } from '../cadence';
import { formatCountdown, msUntilNextScan } from '../autoScan';

/**
 * The Phase 8 mode line + window/budget settings. Display only — every
 * timing decision comes from cadence.ts, every timer lives in ScanPage.
 */
export function CadencePanel({
  settings,
  onSettings,
  cadence,
  budget,
  autoEnabled,
  lastScanAt,
  now,
}: {
  settings: OpsSettings;
  onSettings: (next: OpsSettings) => void;
  cadence: CadenceState;
  budget: BudgetState;
  autoEnabled: boolean;
  lastScanAt: number | null;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(patch: Partial<OpsSettings>) {
    setError(null);
    try {
      onSettings(await patchOpsSettings(patch));
    } catch {
      setError('Could not save cadence settings.');
    }
  }

  const mode = !autoEnabled
    ? 'AUTO-SCAN OFF'
    : budget.stopped
      ? `BUDGET STOP — auto-scan halted at ${settings.autoStopPct}% of ${settings.monthlyCreditBudget.toLocaleString()}`
      : cadence.cadenceMins == null
        ? `${cadence.label} — sleeping until the next window`
        : `${cadence.label} — next scan ${formatCountdown(msUntilNextScan(lastScanAt, cadence.cadenceMins, now))}`;

  return (
    <section className="cadence" aria-label="Scan cadence">
      <div className="cadence-row">
        <span
          className={`cadence-mode micro-label${budget.stopped ? ' is-stopped' : cadence.inWindow && autoEnabled ? ' is-live' : ''}`}
          role="status"
        >
          {mode}
        </span>
        {budget.warning && !budget.stopped && (
          <span className="chip chip-warn" title="Projected month-end burn exceeds the budget">
            ⚠ projected {budget.projectedMonthEnd?.toLocaleString()} / {settings.monthlyCreditBudget.toLocaleString()} credits
          </span>
        )}
        <button type="button" className="cadence-edit micro-label" onClick={() => setOpen(!open)}>
          {open ? 'close' : 'windows & budget'}
        </button>
      </div>

      {open && (
        <div className="cadence-settings">
          <WindowEditor
            label="weekday window"
            window={settings.weekday}
            onChange={(weekday) => void apply({ weekday })}
          />
          <WindowEditor
            label="weekend window"
            window={settings.weekend}
            onChange={(weekend) => void apply({ weekend })}
          />
          <label className="micro-label">
            in-window every (min)
            <input
              type="number"
              min={1}
              max={240}
              defaultValue={settings.inWindowMins}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 1 && v !== settings.inWindowMins) {
                  void apply({ inWindowMins: v });
                }
              }}
            />
          </label>
          <label className="micro-label">
            out-of-window
            <select
              value={settings.outWindowMins == null ? 'off' : String(settings.outWindowMins)}
              onChange={(e) =>
                void apply({ outWindowMins: e.target.value === 'off' ? null : Number(e.target.value) })
              }
            >
              <option value="off">off</option>
              <option value="30">every 30 min</option>
              <option value="60">every 60 min</option>
            </select>
          </label>
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
        </div>
      )}
      {error && <p className="micro-label cadence-error">{error}</p>}
    </section>
  );
}

function WindowEditor({
  label,
  window,
  onChange,
}: {
  label: string;
  window: { startMinutes: number; endMinutes: number };
  onChange: (next: { startMinutes: number; endMinutes: number }) => void;
}) {
  return (
    <label className="micro-label cadence-window">
      {label}
      <span>
        <input
          type="time"
          defaultValue={toHHMM(window.startMinutes)}
          onBlur={(e) => {
            const startMinutes = fromHHMM(e.target.value);
            if (startMinutes != null && startMinutes !== window.startMinutes) {
              onChange({ ...window, startMinutes });
            }
          }}
        />
        –
        <input
          type="time"
          defaultValue={toHHMM(window.endMinutes)}
          onBlur={(e) => {
            const endMinutes = fromHHMM(e.target.value);
            if (endMinutes != null && endMinutes !== window.endMinutes) {
              onChange({ ...window, endMinutes });
            }
          }}
        />
      </span>
    </label>
  );
}

function toHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromHHMM(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
