import { chartGeometry, statsTexts, type ChartViewData } from '../lib/analytics';

interface ProfitChartProps {
  title: string;
  data: ChartViewData;
}

/** §4.4–4.5: light plate, 3px blue border, ink majors + grey minors, thick blue
 *  zigzag with a bullet at every point and the last point ringed. All geometry
 *  from chartGeometry — this component only places shapes. */
export function ProfitChart({ title, data }: ProfitChartProps) {
  const geo = chartGeometry(data.points);
  const s = statsTexts(data.stats);
  return (
    <section>
      <h3 className="chart-title">{title}</h3>
      <div className="chart-plate">
        {geo ? (
          <>
            <svg className="chart-svg" viewBox="0 0 960 220" preserveAspectRatio="none" role="img">
              {geo.yMinors.map((y) => (
                <line key={`ym${y}`} x1={60} x2={940} y1={y} y2={y} className="grid-minor" />
              ))}
              {geo.xMinors.map((x) => (
                <line key={`xm${x}`} x1={x} x2={x} y1={25} y2={205} className="grid-minor" />
              ))}
              {geo.xMajors.map((x) => (
                <line key={`xM${x}`} x1={x} x2={x} y1={25} y2={205} className="grid-major" />
              ))}
              {geo.yLabels.map((l) => (
                <line key={`yM${l.y}`} x1={60} x2={940} y1={l.y} y2={l.y}
                  className={l.y === 205 ? 'grid-base' : 'grid-major'} />
              ))}
              {geo.yLabels.map((l) => (
                <text key={`yt${l.y}`} x={50} y={l.y + 4} textAnchor="end" className="axis-label">
                  {l.text}
                </text>
              ))}
              {geo.line !== null && <polyline points={geo.line} className="trend" />}
              {geo.bullets.map((b, i) => (
                <circle key={`b${i}`} cx={b.x} cy={b.y} r={4} className="bullet" />
              ))}
              <circle cx={geo.last.x} cy={geo.last.y} r={5.5} className="bullet-last" />
            </svg>
            <div className="date-row">
              {geo.dates.map((d) => <span key={d}>{d}</span>)}
            </div>
          </>
        ) : (
          <div className="chart-empty">NO DATA YET</div>
        )}
      </div>
      <div className="stats-row">
        <span className="stat-label">
          RETURN (RANGE) <span className={`stat-value ${s.retTone}`}>{s.ret}</span>
        </span>
        <span className="stat-label">
          ANNUALIZED <span className={`stat-value ${s.retTone}`}>{s.ann}</span>
        </span>
        <span className="stat-label">
          PROFIT <span className="stat-value plain">{s.profit}</span>
        </span>
      </div>
    </section>
  );
}
