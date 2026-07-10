import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorCode, LedgerSummary } from '../../../shared/types';
import { ApiError, fetchLedgerSummary } from '../api';
import { EquityChart } from '../components/EquityChart';
import { EyeGlyph } from '../components/EyeGlyph';
import { PaperPanel } from '../components/PaperPanel';
import { errorHint, errorTitle } from '../errorCopy';

/**
 * The proof layer: is this making money, where, and how fast do edges
 * decay. Every number on this page is computed server-side.
 */
export function LedgerPage() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLedgerSummary()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        if (cancelled) return;
        const isApi = err instanceof ApiError;
        setError({
          code: isApi ? err.code : 'internal',
          message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state="open" />
        <h1 className="wordmark">
          The <span className="wordmark-accent">Ledger</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> · realized P&L · edge decay ·{' '}
          <a className="adv-back" href="/api/ledger/export.csv" download>
            CSV ↓
          </a>
        </p>
      </header>

      {error && (
        <div className="state-block state-error" role="alert">
          <p className="state-title">{errorTitle(error.code)}</p>
          <p className="state-detail">{error.message}</p>
          <p className="state-detail">{errorHint(error.code)}</p>
        </div>
      )}

      {!error && !summary && (
        <div className="state-block" role="status">
          <p className="state-title">Tallying the books…</p>
        </div>
      )}

      {summary && (
        <main className="ledger">
          <section className="ledger-heads">
            <div className="ledger-stat">
              <span className="micro-label">realized profit</span>
              <strong className={summary.realized.totalLockedProfit >= 0 ? 'is-up' : 'is-down'}>
                {money(summary.realized.totalLockedProfit)}
              </strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">completions</span>
              <strong>{summary.realized.completions}</strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">capture rate</span>
              <strong>
                {summary.captureRate.rate == null
                  ? '—'
                  : `${(summary.captureRate.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="micro-label">
                {summary.captureRate.completed} of {summary.captureRate.alerted} alerted
              </span>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">avg edge decay</span>
              <strong>
                {summary.decay.overall.avgDropPp == null
                  ? '—'
                  : `${summary.decay.overall.avgDropPp.toFixed(2)}pp`}
              </strong>
              <span className="micro-label">{summary.decay.overall.samples} samples</span>
            </div>
          </section>

          {summary.realized.unpricedCompletions > 0 && (
            <p className="ledger-note micro-label">
              {summary.realized.unpricedCompletions} completion
              {summary.realized.unpricedCompletions === 1 ? '' : 's'} recorded without filled
              numbers — counted for capture rate, excluded from every dollar figure.
            </p>
          )}

          <section>
            <h2 className="ledger-section micro-label">Equity — cumulative realized profit</h2>
            <EquityChart points={summary.equity} />
          </section>

          <PaperPanel realMonthly={summary.monthly} />

          <div className="ledger-tables">
            <section>
              <h2 className="ledger-section micro-label">By month</h2>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Profit</th>
                    <th>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.monthly.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td className="num">{money(m.lockedProfit)}</td>
                      <td className="num">{m.completions}</td>
                    </tr>
                  ))}
                  {summary.monthly.length === 0 && emptyRow(3)}
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="ledger-section micro-label">By sport</h2>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Sport</th>
                    <th>Profit</th>
                    <th>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bySport.map((s) => (
                    <tr key={s.sportKey}>
                      <td>{s.title}</td>
                      <td className="num">{money(s.lockedProfit)}</td>
                      <td className="num">{s.completions}</td>
                    </tr>
                  ))}
                  {summary.bySport.length === 0 && emptyRow(3)}
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="ledger-section micro-label">By book — stake-weighted</h2>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Staked</th>
                    <th>Profit share</th>
                    <th>Legs</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byBook.map((b) => (
                    <tr key={b.bookmakerKey}>
                      <td>{b.title}</td>
                      <td className="num">${b.staked.toFixed(2)}</td>
                      <td className="num">{money(b.lockedProfitShare)}</td>
                      <td className="num">{b.legs}</td>
                    </tr>
                  ))}
                  {summary.byBook.length === 0 && emptyRow(4)}
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="ledger-section micro-label">Edge decay by book</h2>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Avg drop</th>
                    <th>Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.decay.byBook.map((b) => (
                    <tr key={b.bookmakerKey}>
                      <td>{b.title}</td>
                      <td className="num">
                        {b.avgDropPp == null ? '—' : `${b.avgDropPp.toFixed(2)}pp`}
                      </td>
                      <td className="num">{b.samples}</td>
                    </tr>
                  ))}
                  {summary.decay.byBook.length === 0 && emptyRow(3)}
                </tbody>
              </table>
            </section>
          </div>
        </main>
      )}

      <footer className="footnote micro-label">
        Realized figures come only from completions you priced by hand — nothing here is estimated.
      </footer>
    </div>
  );
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function emptyRow(span: number) {
  return (
    <tr>
      <td colSpan={span} className="ledger-empty micro-label">
        nothing yet
      </td>
    </tr>
  );
}
