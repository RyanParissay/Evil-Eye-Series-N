import { useEffect, useState } from 'react';
import type { FundPosition } from '../../../shared/types';
import { ApiError, fetchFundPosition, patchFundSettings } from '../api';

/**
 * The fund's position at a glance: float across books, unallocated cash,
 * realized P&L, the paper fund alongside (SIMULATED), and the two safety
 * nudges. All manual-entry — this app never touches bookmaker accounts.
 */
export function FundPanel({ refreshKey }: { refreshKey?: number | null }) {
  const [position, setPosition] = useState<FundPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFundPosition()
      .then((p) => {
        if (!cancelled) setPosition(p);
      })
      .catch(() => {
        // Panel is informational — the scan UI reports connectivity issues.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function apply(field: 'totalBankroll' | 'defaultStake' | 'unallocatedCash', value: number) {
    if (busy || !position || value === position.settings[field]) return;
    if (!Number.isFinite(value) || value < 0) return;
    setBusy(true);
    setError(null);
    try {
      setPosition(await patchFundSettings({ [field]: value }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update fund settings.');
    } finally {
      setBusy(false);
    }
  }

  if (!position) return null;

  const { settings, warnings } = position;

  return (
    <section className="fund" aria-label="Fund position">
      <header className="fund-head">
        <h2 className="micro-label">Fund position</h2>
        {warnings.lowBalance.map((key) => (
          <span key={`low-${key}`} className="chip chip-warn" title="Balance below the default stake">
            ⚠ {key} low
          </span>
        ))}
        {warnings.staleBalance.map((key) => (
          <span
            key={`stale-${key}`}
            className="chip chip-warn"
            title="Balance untouched for 14+ days — still accurate?"
          >
            ⚠ {key} stale
          </span>
        ))}
      </header>

      <div className="fund-row">
        <div className="fund-stat">
          <span className="micro-label">float at books</span>
          <strong>${position.totalFloat.toFixed(2)}</strong>
        </div>
        <div className="fund-stat">
          <span className="micro-label">real p&l</span>
          <strong className={position.realProfit >= 0 ? 'is-up' : 'is-down'}>
            {position.realProfit >= 0 ? '+' : '−'}${Math.abs(position.realProfit).toFixed(2)}
          </strong>
        </div>
        {position.paper && (
          <div className="fund-stat">
            <span className="micro-label">paper fund · simulated</span>
            <strong>${position.paper.bankrollIdeal.toFixed(2)}</strong>
            <span className="micro-label">
              ${position.paper.bankrollHaircut.toFixed(2)} after haircut
            </span>
          </div>
        )}
        <label className="fund-field micro-label">
          total bankroll $
          <input
            type="number"
            min={0}
            step={100}
            defaultValue={settings.totalBankroll}
            onBlur={(e) => void apply('totalBankroll', e.target.valueAsNumber)}
          />
        </label>
        <label className="fund-field micro-label">
          default stake $
          <input
            type="number"
            min={0}
            step={50}
            defaultValue={settings.defaultStake}
            onBlur={(e) => void apply('defaultStake', e.target.valueAsNumber)}
          />
        </label>
        <label className="fund-field micro-label">
          unallocated $
          <input
            type="number"
            min={0}
            step={100}
            defaultValue={settings.unallocatedCash}
            onBlur={(e) => void apply('unallocatedCash', e.target.valueAsNumber)}
          />
        </label>
      </div>
      {error && <p className="micro-label fund-error">{error}</p>}
    </section>
  );
}
