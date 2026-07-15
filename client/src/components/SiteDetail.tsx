import {
  chartGeometry, doesNowText, maxBetTexts, quitRulesText, siteMeta, type BrainBookView,
} from '../lib/brain';

function SuspicionChart({ book }: { book: BrainBookView }) {
  const geo = chartGeometry(book.history, book.marks);
  return (
    <>
      <div className="chart-label">
        SUSPICION OVER TIME — GUESS (LINE) VS WHAT ACTUALLY HAPPENED (YELLOW MARKS)
      </div>
      <svg className="suspicion-svg" viewBox="0 0 800 180" preserveAspectRatio="none">
        <line x1="0" y1="20" x2="740" y2="20" stroke="#ababab" strokeWidth="1" strokeDasharray="4 4" />
        <text x="798" y="24" textAnchor="end" fill="#9a9a9a" fontSize="10" letterSpacing="1">STOP</text>
        <line x1="0" y1="85" x2="720" y2="85" stroke="#ababab" strokeWidth="1" strokeDasharray="4 4" />
        <text x="798" y="89" textAnchor="end" fill="#9a9a9a" fontSize="10" letterSpacing="1">GO GENTLE</text>
        {geo && (
          <polyline
            points={geo.line}
            fill="none"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {geo?.marks.map((m, i) => (
          <g key={`${m.label}-${i}`}>
            <rect x={m.x - 4.5} y={m.y - 4.5} width="9" height="9" fill="#F5D90A" />
            <text x={m.x} y={m.y - 10} textAnchor="middle" fill="#F5D90A" fontSize="10" letterSpacing="1">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
    </>
  );
}

export function SiteDetail({ book }: { book: BrainBookView }) {
  const { max, was } = maxBetTexts(book);
  return (
    <section className="site-detail">
      <div className="detail-title">
        <span className="detail-name">{book.displayName.toUpperCase()}</span>{' '}
        <span className="detail-meta">{siteMeta(book)}</span>
      </div>
      <div className="maxbet">
        MY MAX BET HERE <span className="maxbet-value">{max}</span>
        {was !== null && <span className="maxbet-was"> ▼ {was}</span>}
      </div>
      {!book.sharpExempt && <SuspicionChart book={book} />}
      <div className="does-now">
        <div className="box-label">WHAT THE BRAIN DOES NOW</div>
        <div className="box-body">{doesNowText(book)}</div>
      </div>
      <div className="quit-rules">
        <div className="box-label">□ QUIT RULES — WRITTEN IN ADVANCE</div>
        <div className="box-body">{quitRulesText(book)}</div>
      </div>
    </section>
  );
}
