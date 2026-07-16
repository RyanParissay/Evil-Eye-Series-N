// Trade actions (Task 12): the user-facing verbs on a promoted trade — the
// confirm/unconfirm cycle, limited reports, manual settlement — plus the sim
// auto-settlement pass that resolves stale CONFIRMED/UNCONFIRMED trades.
// Money is ALWAYS integer cents; resultCents is SIGNED (negative = loss).

import type { Trade, TradeStatus } from '../shared/types.js';
import type { Repos } from '../db/db.js';
import type { PipeDeps } from './scan.js';
import { applyLimitsReport } from '../brain/pass.js';

/** Invalid status transition — Task 13 maps this to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Unknown trade id — Task 13 maps this to HTTP 404 (never a 409). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const SETTLE_CUTOFF_MS = 3 * 3_600_000; // events settle once 3h past their start
const EV_WIN_PROB = 0.55;
const MIDDLE_WIN_PROB = 0.3;

function mustGet(repos: Repos, id: string): Trade {
  const t = repos.trades.byId(id);
  if (!t) throw new NotFoundError(`trade ${id} not found`);
  return t;
}

/**
 * Shared transition core. Re-applying the CURRENT status is a no-op success —
 * double-taps from the UI never error. Anything else outside `from` conflicts.
 */
function transition(repos: Repos, id: string, from: TradeStatus, to: TradeStatus, verb: string): Trade {
  const t = mustGet(repos, id);
  if (t.status === to) return t;
  if (t.status !== from) throw new ConflictError(`cannot ${verb} a ${t.status} trade`);
  t.status = to;
  repos.trades.update(t);
  return t;
}

/** VERIFIED → CONFIRMED — stamps confirmedAt (Plan 4: the followed-pick timestamp;
 *  a no-op double-tap keeps the first stamp). */
export function confirmTrade(repos: Repos, id: string, now: number): Trade {
  const t = transition(repos, id, 'VERIFIED', 'CONFIRMED', 'confirm');
  if (t.confirmedAt == null) {
    t.confirmedAt = now;
    repos.trades.update(t);
  }
  return t;
}

/** CONFIRMED → VERIFIED — the UI cycle back when a confirm was a mis-tap. Clears the stamp. */
export function unconfirmTrade(repos: Repos, id: string, now: number): Trade {
  void now;
  const t = transition(repos, id, 'CONFIRMED', 'VERIFIED', 'unconfirm');
  if (t.confirmedAt != null) {
    t.confirmedAt = null;
    repos.trades.update(t);
  }
  return t;
}

/**
 * A book limited the account on this trade: log the report, then update the
 * brain immediately (MASTER PROMPT §4 — "logged to Advanced Analytics + Brain
 * updated"): the book's heat/health/belief recompute now and the brain writes
 * the journal line. The trade keeps whatever status it had.
 */
export function reportLimited(repos: Repos, id: string, book: string, maxAllowedCents: number, now: number): void {
  const t = mustGet(repos, id);
  repos.limitsReports.add(t.id, book, maxAllowedCents, now);
  applyLimitsReport(repos, repos.settings.all(), t, book, maxAllowedCents, now);
}

/**
 * Manual settlement: CONFIRMED/UNCONFIRMED → SETTLED. `amountCents` is the
 * magnitude; `result` supplies the sign (LOST stores it negative). A trade
 * already SETTLED is a no-op — the first result stands.
 */
export function settleTrade(repos: Repos, id: string, result: 'WON' | 'LOST', amountCents: number, now: number): Trade {
  const t = mustGet(repos, id);
  if (t.status === 'SETTLED') return t;
  if (t.status !== 'CONFIRMED' && t.status !== 'UNCONFIRMED') {
    throw new ConflictError(`cannot settle a ${t.status} trade`);
  }
  const magnitude = Math.abs(Math.round(amountCents));
  markSettled(t, result === 'WON' ? magnitude : -magnitude, now);
  repos.trades.update(t);
  return t;
}

/**
 * Sim auto-settlement: every CONFIRMED then UNCONFIRMED trade (oldest first
 * within each — the fixed order keeps seeded runs reproducible) whose event
 * started over 3h ago resolves via the rng. VERIFIED trades are never touched:
 * un-actioned cards expire through the pipeline sweep instead.
 */
export function runSimSettlement(deps: PipeDeps, now: number): { settled: number; won: number; lost: number } {
  const { repos } = deps;
  // Plan 6 (Design §13): rng outcomes are SIM-ONLY. In LIVE mode nothing
  // auto-settles until a real results feed ships — fabricating WON/LOST on
  // real money is the one dishonesty every plan forbids. Manual settles stand.
  if (deps.s().liveMode === 1) return { settled: 0, won: 0, lost: 0 };
  let won = 0;
  let lost = 0;

  const due = [...repos.trades.byStatus('CONFIRMED'), ...repos.trades.byStatus('UNCONFIRMED')]
    .filter((t) => t.eventStartsAt + SETTLE_CUTOFF_MS < now);
  for (const t of due) {
    const outcome = simOutcome(t, deps.rng);
    markSettled(t, outcome.resultCents, now);
    repos.trades.update(t);
    if (outcome.won) won += 1;
    else lost += 1;
  }

  const settled = won + lost;
  if (settled > 0) repos.eventsLog.add(now, 'settlement', JSON.stringify({ settled, won, lost }));
  return { settled, won, lost };
}

function markSettled(t: Trade, resultCents: number, now: number): void {
  t.status = 'SETTLED';
  t.resultCents = resultCents;
  t.settledAt = now;
}

/**
 * The simulated outcome, all payout math on the trade's own odds and stakes:
 * - ARB: always WON — promotion re-gates rounding, so marginFinal > 0 is a
 *   locked margin; it pays round(totalStaked × marginFinal).
 * - EV (single leg): wins with prob 0.55 → payout − stake; loses the stake.
 * - MIDDLE: hits with prob 0.30 → BOTH legs cash; a miss cashes one side, and
 *   the worse-paying leg is the basis (the conservative single-leg payout).
 */
export function simOutcome(t: Trade, rng: () => number): { won: boolean; resultCents: number } {
  const stakes = t.legs.map((l) => l.stakeCents ?? 0);
  const totalStaked = stakes.reduce((a, b) => a + b, 0);
  const payouts = t.legs.map((l, i) => l.odds * stakes[i]!);
  switch (t.category) {
    case 'ARB':
      return { won: true, resultCents: Math.round(totalStaked * (t.marginFinal ?? 0)) };
    case 'EV': {
      const wonRoll = rng() < EV_WIN_PROB;
      return {
        won: wonRoll,
        resultCents: wonRoll ? Math.round(payouts[0] ?? 0) - totalStaked : -totalStaked,
      };
    }
    case 'MIDDLE': {
      const wonRoll = rng() < MIDDLE_WIN_PROB;
      const payout = wonRoll ? payouts.reduce((a, b) => a + b, 0) : Math.min(...payouts);
      return { won: wonRoll, resultCents: Math.round(payout) - totalStaked };
    }
  }
}
