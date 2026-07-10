import { Link } from 'react-router-dom';
import type { ArbOpportunity, BookmakerStatusValue } from '../../../shared/types';

/**
 * One guaranteed-profit opportunity: the event, the profit, and one row per
 * leg saying exactly where to put how much money at what odds. Legs whose
 * book the user marked limited/dead carry a warning — visible, never hidden,
 * but those opportunities don't alert and shouldn't be staked.
 */
export function OpportunityCard({
  arb,
  bookStatus,
}: {
  arb: ArbOpportunity;
  bookStatus?: Map<string, BookmakerStatusValue>;
}) {
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
          {arb.id && (
            <Link className="card-cockpit-link micro-label" to={`/opportunity/${arb.id}`}>
              Cockpit →
            </Link>
          )}
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
                {legWarning(bookStatus?.get(leg.bookmakerKey))}
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

function legWarning(status: BookmakerStatusValue | undefined) {
  if (!status || status === 'active') return null;
  return (
    <span
      className="chip chip-warn leg-book-warning"
      title={
        status === 'limited'
          ? 'You marked this book limited — the arb is shown but never alerted; stake with care.'
          : 'You marked this book dead — the arb is shown but never alerted; do not stake here.'
      }
    >
      ⚠ {status}
    </span>
  );
}

function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
