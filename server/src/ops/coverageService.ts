/**
 * Funded-book feed coverage — is the money where the odds are? Pure:
 * derives entirely from the scan log + the registry. Zero API calls.
 */
import type {
  BenchmarkCoverage,
  BookCoverage,
  BookmakerConfig,
  CoverageReport,
  OddsEvent,
  ScanLogEntry,
} from '@shared/types';

const THIN_SHARE = 0.5;

export interface BenchmarkInput {
  keys: readonly string[];
  /** The latest raw snapshot (or null) — per-sport reach comes from it. */
  snapshot: {
    sportsScanned: string[];
    events: OddsEvent[];
  } | null;
}

export function computeCoverage(
  scans: ScanLogEntry[],
  books: BookmakerConfig[],
  lastN: number,
  benchmark?: BenchmarkInput,
): CoverageReport {
  const considered = scans.slice(-lastN);
  const coverage: BookCoverage[] = books
    .filter((b) => b.enabled)
    .map((b) => {
      const seenIn = considered.filter((s) => s.distinctBooks.includes(b.key));
      const appearances = seenIn.length;
      const share = considered.length > 0 ? appearances / considered.length : 0;
      const funded = (b.balance ?? 0) > 0;
      const flag: BookCoverage['flag'] =
        funded && considered.length > 0 && appearances === 0
          ? 'missing'
          : funded && considered.length > 0 && share < THIN_SHARE
            ? 'thin'
            : 'ok';
      return {
        key: b.key,
        title: b.title,
        balance: b.balance,
        appearances,
        share: Math.round(share * 1000) / 1000,
        lastSeenInFeedAt: seenIn.length > 0 ? seenIn[seenIn.length - 1].scannedAt : null,
        flag,
      };
    })
    // Problems float to the top; then by how much money is at risk.
    .sort((a, b) => flagRank(a.flag) - flagRank(b.flag) || (b.balance ?? 0) - (a.balance ?? 0));

  return {
    lastN,
    scansConsidered: considered.length,
    books: coverage,
    distinctBooksPerScan: considered.map((s) => ({
      at: s.scannedAt,
      count: s.distinctBooks.length,
    })),
    ...(benchmark && { benchmark: benchmarkReach(considered, books, benchmark) }),
  };
}

function benchmarkReach(
  scans: ScanLogEntry[],
  books: BookmakerConfig[],
  input: BenchmarkInput,
): BenchmarkCoverage[] {
  return input.keys.map((key) => {
    const title = books.find((b) => b.key === key)?.title ?? key;
    const seen = scans.filter((s) => s.distinctBooks.includes(key)).length;
    const perSport = (input.snapshot?.sportsScanned ?? []).map((sportKey) => {
      const events = (input.snapshot?.events ?? []).filter((e) => e.sportKey === sportKey);
      return {
        sportKey,
        sportTitle: events[0]?.sportTitle ?? sportKey,
        events: events.length,
        eventsWithBenchmark: events.filter((e) => e.bookmakers.some((b) => b.key === key)).length,
      };
    });
    return {
      key,
      title,
      scanShare: scans.length > 0 ? Math.round((seen / scans.length) * 1000) / 1000 : 0,
      perSport,
    };
  });
}

function flagRank(flag: BookCoverage['flag']): number {
  return flag === 'missing' ? 0 : flag === 'thin' ? 1 : 2;
}
