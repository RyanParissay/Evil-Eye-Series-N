// Closing price edge (Plan 3, Design §9). The sim provider regenerates events
// the moment they start, so closes are captured PRE-start: on every scan tick,
// every sent trade whose event begins within the hot window gets its legs'
// current quotes appended as a close_capture row. The LATEST capture before
// start is "the last cached pre-start sweep" — the close. Append-forever, no
// updates, no deletes.
import type { Quote } from '../shared/types.js';
import type { Repos } from '../db/db.js';
import type { PipeDeps } from '../pipeline/scan.js';

export const CLOSE_KIND = 'close_capture';

export interface CloseLeg { book: string; selection: string; oddsAtBet: number; closeOdds: number }
export interface ClosePayload { tradeId: string; eventStartsAt: number; legs: CloseLeg[] }

/** Sent = verified_at stamped. EXPIRED stays in: a stale sent pick still measures pick quality. */
const SENT_STATUSES = ['VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED'] as const;

/** Same event+book+selection; ties across lines go to the odds nearest the stored price (mirrors verify.ts). */
function nearestQuote(quotes: Quote[], event: string, book: string, selection: string, odds: number): Quote | null {
  let best: Quote | null = null;
  for (const q of quotes) {
    if (q.event !== event || q.book !== book || q.selection !== selection) continue;
    if (!best || Math.abs(q.odds - odds) < Math.abs(best.odds - odds)) best = q;
  }
  return best;
}

export function captureCloses(deps: PipeDeps, now: number): number {
  const quotes = deps.lastQuotes ?? [];
  if (quotes.length === 0) return 0;
  const windowMs = deps.s().hotWindowHours * 3_600_000;
  let captured = 0;
  for (const status of SENT_STATUSES) {
    for (const t of deps.repos.trades.byStatus(status)) {
      if (t.verifiedAt === null) continue; // held-back EXPIRED trades were never sent
      if (t.eventStartsAt <= now || t.eventStartsAt - now > windowMs) continue;
      const legs: CloseLeg[] = [];
      for (const leg of t.legs) {
        const q = nearestQuote(quotes, t.event, leg.book, leg.selection, leg.odds);
        if (!q) break;
        legs.push({ book: leg.book, selection: leg.selection, oddsAtBet: leg.odds, closeOdds: q.odds });
      }
      if (legs.length !== t.legs.length) continue; // partial quotes → no capture this tick
      const payload: ClosePayload = { tradeId: t.id, eventStartsAt: t.eventStartsAt, legs };
      deps.repos.eventsLog.add(now, CLOSE_KIND, JSON.stringify(payload));
      captured += 1;
    }
  }
  return captured;
}

export interface ClosingEdge { avgPct: number; beatClosePct: number; legs: number }

/** Per-leg edge = oddsAtBet/closeOdds − 1 (bet at better-than-close odds ⇒ positive). */
export function closingEdge(repos: Repos, now: number): ClosingEdge | null {
  const latest = new Map<string, ClosePayload>(); // rows arrive ts-ascending → last write wins
  for (const row of repos.eventsLog.byKind(CLOSE_KIND)) {
    const p = JSON.parse(row.payload) as ClosePayload;
    latest.set(p.tradeId, p);
  }
  const edges: number[] = [];
  for (const p of latest.values()) {
    if (p.eventStartsAt > now) continue; // a close is final only once the event starts
    for (const l of p.legs) {
      if (l.closeOdds > 0) edges.push(l.oddsAtBet / l.closeOdds - 1);
    }
  }
  if (edges.length === 0) return null;
  const avg = edges.reduce((a, b) => a + b, 0) / edges.length;
  const beat = edges.filter((e) => e > 0).length / edges.length;
  return {
    avgPct: Math.round(avg * 1000) / 10,
    beatClosePct: Math.round(beat * 100),
    legs: edges.length,
  };
}
