import type { ArbOpportunity } from '../../../shared/types';

/**
 * One guaranteed-profit opportunity: the event, the profit, and one row per
 * leg saying exactly where to put how much money at what odds.
 */
export function OpportunityCard({ arb }: { arb: ArbOpportunity }) {
  return (
    <article className="card">
      <header className="card-head">
        <div className="card-title">
          <span className="micro-label">
            {arb.sportTitle} · {formatKickoff(arb.commenceTime)}
          </span>
          <h2>{arb.eventName}</h2>
          <div className="card-flags">
            {arb.sameBookmaker && (
              <span
                className="chip chip-warn"
                title="Every best price comes from one bookmaker — often a listing quirk, not an executable arb."
              >
                ⚠ Same book
              </span>
            )}
            {arb.suspicious && (
              <span
                className="chip chip-warn"
                title="Profit this high usually means stale or errored odds. Verify before acting."
              >
                ⚠ Too good — verify
              </span>
            )}
          </div>
        </div>
        <div className="card-profit">
          <span className="profit-pct">+{arb.profitPct.toFixed(2)}%</span>
          <span className="micro-label">index {arb.arbIndex.toFixed(4)}</span>
        </div>
      </header>

      <table className="legs">
        <thead className="visually-hidden">
          <tr>
            <th>Outcome</th>
            <th>Bookmaker</th>
            <th>Odds</th>
            <th>Stake per $100</th>
          </tr>
        </thead>
        <tbody>
          {arb.legs.map((leg) => (
            <tr key={leg.outcome}>
              <td className="leg-outcome">{leg.outcome}</td>
              <td className="leg-book">
                {leg.link ? (
                  <a href={leg.link} target="_blank" rel="noopener noreferrer">
                    {leg.bookmakerTitle} ↗
                  </a>
                ) : (
                  leg.bookmakerTitle
                )}
              </td>
              <td className="leg-odds">{leg.odds.toFixed(2)}</td>
              <td className="leg-stake">${leg.stake.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
