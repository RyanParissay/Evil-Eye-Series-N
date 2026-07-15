import { TradeView, metricPct } from '../lib/api';
import { formatClock, formatMetric, formatOdds } from '../lib/format';
import { pendingCountdown } from '../lib/timers';

interface PendingCardProps {
  trade: TradeView;
  now: number;
}

export function PendingCard({ trade, now }: PendingCardProps) {
  const seconds = pendingCountdown(trade.verifyDueAt, now);
  return (
    <article className="trade-card pending">
      <div className="card-top">
        <span className="card-title pending">
          <span className="tag pending">{trade.category}</span>
          {trade.event} · {trade.sport.toUpperCase()}
        </span>
        <span className="card-status">
          <span className="status-text pending">
            CHECKING AGAIN IN <span className="status-value dim">{formatClock(seconds)}</span>
          </span>
        </span>
      </div>
      <div className="legs">
        {trade.legs.map((leg, i) => (
          <button key={i} className="leg-btn pending">
            {leg.bookLabel ?? leg.book} — {leg.selectionLabel ?? leg.selection} @ {formatOdds(leg.odds)}
            <span className="leg-arrow">↗</span>
          </button>
        ))}
      </div>
      <div className="action-row">
        <span className={trade.category === 'ARB' ? 'metric-box arb' : 'metric-box edge'}>
          {formatMetric(trade.category, metricPct(trade), { colon: true })}
        </span>
      </div>
    </article>
  );
}
