import { patchSettings } from '../lib/api';
import { riskRows, toleranceText, type SettingsValues } from '../lib/settings';
import { Stepper } from './Stepper';

interface RiskBankrollPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.3 — live-value rows plus the tolerance stepper (MASTER PROMPT hard rule 2:
 *  the tolerance is user-set 0–100% HERE; step 1, clamped). */
export function RiskBankrollPanel({ s, refresh }: RiskBankrollPanelProps) {
  const rows = riskRows(s);
  const tol = async (next: number) => {
    await patchSettings({ tolerancePct: Math.max(0, Math.min(100, next)) });
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">RISK & BANKROLL</header>
      <div className="panel-body">
        {rows.slice(0, 3).map(([key, value]) => (
          <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
        ))}
        <div className="kv">
          <span className="kv-key">LINE MOVE TOLERANCE</span>
          <Stepper value={toleranceText(s)}
            onDec={() => { void tol(s.tolerancePct - 1); }}
            onInc={() => { void tol(s.tolerancePct + 1); }} />
        </div>
        {rows.slice(3).map(([key, value]) => (
          <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
        ))}
      </div>
    </section>
  );
}
