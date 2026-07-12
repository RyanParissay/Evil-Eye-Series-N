import { useEffect, useState } from 'react';
import type {
  DenseWeekStatus,
  OpsSettings,
  SchedulerBlock,
  SchedulerProposal,
  SurvivalStats,
} from '../../../shared/types';
import { describePairCost } from '../creditWidget';
import {
  applyProposal,
  cancelDenseWeek,
  fetchCostEstimate,
  fetchDenseWeek,
  fetchProposal,
  fetchSurvival,
  patchOpsSettings,
  patchScheduler,
  startDenseWeek,
  type CostEstimate,
} from '../api';

/**
 * Scheduler status + the settings the scheduler actually uses (Phase 16).
 * Display only — every scan/score-poll TIMING decision is now the server
 * scheduler's job (server/src/scheduler/), so this panel no longer computes
 * client-side cadence or runs any timer. The legacy weekday/weekend window
 * editors are gone (the scheduler ignores those fields); the block schedule
 * below is read-only in WP1 — WP3's optimizer becomes its editor.
 */
export function CadencePanel({
  settings,
  onSettings,
  regionTab,
  topN,
}: {
  settings: OpsSettings;
  onSettings: (next: OpsSettings) => void;
  regionTab: string;
  topN: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [survival, setSurvival] = useState<SurvivalStats | null>(null);

  // Dense data-gathering week (Phase 16 Part C.3): live status + start/cancel.
  const [dense, setDense] = useState<DenseWeekStatus | null>(null);
  const [denseBusy, setDenseBusy] = useState(false);
  useEffect(() => {
    fetchDenseWeek()
      .then(setDense)
      .catch(() => setDense(null));
  }, []);

  async function startDense() {
    setError(null);
    setDenseBusy(true);
    try {
      setDense(await startDenseWeek());
    } catch {
      setError('Could not start the dense week.');
    } finally {
      setDenseBusy(false);
    }
  }

  async function cancelDense() {
    setError(null);
    setDenseBusy(true);
    try {
      setDense(await cancelDenseWeek());
    } catch {
      setError('Could not cancel the dense week.');
    } finally {
      setDenseBusy(false);
    }
  }

  // Weekly deterministic proposal (Phase 16 Part C.4): MODEL, propose-only.
  const [proposal, setProposal] = useState<SchedulerProposal | null>(null);
  const [proposalMsg, setProposalMsg] = useState<string | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);

  async function loadProposal() {
    setProposalMsg(null);
    setProposalBusy(true);
    try {
      setProposal(await fetchProposal());
    } catch (err) {
      setProposal(null);
      setProposalMsg(err instanceof Error ? err.message : 'Could not compute a proposal.');
    } finally {
      setProposalBusy(false);
    }
  }

  async function applyThisProposal() {
    if (!proposal) return;
    if (!window.confirm('Apply this proposed schedule? It replaces your current blocks.')) return;
    setProposalBusy(true);
    try {
      onSettings(await applyProposal(proposal.blocks));
      setProposal(null);
      setProposalMsg('Applied — the scheduler now runs the proposed schedule.');
    } catch {
      setProposalMsg('Could not apply the proposal.');
    } finally {
      setProposalBusy(false);
    }
  }

  // Pre-scan cost, from the live fetch plan + enabled markets — the number
  // that moves when a market toggle does. Never silent.
  useEffect(() => {
    fetchCostEstimate(regionTab, topN)
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [regionTab, topN, settings.markets.totals, settings.markets.spreads]);

  useEffect(() => {
    fetchSurvival()
      .then(setSurvival)
      .catch(() => setSurvival(null));
  }, []);

  async function apply(patch: Partial<OpsSettings>) {
    setError(null);
    try {
      onSettings(await patchOpsSettings(patch));
    } catch {
      setError('Could not save settings.');
    }
  }

  /** Partial scheduler patch (Phase 16) — the server deep-merges it. */
  async function applyScheduler(patch: Parameters<typeof patchScheduler>[0]) {
    setError(null);
    try {
      onSettings(await patchScheduler(patch));
    } catch {
      setError('Could not save settings.');
    }
  }

  const sched = settings.scheduler;
  const mode = sched.disabledReason
    ? 'SCHEDULER OFF — stopped itself'
    : sched.enabled
      ? 'SCHEDULER ON — server-scheduled scans'
      : 'SCHEDULER OFF';

  return (
    <section className="cadence" aria-label="Scheduler">
      <div className="cadence-row">
        <span
          className={`cadence-mode micro-label${sched.enabled && !sched.disabledReason ? ' is-live' : ''}`}
          role="status"
        >
          {mode}
        </span>
        {estimate && (
          <span className="micro-label" title="markets × region-equivalents × sports">
            ≈{estimate.creditsPerScan} credits/scan ({estimate.marketCount} market
            {estimate.marketCount === 1 ? '' : 's'} × {estimate.regionEquivalents} RE × {estimate.topN})
          </span>
        )}
        {estimate && (
          <span
            className="micro-label"
            title="a scan window = scan A + (hit rate × confirmation scan B)"
          >
            {describePairCost(estimate.confirmation)}
          </span>
        )}
        <button type="button" className="cadence-edit micro-label" onClick={() => setOpen(!open)}>
          {open ? 'close' : 'schedule & budget'}
        </button>
      </div>

      {dense && <DenseWeekControl dense={dense} busy={denseBusy} onStart={startDense} onCancel={cancelDense} />}

      {open && (
        <div className="cadence-settings">
          <div className="cadence-blocks micro-label">
            <span>schedule · America/Vancouver</span>
            <ul>
              {[...sched.blocks]
                .sort((a, b) => a.startMin - b.startMin)
                .map((b, i) => (
                  <li key={i}>{formatBlock(b)}</li>
                ))}
            </ul>
            <span>01:00–08:00 quiet — no scans or re-verifies of any kind</span>
          </div>

          <ProposalControl
            proposal={proposal}
            message={proposalMsg}
            busy={proposalBusy}
            appliedAt={sched.proposalAppliedAt ?? null}
            onLoad={loadProposal}
            onApply={applyThisProposal}
            onDismiss={() => {
              setProposal(null);
              setProposalMsg(null);
            }}
          />
          <label className="micro-label">
            monthly budget
            <input
              type="number"
              min={100}
              step={1000}
              defaultValue={settings.monthlyCreditBudget}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 100 && v !== settings.monthlyCreditBudget) {
                  void apply({ monthlyCreditBudget: v });
                }
              }}
            />
          </label>
          <label className="micro-label">
            auto-stop at %
            <input
              type="number"
              min={10}
              max={100}
              defaultValue={settings.autoStopPct}
              onBlur={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 10 && v <= 100 && v !== settings.autoStopPct) {
                  void apply({ autoStopPct: v });
                }
              }}
            />
          </label>
          <label className="micro-label cadence-market">
            totals market
            <input
              type="checkbox"
              checked={settings.markets.totals}
              onChange={(e) => void apply({ markets: { ...settings.markets, totals: e.target.checked } })}
            />
          </label>
          <label className="micro-label cadence-market">
            spreads market
            <input
              type="checkbox"
              checked={settings.markets.spreads}
              onChange={(e) => void apply({ markets: { ...settings.markets, spreads: e.target.checked } })}
            />
          </label>
          <div className="cadence-second-sight">
            <label className="micro-label">
              confirmation interval (s)
              <input
                type="number"
                min={10}
                max={600}
                step={10}
                defaultValue={sched.confirmationIntervalSecs ?? 60}
                onBlur={(e) => {
                  const v = e.target.valueAsNumber;
                  if (
                    Number.isInteger(v) &&
                    v >= 10 &&
                    v <= 600 &&
                    v !== (sched.confirmationIntervalSecs ?? 60)
                  ) {
                    void applyScheduler({ confirmationIntervalSecs: v });
                  }
                }}
              />
            </label>
            <span className="micro-label">
              scan B re-confirms candidates this long after scan A (±0.5pp) — only confirmed
              opportunities alert; unconfirmed are never acted on
              {survival && survival.overall.samples > 0 && (
                <>
                  {' · '}
                  {survival.overall.rate == null
                    ? '—'
                    : `${Math.round(survival.overall.rate * 100)}%`}{' '}
                  survive one scan interval · {survival.overall.samples} samples
                </>
              )}
            </span>
          </div>
        </div>
      )}
      {error && <p className="micro-label cadence-error">{error}</p>}
    </section>
  );
}

/**
 * The dense data-gathering week (Phase 16 Part C.3): 7 days of elevated
 * scanning across all allowed hours, hard-capped at 4,500 credits/day and
 * 30,000/week. Shows "day X of 7 · credits Y / 30,000" while active, a start
 * button with a one-line cost warning while idle, and the cap-hit banner when
 * a cap has halted scheduled scanning (manual scans stay allowed).
 */
function DenseWeekControl({
  dense,
  busy,
  onStart,
  onCancel,
}: {
  dense: DenseWeekStatus;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  if (!dense.active) {
    return (
      <div className="cadence-dense">
        <span className="micro-label">
          dense week — 7 days of elevated scanning across all allowed hours, capped at{' '}
          {dense.dayCap.toLocaleString()} credits/day · {dense.weekCap.toLocaleString()}/week. Spends
          real credits and starts immediately.
        </span>
        <button type="button" className="cadence-dense-start micro-label" disabled={busy} onClick={onStart}>
          start dense week
        </button>
      </div>
    );
  }
  return (
    <div className="cadence-dense is-active">
      <span className="micro-label cadence-dense-status">
        <strong>dense week: day {dense.dayNumber} of 7</strong> · credits{' '}
        {dense.weekCreditsUsed.toLocaleString()} / {dense.weekCap.toLocaleString()} · today{' '}
        {dense.dayCreditsUsed.toLocaleString()} / {dense.dayCap.toLocaleString()} · every{' '}
        {dense.intervalMins}m
      </span>
      {dense.stopped && (
        <span className="cadence-dense-banner micro-label" role="status">
          {dense.stopped.message}
        </span>
      )}
      <button type="button" className="cadence-dense-cancel micro-label" disabled={busy} onClick={onCancel}>
        cancel dense week
      </button>
    </div>
  );
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * The weekly deterministic proposal (Phase 16 Part C.4): MODEL-labeled, never
 * auto-applied. Shows a "get proposal" button (with the ">7 days old, re-run
 * weekly" nudge), then the confirmed-opportunity density table (hour × day per
 * strategy), the projected spend vs ceiling, and an Apply button behind a
 * confirmation.
 */
function ProposalControl({
  proposal,
  message,
  busy,
  appliedAt,
  onLoad,
  onApply,
  onDismiss,
}: {
  proposal: SchedulerProposal | null;
  message: string | null;
  busy: boolean;
  appliedAt: string | null;
  onLoad: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const appliedMs = appliedAt ? Date.parse(appliedAt) : null;
  const stale = appliedMs == null || Date.now() - appliedMs > WEEK_MS;

  return (
    <div className="cadence-proposal micro-label">
      <div className="cadence-proposal-head">
        <span className="cadence-proposal-tag">MODEL</span>
        <span>weekly optimizer — proposes blocks from confirmed-opportunity density; never auto-applied</span>
        <button type="button" className="cadence-edit" disabled={busy} onClick={proposal ? onDismiss : onLoad}>
          {proposal ? 'dismiss' : busy ? '…' : 'get weekly proposal'}
        </button>
      </div>

      {!proposal && appliedAt && (
        <span className="cadence-proposal-nudge">
          last applied {daysAgo(appliedMs!)}
          {stale ? ' — a week has passed; re-run the optimizer' : ''}
        </span>
      )}
      {!proposal && !appliedAt && (
        <span className="cadence-proposal-nudge">optimizer has never been applied — the seed schedule is running</span>
      )}
      {message && <span className="cadence-proposal-msg">{message}</span>}

      {proposal && (
        <>
          <DensityTable proposal={proposal} />
          <div className="cadence-proposal-spend">
            projected{' '}
            <strong className={proposal.projectedMonthlyCredits > proposal.spendCeiling ? 'over' : ''}>
              {proposal.projectedMonthlyCredits.toLocaleString()}
            </strong>{' '}
            / {proposal.spendCeiling.toLocaleString()} credits/month (budget{' '}
            {proposal.monthlyBudget.toLocaleString()}, 10% reserved) · from{' '}
            {proposal.historyDays.toFixed(1)} days of history · {proposal.blocks.length} block
            {proposal.blocks.length === 1 ? '' : 's'}
          </div>
          <button type="button" className="cadence-proposal-apply" disabled={busy} onClick={onApply}>
            apply proposed schedule
          </button>
        </>
      )}
    </div>
  );
}

/** Confirmed-opportunity density as an hour × day heat table (counts). Only
 *  hours that carry any confirmed opportunity are shown. */
function DensityTable({ proposal }: { proposal: SchedulerProposal }) {
  const hours = [...new Set(proposal.density.map((c) => c.hour))].sort((a, b) => a - b);
  if (hours.length === 0) {
    return <span className="cadence-proposal-empty">no confirmed opportunities in the history yet</span>;
  }
  const cell = (day: number, hour: number) =>
    proposal.density.find((c) => c.day === day && c.hour === hour) ?? null;

  return (
    <div className="cadence-density-wrap">
      <table className="cadence-density">
        <thead>
          <tr>
            <th scope="col">PT</th>
            {DAY_LABELS.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th scope="row">{String(hour).padStart(2, '0')}</th>
              {DAY_LABELS.map((_, day) => {
                const c = cell(day, hour);
                const total = c ? c.arb + c.ev + c.middle : 0;
                return (
                  <td
                    key={day}
                    className={total > 0 ? 'has' : ''}
                    title={c ? `arb ${c.arb} · ev ${c.ev} · middle ${c.middle}` : 'none'}
                  >
                    {total > 0 ? total : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / (24 * 3_600_000));
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatBlock(b: SchedulerBlock): string {
  return `${hhmm(b.startMin)}–${hhmm(b.endMin)} · every ${b.intervalMins}m`;
}

function hhmm(minutes: number): string {
  const m = minutes % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
