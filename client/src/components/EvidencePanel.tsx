import { useEffect, useState } from 'react';
import type { CoverageReport, Scoreboard, SurvivalStats, TelemetryStats } from '../../../shared/types';
import { fetchCoverage, fetchScoreboard, fetchSurvival, fetchTelemetry } from '../api';

/**
 * The proving-month evidence: scoreboard (the decision view), funded-book
 * feed coverage, arb survival, and reaction telemetry. Every number is
 * server-computed from persisted data — this panel can't spend a credit.
 */
export function EvidencePanel() {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [survival, setSurvival] = useState<SurvivalStats | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fetchScoreboard().then((s) => !cancelled && setScoreboard(s)),
      fetchCoverage().then((c) => !cancelled && setCoverage(c)),
      fetchSurvival().then((s) => !cancelled && setSurvival(s)),
      fetchTelemetry().then((t) => !cancelled && setTelemetry(t)),
    ]);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {scoreboard && <ScoreboardBlock data={scoreboard} />}

      <div className="ledger-tables">
        <section>
          <h2 className="ledger-section micro-label">Feed coverage — funded books</h2>
          {!coverage || coverage.scansConsidered === 0 ? (
            <p className="micro-label">No scan history yet — coverage starts with the next scan.</p>
          ) : coverage.books.every((b) => b.flag === 'ok' && (b.balance ?? 0) <= 0) ? (
            <p className="micro-label">
              No funded books to audit — record balances in the scanner's bookmaker panel and
              this view shows whether the feed actually carries them.
            </p>
          ) : (
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Seen</th>
                  <th>Share</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.books
                  .filter((b) => b.flag !== 'ok' || (b.balance ?? 0) > 0)
                  .map((b) => (
                    <tr key={b.key}>
                      <td>{b.title}</td>
                      <td className="num">
                        {b.appearances}/{coverage.scansConsidered}
                      </td>
                      <td className="num">{(b.share * 100).toFixed(0)}%</td>
                      <td>
                        {b.flag === 'missing' && (
                          <span className="chip chip-warn">⚠ FUNDED, NOT IN FEED</span>
                        )}
                        {b.flag === 'thin' && <span className="chip chip-warn">⚠ thin</span>}
                        {b.flag === 'ok' && <span className="micro-label">ok</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        {coverage?.benchmark && coverage.scansConsidered > 0 && (
          <section>
            <h2 className="ledger-section micro-label">Benchmark reach — speculative mode</h2>
            {coverage.benchmark.map((b) => (
              <div key={b.key}>
                <p className="evidence-stat">
                  <strong>{(b.scanShare * 100).toFixed(0)}%</strong>{' '}
                  <span className="micro-label">
                    of scans carried {b.title} — no benchmark, no speculative detection
                  </span>
                </p>
                <table className="ledger-table">
                  <tbody>
                    {b.perSport.map((s) => (
                      <tr key={s.sportKey}>
                        <td>{s.sportTitle}</td>
                        <td className="num">
                          {s.eventsWithBenchmark}/{s.events} events
                        </td>
                        <td>
                          {s.events > 0 && s.eventsWithBenchmark === 0 && (
                            <span className="chip chip-warn">
                              ⚠ SPECULATIVE DETECTION IMPOSSIBLE
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2 className="ledger-section micro-label">Arb survival</h2>
          {!survival || survival.overall.samples === 0 ? (
            <p className="micro-label">
              Needs repeated scans of the same scope — survival starts accruing with auto-scan.
            </p>
          ) : (
            <>
              <p className="evidence-stat">
                <strong>
                  {survival.overall.rate == null
                    ? '—'
                    : `${(survival.overall.rate * 100).toFixed(0)}%`}
                </strong>{' '}
                <span className="micro-label">
                  survive one scan interval · {survival.overall.samples} samples · median gone-lifetime{' '}
                  {formatMs(survival.lifetime.medianMs)} · {survival.lifetime.censored} outlived the
                  window
                </span>
              </p>
              <p className="micro-label">haircut: {survival.haircut.detail}</p>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Book pair</th>
                    <th>Survive</th>
                    <th>N</th>
                  </tr>
                </thead>
                <tbody>
                  {survival.byPair.slice(0, 8).map((p) => (
                    <tr key={p.pair}>
                      <td>{p.pair}</td>
                      <td className="num">{p.rate == null ? '—' : `${(p.rate * 100).toFixed(0)}%`}</td>
                      <td className="num">{p.samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h2 className="ledger-section micro-label">Reaction time</h2>
          {!telemetry || telemetry.alertToVerify.samples === 0 ? (
            <p className="micro-label">
              Accrues once alerts fire and you open the cockpit — the headline is median
              alert → re-verify.
            </p>
          ) : (
            <>
              <p className="evidence-stat">
                <strong>{formatMs(telemetry.alertToVerify.medianMs)}</strong>{' '}
                <span className="micro-label">
                  median alert → re-verify · {telemetry.alertToVerify.samples} samples
                </span>
              </p>
              <table className="ledger-table">
                <tbody>
                  <tr>
                    <td>alert → cockpit open</td>
                    <td className="num">{formatMs(telemetry.alertToOpen.medianMs)}</td>
                    <td className="num">{telemetry.alertToOpen.samples}</td>
                  </tr>
                  <tr>
                    <td>open → re-verify</td>
                    <td className="num">{formatMs(telemetry.openToVerify.medianMs)}</td>
                    <td className="num">{telemetry.openToVerify.samples}</td>
                  </tr>
                  <tr>
                    <td>re-verify → completed</td>
                    <td className="num">{formatMs(telemetry.verifyToCompleted.medianMs)}</td>
                    <td className="num">{telemetry.verifyToCompleted.samples}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h2 className="ledger-section micro-label">Re-verify outcomes — ideal vs reality</h2>
          {!telemetry || telemetry.verifyOutcomes.total === 0 ? (
            <p className="micro-label">No alert-driven re-verifies yet.</p>
          ) : (
            <p className="evidence-stat">
              <strong>
                {telemetry.verifyOutcomes.active}✓ / {telemetry.verifyOutcomes.degraded}▾ /{' '}
                {telemetry.verifyOutcomes.dead}✕
              </strong>{' '}
              <span className="micro-label">
                live / degraded / gone of {telemetry.verifyOutcomes.total} verifies · avg profit
                drift{' '}
                {telemetry.verifyOutcomes.avgProfitDeltaPp == null
                  ? '—'
                  : `${telemetry.verifyOutcomes.avgProfitDeltaPp.toFixed(2)}pp`}
              </span>
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function ScoreboardBlock({ data }: { data: Scoreboard }) {
  return (
    <section className="scoreboard" aria-label="Proving-month scoreboard">
      <h2 className="ledger-section micro-label">Proving-month scoreboard</h2>
      <div className="ledger-heads">
        <div className="ledger-stat">
          <span className="micro-label">paper ideal · simulated</span>
          <strong>{data.paper ? money(data.paper.idealProfit) : '—'}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">
            paper haircut · simulated ·{' '}
            {data.paper ? (data.paper.haircutSource === 'measured' ? 'MEASURED' : 'ASSUMED') : '—'}
          </span>
          <strong>{data.paper ? money(data.paper.haircutProfit) : '—'}</strong>
          {data.paper && <span className="micro-label">{data.paper.haircutPct}% haircut</span>}
        </div>
        <div className="ledger-stat">
          <span className="micro-label">real p&l</span>
          <strong className={data.realProfit >= 0 ? 'is-up' : 'is-down'}>
            {money(data.realProfit)}
          </strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">capture rate</span>
          <strong>
            {data.captureRate.rate == null ? '—' : `${(data.captureRate.rate * 100).toFixed(0)}%`}
          </strong>
          <span className="micro-label">
            {data.captureRate.completed} of {data.captureRate.alerted} alerted
          </span>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">median arb lifetime</span>
          <strong>{formatMs(data.medianArbLifetimeMs)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">median reaction</span>
          <strong>{formatMs(data.medianAlertToVerifyMs)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">credits</span>
          <strong className={data.credits.autoStopEngaged ? 'is-down' : ''}>
            {data.credits.usedTotal?.toLocaleString() ?? '—'}
          </strong>
          <span className="micro-label">
            of {data.credits.budget.toLocaleString()} · proj{' '}
            {data.credits.projectedMonthEnd?.toLocaleString() ?? '—'}
            {data.credits.autoStopEngaged && ' · AUTO-SCAN STOPPED'}
          </span>
        </div>
      </div>
    </section>
  );
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
