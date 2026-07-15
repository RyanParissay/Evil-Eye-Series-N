import { MONTHLY_HEADERS, monthlyCells, type MonthlyRow } from '../lib/analytics';

export function MonthlyTable({ rows }: { rows: MonthlyRow[] }) {
  if (rows.length === 0) return null; // no months yet — the table simply isn't there
  return (
    <div className="monthly">
      <div className="monthly-head">
        {MONTHLY_HEADERS.map((h) => <span key={h}>{h}</span>)}
      </div>
      {rows.map((r) => {
        const cells = monthlyCells(r);
        return (
          <div className="monthly-row" key={r.month}>
            {cells.map((c, i) => (
              <span key={MONTHLY_HEADERS[i]}
                className={i === 0 ? 'm-month' : i === cells.length - 1 ? 'm-pl' : undefined}>
                {c}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
