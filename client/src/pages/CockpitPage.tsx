import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApiErrorCode, OpportunityRecord } from '../../../shared/types';
import {
  ApiError,
  completeOpportunity,
  fetchOpportunity,
  verifyOpportunity,
} from '../api';
import { loadBankroll, saveBankroll, scaleLegStakes } from '../cockpit';
import { EyeGlyph } from '../components/EyeGlyph';
import { errorHint, errorTitle } from '../errorCopy';

type PageState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; code: ApiErrorCode; message: string }
  | { status: 'ready'; record: OpportunityRecord };

/** Outcome banner for the last re-verify, shown until the next action. */
type VerifyNote =
  | { kind: 'ok'; recordStatus: OpportunityRecord['status']; creditsCharged: number }
  | { kind: 'error'; code: ApiErrorCode; message: string };

/**
 * The execution cockpit: one opportunity, opened from a WhatsApp deep link
 * (or a scan card), on a phone, with money on the line. Confirm the edge
 * still exists, open the books, mark it done.
 */
export function CockpitPage() {
  const { id = '' } = useParams();
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [bankroll, setBankroll] = useState(() => loadBankroll(window.localStorage));
  const [busy, setBusy] = useState<'verify' | 'complete' | null>(null);
  const [note, setNote] = useState<VerifyNote | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPage({ status: 'loading' });
    fetchOpportunity(id)
      .then((record) => {
        if (!cancelled) setPage({ status: 'ready', record });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'not_found') {
          setPage({ status: 'missing' });
        } else {
          const isApi = err instanceof ApiError;
          setPage({
            status: 'error',
            code: isApi ? err.code : 'internal',
            message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function updateBankroll(next: number) {
    setBankroll(next);
    if (Number.isFinite(next) && next > 0) saveBankroll(window.localStorage, next);
  }

  async function handleVerify() {
    if (busy || page.status !== 'ready') return;
    setBusy('verify');
    setNote(null);
    try {
      const { record, creditsCharged } = await verifyOpportunity(id);
      setPage({ status: 'ready', record });
      setNote({ kind: 'ok', recordStatus: record.status, creditsCharged });
    } catch (err) {
      const isApi = err instanceof ApiError;
      setNote({
        kind: 'error',
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (busy || page.status !== 'ready') return;
    setBusy('complete');
    setNote(null);
    try {
      const record = await completeOpportunity(id);
      setPage({ status: 'ready', record });
    } catch (err) {
      const isApi = err instanceof ApiError;
      setNote({
        kind: 'error',
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cockpit">
      <header className="cockpit-masthead">
        <Link to="/" className="cockpit-back micro-label">
          ← Scanner
        </Link>
        <EyeGlyph size={28} state={busy === 'verify' ? 'scanning' : 'open'} />
      </header>

      {page.status === 'loading' && (
        <div className="state-block" role="status">
          <p className="state-title">Pulling the record…</p>
        </div>
      )}

      {page.status === 'missing' && (
        <div className="state-block" role="alert">
          <EyeGlyph size={64} state="closed" />
          <p className="state-title">Nothing on file.</p>
          <p className="state-detail">
            This opportunity isn't in the active records — it may have aged into the archive.
            Run a fresh scan to see what's live now.
          </p>
          <Link to="/" className="cockpit-ghost-link">
            Back to the scanner
          </Link>
        </div>
      )}

      {page.status === 'error' && (
        <div className="state-block state-error" role="alert">
          <p className="state-title">{errorTitle(page.code)}</p>
          <p className="state-detail">{page.message}</p>
          <p className="state-detail">{errorHint(page.code)}</p>
        </div>
      )}

      {page.status === 'ready' && (
        <Cockpit
          record={page.record}
          bankroll={bankroll}
          onBankroll={updateBankroll}
          busy={busy}
          note={note}
          onVerify={() => void handleVerify()}
          onComplete={() => void handleComplete()}
        />
      )}
    </div>
  );
}

function Cockpit({
  record,
  bankroll,
  onBankroll,
  busy,
  note,
  onVerify,
  onComplete,
}: {
  record: OpportunityRecord;
  bankroll: number;
  onBankroll: (next: number) => void;
  busy: 'verify' | 'complete' | null;
  note: VerifyNote | null;
  onVerify: () => void;
  onComplete: () => void;
}) {
  const settled = record.status === 'dead' || record.status === 'completed';
  const { stakes, totalStaked, guaranteedProfit } = scaleLegStakes(record.legs, bankroll);
  const reduced = record.profitPct < record.profitPctAtDetection;

  return (
    <main className={`cockpit-body cockpit-${record.status}`}>
      <section className="cockpit-event">
        <p className="micro-label">
          {record.sportTitle} · {record.marketKey} · {formatKickoff(record.commenceTime)}
        </p>
        <h1 className="cockpit-title">{record.eventName}</h1>
        <p className="cockpit-status micro-label">
          <span className={`cockpit-status-word cockpit-status-${record.status}`}>
            {record.status}
          </span>
          {' · '}last seen {relativeTime(record.lastSeenAt)}
          {record.alerted && ' · alerted'}
          {(record.suspicious || record.sameBookmaker) && (
            <span className="chip chip-warn cockpit-flag">
              ⚠ {record.sameBookmaker ? 'same book' : 'too good — verify'}
            </span>
          )}
        </p>
      </section>

      <section className="cockpit-profit-block" aria-live="polite">
        <span className={`cockpit-profit${record.status === 'dead' ? ' is-dead' : ''}`}>
          {record.profitPct >= 0 ? '+' : ''}
          {record.profitPct.toFixed(2)}%
        </span>
        <span className="micro-label">
          {reduced ? (
            <>
              <s>+{record.profitPctAtDetection.toFixed(2)}%</s> at detection · index{' '}
              {record.arbIndex.toFixed(4)}
            </>
          ) : (
            <>index {record.arbIndex.toFixed(4)}</>
          )}
        </span>
      </section>

      {record.status === 'completed' && (
        <div className="cockpit-stamp" role="status">
          <span className="cockpit-stamp-title">Completed</span>
          <span>Legs placed {relativeTime(record.statusChangedAt)}. This record is history.</span>
        </div>
      )}

      {record.status === 'dead' && (
        <div className="cockpit-dead-note" role="status">
          The edge is gone — prices moved or the event started. Numbers below are the last seen.
        </div>
      )}

      <section className="cockpit-bankroll">
        <label className="micro-label" htmlFor="bankroll">
          Total stake
        </label>
        <div className="cockpit-bankroll-row">
          <span className="cockpit-bankroll-currency">$</span>
          <input
            id="bankroll"
            type="number"
            min={1}
            step={10}
            inputMode="decimal"
            value={Number.isFinite(bankroll) ? bankroll : ''}
            onChange={(e) => onBankroll(e.target.valueAsNumber)}
          />
          <span className="cockpit-guaranteed">
            <span className="micro-label">guaranteed</span>
            <strong className={guaranteedProfit >= 0 ? '' : 'is-negative'}>
              {guaranteedProfit >= 0 ? '+' : '−'}${Math.abs(guaranteedProfit).toFixed(2)}
            </strong>
          </span>
        </div>
        <p className="micro-label">
          split of ${totalStaked.toFixed(2)} across {record.legs.length} legs
        </p>
      </section>

      <section className="cockpit-tickets">
        {record.legs.map((leg, i) => (
          <article className="cockpit-ticket" key={`${leg.bookmakerKey}-${leg.outcome}`}>
            <header className="cockpit-ticket-head micro-label">
              <span>Leg {i + 1}</span>
              <span>{leg.bookmakerTitle}</span>
            </header>
            <p className="cockpit-ticket-outcome">
              {leg.outcome}
              {leg.point != null && ` ${leg.point > 0 ? `+${leg.point}` : leg.point}`}
            </p>
            <div className="cockpit-ticket-figures">
              <span>
                <span className="micro-label">odds</span>
                <strong>{leg.odds.toFixed(2)}</strong>
              </span>
              <span>
                <span className="micro-label">stake</span>
                <strong>${stakes[i].toFixed(2)}</strong>
              </span>
            </div>
            {leg.link && !settled && (
              <a
                className="cockpit-ticket-open"
                href={leg.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {leg.bookmakerTitle} ↗
              </a>
            )}
          </article>
        ))}
      </section>

      {note && (
        <div
          className={`cockpit-note${note.kind === 'error' ? ' state-error' : ''}`}
          role={note.kind === 'error' ? 'alert' : 'status'}
        >
          {note.kind === 'ok' ? verifiedCopy(note.recordStatus, note.creditsCharged) : (
            <>
              {errorTitle(note.code)} {note.message}
            </>
          )}
        </div>
      )}

      {record.status !== 'completed' && (
        <section className="cockpit-actions">
          {record.status !== 'dead' && (
            <button
              type="button"
              className="cockpit-action cockpit-action-verify"
              onClick={onVerify}
              disabled={busy !== null}
              aria-busy={busy === 'verify'}
            >
              {busy === 'verify' ? 'Checking the books…' : 'Re-verify prices · ~1 credit'}
            </button>
          )}
          <button
            type="button"
            className="cockpit-action cockpit-action-complete"
            onClick={onComplete}
            disabled={busy !== null}
            aria-busy={busy === 'complete'}
          >
            {busy === 'complete' ? 'Recording…' : 'Both legs placed — mark completed'}
          </button>
        </section>
      )}

      <footer className="footnote micro-label">
        Odds comparison and information only — verify prices at the book before staking anything.
      </footer>
    </main>
  );
}

function verifiedCopy(status: OpportunityRecord['status'], credits: number): string {
  const cost = credits === 0 ? 'no credits spent' : `${credits} credit${credits === 1 ? '' : 's'}`;
  switch (status) {
    case 'active':
      return `Re-verified — still live at the odds shown (${cost}).`;
    case 'degraded':
      return `Re-verified — the edge shrank but is still positive (${cost}).`;
    default:
      return `Re-verified — the edge is gone (${cost}).`;
  }
}

function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function relativeTime(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
