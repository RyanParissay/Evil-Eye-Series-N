import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorCode } from '../../../shared/types';
import {
  ApiError,
  fetchPortfolios,
  optimizePortfolio,
  type PortfolioGroup,
  type PortfolioGroupGate,
  type PortfolioOptimizeResult,
  type PortfolioScanGap,
  type PortfolioSeries,
  type PortfoliosReport,
} from '../api';
import { EquityChart } from '../components/EquityChart';
import { EyeGlyph } from '../components/EyeGlyph';
import { errorHint, errorTitle } from '../errorCopy';

type Tab = 'arb' | 'edge' | 'middles' | 'combo';

/** One representative series per group is charted on the Combo tab and
 *  fed to the optimizer server-side — must match routes/portfolios.ts
 *  GROUP_REPRESENTATIVES exactly. */
const GROUP_REPRESENTATIVE: Record<PortfolioGroup, string> = {
  arb: 'arb_2',
  ev: 'ev_e5_med',
  middle: 'middle',
};

const TAB_GROUP: Record<Tab, PortfolioGroup | null> = {
  arb: 'arb',
  edge: 'ev',
  middles: 'middle',
  combo: null,
};

/** 2–3 representative series charted per tab — all 13 still appear in
 *  that tab's table; charting all of them would make the page unreadable. */
const CHART_KEYS: Record<Tab, string[]> = {
  arb: ['arb_1', 'arb_3'],
  edge: ['ev_e3_high', 'ev_e5_med', 'ev_e7_low'],
  middles: ['middle'],
  combo: ['arb_2', 'ev_e5_med', 'middle'],
};

/**
 * Four views onto the 13 Phase-14 SIMULATED paper series, replayed
 * server-side from the full graded opportunity stream. Everything here is
 * paper money — no live promise, and the Combo optimizer is explicitly
 * labeled MODEL wherever it surfaces.
 */
export function PortfoliosPage() {
  const [tab, setTab] = useState<Tab>('arb');
  const [report, setReport] = useState<PortfoliosReport | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPortfolios()
      .then((r) => {
        if (!cancelled) setReport(r);
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

  const seriesByKey = new Map((report?.series ?? []).map((s) => [s.key, s]));
  const group = TAB_GROUP[tab];
  const groupSeries = group ? (report?.series ?? []).filter((s) => s.group === group) : [];

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state="open" />
        <h1 className="wordmark">
          Paper <span className="wordmark-accent">Portfolios</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> ·{' '}
          <Link to="/ledger" className="adv-back">Ledger</Link> · 13 SIMULATED series, $10,000
          each · <Link to="/risk" className="risk-nav">RISK MODE</Link>
        </p>
      </header>

      {error && (
        <div className="state-block state-error" role="alert">
          <p className="state-title">{errorTitle(error.code)}</p>
          <p className="state-detail">{error.message}</p>
          <p className="state-detail">{errorHint(error.code)}</p>
        </div>
      )}

      {!error && !report && (
        <div className="state-block" role="status">
          <p className="state-title">Replaying the paper series…</p>
        </div>
      )}

      {report && (
        <main className="ledger">
          <div className="risk-segments" role="tablist" aria-label="Portfolio views">
            {(
              [
                ['arb', 'ARB'],
                ['edge', 'EDGE'],
                ['middles', 'MIDDLES'],
                ['combo', 'COMBO'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`risk-segment${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <GapCaveat gaps={report.gaps} />

          {tab !== 'combo' && group && (
            <GroupView group={group} series={groupSeries} chartKeys={CHART_KEYS[tab]} seriesByKey={seriesByKey} />
          )}

          {tab === 'combo' && <ComboView report={report} seriesByKey={seriesByKey} onReload={() => {
            fetchPortfolios().then(setReport).catch(() => {});
          }} />}
        </main>
      )}

      <footer className="footnote micro-label">
        Every number on this page is SIMULATED paper money, flat staked, no compounding — never
        mistake it for a live promise. The optimizer is a model fit to history, not a forecast.
      </footer>
    </div>
  );
}

function GapCaveat({ gaps }: { gaps: PortfolioScanGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <p className="ledger-note micro-label">
      {gaps.length} scan gap{gaps.length === 1 ? '' : 's'} detected during the active window —
      auto-scan may have stopped firing for a stretch, so some signals in this replay could be
      missing rather than genuinely absent. See the Ledger's evidence panel for exact dates.
    </p>
  );
}

function GroupView({
  group,
  series,
  chartKeys,
  seriesByKey,
}: {
  group: PortfolioGroup;
  series: PortfolioSeries[];
  chartKeys: string[];
  seriesByKey: Map<string, PortfolioSeries>;
}) {
  const totalPnl = series.reduce((sum, s) => sum + s.pnl, 0);
  const totalRecords = series.reduce((sum, s) => sum + s.records, 0);
  const totalSkipped = series.reduce((sum, s) => sum + s.skipped.count, 0);

  return (
    <>
      <section className="ledger-heads">
        <div className="ledger-stat">
          <span className="micro-label">{groupLabel(group)} series</span>
          <strong>{series.length}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">combined P&L</span>
          <strong className={totalPnl >= 0 ? 'is-up' : 'is-down'}>{money(totalPnl)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">graded signals placed</span>
          <strong>{totalRecords}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">skipped (bankroll)</span>
          <strong>{totalSkipped}</strong>
        </div>
      </section>

      <section className="portfolio-charts">
        {chartKeys.map((key) => {
          const s = seriesByKey.get(key);
          if (!s) return null;
          return (
            <div key={key} className="portfolio-chart-card">
              <h3 className="ledger-section micro-label">
                {s.label} — equity ({money(s.pnl)})
              </h3>
              <EquityChart points={equityToCumulativeProfit(s)} />
            </div>
          );
        })}
      </section>

      <SeriesTable series={series} />
    </>
  );
}

function SeriesTable({ series }: { series: PortfolioSeries[] }) {
  return (
    <section>
      <h2 className="ledger-section micro-label">All series in this view</h2>
      <div className="risk-table-wrap">
        <table className="ledger-table risk-table">
          <thead>
            <tr>
              <th>Series</th>
              <th>Bankroll</th>
              <th>P&amp;L</th>
              <th>ROI</th>
              <th>Signals</th>
              <th>W</th>
              <th>L</th>
              <th>Push</th>
              <th>Void</th>
              <th>Max DD</th>
              <th title="Skipped: bankroll couldn't afford the flat stake">Skip</th>
              <th title="No schemaVersion, no grading — pre-Phase-13">Pre-v13</th>
              <th title="Flagged needs_rules">Rules</th>
              <th title="Flagged ungraded_stale — gave up after 24h">Stale</th>
              <th title="Graded not yet, no flag">Open</th>
              <th title="Same-book or suspicious — never bettable">Excl</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className="num">${s.bankroll.toFixed(2)}</td>
                <td className="num">{money(s.pnl)}</td>
                <td className="num">{s.roiPct.toFixed(1)}%</td>
                <td className="num">{s.records}</td>
                <td className="num">{s.wins}</td>
                <td className="num">{s.losses}</td>
                <td className="num">{s.pushes}</td>
                <td className="num">{s.voids}</td>
                <td className="num">${s.maxDrawdown.toFixed(2)}</td>
                <td className="num">
                  {s.skipped.count === 0 ? (
                    '—'
                  ) : (
                    <details>
                      <summary>{s.skipped.count}</summary>
                      <ul className="portfolio-skip-list micro-label">
                        {s.skipped.events.slice(0, 20).map((e) => (
                          <li key={e.recordId}>
                            {new Date(e.at).toLocaleDateString()} · {e.recordId.slice(0, 8)}
                          </li>
                        ))}
                        {s.skipped.events.length > 20 && (
                          <li>+{s.skipped.events.length - 20} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="num">{s.buckets.preV13}</td>
                <td className="num">{s.buckets.needsRules}</td>
                <td className="num">{s.buckets.stale}</td>
                <td className="num">{s.buckets.open}</td>
                <td className="num">{s.buckets.excluded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComboView({
  report,
  seriesByKey,
  onReload,
}: {
  report: PortfoliosReport;
  seriesByKey: Map<string, PortfolioSeries>;
  onReload: () => void;
}) {
  const [weights, setWeights] = useState<[number, number, number]>([34, 33, 33]);
  const [optimal, setOptimal] = useState<PortfolioOptimizeResult | null>(null);
  const [live, setLive] = useState<PortfolioOptimizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const gates = report.optimizerGates;

  // Live "your mix" evaluation — debounced so dragging a slider doesn't
  // hammer the server. Only runs once every group clears the gate.
  useEffect(() => {
    if (!gates.met) {
      setLive(null);
      return;
    }
    const handle = setTimeout(() => {
      optimizePortfolio(weights)
        .then(setLive)
        .catch(() => setLive(null));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, gates.met]);

  async function runOptimizer() {
    if (busy || !gates.met) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await optimizePortfolio();
      setOptimal(result);
      setWeights(result.weights.map((w) => Math.round(w * 100)) as [number, number, number]);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Optimizer failed — check the server logs.');
    } finally {
      setBusy(false);
    }
  }

  function onSlide(index: 0 | 1 | 2, raw: number) {
    setOptimal(null);
    setWeights((current) => rebalance(current, index, raw));
  }

  return (
    <>
      <section>
        <h2 className="ledger-section micro-label">Weight the three strategy groups</h2>
        <div className="portfolio-sliders">
          {(['arb', 'ev', 'middle'] as const).map((g, i) => (
            <div key={g} className="slider-block">
              <label>
                {groupLabel(g)} <span className="slider-value">{weights[i]}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={weights[i]}
                onChange={(e) => onSlide(i as 0 | 1 | 2, e.target.valueAsNumber)}
              />
            </div>
          ))}
        </div>
        <p className="risk-note">
          Sliders always sum to 100% — moving one rebalances the other two proportionally.
          Representative series per group: {GROUP_REPRESENTATIVE.arb}, {GROUP_REPRESENTATIVE.ev},{' '}
          {GROUP_REPRESENTATIVE.middle}.
        </p>
      </section>

      <GateProgress gates={gates} />

      <section className="portfolio-result">
        <button
          type="button"
          className="scan-button"
          disabled={!gates.met || busy}
          onClick={() => void runOptimizer()}
        >
          {busy ? 'Optimizing…' : 'Optimize weights (MODEL)'}
        </button>
        {note && <p className="micro-label state-detail">{note}</p>}

        {(optimal ?? live) && (
          <div className="ledger-heads">
            <div className="ledger-stat">
              <span className="micro-label">{optimal ? "optimizer's pick" : 'your mix'}</span>
              <strong>
                {((optimal ?? live)!.weights as number[]).map((w) => Math.round(w * 100)).join(' / ')}%
              </strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">expected return / signal</span>
              <strong className={(optimal ?? live)!.expectedReturn >= 0 ? 'is-up' : 'is-down'}>
                {((optimal ?? live)!.expectedReturn * 100).toFixed(3)}%
              </strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">volatility</span>
              <strong>{((optimal ?? live)!.volatility * 100).toFixed(3)}%</strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">sharpe (mean/std)</span>
              <strong>{(optimal ?? live)!.sharpe.toFixed(3)}</strong>
            </div>
          </div>
        )}
        <p className="risk-note">
          MODEL, in-sample only — fit to the exact history replayed above, bounded 0–70% per
          group. Past paper returns are not a forecast; this never becomes a live promise.
        </p>
      </section>

      <section className="portfolio-charts">
        {CHART_KEYS.combo.map((key) => {
          const s = seriesByKey.get(key);
          if (!s) return null;
          return (
            <div key={key} className="portfolio-chart-card">
              <h3 className="ledger-section micro-label">{s.label} — equity ({money(s.pnl)})</h3>
              <EquityChart points={equityToCumulativeProfit(s)} />
            </div>
          );
        })}
      </section>

      <button type="button" className="adv-save" onClick={onReload}>
        refresh replay
      </button>
    </>
  );
}

function GateProgress({ gates }: { gates: PortfoliosReport['optimizerGates'] }) {
  if (gates.met) {
    return <p className="risk-note">Every group cleared the data-sufficiency gate.</p>;
  }
  return (
    <div className="portfolio-gate-progress micro-label">
      {(['arb', 'ev', 'middle'] as const).map((g) => (
        <GateBadge key={g} label={groupLabel(g)} gate={gates[g]} />
      ))}
    </div>
  );
}

function GateBadge({ label, gate }: { label: string; gate: PortfolioGroupGate }) {
  return (
    <span>
      {label}: {gate.records.have}/{gate.records.need} records · {gate.days.have}/{gate.days.need}{' '}
      days {gate.met ? '✓' : ''}
    </span>
  );
}

function rebalance(
  current: [number, number, number],
  index: 0 | 1 | 2,
  rawValue: number,
): [number, number, number] {
  const value = Math.max(0, Math.min(100, Math.round(rawValue)));
  const others = ([0, 1, 2] as const).filter((i) => i !== index) as [0 | 1 | 2, 0 | 1 | 2];
  const otherSum = current[others[0]] + current[others[1]];
  const remaining = 100 - value;
  const next: [number, number, number] = [0, 0, 0];
  next[index] = value;
  if (otherSum === 0) {
    next[others[0]] = Math.round(remaining / 2);
    next[others[1]] = remaining - next[others[0]];
  } else {
    next[others[0]] = Math.round((current[others[0]] / otherSum) * remaining);
    next[others[1]] = remaining - next[others[0]]; // absorbs rounding drift — sum is always 100
  }
  return next;
}

function equityToCumulativeProfit(series: PortfolioSeries): Array<{ at: string; cumulativeProfit: number }> {
  return series.equity.map((p) => ({
    at: p.at,
    cumulativeProfit: Math.round((p.bankroll - series.startingBankroll) * 100) / 100,
  }));
}

function groupLabel(group: PortfolioGroup): string {
  if (group === 'arb') return 'Arb';
  if (group === 'ev') return 'Edge';
  return 'Middles';
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
