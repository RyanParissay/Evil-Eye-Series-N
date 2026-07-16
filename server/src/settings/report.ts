// Settings view (Plan 5): ONE deterministic serialization of everything the
// SETTINGS screen renders beyond the raw store. Read-only. Client mirror:
// client/src/lib/settings.ts. Every number names its source table.
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName, lastPass, type PassPayload } from '../brain/pass.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';
import { disabledSportSet } from '../pipeline/eligibility.js';
import { modeLabel } from '../live/mode.js';

const DAY_MS = 86_400_000;
/** $3/month hard cap — Plan 6 enforces the spend; Plan 5 displays it honestly. */
export const LLM_CAP_CENTS = 300;

export interface SettingsBookView {
  name: string; displayName: string; sport: string; sharpExempt: boolean; enabled: boolean;
}

export interface SettingsView {
  mode: 'SIMULATED' | 'LIVE';
  settings: Settings;
  forecaster: {
    projectedPerDay: number; dailyAllowance: number; usedThisMonth: number;
    monthEndProjection: number; planMonthly: number; remaining: number; runwayDays: number;
  };
  brain: {
    lastPassAt: number | null; lastPassBooks: number | null;
    llmSpentCents: number; llmCapCents: number; weightsCustom: boolean;
  };
  books: SettingsBookView[];
  sports: { sport: string; enabled: boolean }[];
  safetyLocked: boolean;
  memory: { receipts: number; journalEntries: number };
  lastTickAt: number | null;
  backups: { lastAt: number | null; keep: 14 };
}

export function buildSettingsView(deps: PipeDeps, now: number): SettingsView {
  const { repos } = deps;
  const s = deps.s();
  const day = dayKey(now);
  const monthKey = day.slice(0, 7);

  // CREDIT FORECASTER ← credits_usage (same math family as the brain's CREDITS tile).
  const creditRows = repos.credits.all();
  const usedThisMonth = creditRows
    .filter((c) => dayKey(c.ts).startsWith(monthKey))
    .reduce((sum, c) => sum + c.n, 0);
  const used7d = creditRows.filter((c) => now - c.ts <= 7 * DAY_MS).reduce((sum, c) => sum + c.n, 0);
  const projectedPerDay = Math.round(used7d / 7);
  const remaining = Math.max(0, s.creditPlanMonthly - usedThisMonth);

  const books = repos.books.all();
  const weightsCustom =
    s.heatWeightLimit !== DEFAULT_SETTINGS.heatWeightLimit
    || s.heatWeightReject !== DEFAULT_SETTINGS.heatWeightReject
    || s.heatWeightCut !== DEFAULT_SETTINGS.heatWeightCut
    || s.heatWeightWithdrawal !== DEFAULT_SETTINGS.heatWeightWithdrawal
    || s.heatHalfLifeDays !== DEFAULT_SETTINGS.heatHalfLifeDays;

  const last = lastPass(repos);
  // The LLM ledger is integer micro-dollars (Plan 6); convert to cents for display,
  // rounding UP so spend is never understated.
  const llmSpentCents = Math.ceil(
    repos.eventsLog.byKind('llm_spend')
      .reduce((sum, e) => sum + ((JSON.parse(e.payload) as { costMicro?: number }).costMicro ?? 0), 0) / 10_000,
  );
  const scans = repos.eventsLog.byKind('scan');
  const backupRows = repos.eventsLog.byKind('backup'); // Plan 6 writes these
  const disabled = disabledSportSet(s);
  const sports = [...new Set(books.filter((b) => b.sport !== 'ANY').map((b) => b.sport))].sort();

  return {
    mode: modeLabel(s),
    settings: s,
    forecaster: {
      projectedPerDay,
      dailyAllowance: Math.floor(s.creditPlanMonthly / 30),
      usedThisMonth,
      monthEndProjection: usedThisMonth + projectedPerDay * daysLeftInMonth(day),
      planMonthly: s.creditPlanMonthly,
      remaining,
      runwayDays: Math.floor(remaining / Math.max(1, used7d / 7)),
    },
    brain: {
      lastPassAt: last?.ts ?? null,
      lastPassBooks: last ? Object.keys((last.payload as PassPayload).heats).length : null,
      llmSpentCents,
      llmCapCents: LLM_CAP_CENTS,
      weightsCustom,
    },
    books: books.map((b) => ({
      name: b.name, displayName: displayName(b.name), sport: b.sport,
      sharpExempt: b.sharpExempt === 1, enabled: b.enabled === 1,
    })),
    sports: sports.map((sport) => ({ sport, enabled: !disabled.has(sport) })),
    safetyLocked: books.some((b) => b.sharpExempt === 0 && b.health !== 'green'),
    memory: { receipts: repos.trades.exportRows().length, journalEntries: repos.journal.all().length },
    lastTickAt: scans.length > 0 ? scans[scans.length - 1]!.ts : null,
    backups: { lastAt: backupRows.length > 0 ? backupRows[backupRows.length - 1]!.ts : null, keep: 14 },
  };
}

function daysLeftInMonth(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, daysInMonth - d);
}

/** RFC-4180: quote fields containing comma/quote/newline; double inner quotes. */
export function tradesCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    const raw = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','));
  return lines.join('\n');
}
