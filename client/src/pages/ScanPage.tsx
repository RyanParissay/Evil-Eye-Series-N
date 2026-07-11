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
  runScan,
  type BookmakerPatchBody,
} from '../api';
import { budgetState, windowState } from '../cadence';
import { CadencePanel } from '../components/CadencePanel';
import {
  loadAutoScanSettings,
  msUntilNextScan,
  saveAutoScanSettings,
  shouldDisableAutoScan,
  type AutoScanSettings,
} from '../autoScan';
import { BookmakerPanel } from '../components/BookmakerPanel';
import { ControlBar } from '../components/ControlBar';
import { EyeGlyph } from '../components/EyeGlyph';
import { FundPanel } from '../components/FundPanel';
import { OpportunityCard } from '../components/OpportunityCard';
import { WhatsAppPanel } from '../components/WhatsAppPanel';
import { errorHint, errorTitle } from '../errorCopy';

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ScanResponse }
  | { status: 'error'; code: ApiErrorCode; message: string; autoDisabled?: boolean };

export function ScanPage() {
  const [topN, setTopN] = useState(5);
  const [regionTab, setRegionTab] = useState<RegionTabKey>(DEFAULT_REGION_TAB);
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const [lastMeta, setLastMeta] = useState<ScanMeta | null>(null);

  // Auto-update: persisted so the switch "stays on" across refreshes.
  const [autoScan, setAutoScan] = useState<AutoScanSettings>(() =>
    loadAutoScanSettings(window.localStorage),
  );
  // Epoch ms of the last completed scan ATTEMPT (success or error) — the
  // anchor the auto-update countdown schedules from. Failures count too, so
  // a failing scan can never turn into a hot retry loop.
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  function updateAutoScan(next: AutoScanSettings) {
    setAutoScan(next);
    saveAutoScanSettings(window.localStorage, next);
  }

  // Phase 8 cadence: window/budget settings live server-side; timers stay
  // right here in the client. A 30s tick re-evaluates window transitions.
  const [ops, setOps] = useState<OpsSettings | null>(null);
  const [, setCadenceTick] = useState(0);
  useEffect(() => {
    fetchOpsSettings()
      .then(setOps)
      .catch(() => {
        // No ops settings — the fixed auto-scan interval still works.
      });
  }, []);
  useEffect(() => {
    if (!autoScan.enabled) return;
    const id = window.setInterval(() => setCadenceTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [autoScan.enabled]);

  const cadence = ops ? windowState(ops, new Date()) : null;
  const budget = ops
    ? budgetState(ops, lastMeta?.usage.requestsUsedTotal ?? null, new Date())
    : null;
  // Effective auto-scan interval: window cadence when ops settings exist,
  // the classic slider interval otherwise. null = auto-scan sleeps.
  const effectiveIntervalMins = ops ? (cadence?.cadenceMins ?? null) : autoScan.intervalMins;
  const autoBlocked = budget?.stopped ?? false;

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

  // Hydrate the usage panel from the server's persisted last-scan record,
  // and anchor the auto-update countdown to it: with a 10-minute interval
  // and a scan 3 minutes ago, reopening the page waits 7 minutes.
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

  async function handleScan(source: 'manual' | 'auto' = 'manual') {
    if (scan.status === 'loading') return;
    setScan({ status: 'loading' });
    try {
      const data = await runScan(topN, regionTab);
      setScan({ status: 'success', data });
      setLastMeta(data.meta);
    } catch (err) {
      const isApi = err instanceof ApiError;
      const code: ApiErrorCode = isApi ? err.code : 'internal';
      // A bad key or spent quota won't fix itself — switch auto mode off
      // rather than re-hitting the API every X minutes. Functional update:
      // the closure's autoScan may predate a mid-scan slider change.
      const autoDisabled = source === 'auto' && shouldDisableAutoScan(code);
      if (autoDisabled) {
        setAutoScan((current) => {
          const next = { ...current, enabled: false };
          saveAutoScanSettings(window.localStorage, next);
          return next;
        });
      }
      setScan({
        status: 'error',
        code,
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
        autoDisabled,
      });
    } finally {
      setLastScanAt(Date.now());
    }
  }

  // The auto-update loop: while enabled and not already scanning, arm a
  // timer for when the next scan is due. Completing any scan (manual or
  // auto) moves lastScanAt, re-arming for a fresh interval. Deliberately no
  // dependency array: re-arming every render keeps the closure's
  // topN/regionTab fresh, and the delay is computed from the absolute
  // lastScanAt, so constant re-arming causes no drift. Phase 8 adds two
  // gates: a null effective interval (out of window, sleeping) and the
  // credit hard stop — manual scans are never blocked by either.
  useEffect(() => {
    if (!autoScan.enabled || scan.status === 'loading') return;
    if (effectiveIntervalMins == null || autoBlocked) return;
    const delay = msUntilNextScan(lastScanAt, effectiveIntervalMins, Date.now());
    const id = window.setTimeout(() => void handleScan('auto'), delay);
    return () => window.clearTimeout(id);
  });

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
          <Link to="/risk" className="risk-nav">RISK MODE</Link>
        </p>
      </header>

      <ControlBar
        topN={topN}
        onTopNChange={setTopN}
        regionTab={regionTab}
        onRegionTabChange={setRegionTab}
        onScan={() => void handleScan('manual')}
        scanning={scan.status === 'loading'}
        lastMeta={lastMeta}
        autoScan={autoScan}
        onAutoScanChange={updateAutoScan}
        lastScanAt={lastScanAt}
        cadenceDriven={ops != null}
      />

      {ops && cadence && budget && (
        <CadencePanel
          settings={ops}
          onSettings={setOps}
          cadence={cadence}
          budget={budget}
          autoEnabled={autoScan.enabled}
          lastScanAt={lastScanAt}
          now={Date.now()}
          regionTab={regionTab}
          topN={topN}
        />
      )}

      <FundPanel refreshKey={lastScanAt} />

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
            {scan.autoDisabled && (
              <p className="state-detail">
                Auto update turned itself off so it doesn't retry into this error. Fix the cause,
                then flip the switch back on.
              </p>
            )}
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
    </div>
  );
}
