import { useEffect, useState } from 'react';
import { DEFAULT_REGION_TAB, type RegionTabKey } from '../../shared/regionTabs';
import type { ApiErrorCode, ScanMeta, ScanResponse } from '../../shared/types';
import { ApiError, fetchLastScan, runScan } from './api';
import { ControlBar } from './components/ControlBar';
import { EyeGlyph } from './components/EyeGlyph';
import { OpportunityCard } from './components/OpportunityCard';

type ScanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: ScanResponse }
  | { status: 'error'; code: ApiErrorCode; message: string };

export function App() {
  const [topN, setTopN] = useState(5);
  const [regionTab, setRegionTab] = useState<RegionTabKey>(DEFAULT_REGION_TAB);
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const [lastMeta, setLastMeta] = useState<ScanMeta | null>(null);

  // Hydrate the usage panel from the server's persisted last-scan record.
  useEffect(() => {
    fetchLastScan()
      .then((meta) => setLastMeta((current) => current ?? meta))
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
      setScan({
        status: 'error',
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    }
  }

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state={scan.status === 'loading' ? 'scanning' : 'open'} />
        <h1 className="wordmark">
          Evil Eye <span className="wordmark-accent">Arbitrage</span>
        </h1>
        <p className="tagline micro-label">Cross-book odds surveillance · guaranteed-profit finder</p>
      </header>

      <ControlBar
        topN={topN}
        onTopNChange={setTopN}
        regionTab={regionTab}
        onRegionTabChange={setRegionTab}
        onScan={handleScan}
        scanning={scan.status === 'loading'}
        lastMeta={lastMeta}
      />

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
              <OpportunityCard key={`${arb.eventId}-${arb.marketKey}`} arb={arb} />
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

function errorTitle(code: ApiErrorCode): string {
  switch (code) {
    case 'invalid_api_key':
      return 'The Odds API rejected the key.';
    case 'quota_exhausted':
      return 'Out of API credits.';
    case 'network':
      return 'Network failure.';
    default:
      return 'Scan failed.';
  }
}

function errorHint(code: ApiErrorCode): string {
  switch (code) {
    case 'invalid_api_key':
      return 'Check ODDS_API_KEY in your .env file, then restart the server.';
    case 'quota_exhausted':
      return 'Your monthly credit allowance is spent — wait for reset or upgrade the plan.';
    case 'network':
      return 'Check your connection and that the server can reach the-odds-api.com, then retry.';
    default:
      return 'Retry the scan; if it persists, check the server logs.';
  }
}
