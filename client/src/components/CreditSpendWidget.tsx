import { useEffect, useState } from 'react';
import type { Scoreboard } from '../../../shared/types';
import { fetchGradingStatus, fetchScoreboard, type GradingStatus } from '../api';
import { creditSpendSeverity, scoresSharePct } from '../creditWidget';

/**
 * Phase 15 #7: spent/budget, projected month-end, and today's scores
 * share — fed by the SAME accounting the Ledger scoreboard reads
 * (/api/ops/scoreboard + /api/grading/status), so the two never disagree.
 * Amber at projected ≥80% of budget, red at ≥100% — numeric danger, not
 * the arb red (CLAUDE.md's red/green/yellow reservations are untouched).
 */
export function CreditSpendWidget({ refreshKey }: { refreshKey?: number | null }) {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [grading, setGrading] = useState<GradingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fetchScoreboard().then((s) => !cancelled && setScoreboard(s)),
      fetchGradingStatus().then((g) => !cancelled && setGrading(g)),
    ]);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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
        {severity !== 'ok' && (
          <span className={`chip ${severity === 'red' ? 'chip-warn' : 'chip-amber'}`}>
            {severity === 'red' ? '⚠ PROJECTED OVER BUDGET' : '⚠ PROJECTED ≥80% OF BUDGET'}
          </span>
        )}
      </div>
    </section>
  );
}
