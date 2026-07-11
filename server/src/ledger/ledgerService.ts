/**
 * The ledger read model: every opportunity ever persisted — active file
 * plus the append-only monthly JSONL archives — streamed record by record
 * (readline over a file stream, never a whole-file read) into P&L
 * aggregates. All money math happens here server-side; the client renders.
 */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DecayStat, LedgerSummary, OpportunityRecord } from '@shared/types';
import type { OpportunityData } from '../opportunities/opportunityStore';

export class LedgerService {
  constructor(
    private readonly active: { read(): Promise<OpportunityData> },
    private readonly archiveDir: string,
  ) {}

  /** Archived (settled) records first, then the active file. */
  private async *allRecords(): AsyncGenerator<OpportunityRecord> {
    let files: string[] = [];
    try {
      files = (await readdir(this.archiveDir)).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {
      // No archive yet — normal on a fresh install.
    }
    for (const file of files) {
      const lines = createInterface({
        input: createReadStream(join(this.archiveDir, file), 'utf8'),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as OpportunityRecord;
          yield { ...parsed, strategy: parsed.strategy ?? 'arb' };
        } catch {
          console.warn(`Skipping unparseable archive line in ${file}`);
        }
      }
    }
    for (const record of (await this.active.read()).records) {
      yield record;
    }
  }

  /** Every record, active + archived, as a list (ops survival/telemetry). */
  async allRecordsList(): Promise<OpportunityRecord[]> {
    const all: OpportunityRecord[] = [];
    for await (const record of this.allRecords()) all.push(record);
    return all;
  }

  /** The newest N records by detection time — bounded regardless of archive size. */
  async recentRows(limit: number): Promise<OpportunityRecord[]> {
    const kept: OpportunityRecord[] = [];
    for await (const record of this.allRecords()) {
      kept.push(record);
      if (kept.length > limit * 2) {
        kept.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
        kept.length = limit;
      }
    }
    kept.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    return kept.slice(0, limit);
  }

  async summarize(): Promise<LedgerSummary> {
    let totalLockedProfit = 0;
    let completions = 0;
    let unpricedCompletions = 0;
    let alertedCount = 0;
    const executions: Array<{ at: string; profit: number }> = [];
    const monthly = new Map<string, { lockedProfit: number; completions: number }>();
    const byBook = new Map<
      string,
      { title: string; staked: number; lockedProfitShare: number; legs: number }
    >();
    const bySport = new Map<string, { title: string; lockedProfit: number; completions: number }>();
    const decayAll: number[] = [];
    const decayByBook = new Map<string, { title: string; drops: number[] }>();

    for await (const record of this.allRecords()) {
      if (record.alerted) alertedCount += 1;

      // Decay: detection vs the latest priced evidence; unknown is excluded.
      const latestPct = latestEvidencePct(record);
      if (latestPct != null) {
        const drop = record.profitPctAtDetection - latestPct;
        decayAll.push(drop);
        for (const leg of record.legs) {
          const entry = decayByBook.get(leg.bookmakerKey) ?? { title: leg.bookmakerTitle, drops: [] };
          entry.drops.push(drop);
          decayByBook.set(leg.bookmakerKey, entry);
        }
      }

      if (record.status !== 'completed') continue;
      completions += 1;
      const execution = record.execution;
      if (!execution) {
        unpricedCompletions += 1;
        continue;
      }

      totalLockedProfit += execution.lockedProfit;
      executions.push({ at: execution.recordedAt, profit: execution.lockedProfit });

      const month = execution.recordedAt.slice(0, 7);
      const bucket = monthly.get(month) ?? { lockedProfit: 0, completions: 0 };
      bucket.lockedProfit += execution.lockedProfit;
      bucket.completions += 1;
      monthly.set(month, bucket);

      const sport = bySport.get(record.sportKey) ?? {
        title: record.sportTitle,
        lockedProfit: 0,
        completions: 0,
      };
      sport.lockedProfit += execution.lockedProfit;
      sport.completions += 1;
      bySport.set(record.sportKey, sport);

      record.legs.forEach((leg, i) => {
        const filled = execution.filledLegs[i];
        if (!filled) return;
        const entry = byBook.get(leg.bookmakerKey) ?? {
          title: leg.bookmakerTitle,
          staked: 0,
          lockedProfitShare: 0,
          legs: 0,
        };
        entry.staked += filled.stake;
        entry.legs += 1;
        if (execution.totalStaked > 0) {
          entry.lockedProfitShare += execution.lockedProfit * (filled.stake / execution.totalStaked);
        }
        byBook.set(leg.bookmakerKey, entry);
      });
    }

    executions.sort((a, b) => a.at.localeCompare(b.at));
    let running = 0;
    const equity = executions.map(({ at, profit }) => {
      running += profit;
      return { at, cumulativeProfit: round2(running) };
    });

    return {
      realized: {
        totalLockedProfit: round2(totalLockedProfit),
        completions,
        unpricedCompletions,
      },
      equity,
      monthly: [...monthly.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, bucket]) => ({
          month,
          lockedProfit: round2(bucket.lockedProfit),
          completions: bucket.completions,
        })),
      byBook: [...byBook.entries()]
        .sort(([, a], [, b]) => b.staked - a.staked)
        .map(([bookmakerKey, entry]) => ({
          bookmakerKey,
          title: entry.title,
          staked: round2(entry.staked),
          lockedProfitShare: round2(entry.lockedProfitShare),
          legs: entry.legs,
        })),
      bySport: [...bySport.entries()]
        .sort(([, a], [, b]) => b.lockedProfit - a.lockedProfit)
        .map(([sportKey, entry]) => ({
          sportKey,
          title: entry.title,
          lockedProfit: round2(entry.lockedProfit),
          completions: entry.completions,
        })),
      captureRate: {
        alerted: alertedCount,
        completed: completions,
        rate: alertedCount > 0 ? round4(completions / alertedCount) : null,
      },
      decay: {
        overall: decayStat(decayAll),
        byBook: [...decayByBook.entries()]
          .sort(([, a], [, b]) => b.drops.length - a.drops.length)
          .map(([bookmakerKey, entry]) => ({
            bookmakerKey,
            title: entry.title,
            ...decayStat(entry.drops),
          })),
      },
    };
  }

  /** One row per opportunity, streamed to the sink chunk by chunk. */
  async exportCsv(write: (chunk: string) => void): Promise<void> {
    const legCols = (i: number) =>
      ['book', 'outcome', 'last_odds', 'stake_per_100', 'filled_odds', 'filled_stake'].map(
        (c) => `leg${i}_${c}`,
      );
    write(
      [
        'id',
        'fingerprint',
        'strategy',
        'status',
        'sport',
        'event',
        'market',
        'region_tab',
        'detected_at',
        'commence_time',
        'alerted',
        'alerted_at',
        'profit_pct_at_detection',
        'last_profit_pct',
        ...legCols(1),
        ...legCols(2),
        ...legCols(3),
        'total_staked',
        'locked_profit',
        'completed_at',
        'cockpit_opened_at',
        'verify_pressed_at',
        'fills_opened_at',
        'verify_count',
        'last_verify_outcome',
        'gone_lifetime_ms',
      ].join(',') + '\n',
    );

    for await (const record of this.allRecords()) {
      const legs = [0, 1, 2].flatMap((i) => {
        const leg = record.legs[i];
        const filled = record.execution?.filledLegs[i];
        return leg
          ? [leg.bookmakerKey, leg.outcome, leg.odds, leg.stake, filled?.odds ?? '', filled?.stake ?? '']
          : ['', '', '', '', '', ''];
      });
      const row = [
        record.id,
        record.fingerprint,
        record.strategy,
        record.status,
        record.sportKey,
        record.eventName,
        record.marketKey,
        record.regionTab,
        record.detectedAt,
        record.commenceTime,
        record.alerted,
        record.alertedAt ?? '',
        record.profitPctAtDetection,
        record.profitPct,
        ...legs,
        record.execution?.totalStaked ?? '',
        record.execution?.lockedProfit ?? '',
        record.execution?.recordedAt ?? '',
        record.funnel?.cockpitOpenedAt ?? '',
        record.funnel?.verifyPressedAt ?? '',
        record.funnel?.fillsOpenedAt ?? '',
        record.verifies?.length ?? 0,
        record.verifies?.[record.verifies.length - 1]?.outcome ?? '',
        goneLifetimeMs(record) ?? '',
      ];
      write(row.map(csvEscape).join(',') + '\n');
    }
  }
}

/** first-seen → gone, absence-deaths only (commencement kills excluded). */
function goneLifetimeMs(record: OpportunityRecord): number | null {
  if (record.status !== 'dead') return null;
  if (Date.parse(record.commenceTime) <= Date.parse(record.statusChangedAt)) return null;
  return Date.parse(record.statusChangedAt) - Date.parse(record.detectedAt);
}

function latestEvidencePct(record: OpportunityRecord): number | null {
  if (record.execution && record.execution.totalStaked > 0) {
    return (record.execution.lockedProfit / record.execution.totalStaked) * 100;
  }
  // Re-sighted or re-verified after detection: the stored profit moved on.
  if (record.lastSeenAt !== record.detectedAt) return record.profitPct;
  return null;
}

function decayStat(drops: number[]): DecayStat {
  if (drops.length === 0) return { samples: 0, avgDropPp: null };
  return {
    samples: drops.length,
    avgDropPp: round2(drops.reduce((sum, d) => sum + d, 0) / drops.length),
  };
}

/** Excel-safe CSV field: quote strings, double quotes, defang formulas. */
export function csvEscape(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  const text = String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
