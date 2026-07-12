/**
 * Safety Score settings (Phase 17, Advanced page): safeMode + threshold
 * gate WhatsApp alerts and Hub auto-purchases (the one passesSafetyGate
 * function, engine/safety.ts); everything else here tunes the deterministic
 * score itself. Every field PATCHes on change/blur and re-renders straight
 * from the server's response — no optimistic local math, the same pattern
 * FundPanel and BookmakerPanel already use.
 */
import { useEffect, useState } from 'react';
import type { SafetySettings } from '../../../shared/types';
import { ApiError, fetchSafetySettings, patchSafetySettings, type SafetySettingsPatch } from '../api';

export function SafetySettingsPanel() {
  const [settings, setSettings] = useState<SafetySettings | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBook, setNewBook] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchSafetySettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        // Advanced mode's other panels still work without this one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply(patch: SafetySettingsPatch) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await patchSafetySettings(patch));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update safety settings.');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;

  function addBook() {
    const key = newBook.trim().toLowerCase();
    if (!key || !settings || settings.neverLimitBooks.includes(key)) return;
    void apply({ neverLimitBooks: [...settings.neverLimitBooks, key] });
    setNewBook('');
  }

  function removeBook(key: string) {
    if (!settings) return;
    void apply({ neverLimitBooks: settings.neverLimitBooks.filter((b) => b !== key) });
  }

  return (
    <section className="bm-panel safety-panel" aria-label="Safety Score settings">
      <button type="button" className="bm-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="micro-label">Safety Score</span>
        <span className="bm-summary micro-label">
          {settings.safeMode ? `ON · gate ≥ ${settings.safetyThreshold}/100` : 'OFF · scoring only'}
        </span>
        <span className="bm-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="safety-panel-row">
          <button
            type="button"
            role="switch"
            aria-checked={settings.safeMode}
            aria-label="Safe mode"
            className="switch"
            disabled={busy}
            onClick={() => void apply({ safeMode: !settings.safeMode })}
          >
            <span className="switch-thumb" aria-hidden="true" />
          </button>
          <span className="micro-label">
            safe mode {settings.safeMode ? 'on' : 'off'} (default on)
          </span>
        </div>
      )}

      {open && (
        <p className="safety-panel-copy micro-label">
          Safe mode reduces the risk of a bookmaker limiting you — it does not eliminate that
          risk. When off, every opportunity still scores and persists; nothing is gated from
          WhatsApp alerts or Hub auto-purchases.
        </p>
      )}

      {open && (
        <div className="safety-panel-settings">
          <label className="safety-panel-slider">
            gate threshold (default 55)
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.safetyThreshold}
              disabled={busy}
              onChange={(e) => void apply({ safetyThreshold: e.target.valueAsNumber })}
              aria-valuetext={`${settings.safetyThreshold} of 100`}
            />
            <span className="safety-panel-slider-value">{settings.safetyThreshold}/100</span>
          </label>

          <label>
            max safe edge % (default 4.5)
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              defaultValue={settings.maxSafeEdge}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v > 0 && v !== settings.maxSafeEdge) {
                  void apply({ maxSafeEdge: v });
                }
              }}
            />
          </label>

          <label>
            round stakes to $ (default 5)
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              defaultValue={settings.roundTo}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v > 0 && v !== settings.roundTo) {
                  void apply({ roundTo: v });
                }
              }}
            />
          </label>

          <label>
            max arbs / day per book (default 3)
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={settings.budgets.maxArbsPerDay}
              onBlur={(e) => {
                const v = Math.round(e.target.valueAsNumber);
                if (Number.isFinite(v) && v > 0 && v !== settings.budgets.maxArbsPerDay) {
                  void apply({ budgets: { maxArbsPerDay: v } });
                }
              }}
            />
          </label>

          <label>
            max arbs / week per book (default 12)
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={settings.budgets.maxArbsPerWeek}
              onBlur={(e) => {
                const v = Math.round(e.target.valueAsNumber);
                if (Number.isFinite(v) && v > 0 && v !== settings.budgets.maxArbsPerWeek) {
                  void apply({ budgets: { maxArbsPerWeek: v } });
                }
              }}
            />
          </label>

          <label>
            hot-streak count (default 5)
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={settings.budgets.hotStreakCount}
              onBlur={(e) => {
                const v = Math.round(e.target.valueAsNumber);
                if (Number.isFinite(v) && v > 0 && v !== settings.budgets.hotStreakCount) {
                  void apply({ budgets: { hotStreakCount: v } });
                }
              }}
            />
          </label>

          <label>
            cooldown days (default 3)
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={settings.budgets.cooldownDays}
              onBlur={(e) => {
                const v = Math.round(e.target.valueAsNumber);
                if (Number.isFinite(v) && v > 0 && v !== settings.budgets.cooldownDays) {
                  void apply({ budgets: { cooldownDays: v } });
                }
              }}
            />
          </label>
        </div>
      )}

      {open && (
        <div className="safety-panel-books">
          <span className="micro-label">
            never-limit books (sharp/exchange — exempt from budgets and cooldowns; seed: Pinnacle
            + the betting exchanges)
          </span>
          <div className="safety-panel-book-list">
            {settings.neverLimitBooks.map((key) => (
              <span key={key} className="safety-panel-book-chip">
                {key}
                <button
                  type="button"
                  className="safety-panel-book-remove"
                  aria-label={`Remove ${key}`}
                  disabled={busy}
                  onClick={() => removeBook(key)}
                >
                  ×
                </button>
              </span>
            ))}
            {settings.neverLimitBooks.length === 0 && (
              <span className="micro-label">none — every book is subject to budgets</span>
            )}
          </div>
          <div className="safety-panel-book-add">
            <input
              type="text"
              className="wa-input"
              placeholder="bookmaker key (e.g. pinnacle)"
              value={newBook}
              onChange={(e) => setNewBook(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addBook();
                }
              }}
            />
            <button
              type="button"
              className="bm-toggle"
              disabled={busy || newBook.trim().length === 0}
              onClick={addBook}
            >
              <span className="micro-label">add</span>
            </button>
          </div>
        </div>
      )}

      {open && (
        <p className={`wa-note${error ? ' wa-note-error safety-panel-error' : ''}`}>
          {error ??
            'Filtered opportunities stay fully persisted with their score and reasons — the Hub’s Cost of Safety readout prices what the gate declines.'}
        </p>
      )}
    </section>
  );
}
