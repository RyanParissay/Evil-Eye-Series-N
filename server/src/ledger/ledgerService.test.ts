import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpportunityRecord } from '@shared/types';
import { LedgerService, csvEscape } from './ledgerService';

const NOW = new Date('2026-07-10T12:00:00Z');

let dir: string;
let archiveDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-'));
  archiveDir = join(dir, 'archive');
  await mkdir(archiveDir, { recursive: true });
});

afterEach(() => rm(dir, { recursive: true, force: true }));

function record(overrides: Partial<OpportunityRecord>): OpportunityRecord {
  return {
    id: Math.random().toString(16).slice(2, 18),
    fingerprint: 'f'.repeat(64),
    strategy: 'arb',
    eventId: 'evt',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    eventName: 'A @ B',
    commenceTime: '2026-07-09T00:00:00Z',
    marketKey: 'h2h',
    legs: [
      { outcome: 'A', bookmakerKey: 'bet365', bookmakerTitle: 'Bet365', odds: 2.1, stake: 48.78, link: null },
      { outcome: 'B', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', odds: 2.05, stake: 51.22, link: null },
    ],
    profitPctAtDetection: 2.34,
    profitPct: 2.34,
    arbIndex: 0.977,
    status: 'dead',
    suspicious: false,
    sameBookmaker: false,
    regionTab: 'ca',
    detectedAt: '2026-07-08T10:00:00Z',
    lastSeenAt: '2026-07-08T10:00:00Z',
    statusChangedAt: '2026-07-08T10:00:00Z',
    alerted: false,
    alertedAt: null,
    ...overrides,
  };
}

function completed(
  month: string,
  lockedProfit: number,
  overrides: Partial<OpportunityRecord> = {},
): OpportunityRecord {
  const totalStaked = 500;
  return record({
    status: 'completed',
    alerted: true,
    alertedAt: `${month}-01T10:00:00Z`,
    execution: {
      filledLegs: [
        { odds: 2.1, stake: 250 },
        { odds: 2.05, stake: 250 },
      ],
      totalStaked,
      lockedProfit,
      recordedAt: `${month}-02T10:00:00Z`,
    },
    ...overrides,
  });
}

function service(active: OpportunityRecord[]) {
  return new LedgerService({ read: async () => ({ records: active }) }, archiveDir);
}

describe('LedgerService.summarize', () => {
  it('reconciles totals, monthly buckets, and equity to the cent across active + archive', async () => {
    // Two priced completions in the archive, one active, one unpriced completion.
    const archived = [completed('2026-05', 10.5), completed('2026-06', 7.25)];
    await appendFile(
      join(archiveDir, '2026-06.jsonl'),
      archived.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    const active = [
      completed('2026-07', 4.25),
      record({ status: 'completed', alerted: true }), // unpriced: counted, not summed
      record({ status: 'active' }),
    ];

    const summary = await service(active).summarize();
    expect(summary.realized.totalLockedProfit).toBeCloseTo(22, 2);
    expect(summary.realized.completions).toBe(4);
    expect(summary.realized.unpricedCompletions).toBe(1);
    expect(summary.monthly).toEqual([
      { month: '2026-05', lockedProfit: 10.5, completions: 1 },
      { month: '2026-06', lockedProfit: 7.25, completions: 1 },
      { month: '2026-07', lockedProfit: 4.25, completions: 1 },
    ]);
    const last = summary.equity[summary.equity.length - 1];
    expect(last.cumulativeProfit).toBeCloseTo(22, 2);
    // Stake-weighted book attribution: equal stakes → half of each profit.
    const bet365 = summary.byBook.find((b) => b.bookmakerKey === 'bet365')!;
    expect(bet365.lockedProfitShare).toBeCloseTo(11, 2);
    expect(bet365.staked).toBeCloseTo(750, 2);
  });

  it('computes capture rate and decay with honest fallbacks', async () => {
    const active = [
      // Priced completion: realized 2% vs detection 2.34% → drop 0.34pp.
      completed('2026-07', 10, {
        execution: {
          filledLegs: [
            { odds: 2.1, stake: 250 },
            { odds: 2.05, stake: 250 },
          ],
          totalStaked: 500,
          lockedProfit: 10,
          recordedAt: '2026-07-02T10:00:00Z',
        },
      }),
      // Re-verified (profit moved, never completed): decay from profitPct.
      record({ profitPct: 1.34, lastSeenAt: '2026-07-09T00:00:00Z', alerted: true }),
      // Never seen again after detection: excluded from decay entirely.
      record({ status: 'active' }),
    ];
    const summary = await service(active).summarize();
    expect(summary.captureRate).toEqual({ alerted: 2, completed: 1, rate: 0.5 });
    expect(summary.decay.overall.samples).toBe(2);
    // Drops: (2.34 − 2.0) and (2.34 − 1.34) → mean 0.67pp.
    expect(summary.decay.overall.avgDropPp).toBeCloseTo((0.34 + 1) / 2, 2);
  });

  it('streams a 10k-record archive without loading it whole', async () => {
    const chunk: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      chunk.push(JSON.stringify(completed('2026-06', 1)));
      if (chunk.length === 1000) {
        await appendFile(join(archiveDir, '2026-06.jsonl'), chunk.join('\n') + '\n');
        chunk.length = 0;
      }
    }
    const summary = await service([]).summarize();
    expect(summary.realized.completions).toBe(10_000);
    expect(summary.realized.totalLockedProfit).toBeCloseTo(10_000, 2);
    // Windowed row access stays bounded no matter the archive size.
    const rows = await service([]).recentRows(25);
    expect(rows).toHaveLength(25);
  });
});

describe('CSV export', () => {
  it('round-trips: parsing the export recovers the realized total to the cent', async () => {
    const active = [completed('2026-07', 4.25), completed('2026-07', -1.05), record({})];
    let csv = '';
    await service(active).exportCsv((chunk) => {
      csv += chunk;
    });
    const [header, ...lines] = csv.trim().split('\n');
    const columns = header.split(',');
    const profitIdx = columns.indexOf('locked_profit');
    expect(profitIdx).toBeGreaterThan(-1);
    expect(lines).toHaveLength(3);
    const total = lines
      .map((line) => parseCsvLine(line)[profitIdx])
      .filter((v) => v !== '')
      .reduce((sum, v) => sum + Number(v), 0);
    expect(total).toBeCloseTo(3.2, 2);
  });

  it('escapes quotes and guards Excel formula injection', () => {
    expect(csvEscape('he said "go"')).toBe('"he said ""go"""');
    expect(csvEscape('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvEscape(42)).toBe('42');
  });
});

/** Minimal quoted-field CSV parser for the round-trip assertion. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}
