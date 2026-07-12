import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorCode, ScanBrowserEntry } from '../../../shared/types';
import { ApiError, fetchScanBrowser } from '../api';
import { EyeGlyph } from '../components/EyeGlyph';
import { OpportunityCard } from '../components/OpportunityCard';
import { errorHint, errorTitle } from '../errorCopy';
import { useSafetySettings } from '../useSafetySettings';

const LAST_N_OPTIONS = [10, 20, 50, 100] as const;

/**
 * Phase 15 #2: past scans, newest first — time, region, sports, credits,
 * counts — with Phase-13 gap indicators inline between rows and expandable
 * drill-down into that scan's opportunities. Every number is server-computed
 * from scanHistoryStore + persisted records; this page cannot spend a credit.
 */
export function ScanHistoryPage() {
  const [lastN, setLastN] = useState(20);
  const [scans, setScans] = useState<ScanBrowserEntry[] | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Real persisted records — the ones that reached 'confirmed' after
  // Phase 17 carry `safety`, including gate-filtered ones. This is where
  // the FILTERED chip earns its keep.
  const safetySettings = useSafetySettings();

  useEffect(() => {
    let cancelled = false;
    setScans(null);
    fetchScanBrowser(lastN)
      .then((s) => {
        if (!cancelled) setScans(s);
      })
      .catch((err) => {
        if (cancelled) return;
        const isApi = err instanceof ApiError;
        setError({
          code: isApi ? err.code : 'internal',
          message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [lastN]);

  function toggle(scannedAt: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(scannedAt)) next.delete(scannedAt);
      else next.add(scannedAt);
      return next;
    });
  }

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state="open" />
        <h1 className="wordmark">
          Scan <span className="wordmark-accent">History</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> ·{' '}
          <Link to="/ledger" className="adv-back">Ledger</Link> · past scans, credits, and
          what they found
        </p>
      </header>

      {error && (
        <div className="state-block state-error" role="alert">
          <p className="state-title">{errorTitle(error.code)}</p>
          <p className="state-detail">{error.message}</p>
          <p className="state-detail">{errorHint(error.code)}</p>
        </div>
      )}

      {!error && !scans && (
        <div className="state-block" role="status">
          <p className="state-title">Loading scan history…</p>
        </div>
      )}

      {scans && (
        <main className="ledger">
          <section>
            <div className="scan-history-controls">
              <label className="micro-label" htmlFor="scan-history-lastn">
                show last
              </label>
              <select
                id="scan-history-lastn"
                value={lastN}
                onChange={(e) => setLastN(Number(e.target.value))}
              >
                {LAST_N_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} scans
                  </option>
                ))}
              </select>
            </div>

            {scans.length === 0 ? (
              <p className="state-block micro-label" role="status">
                No scans yet — run one from the Scanner and it shows up here.
              </p>
            ) : (
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Region</th>
                    <th>Sports</th>
                    <th>Credits</th>
                    <th>Events</th>
                    <th>Books</th>
                    <th>Arb</th>
                    <th>EV</th>
                    <th>Middle</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((scan) => {
                    const isOpen = expanded.has(scan.scannedAt);
                    return (
                      <Fragment key={scan.scannedAt}>
                        {scan.gapBefore && (
                          <tr key={`${scan.scannedAt}-gap`} className="scan-gap-row">
                            <td colSpan={10}>
                              <p className="ledger-note micro-label">
                                ⚠ {scan.gapBefore.minutes}min gap before this scan — auto-scan may
                                have stopped firing between {new Date(scan.gapBefore.from).toLocaleString()}{' '}
                                and {new Date(scan.gapBefore.to).toLocaleString()}.
                              </p>
                            </td>
                          </tr>
                        )}
                        <tr key={scan.scannedAt}>
                          <td>{new Date(scan.scannedAt).toLocaleString()}</td>
                          <td>{scan.regionTab}</td>
                          <td className="scan-sports-cell" title={scan.sportsScanned.join(', ')}>
                            {summarizeSports(scan.sportsScanned)}
                          </td>
                          <td className="num">{scan.creditsComputed}</td>
                          <td className="num">{scan.eventCount}</td>
                          <td className="num">{scan.distinctBooks.length}</td>
                          <td className="num">{scan.counts.arb}</td>
                          <td className="num">{scan.counts.ev}</td>
                          <td className="num">{scan.counts.middle}</td>
                          <td className="num">
                            <button
                              type="button"
                              className="scan-row-toggle"
                              aria-expanded={isOpen}
                              disabled={scan.counts.total === 0}
                              onClick={() => toggle(scan.scannedAt)}
                            >
                              {scan.counts.total === 0
                                ? 'none'
                                : `${isOpen ? '▾' : '▸'} ${scan.counts.total}`}
                            </button>
                          </td>
                        </tr>
                        {isOpen && scan.counts.total > 0 && (
                          <tr key={`${scan.scannedAt}-drill`}>
                            <td colSpan={10}>
                              <div className="scan-drill">
                                {scan.opportunities.map((record) => (
                                  <OpportunityCard
                                    key={record.id}
                                    arb={record}
                                    safetySettings={safetySettings}
                                  />
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </main>
      )}

      <footer className="footnote micro-label">
        Every figure here is server-computed from scanHistoryStore and persisted opportunity
        records — this page reads only, it never calls the odds provider.
      </footer>
    </div>
  );
}

/** A broad scan can cover 20+ leagues — keep the row compact; the full list
 *  is still available on hover via the cell's title attribute. */
function summarizeSports(sports: string[]): string {
  if (sports.length === 0) return '—';
  const SHOWN = 3;
  if (sports.length <= SHOWN) return sports.join(', ');
  return `${sports.slice(0, SHOWN).join(', ')} +${sports.length - SHOWN} more`;
}
