import { patchSettings } from '../lib/api';
import {
  cadenceText, forecastRows, quietHoursText, scanWindowText, staleText,
  verifyGapText, type ForecasterView, type SettingsValues,
} from '../lib/settings';
import { Stepper } from './Stepper';

interface ScanRulesPanelProps {
  s: SettingsValues;
  forecaster: ForecasterView;
  refresh: () => void;
}

export function ScanRulesPanel({ s, forecaster, refresh }: ScanRulesPanelProps) {
  const stale = async (next: number) => {
    await patchSettings({ staleRemoveMin: Math.max(1, next) }); // − floors at 1 (§5.2)
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">SCAN RULES · CREDIT FORECASTER</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">SCAN WINDOW</span><span className="kv-value">{scanWindowText(s)}</span></div>
        <div className="kv"><span className="kv-key">QUIET HOURS</span><span className="kv-value">{quietHoursText(s)}</span></div>
        <div className="kv"><span className="kv-key">CADENCE</span><span className="kv-value">{cadenceText(s)}</span></div>
        <div className="kv"><span className="kv-key">VERIFY GAP</span><span className="kv-value">{verifyGapText(s)}</span></div>
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
