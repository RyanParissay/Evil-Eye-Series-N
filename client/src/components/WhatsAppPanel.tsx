/**
 * "Connect WhatsApp" — link a phone number and get alerted when a scan finds
 * an arb at or above your threshold. Three faces: a connect form, the
 * 6-digit confirmation step, and the connected controls (threshold, test,
 * disconnect). The server is the source of truth; every action returns the
 * fresh WhatsAppStatus and this component just renders it.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { WhatsAppStatus } from '../../../shared/types';
import {
  ApiError,
  fetchWhatsAppStatus,
  whatsappConnect,
  whatsappDisconnect,
  whatsappSendTest,
  whatsappSetEv,
  whatsappSetMiddles,
  whatsappSetThreshold,
  whatsappVerify,
} from '../api';

export function WhatsAppPanel() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const [phone, setPhone] = useState('');
  const [threshold, setThreshold] = useState('2');
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchWhatsAppStatus()
      .then(setStatus)
      .catch(() => setUnreachable(true));
  }, []);

  // Keep the threshold input honest with the server's value (page load with
  // an existing subscription, threshold saved elsewhere). While typing,
  // the server value doesn't change, so this never clobbers edits.
  const serverThreshold = status?.thresholdPercent;
  useEffect(() => {
    if (serverThreshold != null) setThreshold(String(serverThreshold));
  }, [serverThreshold]);

  // Wraps every action: one in-flight call at a time, errors land in the
  // shared error line, success replaces the whole status.
  async function run(action: () => Promise<WhatsAppStatus>, successNotice?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await action());
      if (successNotice) setNotice(successNotice);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something unexpected broke.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleConnect(event: FormEvent) {
    event.preventDefault();
    const thresholdPercent = Number(threshold);
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
      setError('Threshold must be a number from 0 to 100.');
      return;
    }
    void run(
      () => whatsappConnect(phone, thresholdPercent),
      'Code sent — check your WhatsApp.',
    );
  }

  function handleVerify(event: FormEvent) {
    event.preventDefault();
    void run(() => whatsappVerify(code), 'Connected. Alerts are on.').then((ok) => {
      if (ok) setCode('');
    });
  }

  function handleThresholdSave(event: FormEvent) {
    event.preventDefault();
    const thresholdPercent = Number(threshold);
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
      setError('Threshold must be a number from 0 to 100.');
      return;
    }
    void run(() => whatsappSetThreshold(thresholdPercent), 'Threshold updated.');
  }

  if (unreachable || !status) {
    return null; // no server, no panel — the scan UI already shows the error
  }

  const phase = status.connected ? 'connected' : status.pendingVerification ? 'code' : 'form';

  return (
    <section className="wa-panel" aria-label="WhatsApp alerts">
      <div className="wa-head">
        <span className="micro-label">WhatsApp alerts</span>
        {status.devMode && (
          <span className="chip chip-mock" title="Messages are logged to the server console instead of sent. Set the TWILIO_* variables in .env to send for real.">
            Dev mode
          </span>
        )}
        {phase === 'connected' &&
          (status.active ? (
            <span className="chip chip-live">Active</span>
          ) : (
            <span className="chip chip-warn">Paused</span>
          ))}
      </div>

      {phase === 'form' && (
        <form className="wa-row" onSubmit={handleConnect}>
          <label className="wa-field">
            <span className="micro-label">Phone (with country code)</span>
            <input
              type="tel"
              className="wa-input"
              placeholder="+1 416 555 1234"
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              required
            />
          </label>
          <label className="wa-field wa-field-narrow">
            <span className="micro-label">Min return %</span>
            <input
              type="number"
              className="wa-input"
              min={0}
              max={100}
              step={0.1}
              value={threshold}
              onChange={(e) => setThreshold(e.currentTarget.value)}
              required
            />
          </label>
          <button type="submit" className="wa-button" disabled={busy}>
            {busy ? 'Sending…' : 'Connect'}
          </button>
        </form>
      )}

      {phase === 'code' && (
        <form className="wa-row" onSubmit={handleVerify}>
          <label className="wa-field wa-field-narrow">
            <span className="micro-label">Code sent to {status.phoneMasked}</span>
            <input
              type="text"
              inputMode="numeric"
              className="wa-input wa-input-code"
              placeholder="000000"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              required
              autoFocus
            />
          </label>
          <button type="submit" className="wa-button" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button
            type="button"
            className="wa-button wa-button-quiet"
            disabled={busy}
            onClick={() => void run(() => whatsappDisconnect())}
          >
            Cancel
          </button>
        </form>
      )}

      {phase === 'connected' && (
        <div className="wa-row">
          <div className="wa-field">
            <span className="micro-label">Number</span>
            <span className="wa-value">{status.phoneMasked}</span>
          </div>
          <div className="wa-field wa-field-narrow">
            <span className="micro-label" id="wa-middle-label">
              Middle alerts <span className="risk-badge wa-ev-badge">costs on miss</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={status.middleEnabled}
              aria-labelledby="wa-middle-label"
              className="switch"
              disabled={busy}
              onClick={() =>
                void run(
                  () => whatsappSetMiddles(!status.middleEnabled),
                  status.middleEnabled
                    ? 'Middle alerts off (free middles still alert).'
                    : 'Middle alerts on — they cost money when they miss.',
                )
              }
            >
              <span className="switch-thumb" aria-hidden="true" />
            </button>
          </div>
          <div className="wa-field wa-field-narrow">
            <span className="micro-label" id="wa-ev-label">
              EV alerts <span className="risk-badge wa-ev-badge">not guaranteed</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={status.evEnabled}
              aria-labelledby="wa-ev-label"
              className="switch"
              disabled={busy}
              onClick={() =>
                void run(
                  () => whatsappSetEv(!status.evEnabled),
                  status.evEnabled ? 'EV alerts off.' : 'EV alerts on — expect losing bets too.',
                )
              }
            >
              <span className="switch-thumb" aria-hidden="true" />
            </button>
          </div>
          <form className="wa-field wa-field-narrow" onSubmit={handleThresholdSave}>
            <label className="micro-label" htmlFor="wa-threshold">
              Min return %
            </label>
            <div className="wa-threshold-row">
              <input
                id="wa-threshold"
                type="number"
                className="wa-input"
                min={0}
                max={100}
                step={0.1}
                value={threshold}
                onChange={(e) => setThreshold(e.currentTarget.value)}
              />
              {Number(threshold) !== status.thresholdPercent && (
                <button type="submit" className="wa-button wa-button-quiet" disabled={busy}>
                  Save
                </button>
              )}
            </div>
          </form>
          <button
            type="button"
            className="wa-button wa-button-quiet"
            disabled={busy}
            onClick={() =>
              void run(
                () => whatsappSendTest(),
                status.devMode
                  ? 'Test message logged to the server console.'
                  : 'Test message sent.',
              )
            }
          >
            Send test
          </button>
          <button
            type="button"
            className="wa-button wa-button-quiet wa-button-danger"
            disabled={busy}
            onClick={() => void run(() => whatsappDisconnect())}
          >
            Disconnect
          </button>
        </div>
      )}

      {error && (
        <p className="wa-note wa-note-error" role="alert">
          {error}
        </p>
      )}
      {!error && notice && (
        <p className="wa-note" role="status">
          {notice}
        </p>
      )}
      {!error && !notice && phase === 'connected' && !status.active && (
        <p className="wa-note wa-note-error">
          Paused after repeated send failures — send a test message to re-enable.
        </p>
      )}
      {!error && !notice && phase === 'connected' && status.active && (
        <p className="wa-note">
          Alerts fire when a scan runs (button or auto update) and finds a return ≥{' '}
          {status.thresholdPercent}%.
        </p>
      )}
    </section>
  );
}
