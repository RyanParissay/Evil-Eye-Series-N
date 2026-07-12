import { useEffect, useState } from 'react';
import type { Scoreboard } from '../../../shared/types';
import { fetchCostEstimate, fetchGradingStatus, fetchScoreboard, type CostEstimate, type GradingStatus } from '../api';
import { creditSpendSeverity, describePairCost, scoresSharePct } from '../creditWidget';

/**
 * Phase 15 #7: spent/budget, projected month-end, and today's scores
 * share — fed by the SAME accounting the Ledger scoreboard reads
 * (/api/ops/scoreboard + /api/grading/status), so the two never disagree.
 * Amber at projected ≥80% of budget, red at ≥100% — numeric danger, not
 * the arb red (CLAUDE.md's red/green/yellow reservations are untouched).
 */
export function CreditSpendWidget({
  refreshKey,
  regionTab,
  topN,
}: {
  refreshKey?: number | null;
  /** Scope for the per-window pair cost (Phase 16 Part A); omit to hide it. */
  regionTab?: string;
  topN?: number;
}) {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [grading, setGrading] = useState<GradingStatus | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fetchScoreboard().then((s) => !cancelled && setScoreboard(s)),
      fetchGradingStatus().then((g) => !cancelled && setGrading(g)),
      regionTab && topN
        ? fetchCostEstimate(regionTab, topN).then((e) => !cancelled && setEstimate(e))
        : Promise.resolve(),
    ]);
    return () => {
      cancelled = true;
    };
  }, [refreshKey, regionTab, topN]);

  if (!scoreboard) return null;

  const { credits } = scoreboard;
  const severity = creditSpendSeverity(credits.projectedMonthEnd, credits.budget);
  const share = grading ? scoresSharePct(grading.scoresSpendToday, grading.cap) : null;

  return (
    <section className="credit-widget" aria-label="Credit spend">
      <div className="credit-widget-row">
        <div className="credit-widget-stat">
          <span className="micro-label">spent / budget</span>
          <strong>
            {credits.usedTotal?.toLocaleString() ?? '—'} / {credits.budget.toLocaleString()}
          </strong>
        </div>
        <div className="credit-widget-stat">
          <span className="micro-label">projected month-end</span>
          <strong>{credits.projectedMonthEnd?.toLocaleString() ?? '—'}</strong>
        </div>
        <div className="credit-widget-stat">
          <span className="micro-label">scores share today</span>
          <strong>{share == null ? '—' : `${share}%`}</strong>
        </div>
        {estimate && (
          <div className="credit-widget-stat">
            <span className="micro-label">per scan window</span>
            <strong title={describePairCost(estimate.confirmation)}>
              ≈{estimate.confirmation.creditsPerPairWindow} cr ·{' '}
              {Math.round(estimate.confirmation.hitRate * 100)}%{' '}
              {estimate.confirmation.hitRateSource === 'measured' ? 'MEASURED' : 'ASSUMED'}
            </strong>
          </div>
        )}
        {severity !== 'ok' && (
          <span className={`chip ${severity === 'red' ? 'chip-warn' : 'chip-amber'}`}>
            {severity === 'red' ? '⚠ PROJECTED OVER BUDGET' : '⚠ PROJECTED ≥80% OF BUDGET'}
          </span>
        )}
      </div>
    </section>
  );
}
