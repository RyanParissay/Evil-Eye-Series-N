import { patchSettings } from '../lib/api';
import {
  clampStepper, forecastRows, hotMaxText, hotMinText, hotWindowText,
  quietEndText, quietStartText, scanBaseText, scanWindowText,
  staleText, verifyGapText, type ForecasterView, type SettingsValues,
} from '../lib/settings';
import { Stepper } from './Stepper';

interface ScanRulesPanelProps {
  s: SettingsValues;
  forecaster: ForecasterView;
  refresh: () => void;
}

/** §2.3 — one PATCH per knob; the displayed value always comes from `s` (the last
 *  server-confirmed state), never local state, so a rejected PATCH just leaves the
 *  row showing its last known-good value once `refresh()` re-polls. */
export function ScanRulesPanel({ s, forecaster, refresh }: ScanRulesPanelProps) {
  const step = async (key: string, next: number) => {
    await patchSettings({ [key]: next });
    refresh();
  };
  const stale = async (next: number) => {
    await patchSettings({ staleRemoveMin: clampStepper(next, 1) }); // − floors at 1 (§5.2)
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">SCAN RULES · CREDIT FORECASTER</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">SCAN WINDOW</span><span className="kv-value">{scanWindowText(s)}</span></div>
        <div className="kv">
          <span className="kv-key">QUIET HOURS</span>
          <span className="kv-pair">
            <Stepper value={quietStartText(s)}
              onDec={() => { void step('quietStartHour', clampStepper(s.quietStartHour - 1, 0, 23)); }}
              onInc={() => { void step('quietStartHour', clampStepper(s.quietStartHour + 1, 0, 23)); }} />
            <span className="kv-pair-sep">–</span>
            <Stepper value={quietEndText(s)}
              onDec={() => { void step('quietEndHour', clampStepper(s.quietEndHour - 1, 0, 23)); }}
              onInc={() => { void step('quietEndHour', clampStepper(s.quietEndHour + 1, 0, 23)); }} />
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">SCAN BASE</span>
          <Stepper value={scanBaseText(s)}
            onDec={() => { void step('scanBaseMin', clampStepper(s.scanBaseMin - 1, 1)); }}
            onInc={() => { void step('scanBaseMin', clampStepper(s.scanBaseMin + 1, 1)); }} />
        </div>
        <div className="kv">
          <span className="kv-key">HOT CADENCE</span>
          <span className="kv-pair">
            <Stepper value={hotMinText(s)}
              onDec={() => { void step('scanHotMinMin', clampStepper(s.scanHotMinMin - 1, 1)); }}
              onInc={() => { void step('scanHotMinMin', clampStepper(s.scanHotMinMin + 1, 1)); }} />
            <span className="kv-pair-sep">–</span>
            <Stepper value={hotMaxText(s)}
              onDec={() => { void step('scanHotMaxMin', clampStepper(s.scanHotMaxMin - 1, 1)); }}
              onInc={() => { void step('scanHotMaxMin', clampStepper(s.scanHotMaxMin + 1, 1)); }} />
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">HOT WINDOW</span>
          <Stepper value={hotWindowText(s)}
            onDec={() => { void step('hotWindowHours', clampStepper(s.hotWindowHours - 1, 1)); }}
            onInc={() => { void step('hotWindowHours', clampStepper(s.hotWindowHours + 1, 1)); }} />
        </div>
        <div className="kv">
          <span className="kv-key">VERIFY GAP</span>
          <Stepper value={verifyGapText(s)}
            onDec={() => { void step('verifyGapSecs', clampStepper(s.verifyGapSecs - 5, 5)); }}
            onInc={() => { void step('verifyGapSecs', clampStepper(s.verifyGapSecs + 5, 5)); }} />
        </div>
        {forecastRows(forecaster).map(([key, value, tone]) => (
          <div className="kv" key={key}>
            <span className="kv-key">{key}</span>
            <span className={`kv-value${tone === 'plain' ? '' : ` ${tone}`}`}>{value}</span>
          </div>
        ))}
        <div className="kv">
          <span className="kv-key">REMOVE STALE TRADES AFTER</span>
          <Stepper value={staleText(s)}
            onDec={() => { void stale(s.staleRemoveMin - 1); }}
            onInc={() => { void stale(s.staleRemoveMin + 1); }} />
        </div>
      </div>
    </section>
  );
}
