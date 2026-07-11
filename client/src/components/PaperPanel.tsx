import { useEffect, useState } from 'react';
import type { LedgerSummary, PaperView } from '../../../shared/types';
import { ApiError, fetchPaper, patchPaperSettings, resetPaper } from '../api';
import { EquityChart } from './EquityChart';

/**
 * The shadow fund: what acting on 100% of alert-worthy opportunities
 * would have earned. Everything in this panel is SIMULATED and says so.
 */
export function PaperPanel({ realMonthly }: { realMonthly: LedgerSummary['monthly'] }) {
  const [view, setView] = useState<PaperView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPaper()
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Paper fund unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply(patch: Parameters<typeof patchPaperSettings>[0]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setView(await patchPaperSettings(patch));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update paper settings.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!window.confirm('Reset the paper fund? All simulated entries are deleted.')) return;
    setBusy(true);
    try {
      setView(await resetPaper());
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <section className="paper">
        <h2 className="ledger-section micro-label">
          Paper fund <span className="paper-badge">simulated</span>
        </h2>
        <p className="micro-label">{error ?? 'Loading…'}</p>
      </section>
    );
  }

  const { settings, book } = view;
  const monthlyMerged = mergeMonths(book.monthly, realMonthly);

  return (
    <section className="paper" aria-label="Paper fund (simulated)">
      <h2 className="ledger-section micro-label">
        Paper fund <span className="paper-badge">simulated</span>
      </h2>

      <div className="paper-controls">
        <button
          type="button"
          className={`paper-toggle${settings.enabled ? ' is-on' : ''}`}
          role="switch"
          aria-checked={settings.enabled}
          disabled={busy}
          onClick={() => void apply({ enabled: !settings.enabled })}
        >
          {settings.enabled ? 'Paper mode ON' : 'Paper mode OFF'}
        </button>
        <label className="micro-label">
          start $
          <input
            type="number"
            min={100}
            step={100}
            defaultValue={settings.startingBankroll}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v > 0 && v !== settings.startingBankroll) {
                void apply({ startingBankroll: v });
              }
            }}
          />
        </label>
        <label className="micro-label">
          stake
          <select
            defaultValue={settings.stakeRule.kind}
            onChange={(e) =>
              void apply({
                stakeRule: {
                  kind: e.target.value as 'flat' | 'percent',
                  value: settings.stakeRule.value,
                },
              })
            }
          >
            <option value="flat">flat $</option>
            <option value="percent">% of fund</option>
          </select>
        </label>
        <label className="micro-label">
          {settings.stakeRule.kind === 'flat' ? 'stake $' : 'stake %'}
          <input
            type="number"
            min={1}
            step={settings.stakeRule.kind === 'flat' ? 50 : 1}
            defaultValue={settings.stakeRule.value}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v > 0 && v !== settings.stakeRule.value) {
                void apply({ stakeRule: { kind: settings.stakeRule.kind, value: v } });
              }
            }}
          />
        </label>
        <label className="micro-label">
          haircut
          <select
            value={settings.haircutSource}
            onChange={(e) =>
              void apply({ haircutSource: e.target.value as 'manual' | 'measured' })
            }
          >
            <option value="manual">assumed %</option>
            <option value="measured">measured</option>
          </select>
        </label>
        {settings.haircutSource === 'manual' && (
          <label className="micro-label">
            haircut %
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={settings.haircutPercent}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== settings.haircutPercent) {
                  void apply({ haircutPercent: v });
                }
              }}
            />
          </label>
        )}
        <label className="micro-label">
          entry ≥ %
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={settings.thresholdPercent}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== settings.thresholdPercent) {
                void apply({ thresholdPercent: v });
              }
            }}
          />
        </label>
        <button type="button" className="paper-reset micro-label" onClick={() => void handleReset()}>
          reset fund
        </button>
      </div>

      {!settings.enabled && book.entries.length === 0 ? (
        <p className="micro-label paper-off-note">
          Off. Flip it on and every alert-worthy opportunity from future scans enters the
          simulated book at alert-time odds.
        </p>
      ) : (
        <>
          <div className="paper-stats">
            <div className="ledger-stat">
              <span className="micro-label">simulated fund — ideal</span>
              <strong className="is-up">${book.bankrollIdeal.toFixed(2)}</strong>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">
                with {view.haircut.pct}% haircut ·{' '}
                {view.haircut.source === 'measured' ? 'MEASURED' : 'ASSUMED'}
              </span>
              <strong>${book.bankrollHaircut.toFixed(2)}</strong>
              <span className="micro-label">{view.haircut.detail}</span>
            </div>
            <div className="ledger-stat">
              <span className="micro-label">entries / open stake</span>
              <strong>{book.entries.length}</strong>
              <span className="micro-label">${book.openStake.toFixed(2)} awaiting kickoff</span>
            </div>
          </div>

          {book.entries.some((e) => e.floor) && (
            <p className="micro-label ledger-note">
              {book.entries.filter((e) => e.floor).length} middle entr
              {book.entries.filter((e) => e.floor).length === 1 ? 'y' : 'ies'} at worst-case
              FLOOR — the fund understates them until the same bet is graded for real.
            </p>
          )}

          <EquityChart
            points={book.equityIdeal}
            secondary={book.equityHaircut}
            labels={{ primary: 'ideal 100% (simulated)', secondary: 'haircut (simulated)' }}
            emptyText="Nothing settled yet — simulated profit realizes when each event kicks off."
          />

          <table className="ledger-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Ideal (sim)</th>
                <th>Haircut (sim)</th>
                <th>Real</th>
              </tr>
            </thead>
            <tbody>
              {monthlyMerged.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.ideal == null ? '—' : money(m.ideal)}</td>
                  <td className="num">{m.haircut == null ? '—' : money(m.haircut)}</td>
                  <td className="num">{m.real == null ? '—' : money(m.real)}</td>
                </tr>
              ))}
              {monthlyMerged.length === 0 && (
                <tr>
                  <td colSpan={4} className="ledger-empty micro-label">
                    nothing settled yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      {error && <p className="micro-label paper-error">{error}</p>}
    </section>
  );
}

function mergeMonths(
  paper: Array<{ month: string; ideal: number; haircut: number }>,
  real: LedgerSummary['monthly'],
): Array<{ month: string; ideal: number | null; haircut: number | null; real: number | null }> {
  const months = new Map<
    string,
    { ideal: number | null; haircut: number | null; real: number | null }
  >();
  for (const p of paper) months.set(p.month, { ideal: p.ideal, haircut: p.haircut, real: null });
  for (const r of real) {
    const row = months.get(r.month) ?? { ideal: null, haircut: null, real: null };
    row.real = r.lockedProfit;
    months.set(r.month, row);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, row]) => ({ month, ...row }));
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
