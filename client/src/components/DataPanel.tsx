import { backupsText, type SettingsView } from '../lib/settings';

interface DataPanelProps {
  backups: SettingsView['backups'];
  mode: 'SIMULATED';
}

/** §5.6 — the MODE badge stays non-interactive: the SIM/LIVE switch (with its
 *  confirm dialog) ships in Plan 6 and is never flipped by this plan. */
export function DataPanel({ backups, mode }: DataPanelProps) {
  return (
    <section className="panel">
      <header className="panel-head">DATA</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">MODE</span><span className="badge-sim">{mode}</span></div>
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
