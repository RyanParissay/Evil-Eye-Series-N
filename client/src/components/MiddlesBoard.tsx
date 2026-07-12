import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SafetySettings } from '../../../shared/types';
import { ApiError, fetchMiddlesBoard, patchMiddlesSettings, type MiddlesBoard as Board } from '../api';
import { SafetyBadge } from './SafetyBadge';

/**
 * The MIDDLES segment of Risk Mode: two opposite bets on different lines,
 * gapped so both can win. Costs money when it misses — the breakeven
 * column is a fact; the hit chance is your judgment.
 */
export function MiddlesBoard({
  safetySettings = null,
}: {
  safetySettings?: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'> | null;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setBoard(await fetchMiddlesBoard());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Middles board unavailable.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function apply(patch: Parameters<typeof patchMiddlesSettings>[0]) {
    if (busy) return;
    setBusy(true);
    try {
      await patchMiddlesSettings(patch);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="micro-label risk-note">{error}</p>;
  if (!board) return <p className="micro-label risk-note">Loading…</p>;

  return (
    <>
      <section className="risk-controls micro-label">
        <label>
          max cost %
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            defaultValue={board.settings.maxCostPct}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v >= 0 && v !== board.settings.maxCostPct) {
                void apply({ maxCostPct: v });
              }
            }}
          />
        </label>
        <label>
          min window
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            defaultValue={board.settings.minWindow}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v >= 0 && v !== board.settings.minWindow) {
                void apply({ minWindow: v });
              }
            }}
          />
        </label>
        <label>
          alert breakeven ≤ %
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            defaultValue={board.settings.alertMaxBreakevenPct}
            onBlur={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v >= 0 && v !== board.settings.alertMaxBreakevenPct) {
                void apply({ alertMaxBreakevenPct: v });
              }
            }}
          />
        </label>
        <span className="risk-note">
          middles need the totals/spreads markets ON (scanner → windows & budget) — cost $ shown
          at the ${board.defaultStake.toFixed(0)} fund default
        </span>
      </section>

      {board.bets.length === 0 ? (
        <div className="state-block">
          <p className="state-title">No live middles.</p>
          <p className="state-detail">
            Middles appear when scans carry the totals or spreads markets and two books disagree
            on the line by enough. Flip the market toggles in the scanner's windows & budget
            panel — each enabled market multiplies scan credits.
          </p>
        </div>
      ) : (
        <>
          <div className="results-head micro-label">
            {board.bets.length} live middle{board.bets.length === 1 ? '' : 's'} · sorted by
            breakeven · costs money when it misses
          </div>
          <div className="risk-table-wrap">
            <table className="ledger-table risk-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Legs</th>
                  <th>Window</th>
                  <th>Cost</th>
                  <th>Pays</th>
                  <th>Breakeven</th>
                  <th></th>
                  <th>Safety</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {board.bets.map((bet) => {
                  const middle = bet.middle!;
                  return (
                    <tr key={bet.id}>
                      <td>
                        <span className="micro-label">{bet.sportTitle} · {bet.marketKey}</span>
                        <br />
                        {bet.eventName}
                      </td>
                      <td>
                        {bet.legs.map((leg) => (
                          <div key={`${leg.bookmakerKey}-${leg.outcome}-${leg.point}`}>
                            {leg.outcome} {leg.point != null && (leg.point > 0 ? `+${leg.point}` : leg.point)}{' '}
                            @{leg.odds} <span className="micro-label">{leg.bookmakerTitle}</span>
                          </div>
                        ))}
                      </td>
                      <td className="num">
                        {middle.lowLine}–{middle.highLine}
                        <span className="micro-label"> ({middle.windowSize})</span>
                      </td>
                      <td className="num">
                        {middle.freeMiddle
                          ? `+$${((board.defaultStake * -middle.costPct) / 100).toFixed(2)}`
                          : `−$${((board.defaultStake * middle.costPct) / 100).toFixed(2)}`}
                      </td>
                      <td className="num">
                        +${((board.defaultStake * middle.payoutPct) / 100).toFixed(2)}
                      </td>
                      <td className="num risk-edge">
                        {middle.freeMiddle ? 'FREE' : `${middle.breakevenPct.toFixed(1)}%`}
                      </td>
                      <td>
                        {middle.freeMiddle && <span className="chip risk-badge">free</span>}
                        {middle.keyNumbers.length > 0 && (
                          <span className="chip risk-badge" title="Key number inside the window">
                            key {middle.keyNumbers.join(',')}
                          </span>
                        )}
                        {middle.pushPossible && (
                          <span className="chip bm-benchmark-chip" title="A whole-number line can push (stake returned)">
                            push
                          </span>
                        )}
                        {bet.sameBookmaker && <span className="chip chip-warn">⚠ same book</span>}
                      </td>
                      <td>
                        <SafetyBadge safety={bet.safety} settings={safetySettings} compact />
                      </td>
                      <td>
                        <Link className="card-cockpit-link micro-label" to={`/opportunity/${bet.id}`}>
                          Cockpit →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
