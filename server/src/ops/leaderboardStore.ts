/**
 * Book leaderboards (Phase 15 #1). The raw odds snapshot is latest-only, so
 * historic re-detection is impossible (see CLAUDE.md) — counts ACCRUE per
 * scan going forward instead: per book, appearances in the raw feed and
 * opportunity-leg counts by strategy (arb/ev/middle). Zero credits
 * structurally — this file imports no provider, only @shared/types and the
 * generic JsonStore; it is fed exclusively by data a scan already fetched.
 */
import type { ArbOpportunity, BookLeaderboardEntry, Leaderboard, OddsEvent } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

/** Persisted per-book counts, pre-share (share is a read-time ratio against
 *  the CURRENT totalScans, never frozen at accrual time). */
interface StoredBook {
  key: string;
  title: string;
  appearances: number;
  legCounts: { arb: number; ev: number; middle: number };
  firstSeenAt: string;
  lastSeenAt: string;
}

interface LeaderboardData {
  /** Stamped once, the first time this store ever accrues — "since <date>"
   *  in the UI, NOT "since paper start". */
  createdAt: string;
  totalScans: number;
  books: StoredBook[];
}

export interface LeaderboardScanInput {
  /** The scan's raw feed — every book present, before allowlist filtering
   *  (mirrors ScanLogEntry.distinctBooks' source). */
  events: OddsEvent[];
  /** Detected opportunities this scan — arb + ev + middle, pre-alert-filter
   *  (mirrors what opportunityLog.recordScan and scanLog both see). */
  opportunities: ArbOpportunity[];
}

export class LeaderboardStore {
  private readonly store: JsonStore<LeaderboardData>;

  constructor(
    filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new JsonStore<LeaderboardData>(
      filePath,
      () => ({ createdAt: this.now().toISOString(), totalScans: 0, books: [] }),
      (parsed) => {
        const data = (parsed ?? {}) as Partial<LeaderboardData>;
        return {
          createdAt: data.createdAt ?? this.now().toISOString(),
          totalScans: data.totalScans ?? 0,
          books: data.books ?? [],
        };
      },
    );
  }

  async read(): Promise<Leaderboard> {
    return toLeaderboard(await this.store.read());
  }

  /** One accrual per scan: feed presence (appearances) plus every detected
   *  opportunity's legs (legCounts), keyed by bookmaker. */
  async accrue(input: LeaderboardScanInput): Promise<void> {
    const at = this.now().toISOString();
    await this.store.update((data) => {
      const byKey = new Map(data.books.map((b) => [b.key, b]));
      const blank = (key: string, title: string): StoredBook => ({
        key,
        title,
        appearances: 0,
        legCounts: { arb: 0, ev: 0, middle: 0 },
        firstSeenAt: at,
        lastSeenAt: at,
      });

      const seenBooks = new Map<string, string>();
      for (const event of input.events) {
        for (const book of event.bookmakers) seenBooks.set(book.key, book.title);
      }
      for (const [key, title] of seenBooks) {
        const entry = byKey.get(key) ?? blank(key, title);
        entry.title = title;
        entry.appearances += 1;
        entry.lastSeenAt = at;
        byKey.set(key, entry);
      }

      for (const opp of input.opportunities) {
        const strategy = opp.ev ? 'ev' : opp.middle ? 'middle' : 'arb';
        for (const leg of opp.legs) {
          const entry = byKey.get(leg.bookmakerKey) ?? blank(leg.bookmakerKey, leg.bookmakerTitle);
          entry.legCounts[strategy] += 1;
          byKey.set(leg.bookmakerKey, entry);
        }
      }

      const next: LeaderboardData = {
        createdAt: data.createdAt,
        totalScans: data.totalScans + 1,
        books: [...byKey.values()],
      };
      return { data: next, result: undefined };
    });
  }
}

/** Pure: share is always computed against the CURRENT totalScans, sorted
 *  most-active book first (same shape coverageService.computeCoverage uses
 *  for BookCoverage). */
function toLeaderboard(data: LeaderboardData): Leaderboard {
  const totalLegs = (b: StoredBook) => b.legCounts.arb + b.legCounts.ev + b.legCounts.middle;
  const books: BookLeaderboardEntry[] = [...data.books]
    .map((b) => ({
      ...b,
      share: data.totalScans > 0 ? Math.round((b.appearances / data.totalScans) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => totalLegs(b) - totalLegs(a) || b.appearances - a.appearances);
  return { createdAt: data.createdAt, totalScans: data.totalScans, books };
}
