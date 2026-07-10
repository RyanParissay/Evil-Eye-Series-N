import { useMemo, useState } from 'react';

interface Point {
  at: string;
  cumulativeProfit: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 56 };

/**
 * Cumulative profit as a step-after line (profit jumps at events;
 * interpolating between them would invent money). Optionally a second,
 * dashed series (the paper fund's haircut curve) — with a legend, since
 * two series must never be color-alone. Hand-rolled SVG, no deps.
 */
export function EquityChart({
  points,
  secondary,
  labels,
  emptyText = 'No priced completions yet — the curve starts with the first one.',
}: {
  points: Point[];
  secondary?: Point[];
  labels?: { primary: string; secondary: string };
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const all = [...points, ...(secondary ?? [])];
    const times = all.map((p) => Date.parse(p.at));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    const span = Math.max(t1 - t0, 1);
    const values = all.map((p) => p.cumulativeProfit);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const range = Math.max(hi - lo, 1);
    const x = (at: string) =>
      PAD.left + ((Date.parse(at) - t0) / span) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + ((hi - v) / range) * (H - PAD.top - PAD.bottom);
    const stepPath = (series: Point[]) =>
      series
        .map((p, i) => {
          const px = x(p.at).toFixed(1);
          const py = y(p.cumulativeProfit).toFixed(1);
          if (i === 0) return `M ${px} ${py}`;
          const prevY = y(series[i - 1].cumulativeProfit).toFixed(1);
          return `L ${px} ${prevY} L ${px} ${py}`; // step-after
        })
        .join(' ');
    return { x, y, path: stepPath(points), path2: secondary?.length ? stepPath(secondary) : null, lo, hi };
  }, [points, secondary]);

  if (!geometry) {
    return <p className="ledger-chart-empty micro-label">{emptyText}</p>;
  }

  const { x, y, path, path2, lo, hi } = geometry;
  const zeroY = y(0);
  const hovered = hover != null ? points[hover] : null;

  function onMove(evt: React.MouseEvent<SVGSVGElement>) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.at) - mx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  return (
    <div className="ledger-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative realized profit over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive grid: the zero line plus the value extremes. */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} className="ledger-grid-zero" />
        <text x={PAD.left - 8} y={y(hi) + 4} className="ledger-axis" textAnchor="end">
          {dollars(hi)}
        </text>
        <text x={PAD.left - 8} y={zeroY + 4} className="ledger-axis" textAnchor="end">
          $0
        </text>
        {lo < 0 && (
          <text x={PAD.left - 8} y={y(lo) + 4} className="ledger-axis" textAnchor="end">
            {dollars(lo)}
          </text>
        )}
        <text x={PAD.left} y={H - 8} className="ledger-axis">
          {day(points[0].at)}
        </text>
        <text x={W - PAD.right} y={H - 8} className="ledger-axis" textAnchor="end">
          {day(points[points.length - 1].at)}
        </text>

        {path2 && <path d={path2} className="ledger-line-secondary" />}
        <path d={path} className="ledger-line" />
        {/* Markers when sparse, so single completions are visible. */}
        {points.length <= 40 &&
          points.map((p, i) => (
            <circle
              key={p.at + i}
              cx={x(p.at)}
              cy={y(p.cumulativeProfit)}
              r={hover === i ? 5 : 3.5}
              className="ledger-dot"
            />
          ))}
        {hovered && (
          <line
            x1={x(hovered.at)}
            x2={x(hovered.at)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            className="ledger-crosshair"
          />
        )}
      </svg>
      {labels && path2 && (
        <div className="ledger-legend micro-label">
          <span>
            <span className="ledger-legend-swatch is-primary" /> {labels.primary}
          </span>
          <span>
            <span className="ledger-legend-swatch is-secondary" /> {labels.secondary}
          </span>
        </div>
      )}
      {hovered && (
        <div className="ledger-tooltip micro-label" role="status">
          {day(hovered.at)} · cumulative {dollars(hovered.cumulativeProfit)}
        </div>
      )}
    </div>
  );
}

function dollars(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function day(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}
