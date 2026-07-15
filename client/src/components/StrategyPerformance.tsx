import { gradeTone, type GradeView } from '../lib/brain';

export function StrategyPerformance({ grades }: { grades: GradeView[] }) {
  return (
    <section className="grades">
      <div className="panel-label">STRATEGY PERFORMANCE</div>
      <div className="grades-head">
        <span />
        <span>GRADE</span>
        <span>NOTES</span>
      </div>
      {grades.map((g) => (
        <div className="grade-row" key={g.strategy}>
          <span className="grade-name">{g.strategy}</span>
          <span className={`grade-value ${gradeTone(g.grade)}`}>{g.grade}</span>
          <span className={`grade-note${g.provisional ? ' provisional' : ''}`}>{g.note}</span>
        </div>
      ))}
    </section>
  );
}
