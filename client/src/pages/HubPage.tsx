import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ApiErrorCode,
  GradeResult,
  HubLeaderboardRow,
  HubLeaderboards,
  HubProfile,
  HubProfileReport,
  HubStake,
  OpportunityStrategy,
} from '../../../shared/types';
import {
  ApiError,
  createHubProfile,
  deleteHubProfile,
  fetchHubLeaderboards,
  fetchHubReports,
  updateHubProfile,
  type HubProfileInput,
} from '../api';
import { EquityChart } from '../components/EquityChart';
import { EyeGlyph } from '../components/EyeGlyph';
import { SafetyCostPanel } from '../components/SafetyCostPanel';
import { errorHint, errorTitle } from '../errorCopy';
import {
  describeStake,
  equityToProfitCurve,
  filterPositions,
  resultLabel,
  type PositionResultFilter,
  type PositionStrategyFilter,
} from '../hub';

const STRATEGIES: readonly OpportunityStrategy[] = ['arb', 'ev', 'middle'];
const STRATEGY_LABEL: Record<OpportunityStrategy, string> = { arb: 'Arb', ev: 'EV', middle: 'Middles' };

type Segment = 'profile' | 'leaderboards' | 'safety';
type FormMode = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; profile: HubProfile };

/**
 * ANALYTICS HUB — /hub. Every dollar here is SIMULATED: profiles are
 * parameterized paper series that auto-purchase confirmed opportunities
 * (server-side, Phase 16 Part A gating) and settle through the same
 * primitives the Phase 14 scenario engine uses. The client renders every
 * number verbatim — no money math happens on this page.
 */
export function HubPage() {
  const [reports, setReports] = useState<HubProfileReport[] | null>(null);
  const [leaderboards, setLeaderboards] = useState<HubLeaderboards | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);
  const [segment, setSegment] = useState<Segment>('profile');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' });
  const [strategyFilter, setStrategyFilter] = useState<PositionStrategyFilter>('all');
  const [resultFilter, setResultFilter] = useState<PositionResultFilter>('all');

  async function load() {
    try {
      const [nextReports, nextBoards] = await Promise.all([fetchHubReports(), fetchHubLeaderboards()]);
      setReports(nextReports);
      setLeaderboards(nextBoards);
      setError(null);
      setSelectedId((current) =>
        current && nextReports.some((r) => r.profile.id === current)
          ? current
          : (nextReports[0]?.profile.id ?? null),
      );
    } catch (err) {
      const isApi = err instanceof ApiError;
      setError({
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = reports?.find((r) => r.profile.id === selectedId) ?? null;

  const filteredPositions = useMemo(
    () =>
      selected
        ? filterPositions(selected.positions, { strategy: strategyFilter, result: resultFilter })
        : [],
    [selected, strategyFilter, resultFilter],
  );

  async function handleCreate(input: HubProfileInput) {
    const created = await createHubProfile(input);
    await load();
    setSelectedId(created.id);
    setFormMode({ kind: 'closed' });
  }

  async function handleUpdate(id: string, patch: HubProfileInput) {
    await updateHubProfile(id, patch);
    await load();
    setFormMode({ kind: 'closed' });
  }

  async function handleDelete(profile: HubProfile) {
    if (profile.premade) return;
    if (!window.confirm(`Delete profile "${profile.name}"? Its purchase history goes with it.`)) return;
    await deleteHubProfile(profile.id);
    setSelectedId(null);
    await load();
  }

  return (
    <div className="page hub">
      <header className="masthead">
        <EyeGlyph size={52} state="open" />
        <h1 className="wordmark">
          Analytics <span className="hub-accent">Hub</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> · paper series over confirmed
          opportunities · <span className="hub-badge">SIMULATED</span>
        </p>
      </header>

      <div className="risk-segments" role="tablist" aria-label="Analytics Hub views">
        {(['profile', 'leaderboards', 'safety'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={segment === key}
            className={`risk-segment${segment === key ? ' is-active' : ''}`}
            onClick={() => setSegment(key)}
          >
            {key === 'profile' ? 'PROFILE' : key === 'leaderboards' ? 'LEADERBOARDS' : 'COST OF SAFETY'}
          </button>
        ))}
      </div>

      {error && (
        <div className="state-block state-error" role="alert">
          <p className="state-title">{errorTitle(error.code)}</p>
          <p className="state-detail">{error.message}</p>
          <p className="state-detail">{errorHint(error.code)}</p>
        </div>
      )}

      {!error && !reports && (
        <div className="state-block" role="status">
          <EyeGlyph size={64} state="scanning" />
          <p className="state-title">Loading the Hub…</p>
        </div>
      )}

      {!error && reports && segment === 'profile' && (
        <>
          <ProfileBar
            reports={reports}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setFormMode({ kind: 'closed' });
            }}
            onNew={() => setFormMode({ kind: 'new' })}
            onEdit={(profile) => setFormMode({ kind: 'edit', profile })}
            onDelete={handleDelete}
          />

          {formMode.kind !== 'closed' && (
            <ProfileForm
              key={formMode.kind === 'edit' ? formMode.profile.id : 'new'}
              initial={formMode.kind === 'edit' ? formMode.profile : null}
              onCancel={() => setFormMode({ kind: 'closed' })}
              onSubmit={(input) =>
                formMode.kind === 'edit' ? handleUpdate(formMode.profile.id, input) : handleCreate(input)
              }
            />
          )}

          {selected && (
            <ProfileReportView
              report={selected}
              strategyFilter={strategyFilter}
              resultFilter={resultFilter}
              onStrategyFilter={setStrategyFilter}
              onResultFilter={setResultFilter}
              positions={filteredPositions}
            />
          )}
        </>
      )}

      {!error && leaderboards && segment === 'leaderboards' && <LeaderboardsView boards={leaderboards} />}

      {!error && segment === 'safety' && <SafetyCostPanel />}

      <footer className="footnote micro-label">
        Every figure on this page is SIMULATED paper money, flat or %-of-start staked, never
        compounding — this is a shadow position, not a live promise.
      </footer>
    </div>
  );
}

function ProfileBar({
  reports,
  selectedId,
  onSelect,
  onNew,
  onEdit,
  onDelete,
}: {
  reports: HubProfileReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (profile: HubProfile) => void;
  onDelete: (profile: HubProfile) => void;
}) {
  const selected = reports.find((r) => r.profile.id === selectedId)?.profile ?? null;
  return (
    <div className="hub-profile-bar">
      <label className="micro-label">
        profile
        <select
          className="hub-profile-select"
          value={selectedId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {reports.map((r) => (
            <option key={r.profile.id} value={r.profile.id}>
              {r.profile.name}
              {r.profile.premade ? ' (premade)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="hub-profile-actions">
        <button type="button" className="hub-profile-action" onClick={onNew}>
          + New profile
        </button>
        {selected && (
          <button type="button" className="hub-profile-action" onClick={() => onEdit(selected)}>
            Edit
          </button>
        )}
        {selected && !selected.premade && (
          <button
            type="button"
            className="hub-profile-action hub-profile-action-danger"
            onClick={() => onDelete(selected)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: HubProfile | null;
  onSubmit: (input: HubProfileInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startingBankroll, setStartingBankroll] = useState(initial?.startingBankroll ?? 1000);
  const [stakeType, setStakeType] = useState<HubStake['type']>(initial?.stake.type ?? 'flat');
  const [stakeValue, setStakeValue] = useState(initial?.stake.value ?? 50);
  const [strategies, setStrategies] = useState<Set<OpportunityStrategy>>(
    new Set(initial?.strategies ?? ['arb']),
  );
  const [minEdgePct, setMinEdgePct] = useState(initial?.minEdgePct ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length > 0 &&
    startingBankroll > 0 &&
    stakeValue > 0 &&
    strategies.size > 0 &&
    minEdgePct >= 0;

  function toggleStrategy(s: OpportunityStrategy) {
    setStrategies((current) => {
      const next = new Set(current);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        startingBankroll,
        stake: { type: stakeType, value: stakeValue },
        strategies: [...strategies],
        minEdgePct,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hub-form">
      <h2 className="ledger-section micro-label">{initial ? `Edit ${initial.name}` : 'New profile'}</h2>
      <div className="hub-form-row">
        <label>
          name
          <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          starting bankroll ($)
          <input
            type="number"
            min={1}
            step={1}
            value={startingBankroll}
            onChange={(e) => setStartingBankroll(e.target.valueAsNumber)}
          />
        </label>
        <label>
          stake
          <select value={stakeType} onChange={(e) => setStakeType(e.target.value as HubStake['type'])}>
            <option value="flat">flat $</option>
            <option value="pctOfStart">% of start</option>
          </select>
        </label>
        <label>
          {stakeType === 'flat' ? 'stake ($)' : 'stake (%)'}
          <input
            type="number"
            min={0.01}
            step={stakeType === 'flat' ? 1 : 0.5}
            value={stakeValue}
            onChange={(e) => setStakeValue(e.target.valueAsNumber)}
          />
        </label>
        <label>
          min headline edge (pp)
          <input
            type="number"
            min={0}
            step={0.5}
            value={minEdgePct}
            onChange={(e) => setMinEdgePct(e.target.valueAsNumber)}
          />
        </label>
      </div>
      <div className="hub-form-strategies">
        <span className="micro-label">auto-purchase strategies</span>
        {STRATEGIES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={strategies.has(s)} onChange={() => toggleStrategy(s)} />
            {STRATEGY_LABEL[s]}
          </label>
        ))}
      </div>
      <div className="hub-form-actions">
        <button type="button" className="hub-form-save" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="hub-form-cancel" onClick={onCancel}>
          cancel
        </button>
        {error && <span className="micro-label hub-form-error">{error}</span>}
      </div>
    </div>
  );
}

function ProfileReportView({
  report,
  strategyFilter,
  resultFilter,
  onStrategyFilter,
  onResultFilter,
  positions,
}: {
  report: HubProfileReport;
  strategyFilter: PositionStrategyFilter;
  resultFilter: PositionResultFilter;
  onStrategyFilter: (v: PositionStrategyFilter) => void;
  onResultFilter: (v: PositionResultFilter) => void;
  positions: HubProfileReport['positions'];
}) {
  const { profile } = report;
  return (
    <>
      <section className="ledger-heads">
        <div className="ledger-stat">
          <span className="micro-label">bankroll now</span>
          <strong>${report.bankroll.toFixed(2)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">starting bankroll</span>
          <strong>${profile.startingBankroll.toFixed(2)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">total profit</span>
          <strong className={report.pnl >= 0 ? 'is-up' : 'is-down'}>{money(report.pnl)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">ROI</span>
          <strong className={report.roiPct >= 0 ? 'is-up' : 'is-down'}>{report.roiPct.toFixed(1)}%</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">bets</span>
          <strong>{report.betCount}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">W / L / push / void</span>
          <strong>
            {report.wins} / {report.losses} / {report.pushes} / {report.voids}
          </strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">pending</span>
          <strong>{report.pending}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">exposure</span>
          <strong>${report.exposure.toFixed(2)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">max drawdown</span>
          <strong>${report.maxDrawdown.toFixed(2)}</strong>
        </div>
        <div className="ledger-stat">
          <span className="micro-label">skipped (bankroll)</span>
          <strong>{report.skipped.count}</strong>
        </div>
      </section>

      <p className="risk-note">
        {STRATEGIES.filter((s) => profile.strategies.includes(s)).map((s) => STRATEGY_LABEL[s]).join(' + ')}
        {' · '}
        {describeStake(profile.stake)}
        {' · min edge ≥ '}
        {profile.minEdgePct}pp
      </p>

      <section>
        <h2 className="ledger-section micro-label">Lifetime equity</h2>
        <EquityChart
          points={equityToProfitCurve(report.equity, profile.startingBankroll)}
          emptyText="No settled bets yet — the curve starts once a purchase grades."
        />
      </section>

      <section>
        <h2 className="ledger-section micro-label">Position history</h2>
        <div className="hub-filters micro-label">
          <label>
            strategy
            <select
              value={strategyFilter}
              onChange={(e) => onStrategyFilter(e.target.value as PositionStrategyFilter)}
            >
              <option value="all">all</option>
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            result
            <select
              value={resultFilter}
              onChange={(e) => onResultFilter(e.target.value as PositionResultFilter)}
            >
              <option value="all">all</option>
              <option value="pending">pending</option>
              {(['win', 'loss', 'push', 'void'] as GradeResult[]).map((r) => (
                <option key={r} value={r}>
                  {resultLabel(r)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {report.positions.length === 0 && (
          <div className="state-block">
            <p className="state-title">No purchases yet.</p>
            <p className="state-detail">
              This profile auto-purchases confirmed opportunities matching its strategy mix and
              minimum edge. Run scans (or wait for the scheduler) — a purchase lands here the
              moment a candidate is confirmed by scan B.
            </p>
          </div>
        )}

        {report.positions.length > 0 && positions.length === 0 && (
          <p className="ledger-empty micro-label">No positions match this filter.</p>
        )}

        {positions.length > 0 && (
          <div className="risk-table-wrap">
            <table className="ledger-table risk-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Sport</th>
                  <th>Commence</th>
                  <th>Strategy</th>
                  <th>Stake</th>
                  <th>Result</th>
                  <th>P&amp;L</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.purchase.recordId}>
                    <td>{p.eventName}</td>
                    <td>{p.sportTitle}</td>
                    <td>{p.commenceTime ? new Date(p.commenceTime).toLocaleString() : '—'}</td>
                    <td>{STRATEGY_LABEL[p.purchase.strategy]}</td>
                    <td className="num">${p.purchase.stake.toFixed(2)}</td>
                    <td>{resultLabel(p.result)}</td>
                    <td className="num">
                      {p.pnl == null ? (
                        '—'
                      ) : (
                        <span className={p.pnl >= 0 ? 'is-up' : 'is-down'}>{money(p.pnl)}</span>
                      )}
                    </td>
                    <td>
                      {p.gradeSource ?? '—'}
                      {p.gradeFlags && p.gradeFlags.length > 0 && (
                        <span className="micro-label"> · {p.gradeFlags.join(', ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report.skipped.count > 0 && (
        <p className="ledger-note micro-label">
          {report.skipped.count} confirmed opportunit{report.skipped.count === 1 ? 'y' : 'ies'} skipped —
          bankroll couldn't cover the stake at the time.
        </p>
      )}
    </>
  );
}

function LeaderboardsView({ boards }: { boards: HubLeaderboards }) {
  const since = new Date(boards.sinceAt).toLocaleDateString();
  return (
    <section className="hub-lb-grid">
      <LeaderboardCard title="Arbitrage" rows={boards.arb} since={since} />
      <LeaderboardCard title="EV" rows={boards.ev} since={since} />
      <LeaderboardCard title="Middles" rows={boards.middle} since={since} />
    </section>
  );
}

function LeaderboardCard({
  title,
  rows,
  since,
}: {
  title: string;
  rows: HubLeaderboardRow[];
  since: string;
}) {
  return (
    <div className="hub-lb-card">
      <h3 className="ledger-section micro-label">
        {title} — top books since {since}
      </h3>
      {rows.length === 0 ? (
        <div className="state-block">
          <p className="state-title">Not accrued yet.</p>
          <p className="state-detail">
            Book leaderboards accrue forward from confirmed {title.toLowerCase()} opportunities —
            run more scans to build history.
          </p>
        </div>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Book</th>
              <th>Count</th>
              <th>Occurrence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bookmakerKey}>
                <td>{r.title}</td>
                <td className="num">{r.count}</td>
                <td className="num">{r.occurrencePct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function money(v: number): string {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
