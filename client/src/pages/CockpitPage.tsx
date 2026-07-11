import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApiErrorCode, OpportunityRecord } from '../../../shared/types';
import { planStakes } from '../../../shared/stakePlanning';
import {
  ApiError,
  applyBalances,
  completeOpportunity,
  fetchBookmakers,
  fetchFundPosition,
  fetchOpportunity,
  gradeOpportunity,
  gradeOpportunityLegs,
  pingFunnel,
  revertBalances,
  verifyOpportunity,
} from '../api';
import { loadBankroll, saveBankroll } from '../cockpit';
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
  const [bankrollTouched, setBankrollTouched] = useState(false);
  const [balances, setBalances] = useState<Map<string, number | null>>(new Map());
  const [busy, setBusy] = useState<'verify' | 'complete' | 'reconcile' | null>(null);
  const [note, setNote] = useState<VerifyNote | null>(null);

  // Book balances cap the suggested stakes; fund settings supply the
  // default stake (a hand-edited bankroll always wins for this visit).
  useEffect(() => {
    fetchBookmakers()
      .then((books) => setBalances(new Map(books.map((b) => [b.key, b.balance ?? null]))))
      .catch(() => {
        // No registry — stakes simply go uncapped.
      });
    fetchFundPosition()
      .then((position) => {
        if (position.settings.defaultStake > 0) {
          setBankroll((current) => (bankrollTouched ? current : position.settings.defaultStake));
        }
      })
      .catch(() => {
        // No fund settings yet — localStorage default stands.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPage({ status: 'loading' });
    fetchOpportunity(id)
      .then((record) => {
        if (cancelled) return;
        setPage({ status: 'ready', record });
        pingFunnel(id, 'cockpit_opened'); // reaction telemetry, first-write-wins
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
    setBankrollTouched(true);
    if (Number.isFinite(next) && next > 0) saveBankroll(window.localStorage, next);
  }

  async function handleReconcile(action: () => Promise<OpportunityRecord>) {
    if (busy) return;
    setBusy('reconcile');
    setNote(null);
    try {
      const record = await action();
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

  async function handleComplete(filledLegs: Array<{ odds: number; stake: number }>) {
    if (busy || page.status !== 'ready') return;
    setBusy('complete');
    setNote(null);
    try {
      const record = await completeOpportunity(id, filledLegs);
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
          balances={balances}
          onBankroll={updateBankroll}
          busy={busy}
          note={note}
          onVerify={() => void handleVerify()}
          onComplete={(filledLegs) => void handleComplete(filledLegs)}
          onApply={(winner) => void handleReconcile(() => applyBalances(id, winner))}
          onRevert={() => void handleReconcile(() => revertBalances(id))}
          onGrade={(grade) => void handleReconcile(() => gradeOpportunity(id, grade))}
          onGradeLegs={(legGrades) => void handleReconcile(() => gradeOpportunityLegs(id, legGrades))}
        />
      )}
    </div>
  );
}

function Cockpit({
  record,
  bankroll,
  balances,
  onBankroll,
  busy,
  note,
  onVerify,
  onComplete,
  onApply,
  onRevert,
  onGrade,
  onGradeLegs,
}: {
  record: OpportunityRecord;
  bankroll: number;
  balances: Map<string, number | null>;
  onBankroll: (next: number) => void;
  busy: 'verify' | 'complete' | 'reconcile' | null;
  note: VerifyNote | null;
  onVerify: () => void;
  onComplete: (filledLegs: Array<{ odds: number; stake: number }>) => void;
  onApply: (winningLegIndex: number) => void;
  onRevert: () => void;
  onGrade: (grade: 'won' | 'lost' | 'void') => void;
  onGradeLegs: (legGrades: Array<'won' | 'lost' | 'void'>) => void;
}) {
  const isEv = record.strategy === 'ev' && record.ev != null;
  const isMiddle = record.strategy === 'middle' && record.middle != null;
  const settled = record.status === 'dead' || record.status === 'completed';
  const [legGradeDraft, setLegGradeDraft] = useState<Array<'won' | 'lost' | 'void' | null>>([]);
  // The same planStakes the alert path runs: ideal shares, whole-position
  // rescale when a book's recorded balance would be exceeded.
  const { stakes, totalStaked, guaranteedProfit, capped, cappedBy } = planStakes(
    record.legs,
    bankroll,
    balances,
  );
  const reduced = record.profitPct < record.profitPctAtDetection;
  const [winner, setWinner] = useState<number | null>(null);

  // Completion books ACTUAL numbers: the form opens prefilled with the
  // record's odds and the current bankroll split — confirm or correct.
  const [fills, setFills] = useState<Array<{ odds: string; stake: string }> | null>(null);
  const parsedFills = (fills ?? []).map((f) => ({ odds: Number(f.odds), stake: Number(f.stake) }));
  const fillsValid =
    fills != null &&
    parsedFills.every(
      (f) => Number.isFinite(f.odds) && f.odds > 1 && Number.isFinite(f.stake) && f.stake >= 0,
    );

  return (
    <main
      className={`cockpit-body cockpit-${record.status}${isEv || isMiddle ? ' cockpit-ev' : ''}`}
    >
      <section className="cockpit-event">
        <p className="micro-label">
          {record.sportTitle} · {record.marketKey} · {formatKickoff(record.commenceTime)}
          {isEv && <span className="risk-badge cockpit-ev-badge">EV · not guaranteed</span>}
          {isMiddle && (
            <span className="risk-badge cockpit-ev-badge">
              {record.middle!.freeMiddle ? 'FREE MIDDLE' : 'MIDDLE · costs if it misses'}
            </span>
          )}
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
        {isMiddle ? (
          <span className="micro-label">
            worst case — the window ({record.middle!.lowLine}–{record.middle!.highLine}) pays +
            {record.middle!.payoutPct.toFixed(0)}% · breakeven{' '}
            {record.middle!.freeMiddle ? 'FREE' : `${record.middle!.breakevenPct.toFixed(1)}%`}
            {record.middle!.keyNumbers.length > 0 && ` · key ${record.middle!.keyNumbers.join(',')} inside`}
            {record.middle!.pushPossible && ' · integer line can push'}
          </span>
        ) : isEv ? (
          <span className="micro-label">
            expected edge — not guaranteed · fair {(record.ev!.fairProbability * 100).toFixed(0)}%
            win ({(1 / record.ev!.fairProbability).toFixed(2)}) · benchmark {record.ev!.benchmarkKey}{' '}
            @{record.ev!.benchmarkOdds}
          </span>
        ) : (
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
        )}
      </section>

      {record.status === 'completed' && (
        <div className="cockpit-stamp" role="status">
          <span className="cockpit-stamp-title">Completed</span>
          <span>
            {isEv ? 'Bet placed' : 'Legs placed'} {relativeTime(record.statusChangedAt)}.{' '}
            {record.execution
              ? isEv
                ? record.execution.grade
                  ? `Graded ${record.execution.grade.toUpperCase()}: ${record.execution.lockedProfit >= 0 ? '+' : '−'}$${Math.abs(record.execution.lockedProfit).toFixed(2)} realized.`
                  : `Ungraded — counts $0 until you grade it below.`
                : isMiddle
                  ? record.execution.legGrades
                    ? `Graded ${record.execution.legGrades.map((g) => g.toUpperCase()).join(' / ')}: ${record.execution.lockedProfit >= 0 ? '+' : '−'}$${Math.abs(record.execution.lockedProfit).toFixed(2)} realized${record.execution.legGrades.every((g) => g === 'won') ? ' — the middle HIT.' : '.'}`
                    : `Ungraded — counts $0 until both legs are graded below.`
                  : `Locked ${record.execution.lockedProfit >= 0 ? '+' : '−'}$${Math.abs(record.execution.lockedProfit).toFixed(2)} on $${record.execution.totalStaked.toFixed(2)} staked.`
              : 'No filled numbers were recorded, so it counts as captured but adds nothing to P&L.'}
          </span>
        </div>
      )}

      {record.status === 'completed' && record.execution && isMiddle && !record.execution.balancesAppliedAt && (
        <section className="cockpit-reconcile" aria-label="Grade the legs">
          <p className="micro-label">
            Event settled? Grade each leg — both won is the middle hit; an integer-line push
            grades that leg VOID.
            {record.execution.legGrades && ' Regrade any time before applying balances.'}
          </p>
          {record.legs.map((leg, i) => (
            <div className="cockpit-grade-row" key={`${leg.bookmakerKey}-${leg.outcome}-${leg.point}`}>
              <span className="cockpit-fill-book">
                {leg.outcome} {leg.point != null && (leg.point > 0 ? `+${leg.point}` : leg.point)}
              </span>
              {(['won', 'lost', 'void'] as const).map((grade) => {
                const current = legGradeDraft[i] ?? record.execution?.legGrades?.[i] ?? null;
                return (
                  <button
                    key={grade}
                    type="button"
                    className={`cockpit-action cockpit-grade${current === grade ? ' is-current' : ''}`}
                    onClick={() =>
                      setLegGradeDraft((draft) => {
                        const next = [...draft];
                        next[i] = grade;
                        return next;
                      })
                    }
                    disabled={busy !== null}
                    aria-pressed={current === grade}
                  >
                    {grade.toUpperCase()}
                  </button>
                );
              })}
            </div>
          ))}
          <button
            type="button"
            className="cockpit-action cockpit-action-verify"
            onClick={() => {
              const grades = record.legs.map(
                (_, i) => legGradeDraft[i] ?? record.execution?.legGrades?.[i] ?? null,
              );
              if (grades.every((g): g is 'won' | 'lost' | 'void' => g != null)) {
                onGradeLegs(grades);
              }
            }}
            disabled={
              busy !== null ||
              !record.legs.every((_, i) => (legGradeDraft[i] ?? record.execution?.legGrades?.[i]) != null)
            }
            aria-busy={busy === 'reconcile'}
          >
            {busy === 'reconcile' ? 'Grading…' : 'Save grades'}
          </button>
        </section>
      )}

      {record.status === 'completed' && record.execution && isEv && !record.execution.balancesAppliedAt && (
        <section className="cockpit-reconcile" aria-label="Grade the bet">
          <p className="micro-label">
            Event settled? Grade it — the grade IS the realized money.
            {record.execution.grade && ' Regrade any time before applying balances.'}
          </p>
          <div className="cockpit-grade-row">
            {(['won', 'lost', 'void'] as const).map((grade) => (
              <button
                key={grade}
                type="button"
                className={`cockpit-action cockpit-grade${record.execution?.grade === grade ? ' is-current' : ''}`}
                onClick={() => onGrade?.(grade)}
                disabled={busy !== null}
                aria-busy={busy === 'reconcile'}
                aria-pressed={record.execution?.grade === grade}
              >
                {grade.toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      )}

      {record.status === 'completed' && record.execution && (
        <section className="cockpit-reconcile" aria-label="Apply to balances">
          {record.execution.balancesAppliedAt ? (
            <div className="cockpit-reconcile-done">
              <span className="micro-label">
                applied to balances {relativeTime(record.execution.balancesAppliedAt)} ·{' '}
                {isEv
                  ? `graded ${record.execution.grade?.toUpperCase()}`
                  : isMiddle
                    ? `graded ${record.execution.legGrades?.map((g) => g.toUpperCase()).join(' / ')}`
                    : `winner: ${record.legs[record.execution.winningLegIndex ?? 0]?.outcome}`}
              </span>
              <button
                type="button"
                className="cockpit-action cockpit-action-verify"
                onClick={onRevert}
                disabled={busy !== null}
                aria-busy={busy === 'reconcile'}
              >
                {busy === 'reconcile' ? 'Reverting…' : 'Revert balance changes'}
              </button>
            </div>
          ) : isEv || isMiddle ? (
            (isEv ? record.execution.grade != null : record.execution.legGrades != null) && (
              <button
                type="button"
                className="cockpit-action cockpit-action-verify"
                onClick={() => onApply(0)}
                disabled={busy !== null}
                aria-busy={busy === 'reconcile'}
              >
                {busy === 'reconcile' ? 'Applying…' : 'Apply to balances'}
              </button>
            )
          ) : (
            <>
              <p className="micro-label">
                Event settled? Pick the winning leg and fold the money into your book balances.
              </p>
              <div className="cockpit-reconcile-picks" role="radiogroup" aria-label="Winning leg">
                {record.legs.map((leg, i) => (
                  <label key={`${leg.bookmakerKey}-${leg.outcome}`} className="cockpit-reconcile-pick">
                    <input
                      type="radio"
                      name="winner"
                      checked={winner === i}
                      onChange={() => setWinner(i)}
                    />
                    {leg.outcome} won ({leg.bookmakerTitle})
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="cockpit-action cockpit-action-verify"
                onClick={() => winner != null && onApply(winner)}
                disabled={busy !== null || winner == null}
                aria-busy={busy === 'reconcile'}
              >
                {busy === 'reconcile' ? 'Applying…' : 'Apply to balances'}
              </button>
            </>
          )}
        </section>
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
          {isMiddle ? (
            <span className="cockpit-guaranteed">
              <span className="micro-label">
                {record.middle!.freeMiddle ? 'floor · middle pays' : 'if it misses · middle pays'}
              </span>
              <strong className="cockpit-ev-expected">
                {record.middle!.freeMiddle ? '+' : '−'}$
                {Math.abs((totalStaked * record.middle!.costPct) / 100).toFixed(2)} · +$
                {((totalStaked * record.middle!.payoutPct) / 100).toFixed(2)}
              </strong>
            </span>
          ) : isEv ? (
            <span className="cockpit-guaranteed">
              <span className="micro-label">expected · if it loses</span>
              <strong className="cockpit-ev-expected">
                +${((totalStaked * record.ev!.edgePct) / 100).toFixed(2)} · −$
                {totalStaked.toFixed(2)}
              </strong>
            </span>
          ) : (
            <span className="cockpit-guaranteed">
              <span className="micro-label">guaranteed</span>
              <strong className={guaranteedProfit >= 0 ? '' : 'is-negative'}>
                {guaranteedProfit >= 0 ? '+' : '−'}${Math.abs(guaranteedProfit).toFixed(2)}
              </strong>
            </span>
          )}
        </div>
        <p className="micro-label">
          split of ${totalStaked.toFixed(2)} across {record.legs.length} legs
        </p>
        {capped && (
          <p className="micro-label cockpit-capped" role="status">
            ⚠ position rescaled — {cappedBy}'s recorded balance is the ceiling. Top it up or
            update its balance in the scanner's bookmaker panel.
          </p>
        )}
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

      {record.status !== 'completed' && fills == null && (
        <section className="cockpit-actions">
          {record.status !== 'dead' && !isEv && (
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
            onClick={() => {
              pingFunnel(record.id, 'fills_opened');
              setFills(
                record.legs.map((leg, i) => ({
                  odds: leg.odds.toFixed(2),
                  stake: stakes[i].toFixed(2),
                })),
              );
            }}
            disabled={busy !== null}
          >
            {isEv ? 'Bet placed — record the fill' : 'Both legs placed — record the fills'}
          </button>
        </section>
      )}

      {record.status !== 'completed' && fills != null && (
        <section className="cockpit-fill" aria-label="Record filled legs">
          <p className="micro-label">What actually got placed — this becomes realized P&L</p>
          {record.legs.map((leg, i) => (
            <div className="cockpit-fill-row" key={`${leg.bookmakerKey}-${leg.outcome}`}>
              <span className="cockpit-fill-book">{leg.bookmakerTitle} · {leg.outcome}</span>
              <label className="micro-label">
                odds
                <input
                  type="number"
                  step="0.01"
                  min="1.01"
                  inputMode="decimal"
                  value={fills[i]?.odds ?? ''}
                  onChange={(e) =>
                    setFills(fills.map((f, j) => (j === i ? { ...f, odds: e.target.value } : f)))
                  }
                />
              </label>
              <label className="micro-label">
                stake $
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={fills[i]?.stake ?? ''}
                  onChange={(e) =>
                    setFills(fills.map((f, j) => (j === i ? { ...f, stake: e.target.value } : f)))
                  }
                />
              </label>
            </div>
          ))}
          <div className="cockpit-fill-actions">
            <button
              type="button"
              className="cockpit-action cockpit-action-complete"
              onClick={() => onComplete(parsedFills)}
              disabled={busy !== null || !fillsValid}
              aria-busy={busy === 'complete'}
            >
              {busy === 'complete' ? 'Booking…' : 'Book it — mark completed'}
            </button>
            <button
              type="button"
              className="cockpit-action cockpit-action-verify"
              onClick={() => setFills(null)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
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
