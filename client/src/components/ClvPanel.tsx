import { useEffect, useState } from 'react';
import type { ClvCell, ClvSummary } from '../../../shared/types';
import { fetchClvSummary } from '../api';
import {
  barGeometry,
  formatBeatShare,
  formatCaptureLead,
  formatClvPct,
  formatPpDelta,
  gateGroups,
  gateScaleMax,
  isSmallN,
  topBooks,
  type GateGroup,
} from '../clv';

/**
 * Phase 18 — the CLV evidence section. Every number is server-computed
 * (GET /api/clv/summary, zero credits); this component only formats and
 * arranges. Reading order is the honesty order: coverage first (every figure
 * below is only as good as the capture), the alerted headline, the
 * gate-quality comparison, then which books' closes we beat.
 */
export function ClvPanel() {
  const [summary, setSummary] = useState<ClvSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchClvSummary()
      .then((s) => !cancelled && setSummary(s))
      .catch(() => {
        // Evidence panels never block the ledger — no summary, no section.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  const { coverage } = summary;

  return (
    <section className="clv" aria-label="Closing line value">
      <h2 className="ledger-section micro-label">Closing line value — are the edges real?</h2>

      {coverage.recordsWithClosing === 0 ? (
        <p className="micro-label">
          Closing lines start freezing with tonight's games — every scan quietly captures them.
        </p>
      ) : (
        <>
          <p className="evidence-stat">
            <strong>
              {coverage.recordsWithClosing} of {coverage.recordsTotal}
            </strong>{' '}
            <span className="micro-label">
              records carry a closing line ·{' '}
              {coverage.medianCaptureMins == null
                ? 'median capture — first freeze pending'
                : `median capture ${formatCaptureLead(coverage.medianCaptureMins)} before start`}
            </span>
          </p>

          <HeadlineTiles summary={summary} />

          <div className="clv-columns">
            <GateUnit signal={summary.signal} />
            <BookTable byBook={summary.byBook} />
          </div>
        </>
      )}
    </section>
  );
}

const STRATEGY_LABEL: Record<string, string> = { arb: 'arb', ev: 'ev', middle: 'middle' };
const GATE_LABEL: Record<string, string> = {
  alerted: 'alerted',
  filtered: 'safety-filtered',
  single_sighting: 'single sighting',
};

function upDown(v: number | null): string {
  if (v == null) return '';
  return v >= 0 ? 'is-up' : 'is-down';
}

function smallNChip() {
  return <span className="chip chip-mock">n&lt;10</span>;
}

/**
 * The headline: signal CLV of ALERTED records, one tile per strategy. Where
 * the de-vigged benchmark exists, "vs sharp close" is the authoritative big
 * number and the own-book raw figure drops to a secondary line. Execution
 * (fills-basis) CLV appends as a final line where completed fills exist.
 */
function HeadlineTiles({ summary }: { summary: ClvSummary }) {
  const alerted = summary.signal.filter((s) => s.gateOutcome === 'alerted');
  const execFor = (strategy: string) =>
    summary.execution.find((e) => e.strategy === strategy)?.cell ?? null;
  // Strategies with fills but no alerted cell still get their execution shown.
  const execOnly = summary.execution.filter(
    (e) => !alerted.some((a) => a.strategy === e.strategy),
  );

  if (alerted.length === 0 && execOnly.length === 0) {
    return (
      <p className="micro-label">
        No alerted records have a frozen close yet — the headline appears with the first one.
      </p>
    );
  }

  return (
    <div className="clv-heads">
      {alerted.map(({ strategy, cell }) => {
        const primary = cell.trueClv
          ? { mean: cell.trueClv.meanPct, beat: cell.trueClv.beatPct, n: cell.trueClv.records }
          : { mean: cell.meanClvPct, beat: cell.beatClosePct, n: cell.records };
        const small = isSmallN(primary.n);
        const exec = execFor(strategy);
        return (
          <div key={strategy} className={`ledger-stat${small ? ' clv-small-n' : ''}`}>
            <span className="micro-label">
              {STRATEGY_LABEL[strategy] ?? strategy} · alerted ·{' '}
              {cell.trueClv ? 'vs sharp close' : 'vs own-book close'}
            </span>
            <strong className={upDown(primary.mean)}>{formatClvPct(primary.mean)}</strong>
            <span className="micro-label">
              {formatBeatShare(primary.beat)} beat the close · n {primary.n}{' '}
              {small && smallNChip()}
            </span>
            {cell.trueClv && (
              <span className="micro-label">
                own-book raw {formatClvPct(cell.meanClvPct)} ·{' '}
                {formatBeatShare(cell.beatClosePct)} beat · n {cell.records}
              </span>
            )}
            {exec && (
              <span className="micro-label">
                fills {formatClvPct(exec.meanClvPct)} · {formatBeatShare(exec.beatClosePct)} beat
                · n {exec.records} {isSmallN(exec.records) && smallNChip()}
              </span>
            )}
          </div>
        );
      })}
      {execOnly.map(({ strategy, cell }) => (
        <div
          key={`exec-${strategy}`}
          className={`ledger-stat${isSmallN(cell.records) ? ' clv-small-n' : ''}`}
        >
          <span className="micro-label">
            {STRATEGY_LABEL[strategy] ?? strategy} · fills · vs own-book close
          </span>
          <strong className={upDown(cell.meanClvPct)}>{formatClvPct(cell.meanClvPct)}</strong>
          <span className="micro-label">
            {formatBeatShare(cell.beatClosePct)} beat the close · n {cell.records}{' '}
            {isSmallN(cell.records) && smallNChip()}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The gate-quality unit: every strategy's alerted / safety-filtered /
 * single-sighting cells on ONE shared diverging scale (zero mid-track,
 * positive CLV runs right in the money color, negative left in grey), with
 * the alerted margin spelled out per strategy. A challenger cell whose mean
 * matches or beats alerted at n≥10 is flagged — the gates may be discarding
 * value, and that must be legible without reading every number.
 */
function GateUnit({ signal }: { signal: ClvSummary['signal'] }) {
  const groups = gateGroups(signal);
  if (groups.length === 0) return null;
  const scale = gateScaleMax(groups);

  return (
    <section className="clv-gates" aria-label="Gate quality — signal CLV by gate outcome">
      <h3 className="micro-label clv-subhead">Gate quality — do the gates keep the right bets?</h3>
      {groups.map((group) => (
        <div key={group.strategy} className="clv-gate-group">
          <p className="micro-label clv-gate-strategy">{STRATEGY_LABEL[group.strategy] ?? group.strategy}</p>
          {group.rows.map((row) => {
            const geo = barGeometry(row.cell.meanClvPct, scale);
            const small = isSmallN(row.cell.records);
            return (
              <div
                key={row.gateOutcome}
                className={`clv-gate-row${small ? ' clv-small-n' : ''}`}
              >
                <span className="clv-gate-label micro-label">{GATE_LABEL[row.gateOutcome]}</span>
                <span className="clv-track" aria-hidden="true">
                  <span className="clv-zero" />
                  {geo && (
                    <span
                      className={`clv-bar clv-bar-${geo.side}`}
                      style={{ width: `${geo.pct}%` }}
                    />
                  )}
                </span>
                <span className="clv-gate-figs">
                  <strong className={upDown(row.cell.meanClvPct)}>
                    {formatClvPct(row.cell.meanClvPct)}
                  </strong>
                  <span className="micro-label">
                    {formatBeatShare(row.cell.beatClosePct)} beat · n {row.cell.records}
                  </span>
                  {small && smallNChip()}
                  {row.beatsAlerted && <span className="chip chip-warn">≥ alerted</span>}
                </span>
              </div>
            );
          })}
          <MarginLine group={group} />
        </div>
      ))}
    </section>
  );
}

function MarginLine({ group }: { group: GateGroup }) {
  if (group.margins.length === 0) return null;
  const anyTrailing = group.margins.some((m) => m.pp <= 0);
  return (
    <p className={`micro-label clv-gate-margin${anyTrailing ? ' ledger-note' : ''}`}>
      alerted{' '}
      {group.margins
        .map((m) => `${formatPpDelta(m.pp)} vs ${GATE_LABEL[m.vs]}`)
        .join(' · ')}
      {anyTrailing && ' — the gate may be discarding value'}
    </p>
  );
}

/** Which books' closing prices the signal consistently beat — leg-counted. */
function BookTable({ byBook }: { byBook: ClvSummary['byBook'] }) {
  if (byBook.length === 0) return null;
  return (
    <section aria-label="CLV by book">
      <h3 className="micro-label clv-subhead">By book — whose close you beat</h3>
      <div className="clv-table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Book</th>
              <th>CLV</th>
              <th>Beat</th>
              <th>Sharp</th>
              <th>Legs</th>
            </tr>
          </thead>
          <tbody>
            {topBooks(byBook).map((b) => {
              const small = isSmallN(b.cell.records);
              return (
                <tr key={b.bookmakerKey} className={small ? 'clv-small-n' : ''}>
                  <td>
                    {b.title} {small && smallNChip()}
                  </td>
                  <td className="num">
                    <strong className={upDown(b.cell.meanClvPct)}>
                      {formatClvPct(b.cell.meanClvPct)}
                    </strong>
                  </td>
                  <td className="num">{formatBeatShare(b.cell.beatClosePct)}</td>
                  <td className="num">{trueMean(b.cell)}</td>
                  <td className="num">{b.cell.records}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="micro-label">
        signal legs vs each book's own close · sharp = vs de-vigged benchmark close
      </p>
    </section>
  );
}

function trueMean(cell: ClvCell): string {
  return cell.trueClv ? formatClvPct(cell.trueClv.meanPct) : '—';
}
