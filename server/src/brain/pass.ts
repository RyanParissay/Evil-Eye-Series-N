// The brain pass (Plan 3, Design §6): recompute every book's heat/health/belief
// from the tables, journal state TRANSITIONS (never spam steady state), enforce
// the 1/day journal minimum, and append a 'brain_pass' events_log row whose
// payload is both the next pass's transition baseline and the suspicion chart's
// history. Runs on the scheduler's scan tick via brainPassIfDue — NO timers here.
import type { Strategy, Trade } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Book, Repos } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import {
  DEFAULT_BELIEF_CENTS, computeHeat, deriveBelief, deriveHealth,
  type Health, type HeatEvent,
} from './heat.js';
import { gradeAll } from './grades.js';

// events_log kinds owned by the brain. bet_rejected/stake_cut/withdrawal are
// CONSUMED here and defined here; sim emits none yet (live mode / future hooks
// write them) — the model reads honest zeros rather than faking incidents.
export const BRAIN_PASS_KIND = 'brain_pass';
export const REJECT_KIND = 'bet_rejected';
export const CUT_KIND = 'stake_cut';
export const WITHDRAWAL_KIND = 'withdrawal';

/** Seed-slug → screen name. The site table renders these; slugs stay in the db. */
export const BOOK_DISPLAY: Record<string, string> = {
  pinnacle: 'Pinnacle', bet365: 'Bet365', fanduel: 'FanDuel', draftkings: 'DraftKings',
  betmgm: 'BetMGM', caesars: 'Caesars', bet99: 'Bet99', sportsinteraction: 'Sports Interaction',
  betway: 'Betway', pointsbet: 'PointsBet', bwin: 'bwin', unibet: 'Unibet',
  bodog: 'Bodog', betvictor: 'Bet Victor', leovegas: 'LeoVegas', betrivers: 'BetRivers',
};
export function displayName(name: string): string {
  return BOOK_DISPLAY[name] ?? name;
}

export interface PassPayload {
  heats: Record<string, number>;
  healths: Record<string, Health>;
  grades: Record<Strategy, number>;
}

const HEALTH_WORD: Record<Health, string> = { green: 'green', yellow: 'amber', red: 'red' };
const POLICY: Record<Health, string> = {
  green: 'full speed restored',
  yellow: 'sharp bets there halved',
  red: 'nothing sharp goes there',
};
const GRADE_JOURNAL_DELTA = 5;

/** Whole-dollar display for journal lines: 50_000 → "$500". */
export function fmtDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Every heat-bearing incident for a book: limits reports + the three event kinds. */
export function heatEventsForBook(repos: Repos, book: string): HeatEvent[] {
  const out: HeatEvent[] = repos.limitsReports.all()
    .filter((r) => r.book === book)
    .map((r) => ({ kind: 'limit' as const, ts: r.sentAt }));
  const kinds = [
    [REJECT_KIND, 'reject'], [CUT_KIND, 'cut'], [WITHDRAWAL_KIND, 'withdrawal'],
  ] as const;
  for (const [kind, tag] of kinds) {
    for (const e of repos.eventsLog.byKind(kind)) {
      const payload = JSON.parse(e.payload) as { book?: string };
      if (payload.book === book) out.push({ kind: tag, ts: e.ts });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** The most recent brain_pass ledger row, parsed. */
export function lastPass(repos: Repos): { ts: number; payload: PassPayload } | null {
  const rows = repos.eventsLog.byKind(BRAIN_PASS_KIND);
  const last = rows[rows.length - 1];
  return last ? { ts: last.ts, payload: JSON.parse(last.payload) as PassPayload } : null;
}

interface BookState { heat: number; health: Health; maxBetCents: number | null }

function computeBookState(repos: Repos, book: Book, now: number, s: Settings): BookState {
  if (book.sharpExempt) return { heat: 0, health: 'green', maxBetCents: null };
  const events = heatEventsForBook(repos, book.name);
  const heat = computeHeat(events, repos.trades.sentVolumeByBook(book.name), now, s);
  const health = deriveHealth(heat, events, now, s);
  const reports = repos.limitsReports.all()
    .filter((r) => r.book === book.name)
    .map((r) => r.maxAllowedCents);
  return { heat, health, maxBetCents: deriveBelief(reports, false).maxBetCents };
}

export function runBrainPass(deps: PipeDeps, now: number): PassPayload {
  const s = deps.s();
  const { repos } = deps;
  const prev = lastPass(repos);
  const today = dayKey(now);
  const preEntries = repos.journal.all();
  const latestEntry = preEntries[preEntries.length - 1];
  const needsDailyCheck = !latestEntry || dayKey(latestEntry.ts) !== today;

  const heats: Record<string, number> = {};
  const healths: Record<string, Health> = {};
  for (const book of repos.books.all()) {
    const st = computeBookState(repos, book, now, s);
    if (st.heat !== book.heat || st.health !== book.health || st.maxBetCents !== book.maxBeliefCents) {
      repos.books.update(book.name, st.heat, st.health, st.maxBetCents);
    }
    heats[book.name] = st.heat;
    healths[book.name] = st.health;
    const prevHealth = prev?.payload.healths[book.name];
    if (prev && prevHealth && prevHealth !== st.health) {
      repos.journal.add(now, `Consolidation pass: ${displayName(book.name)} ${HEALTH_WORD[st.health]}`
        + ` → ${POLICY[st.health]} (heat ${prev.payload.heats[book.name] ?? 0}→${st.heat})`);
    }
  }

  const grades = gradeAll(repos.trades.byStatus('SETTLED'));
  const gradeMap = Object.fromEntries(grades.map((g) => [g.strategy, g.grade])) as Record<Strategy, number>;
  for (const g of grades) {
    const old = prev?.payload.grades[g.strategy];
    if (old !== undefined && Math.abs(old - g.grade) >= GRADE_JOURNAL_DELTA) {
      repos.journal.add(now, `${g.strategy} grade ${old}→${g.grade} — ${g.note}`);
    }
  }

  // JOURNAL MINIMUM 1/DAY: the first pass of a Vancouver day always leaves a trace.
  if (needsDailyCheck) {
    const total = Object.keys(healths).length;
    const green = Object.values(healths).filter((h) => h === 'green').length;
    repos.journal.add(now, `Daily check: ${green} of ${total} books green`
      + ` · grades ARB ${gradeMap.ARB} / EV ${gradeMap.EV} / MIDDLE ${gradeMap.MIDDLE}`);
  }

  const payload: PassPayload = { heats, healths, grades: gradeMap };
  repos.eventsLog.add(now, BRAIN_PASS_KIND, JSON.stringify(payload));
  return payload;
}

/** Cadence gate for the scheduler tick: 6h between passes, silent under the kill switch. */
export function brainPassIfDue(deps: PipeDeps, now: number): boolean {
  const s = deps.s();
  if (s.brainKillSwitch !== 0) return false;
  const prev = lastPass(deps.repos);
  if (prev && now - prev.ts < s.brainCadenceHours * 3_600_000) return false;
  runBrainPass(deps, now);
  return true;
}

/**
 * "Brain updated" for the TRADE LIMITED? flow (MASTER PROMPT §4): the caller has
 * already inserted the limits_reports row; recompute THAT book now and journal
 * one rich line. The next full pass will agree — same math, same inputs.
 */
export function applyLimitsReport(
  repos: Repos, s: Settings, t: Trade, book: string, maxAllowedCents: number, now: number,
): void {
  const b = repos.books.byName(book);
  if (!b) {
    repos.journal.add(now, `${t.category} ${t.event}: limit report for unknown book "${book}" — logged, no heat applied`);
    return;
  }
  if (b.sharpExempt) {
    repos.journal.add(now, `${t.category} ${t.event}: ${displayName(book)} limit report noted`
      + ' — sharp books don’t limit winners; no heat applied');
    return;
  }
  const beforeHeat = b.heat;
  const beforeBelief = b.maxBeliefCents ?? DEFAULT_BELIEF_CENTS;
  const st = computeBookState(repos, b, now, s);
  repos.books.update(book, st.heat, st.health, st.maxBetCents);
  const suffix = st.health === 'red' ? ', quit rule armed' : st.health === 'yellow' ? ', going gentle' : '';
  repos.journal.add(now, `${t.category} ${t.event}: ${displayName(book)} limit report`
    + ` → heat ${beforeHeat}→${st.heat}, max bet ${fmtDollars(beforeBelief)}→${fmtDollars(maxAllowedCents)}${suffix}`);
}
