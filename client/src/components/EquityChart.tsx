import { useMemo, useState } from 'react';

interface Point {
  at: string;
  cumulativeProfit: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 56 };

/**
 * Cumulative realized profit as a step-after line (profit jumps at each
 * completion; interpolating between events would invent money). Single
 * series — the heading names it, no legend. Hand-rolled SVG, no deps.
 */
export function EquityChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const t0 = Date.parse(points[0].at);
    const t1 = Date.parse(points[points.length - 1].at);
    const span = Math.max(t1 - t0, 1);
    const values = points.map((p) => p.cumulativeProfit);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const range = Math.max(hi - lo, 1);
    const x = (at: string) =>
      PAD.left + ((Date.parse(at) - t0) / span) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + ((hi - v) / range) * (H - PAD.top - PAD.bottom);
    const path = points
      .map((p, i) => {
        const px = x(p.at).toFixed(1);
        const py = y(p.cumulativeProfit).toFixed(1);
        if (i === 0) return `M ${px} ${py}`;
        const prevY = y(points[i - 1].cumulativeProfit).toFixed(1);
        return `L ${px} ${prevY} L ${px} ${py}`; // step-after
      })
      .join(' ');
    return { x, y, path, lo, hi };
  }, [points]);

  if (!geometry) {
    return (
      <p className="ledger-chart-empty micro-label">
        No priced completions yet — the curve starts with the first one.
      </p>
    );
  }

  const { x, y, path, lo, hi } = geometry;
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
