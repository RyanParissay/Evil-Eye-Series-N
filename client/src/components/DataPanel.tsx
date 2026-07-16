import { useState } from 'react';
import { setMode } from '../lib/api';
import { backupsText, missingText, modeSwitchLabel, type SettingsView } from '../lib/settings';

interface DataPanelProps {
  backups: SettingsView['backups'];
  mode: 'SIMULATED' | 'LIVE';
  refresh: () => void;
}

/** §5.6 + Plan 6 Design §10: two-click armed switch. The client never flips
 *  anything on its own — the server's env-name gate owns the decision. */
export function DataPanel({ backups, mode, refresh }: DataPanelProps) {
  const [armed, setArmed] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const click = async () => {
    if (!armed) {
      setArmed(true);
      setMissing([]);
      return;
    }
    const res = await setMode(mode === 'SIMULATED' ? 1 : 0);
    setArmed(false);
    if (!res.ok) setMissing(res.missing);
    refresh();
  };

  return (
    <section className="panel">
      <header className="panel-head">DATA</header>
      <div className="panel-body">
        <div className="kv">
          <span className="kv-key">MODE</span>
          <button
            className={`badge-sim${mode === 'LIVE' ? ' live' : ''}${armed ? ' armed' : ''}`}
            onClick={() => { void click(); }}
          >
            {modeSwitchLabel(mode, armed)}
          </button>
        </div>
        {missing.length > 0 && <div className="data-note">{missingText(missing)}</div>}
        <div className="kv"><span className="kv-key">BACKUPS</span><span className="kv-value">{backupsText(backups)}</span></div>
        <div className="btn-pair">
          <a className="btn-half" href="/api/export/trades.csv" download>EXPORT CSV</a>
          <a className="btn-half" href="/api/export/all.json" download>EXPORT JSON</a>
        </div>
        <div className="data-note">EXPORT, NEVER DELETE. TRADES AND EVENTS ARE KEPT FOREVER.</div>
      </div>
    </section>
  );
}
