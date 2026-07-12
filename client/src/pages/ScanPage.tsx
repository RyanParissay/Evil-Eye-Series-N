import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_REGION_TAB, type RegionTabKey } from '../../../shared/regionTabs';
import type {
  ApiErrorCode,
  BookmakerConfig,
  ScanMeta,
  ScanResponse,
} from '../../../shared/types';
import type { OpsSettings } from '../../../shared/types';
import {
  ApiError,
  fetchBookmakers,
  fetchLastScan,
  fetchOpsSettings,
  patchBookmaker,
  patchScheduler,
  runScan,
  type BookmakerPatchBody,
} from '../api';
import { CadencePanel } from '../components/CadencePanel';
import { BookmakerPanel } from '../components/BookmakerPanel';
import { ControlBar } from '../components/ControlBar';
import { CreditSpendWidget } from '../components/CreditSpendWidget';
import { EyeGlyph } from '../components/EyeGlyph';
import { FundPanel } from '../components/FundPanel';
import { OpportunityCard } from '../components/OpportunityCard';
import { WhatsAppPanel } from '../components/WhatsAppPanel';
import { errorHint, errorTitle } from '../errorCopy';

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ScanResponse }
  | { status: 'error'; code: ApiErrorCode; message: string };

export function ScanPage() {
  const [topN, setTopN] = useState(5);
  const [regionTab, setRegionTab] = useState<RegionTabKey>(DEFAULT_REGION_TAB);
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const [lastMeta, setLastMeta] = useState<ScanMeta | null>(null);

  // Epoch ms of the last completed scan attempt — a refresh key for the fund
  // and credit widgets and the bookmaker refetch. It is NOT a countdown
  // anchor anymore: Phase 16 moved all scan/grading TIMING to the server
  // scheduler (server/src/scheduler/). The client runs no scan or grading
  // timers at all now.
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  // The auto-scan switch drives the SERVER scheduler (ops setting
  // scheduler.enabled). We render its state from the ops settings fetch and
  // PATCH it on toggle; the server wakes the running scheduler.
  const [ops, setOps] = useState<OpsSettings | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  useEffect(() => {
    fetchOpsSettings()
      .then(setOps)
      .catch(() => {
        // No ops settings — the manual scan button still works.
      });
  }, []);

  async function setSchedulerEnabled(enabled: boolean) {
    setSchedulerBusy(true);
    try {
      // Enabling carries the current scan scope so the scheduler scans with
      // the settings the operator has dialed in.
      setOps(await patchScheduler({ enabled, scanParams: { regionTab, topN } }));
    } catch {
      // Leave the toggle as-is; the scheduler status line still reflects
      // server truth on the next fetch.
    } finally {
      setSchedulerBusy(false);
    }
  }

  // The bookmaker registry: shared by the settings panel and the leg
  // warnings on opportunity cards. Scans grow it, so refetch after each one.
  const [books, setBooks] = useState<BookmakerConfig[] | null>(null);
  useEffect(() => {
    fetchBookmakers()
      .then(setBooks)
      .catch(() => {
        // Server unreachable — the scan UI surfaces that already.
      });
  }, [lastScanAt]);

  async function patchBook(key: string, patch: BookmakerPatchBody) {
    const updated = await patchBookmaker(key, patch);
    setBooks((current) =>
      current ? current.map((b) => (b.key === updated.key ? updated : b)) : current,
    );
  }

  const bookStatus = useMemo(
    () => new Map(books?.map((b) => [b.key, b.status]) ?? []),
    [books],
  );

  // Hydrate the usage panel from the server's persisted last-scan record.
  useEffect(() => {
    fetchLastScan()
      .then((meta) => {
        if (!meta) return;
        setLastMeta((current) => current ?? meta);
        const at = Date.parse(meta.scannedAt);
        if (Number.isFinite(at)) setLastScanAt((current) => current ?? at);
      })
      .catch(() => {
        // No last scan (or server briefly unreachable) — panel shows dashes.
      });
  }, []);

  async function handleScan() {
    if (scan.status === 'loading') return;
    setScan({ status: 'loading' });
    try {
      const data = await runScan(topN, regionTab);
      setScan({ status: 'success', data });
      setLastMeta(data.meta);
    } catch (err) {
      const isApi = err instanceof ApiError;
      const code: ApiErrorCode = isApi ? err.code : 'internal';
      setScan({
        status: 'error',
        code,
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    } finally {
      setLastScanAt(Date.now());
    }
  }

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state={scan.status === 'loading' ? 'scanning' : 'open'} />
        <h1 className="wordmark">
          Evil Eye <span className="wordmark-accent">Arbitrage</span>
        </h1>
        <p className="tagline micro-label">
          Cross-book odds surveillance · guaranteed-profit finder ·{' '}
          <Link to="/advanced" className="adv-back">Advanced →</Link> ·{' '}
          <Link to="/ledger" className="adv-back">Ledger →</Link> ·{' '}
          <Link to="/portfolios" className="adv-back">Portfolios →</Link> ·{' '}
          <Link to="/scans" className="adv-back">Scan history →</Link> ·{' '}
          <Link to="/risk" className="risk-nav">RISK MODE</Link>
        </p>
      </header>

      <ControlBar
        topN={topN}
        onTopNChange={setTopN}
        regionTab={regionTab}
        onRegionTabChange={setRegionTab}
        onScan={() => void handleScan()}
        scanning={scan.status === 'loading'}
        lastMeta={lastMeta}
        schedulerEnabled={ops?.scheduler.enabled ?? false}
        onSchedulerToggle={(enabled) => void setSchedulerEnabled(enabled)}
        schedulerDisabledReason={ops?.scheduler.disabledReason ?? null}
        schedulerBusy={schedulerBusy}
      />

      {ops && (
        <CadencePanel settings={ops} onSettings={setOps} regionTab={regionTab} topN={topN} />
      )}

      <FundPanel refreshKey={lastScanAt} />

      <CreditSpendWidget refreshKey={lastScanAt} regionTab={regionTab} topN={topN} />

      <WhatsAppPanel />

      <BookmakerPanel books={books} onPatch={patchBook} />

      <main className="results">
        {scan.status === 'idle' && (
          <div className="state-block">
            <EyeGlyph size={64} state="open" />
            <p className="state-title">The eye is open.</p>
            <p className="state-detail">
              Run a scan to sweep live odds across bookmakers for guaranteed-profit spreads.
              Scans cost API credits — nothing runs until you press the button.
            </p>
          </div>
        )}

        {scan.status === 'loading' && (
          <div className="state-block" role="status">
            <EyeGlyph size={64} state="scanning" />
            <p className="state-title">Scanning the books…</p>
            <p className="state-detail">Fetching odds and hunting for prices that disagree.</p>
          </div>
        )}

        {scan.status === 'error' && (
          <div className="state-block state-error" role="alert">
            <p className="state-title">{errorTitle(scan.code)}</p>
            <p className="state-detail">{scan.message}</p>
            <p className="state-detail">{errorHint(scan.code)}</p>
          </div>
        )}

        {scan.status === 'success' && scan.data.opportunities.length === 0 && (
          <div className="state-block">
            <EyeGlyph size={64} state="closed" />
            <p className="state-title">No arbitrage found.</p>
            <p className="state-detail">
              Markets are efficient right now. Scanned {scan.data.meta.sportsScanned.length}{' '}
              sports — try again later or widen the scan.
            </p>
          </div>
        )}

        {scan.status === 'success' && scan.data.opportunities.length > 0 && (
          <>
            <div className="results-head micro-label">
              {scan.data.opportunities.length} opportunit
              {scan.data.opportunities.length === 1 ? 'y' : 'ies'} · scanned{' '}
              {scan.data.meta.sportsScanned.length} sports · stakes shown per $100
            </div>
            {scan.data.opportunities.map((arb) => (
              <OpportunityCard
                key={`${arb.eventId}-${arb.marketKey}`}
                arb={arb}
                bookStatus={bookStatus}
              />
            ))}
          </>
        )}
      </main>

      <footer className="footnote micro-label">
        Odds comparison and information only — verify prices at the book before staking anything.
      </footer>

      {/* Analytics Hub entry point — a separate page, SIMULATED money only.
          Self-contained block: touch only this when merging. */}
      <div className="hub-nav">
        <Link to="/hub" className="hub-nav-button">
          Analytics Hub
        </Link>
      </div>
    </div>
  );
}
