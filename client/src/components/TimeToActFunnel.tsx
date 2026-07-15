import { funnelRows, type FunnelCounts } from '../lib/analytics';

export function TimeToActFunnel({ funnel }: { funnel: FunnelCounts }) {
  return (
    <div className="funnel">
      <div className="funnel-title">TIME TO ACT — SENT → CONFIRMED</div>
      {funnelRows(funnel).map((r) => (
        <div className="funnel-row" key={r.label}>
          <span className="funnel-label">{r.label}</span>
          <span className="funnel-track">
            <span className={`funnel-fill${r.dead ? ' dead' : ''}`} style={{ width: `${r.pct ?? 0}%`, display: 'block' }} />
          </span>
          <span className="funnel-value">{r.value}</span>
        </div>
      ))}
      <div className="funnel-foot">
        % OF VERIFIED PICKS STILL ALIVE AT CONFIRMATION — THE REFERENDUM ON THE NOTIFICATION ARCHITECTURE
      </div>
    </div>
  );
}
