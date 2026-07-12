/**
 * Book leaderboards (Phase 15 #1). The raw odds snapshot is latest-only, so
 * historic re-detection is impossible (see CLAUDE.md) — counts ACCRUE per
 * scan going forward instead: per book, appearances in the raw feed and
 * opportunity-leg counts by strategy (arb/ev/middle). Zero credits
 * structurally — this file imports no provider, only @shared/types and the
 * generic JsonStore; it is fed exclusively by data a scan already fetched.
 */
import type {
  ArbOpportunity,
  BookLeaderboardEntry,
  HubLeaderboardRow,
  HubLeaderboards,
  Leaderboard,
  OddsEvent,
} from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

type StrategyKey = 'arb' | 'ev' | 'middle';

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
  /** Phase 16 (additive): cumulative opportunity COUNT per strategy — the
   *  denominator for the Hub boards' occurrencePct. Accrues forward, same as
   *  everything else here (the raw snapshot is latest-only, so history can't
   *  be recomputed). Absent on pre-Phase-16 files → migrated to zeros. */
  oppTotals: { arb: number; ev: number; middle: number };
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
  /** In-memory memo of the Hub boards; invalidated on every store write. */
  private hubCache: HubLeaderboards | null = null;

  constructor(
    filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new JsonStore<LeaderboardData>(
      filePath,
      () => ({ createdAt: this.now().toISOString(), totalScans: 0, books: [], oppTotals: blankTotals() }),
      (parsed) => {
        const data = (parsed ?? {}) as Partial<LeaderboardData>;
        return {
          createdAt: data.createdAt ?? this.now().toISOString(),
          totalScans: data.totalScans ?? 0,
          books: data.books ?? [],
          oppTotals: { ...blankTotals(), ...(data.oppTotals ?? {}) },
        };
      },
    );
  }

  async read(): Promise<Leaderboard> {
    return toLeaderboard(await this.store.read());
  }

  /** Phase 16 Hub boards — top 10 books per strategy with occurrencePct.
   *  Served from an in-memory cache invalidated whenever accrue() writes. */
  async readHubLeaderboards(): Promise<HubLeaderboards> {
    if (this.hubCache) return this.hubCache;
    this.hubCache = toHubLeaderboards(await this.store.read());
    return this.hubCache;
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

      const oppTotals = { ...data.oppTotals };
      for (const opp of input.opportunities) {
        const strategy = opp.ev ? 'ev' : opp.middle ? 'middle' : 'arb';
        oppTotals[strategy] += 1;
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
        oppTotals,
      };
      return { data: next, result: undefined };
    });
    // The store write above changed the accrued counts — drop the memo so the
    // next Hub read recomputes.
    this.hubCache = null;
  }
}

function blankTotals(): { arb: number; ev: number; middle: number } {
  return { arb: 0, ev: 0, middle: 0 };
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

/** Pure: one top-10 board per strategy. count = the book's leg appearances in
 *  that strategy's opportunities (two-leg strategies credit both legs' books);
 *  occurrencePct = count ÷ that strategy's total opportunity count × 100,
 *  recomputed against the CURRENT totals (never frozen at accrual time). */
function toHubLeaderboards(data: LeaderboardData): HubLeaderboards {
  const board = (strategy: StrategyKey): HubLeaderboardRow[] => {
    const total = data.oppTotals[strategy];
    return data.books
      .filter((b) => b.legCounts[strategy] > 0)
      .map((b) => ({
        bookmakerKey: b.key,
        title: b.title,
        count: b.legCounts[strategy],
        occurrencePct: total > 0 ? Math.round((b.legCounts[strategy] / total) * 10000) / 100 : 0,
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.occurrencePct - a.occurrencePct ||
          a.bookmakerKey.localeCompare(b.bookmakerKey),
      )
      .slice(0, 10);
  };
  return { sinceAt: data.createdAt, arb: board('arb'), ev: board('ev'), middle: board('middle') };
}
