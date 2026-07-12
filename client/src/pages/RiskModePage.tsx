import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorCode } from '../../../shared/types';
import { ApiError, fetchEvBoard, patchEvSettings, type EvBoard } from '../api';
import { EyeGlyph } from '../components/EyeGlyph';
import { MiddlesBoard } from '../components/MiddlesBoard';
import { SafetyBadge } from '../components/SafetyBadge';
import { errorHint, errorTitle } from '../errorCopy';
import { useSafetySettings } from '../useSafetySettings';

/**
 * RISK MODE — the best upcoming EV bets. Yellow means exactly one thing
 * in this app: expected value, NOT guaranteed. Individual bets lose by
 * design; the edge is statistical. Zero credits: the board reads what
 * scans already persisted.
 */
export function RiskModePage() {
  const [segment, setSegment] = useState<'edges' | 'middles'>('edges');
  const [board, setBoard] = useState<EvBoard | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const safetySettings = useSafetySettings();

  async function load() {
    try {
      setBoard(await fetchEvBoard());
      setError(null);
    } catch (err) {
      const isApi = err instanceof ApiError;
      setError({
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applySetting(patch: Parameters<typeof patchEvSettings>[0]) {
    if (busy) return;
    setBusy(true);
    try {
      await patchEvSettings(patch);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page risk">
      <header className="masthead">
        <EyeGlyph size={52} state="open" />
        <h1 className="wordmark">
          Risk <span className="risk-accent">Mode</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> · expected value — individual bets
          can and do lose · <span className="risk-badge">not guaranteed</span>
        </p>
      </header>

      <div className="risk-segments" role="tablist" aria-label="Risk Mode boards">
        {(['edges', 'middles'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={segment === key}
            className={`risk-segment${segment === key ? ' is-active' : ''}`}
            onClick={() => setSegment(key)}
          >
            {key === 'edges' ? 'EDGES' : 'MIDDLES'}
          </button>
        ))}
      </div>

      {segment === 'middles' && <MiddlesBoard safetySettings={safetySettings} />}

      {segment === 'edges' && board && (
        <section className="risk-controls micro-label">
          <label>
            show edge ≥ %
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              defaultValue={board.settings.showMinEdgePct}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v >= 0 && v !== board.settings.showMinEdgePct) {
                  void applySetting({ showMinEdgePct: v });
                }
              }}
            />
          </label>
          <label>
            alert edge ≥ %
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              defaultValue={board.settings.alertMinEdgePct}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v >= 0 && v !== board.settings.alertMinEdgePct) {
                  void applySetting({ alertMinEdgePct: v });
                }
              }}
            />
          </label>
          <label>
            max odds
            <input
              type="number"
              min={1.1}
              max={100}
              step={0.5}
              defaultValue={board.settings.maxOdds}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v > 1 && v !== board.settings.maxOdds) {
                  void applySetting({ maxOdds: v });
                }
              }}
            />
          </label>
          <label>
            benchmark ≤ min old
            <input
              type="number"
              min={1}
              max={240}
              defaultValue={board.settings.maxBenchmarkAgeMins}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 1 && v !== board.settings.maxBenchmarkAgeMins) {
                  void applySetting({ maxBenchmarkAgeMins: v });
                }
              }}
            />
          </label>
          <span className="risk-note">
            stakes shown flat at ${board.defaultStake.toFixed(0)} (fund default) — Kelly sizing
            lands in the RISK models phase
          </span>
        </section>
      )}

      <main className="results">
        {segment === 'edges' && error && (
          <div className="state-block state-error" role="alert">
            <p className="state-title">{errorTitle(error.code)}</p>
            <p className="state-detail">{error.message}</p>
            <p className="state-detail">{errorHint(error.code)}</p>
          </div>
        )}

        {segment === 'edges' && !error && board && board.bets.length === 0 && (
          <div className="state-block">
            <EyeGlyph size={64} state="closed" />
            <p className="state-title">No live edges.</p>
            <p className="state-detail">
              EV bets appear when a scan finds a soft-book price beating the de-vigged Pinnacle
              fair line. Run a scan — and check the Ledger's benchmark-reach audit: sports the
              benchmark doesn't cover can never produce an edge.
            </p>
          </div>
        )}

        {segment === 'edges' && !error && board && board.bets.length > 0 && (
          <>
            <div className="results-head micro-label">
              {board.bets.length} live edge{board.bets.length === 1 ? '' : 's'} · sorted by edge ·
              expected value only
            </div>
            <div className="risk-table-wrap">
              <table className="ledger-table risk-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Bet</th>
                    <th>Book</th>
                    <th>Offered</th>
                    <th>Fair</th>
                    <th>Edge</th>
                    <th>Win prob</th>
                    <th>Stake</th>
                    <th>Expected</th>
                    <th>Bench age</th>
                    <th>Safety</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {board.bets.map((bet) => {
                    const ev = bet.ev!;
                    const leg = bet.legs[0];
                    const expected = (board.defaultStake * ev.edgePct) / 100;
                    return (
                      <tr key={bet.id}>
                        <td>
                          <span className="micro-label">{bet.sportTitle}</span>
                          <br />
                          {bet.eventName}
                        </td>
                        <td>
                          {leg.outcome}
                          {leg.point != null && ` ${leg.point > 0 ? `+${leg.point}` : leg.point}`}
                          <span className="micro-label"> · {bet.marketKey}</span>
                        </td>
                        <td>{leg.bookmakerTitle}</td>
                        <td className="num">{leg.odds.toFixed(2)}</td>
                        <td className="num">{(1 / ev.fairProbability).toFixed(2)}</td>
                        <td className="num risk-edge">+{ev.edgePct.toFixed(1)}%</td>
                        <td className="num">{Math.round(ev.fairProbability * 100)}%</td>
                        <td className="num">${board.defaultStake.toFixed(0)}</td>
                        <td className="num">+${expected.toFixed(2)}</td>
                        <td className="num">{benchAge(ev.benchmarkLastUpdate)}</td>
                        <td>
                          <SafetyBadge safety={bet.safety} settings={safetySettings} compact />
                        </td>
                        <td>
                          <Link className="card-cockpit-link micro-label" to={`/opportunity/${bet.id}`}>
                            Cockpit →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      <footer className="footnote micro-label">
        Expected value is a model, not a promise — roughly half of individual EV bets lose.
        Grade every settled bet or the ledger stays honestly at $0.
      </footer>
    </div>
  );
}

function benchAge(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return mins < 1 ? 'now' : `${mins}m`;
}
