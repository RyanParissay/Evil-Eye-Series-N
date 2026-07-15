// Journal minimum (Plan 5, Design §7): "The brain always writes at least this
// many entries and as many more as it wants." Deterministic observations from
// live tables, riding the scan tick — no timers, no LLM, no fabrication.
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { displayName } from './pass.js';

/** Appends observation lines until today's journal count reaches journalMinPerDay
 *  (at most 3 supplementary lines — where distinct honest observations end, so does
 *  the knob's range). Kill switch on → writes nothing (autonomy stopped). */
export function ensureJournalMinimum(deps: PipeDeps, now: number): number {
  const s = deps.s();
  if (s.brainKillSwitch !== 0) return 0;
  const day = dayKey(now);
  const existing = deps.repos.journal.all().filter((j) => dayKey(j.ts) === day).length;
  const need = Math.min(3, Math.max(0, s.journalMinPerDay - existing));
  if (need === 0) return 0;
  const lines = observationLines(deps, now, day).slice(0, need);
  for (const line of lines) deps.repos.journal.add(now, line);
  return lines.length;
}

function observationLines(deps: PipeDeps, now: number, day: string): string[] {
  const { repos } = deps;
  const s = deps.s();
  const hottest = repos.books.all()
    .filter((b) => b.sharpExempt === 0)
    .sort((a, b) => b.heat - a.heat || (a.name < b.name ? -1 : 1))
    .slice(0, 3);
  const killed = Object.values(repos.trades.killedTodayByReason(day)).reduce((sum, n) => sum + (n ?? 0), 0);
  const monthKey = day.slice(0, 7);
  const used = repos.credits.all()
    .filter((c) => dayKey(c.ts).startsWith(monthKey))
    .reduce((sum, c) => sum + c.n, 0);
  return [
    `Watch list: ${hottest.map((b) => `${displayName(b.name)} ${b.heat}`).join(' · ')}`,
    `Today so far: ${repos.trades.countToday(day)} candidates · ${repos.trades.verifiedSentToday(day)} sent · ${killed} killed`,
    `Credits used this month: ${used.toLocaleString('en-US')} of ${s.creditPlanMonthly.toLocaleString('en-US')}`,
  ];
}
