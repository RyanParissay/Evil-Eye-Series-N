import { useState } from 'react';
import {
  closingEdgeTile, formatDateCaps, gateBar, limitRow, openBetStatus, openBetText, oppToggle,
  retentionTile, roundingTile, sortOpp,
  type AnalyticsView, type BoardRow, type OppRow,
} from '../lib/analytics';

type Advanced = AnalyticsView['advanced'];

function Board({ title, rows }: { title: string; rows: BoardRow[] }) {
  return (
    <div className="board">
      <div className="board-title">{title}</div>
      {rows.length === 0 && <div className="board-row"><span className="book">—</span></div>}
      {rows.map((r) => (
        <div className="board-row" key={r.book}>
          <span className="book">{r.book}</span>
          <span className="board-count">{r.count}</span>
          <span className="board-pct">{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function OppColumn({ title, metric, rows, sort, open }: {
  title: string; metric: string; rows: OppRow[]; sort: 'COUNT' | 'EDGE'; open: boolean;
}) {
  const sorted = sortOpp(rows, sort);
  const shown = open ? sorted : sorted.slice(0, 5);
  return (
    <div className="opp-col">
      <div className="opp-col-title">{title}</div>
      <div className="opp-subhead">
        <span>BOOK</span><span className="right">COUNT</span><span className="right">{metric}</span>
      </div>
      {shown.length === 0 && <div className="opp-row"><span className="book">—</span></div>}
      {shown.map((r) => (
        <div className="opp-row" key={r.book}>
          <span className="book">{r.book}</span>
          <span className="opp-count">{r.count}</span>
          <span className="opp-avg">{r.avgPct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function AdvancedAnalytics({ adv, since }: { adv: Advanced; since: string }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<'COUNT' | 'EDGE'>('COUNT');
  const [oppOpen, setOppOpen] = useState(false);

  const rounding = roundingTile(adv.costOfSafety.rounding);
  const ret = retentionTile(adv.costOfSafety.retention);
  const cpe = closingEdgeTile(adv.costOfSafety.closingEdge);
  const bars = gateBar(adv.costOfSafety.gateCost);

  return (
    <>
      {open && (
        <>
          <h3 className="adv-section-head">OPEN BETS</h3>
          <div className="adv-box">
            {adv.openBets.length === 0 && <div className="ob-row"><span>NO OPEN BETS</span></div>}
            {adv.openBets.map((b, i) => (
              <div className="ob-row" key={i}>
                <span>{openBetText(b)}</span>
                <span className="ob-status">{openBetStatus(b)}</span>
              </div>
            ))}
          </div>

          <h3 className="adv-section-head">LEADERBOARDS</h3>
          <div className="lb-sub">
            TOP BOOKS BY CONFIRMED COUNT · SINCE
            <span className="since-chip">{formatDateCaps(since)} ▾</span>
          </div>
          <div className="lb-grid">
            {adv.leaderboards.boards.map((b) => <Board key={b.title} title={b.title} rows={b.rows} />)}
          </div>

          <h3 className="adv-section-head">COST OF SAFETY</h3>
          <div className="cost-grid">
            <div className="cost-tile">
              <div className="cost-label">ROUNDING COST</div>
              <div className="cost-value">{rounding.value}</div>
              <div className="cost-note">{rounding.note}</div>
            </div>
            <div className="cost-tile">
              <div className="cost-label">MARGIN RETENTION — INITIAL → RECHECK → FINAL</div>
              <div className="cost-value">{ret.value}</div>
              <div className="cost-note">{ret.note}</div>
            </div>
            <div className="cost-tile span2">
              <div className="cost-label">GATE COST — ESTIMATED EV OF KILLED CANDIDATES, PER BATTERY RULE</div>
              {bars.length === 0 && <div className="cost-note">NO GATE KILLS YET</div>}
              {bars.map((b) => (
                <div className="gate-row" key={b.reason}>
                  <span className="gate-label">{b.reason}</span>
                  <span className="gate-track">
                    <span className={`gate-fill${b.top ? ' top' : ''}`} style={{ width: `${b.widthPct}%`, display: 'block' }} />
                  </span>
                  <span className="gate-cost">{b.cost}</span>
                  <span className="gate-note">{b.note}</span>
                </div>
              ))}
            </div>
            <div className="cost-tile span2">
              <div className="cost-label">CLOSING PRICE EDGE VS PINNACLE CLOSE</div>
              <div className="cost-value">{cpe.value}</div>
              <div className="cost-note">{cpe.note}</div>
            </div>
          </div>

          <h3 className="adv-section-head">LIMITS REPORTED — SENT TO MODEL</h3>
          <div className="limits-box">
            <div className="limits-head">LIMITS REPORTED — SENT TO MODEL</div>
            {adv.limits.length === 0 && <div className="limits-row"><span>NO REPORTS YET</span></div>}
            {adv.limits.map((l, i) => {
              const row = limitRow(l);
              return (
                <div className="limits-row" key={i}>
                  <span>{row.left}</span>
                  <span className="limits-right">{row.right}</span>
                </div>
              );
            })}
          </div>

          <div className="opp-box">
            <div className="opp-head">
              OPPORTUNITY LEADERBOARDS — SINCE {adv.opportunities.since === '' ? '—' : formatDateCaps(adv.opportunities.since)}
              <span className="opp-toggle">
                <button className={`opp-chip${sort === 'COUNT' ? ' active' : ''}`} onClick={() => setSort('COUNT')}>
                  COUNT
                </button>
                <button className={`opp-chip${sort === 'EDGE' ? ' active' : ''}`} onClick={() => setSort('EDGE')}>
                  MARGIN / EDGE
                </button>
              </span>
            </div>
            <div className="opp-grid">
              <OppColumn title="ARB" metric="AVG MARGIN" rows={adv.opportunities.arb} sort={sort} open={oppOpen} />
              <OppColumn title="EV" metric="AVG EDGE" rows={adv.opportunities.ev} sort={sort} open={oppOpen} />
              <OppColumn title="MIDDLES" metric="AVG EDGE" rows={adv.opportunities.middles} sort={sort} open={oppOpen} />
            </div>
            <button className="see-all" onClick={() => setOppOpen((v) => !v)}>{oppToggle(oppOpen)}</button>
          </div>
        </>
      )}
      <button className={`cta cta-blue${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        ADVANCED ANALYTICS
      </button>
      <div className="cta-caption">BOOKS THAT LIMITED YOU — LOGGED AND SENT TO THE MODEL</div>
    </>
  );
}
