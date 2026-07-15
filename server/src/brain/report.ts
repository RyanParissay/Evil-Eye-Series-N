// Brain read model (Plan 3): ONE deterministic serialization of everything the
// BRAIN screen renders. Read-only — building the view never mutates state.
// Client mirror: client/src/lib/brain.ts. Every number names its source table.
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import { deriveBelief, suspicionLevel, type Health } from './heat.js';
import { gradeAll, type Grade } from './grades.js';
import {
  BRAIN_PASS_KIND, CUT_KIND, REJECT_KIND, displayName, lastPass, type PassPayload,
} from './pass.js';
import { closingEdge } from './closes.js';

export const ANCHOR_LABELS = ['PINNACLE', 'CIRCA', 'CONSENSUS'] as const;
const HISTORY_PASSES = 40; // suspicion chart depth: the last 40 consolidation passes (~10 days at 6h)
const DAY_MS = 86_400_000;

export type MarkKind = 'LIMIT REPORTED' | 'BET REJECTED' | 'STAKE CUT';

export interface BrainBookView {
  name: string;
  displayName: string;
  sport: string;
  sharpExempt: boolean;
  heat: number;
  health: Health;
  suspicion: number;
  maxBetCents: number | null;
  wasCents: number | null;
  history: { ts: number; heat: number }[];
  marks: { ts: number; kind: MarkKind }[];
}

export interface BrainView {
  lastFullPassAt: number | null;
  killSwitch: boolean;
  anchor: { idx: 0 | 1 | 2; label: (typeof ANCHOR_LABELS)[number]; effective: 'PINNACLE'; live: boolean };
  tiles: {
    credits: { remainingCredits: number; planCredits: number; runwayDays: number };
    doubleVerification: { passRatePct: number; edgeRetentionPct: number; rechecked: number } | null;
    todaysPicks: { sent: number; of: number; heldBack: number };
    closingPriceEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
  };
  rationale: { sent: number; candidates: number; passed: number; heldBackClauses: string[] };
  books: BrainBookView[];
  grades: Grade[];
  journal: { total: number; entries: { ts: number; text: string }[] };
  controls: { limit: number; reject: number; cut: number; withdrawal: number; halfLifeDays: number; cadenceHours: number };
  limitsThisMonth: number;
}

export function buildBrainView(deps: PipeDeps, now: number): BrainView {
  const { repos } = deps;
  const s = deps.s();
  const day = dayKey(now);
  const monthKey = day.slice(0, 7); // Vancouver 'YYYY-MM'

  // CREDITS tile ← credits_usage: month burn vs plan; runway from the trailing-7-day burn rate.
  const creditRows = repos.credits.all();
  const usedThisMonth = creditRows
    .filter((c) => dayKey(c.ts).startsWith(monthKey))
    .reduce((sum, c) => sum + c.n, 0);
  const used7d = creditRows
    .filter((c) => now - c.ts <= 7 * DAY_MS)
    .reduce((sum, c) => sum + c.n, 0);
  const remainingCredits = Math.max(0, s.creditPlanMonthly - usedThisMonth);
  const runwayDays = Math.floor(remainingCredits / Math.max(1, used7d / 7));

  // DOUBLE VERIFICATION tile ← trades with margin_recheck set (Task 1 recheckRows).
  const rechecks = repos.trades.recheckRows();
  let doubleVerification: BrainView['tiles']['doubleVerification'] = null;
  if (rechecks.length > 0) {
    const survivors = rechecks.filter((r) => r.status !== 'KILLED');
    const retentions = survivors
      .filter((r) => r.marginInitial > 0)
      .map((r) => r.marginRecheck / r.marginInitial)
      .sort((a, b) => a - b);
    const mid = retentions.length === 0 ? 0
      : retentions.length % 2 === 1 ? retentions[(retentions.length - 1) / 2]!
        : (retentions[retentions.length / 2 - 1]! + retentions[retentions.length / 2]!) / 2;
    doubleVerification = {
      passRatePct: Math.round((survivors.length / rechecks.length) * 100),
      edgeRetentionPct: Math.round(mid * 100),
      rechecked: rechecks.length,
    };
  }

  // TODAY'S PICKS tile + WHY ONLY n TODAY ← today's day_key slices (Task 1 queries).
  const sent = repos.trades.verifiedSentToday(day);
  const heldBack = repos.trades.heldBackToday(day);
  const candidates = repos.trades.countToday(day);
  const killedByReason = repos.trades.killedTodayByReason(day);
  const failedVerification = killedByReason.FAILED_VERIFICATION ?? 0;
  const batteryKills = Object.entries(killedByReason)
    .filter(([reason]) => reason !== 'FAILED_VERIFICATION')
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const heldBackClauses: string[] = [];
  if (failedVerification > 0) heldBackClauses.push(`${failedVerification} died at the recheck`);
  if (batteryKills > 0) heldBackClauses.push(`${batteryKills} killed by the gate battery`);
  if (heldBack > 0) heldBackClauses.push(`daily cap of ${s.dailyPickCap} held back ${heldBack}`);
  if (heldBackClauses.length === 0) heldBackClauses.push('nothing — every verified pick went out');

  // Suspicion history ← brain_pass ledger; marks ← limits_reports + reject/cut events.
  const passes = repos.eventsLog.byKind(BRAIN_PASS_KIND).slice(-HISTORY_PASSES)
    .map((row) => ({ ts: row.ts, payload: JSON.parse(row.payload) as PassPayload }));
  const historyStart = passes[0]?.ts ?? Number.POSITIVE_INFINITY;
  const allReports = repos.limitsReports.all();
  const markRows: { ts: number; kind: MarkKind; book: string }[] =
    allReports.map((r) => ({ ts: r.sentAt, kind: 'LIMIT REPORTED' as const, book: r.book }));
  for (const [kind, label] of [[REJECT_KIND, 'BET REJECTED'], [CUT_KIND, 'STAKE CUT']] as const) {
    for (const e of repos.eventsLog.byKind(kind)) {
      const payload = JSON.parse(e.payload) as { book?: string };
      markRows.push({ ts: e.ts, kind: label, book: payload.book ?? '' });
    }
  }
  const reportsByBook = new Map<string, number[]>();
  for (const r of allReports) {
    const list = reportsByBook.get(r.book) ?? [];
    list.push(r.maxAllowedCents);
    reportsByBook.set(r.book, list);
  }

  const books: BrainBookView[] = repos.books.all().map((b) => {
    const sharp = b.sharpExempt === 1;
    const belief = deriveBelief(reportsByBook.get(b.name) ?? [], sharp);
    return {
      name: b.name,
      displayName: displayName(b.name),
      sport: b.sport,
      sharpExempt: sharp,
      heat: b.heat,
      health: b.health,
      suspicion: sharp ? 1 : suspicionLevel(b.heat),
      maxBetCents: belief.maxBetCents,
      wasCents: belief.wasCents,
      history: passes.map((p) => ({ ts: p.ts, heat: p.payload.heats[b.name] ?? 0 })),
      marks: markRows
        .filter((m) => m.book === b.name && m.ts >= Math.min(historyStart, now) && m.ts <= now)
        .map(({ ts, kind }) => ({ ts, kind })),
    };
  });

  const last = lastPass(repos);
  const journalRows = repos.journal.all();
  const idx = (s.anchorIdx === 1 || s.anchorIdx === 2 ? s.anchorIdx : 0) as 0 | 1 | 2;

  return {
    lastFullPassAt: last?.ts ?? null,
    killSwitch: s.brainKillSwitch !== 0,
    anchor: {
      idx,
      label: ANCHOR_LABELS[idx],
      effective: 'PINNACLE', // sim truth — CIRCA/CONSENSUS render but map to pinnacle prices
      live: (deps.lastQuotes ?? []).some((q) => q.book === 'pinnacle'),
    },
    tiles: {
      credits: { remainingCredits, planCredits: s.creditPlanMonthly, runwayDays },
      doubleVerification,
      todaysPicks: { sent, of: sent + heldBack, heldBack },
      closingPriceEdge: closingEdge(repos, now),
    },
    rationale: { sent, candidates, passed: sent + heldBack, heldBackClauses },
    books,
    grades: gradeAll(repos.trades.byStatus('SETTLED')),
    journal: {
      total: journalRows.length,
      entries: [...journalRows].reverse().map((j) => ({ ts: j.ts, text: j.text })),
    },
    controls: {
      limit: s.heatWeightLimit, reject: s.heatWeightReject, cut: s.heatWeightCut,
      withdrawal: s.heatWeightWithdrawal, halfLifeDays: s.heatHalfLifeDays,
      cadenceHours: s.brainCadenceHours,
    },
    limitsThisMonth: allReports.filter((r) => dayKey(r.sentAt).startsWith(monthKey)).length,
  };
}
