/**
 * Hub "Cost of Safety" readout (Phase 17 deliverable 4): what the safety
 * gate declined at CURRENT settings, this week and lifetime — every dollar
 * is HYPOTHETICAL (bets deliberately not taken), server-computed by
 * safety/cost.ts. The client renders the report verbatim: no money math,
 * just labeling (EV forgone profit is EXPECTED — a model, not money;
 * middles contribute count but $0 unless a free middle's locked floor).
 */
import { useEffect, useState } from 'react';
import type {
  OpportunityStrategy,
  SafetyCostReport,
  SafetyCostWindow,
} from '../../../shared/types';
import { ApiError, fetchSafetyCost } from '../api';
import { reasonLabel } from '../safetyDisplay';

const STRATEGY_LABEL: Record<OpportunityStrategy, string> = {
  arb: 'Arb',
  ev: 'EV',
  middle: 'Middles',
};

export function SafetyCostPanel() {
  const [report, setReport] = useState<SafetyCostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSafetyCost()
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load the Cost of Safety readout.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="state-block state-error" role="alert">
        <p className="state-title">Cost of Safety unavailable</p>
        <p className="state-detail">{error}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="state-block" role="status">
        <p className="state-title">Loading the Cost of Safety readout…</p>
      </div>
    );
  }

  const empty = report.lifetime.filteredCount === 0;

  return (
    <section aria-label="Cost of Safety">
      <p className="risk-note safety-cost-intro">
        What the safety gate declined <span className="hub-badge">SIMULATED</span> — every dollar
        here is HYPOTHETICAL: opportunities that confirmed but were never alerted or
        auto-purchased. This is the evidence for tuning the threshold, not realized money.
      </p>

      {empty ? (
        <div className="state-block">
          <p className="state-title">Nothing filtered yet.</p>
          <p className="state-detail">
            The gate starts pricing what it declines once confirmations flow.
          </p>
        </div>
      ) : (
        <>
          <CostWindowView title="This week" window={report.week} />
          <CostWindowView title="Lifetime" window={report.lifetime} />
        </>
      )}
    </section>
  );
}

function CostWindowView({ title, window }: { title: string; window: SafetyCostWindow }) {
  return (
    <div className="safety-cost-window">
      <h3 className="ledger-section micro-label">{title}</h3>
      <section className="ledger-heads">
        <div className="ledger-stat">
          <span className="micro-label">filtered</span>
          <strong>{window.filteredCount}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">forgone profit · hypothetical</span>
          <strong>{money(window.forgoneProfit)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">forgone edge</span>
          <strong>{window.forgoneEdgePp.toFixed(2)}pp</strong>
        </div>
      </section>

      {window.filteredCount === 0 ? (
        <p className="ledger-empty micro-label">nothing filtered in this window</p>
      ) : (
        <>
          {window.byStrategy && window.byStrategy.length > 0 && (
            <div className="risk-table-wrap">
              <table className="ledger-table safety-cost-by-strategy">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Count</th>
                    <th>Forgone</th>
                  </tr>
                </thead>
                <tbody>
                  {window.byStrategy.map((s) => (
                    <tr key={s.strategy}>
                      <td>
                        {STRATEGY_LABEL[s.strategy]}
                        {s.strategy === 'ev' && <span className="safety-cost-tag">expected</span>}
                        {s.strategy === 'middle' && (
                          <span className="safety-cost-tag">count only, unless free</span>
                        )}
                      </td>
                      <td className="num">{s.count}</td>
                      <td className="num">{money(s.forgoneProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="risk-table-wrap">
            <table className="ledger-table safety-cost-by-reason">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Count</th>
                  <th>Forgone</th>
                </tr>
              </thead>
              <tbody>
                {window.byReason.map((r) => (
                  <tr key={r.reason}>
                    <td>{reasonLabel(r.reason)}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{money(r.forgoneProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
