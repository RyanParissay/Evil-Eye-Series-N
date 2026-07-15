import { TradeView, metricPct, requestScan } from '../lib/api';
import { formatCents, formatClock, formatMetric, formatOdds } from '../lib/format';
import { liveTimer } from '../lib/timers';
import { ConfirmButton } from './ConfirmButton';
import { LimitedPanel } from './LimitedPanel';

interface LiveCardProps {
  trade: TradeView;
  now: number;
  refresh: () => void;
  limitedOpen: boolean;
  onToggleLimited: () => void;
}

export function LiveCard({ trade, now, refresh, limitedOpen, onToggleLimited }: LiveCardProps) {
  const timer = liveTimer(trade.freshUntil ?? now, now);
  const stale = timer.phase === 'STALE';
  return (
    <article className="trade-card">
      <div className="card-top">
        <span className="card-title">
          <span className="tag">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text">
            {timer.phase}{' '}
            <span className={stale ? 'status-value stale' : 'status-value'}>
              {formatClock(timer.seconds)}
            </span>
          </span>
          {stale && (
            <button
              className="refresh-chip"
              onClick={() => void requestScan().then(() => refresh())}
            >
              REFRESH?
            </button>
          )}
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn">
            {leg.book} — {leg.selection} @ {formatOdds(leg.odds)}
            {leg.stakeCents !== null && (
              <span className="leg-stake">BET {formatCents(leg.stakeCents)} ↗</span>
            )}
          </button>
        ))}
      </div>
      <div className="action-row">
        <ConfirmButton trade={trade} refresh={refresh} />
        <button
          className={limitedOpen ? 'limited-btn open' : 'limited-btn'}
          onClick={onToggleLimited}
        >
          TRADE LIMITED?
        </button>
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
      {limitedOpen && <LimitedPanel trade={trade} onClose={onToggleLimited} refresh={refresh} />}
    </article>
  );
}
