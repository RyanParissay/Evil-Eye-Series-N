// Scan half of the core loop (Task 11): one provider snapshot → candidate
// detection → kill battery → survivors become PENDING trades awaiting the
// recheck. Money NEVER appears here — pending legs carry stakeCents null until
// promotion (verify.ts); a pending card is book + selection + odds only.

import type { AlertSender, OddsProvider, Quote, Trade } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';
import type { Repos } from '../db/db.js';
import { runKillBattery, type Candidate, type GateContext } from '../engine/gates.js';
import { detectCandidates } from './candidates.js';
import { eligibleQuotes } from './eligibility.js';
import { dayKey } from '../scheduler/vancouverTime.js';

const WEEK_MS = 7 * 24 * 3_600_000; // MARKET_BREADTH_CAP window: rolling 7 days

export interface PipeDeps {
  repos: Repos;
  provider: OddsProvider;
  sender: AlertSender;
  /** Settings, FRESH per call — they may change between ticks; call at use time, never cache. */
  s(): Settings;
  rng: () => number;
  /** Last snapshot the pipeline fetched — cached here for the recheck / UI. */
  lastQuotes?: Quote[];
}

export function runScan(deps: PipeDeps, now: number): { created: number; killed: number } {
  const s = deps.s();
  const { repos } = deps;

  const quotes = deps.provider.fetchQuotes(now);
  deps.lastQuotes = quotes;
  repos.credits.add(now, 1); // one provider snapshot = one credit

  const day = dayKey(now);
  const allBooks = repos.books.all();
  const ctx: GateContext = {
    now,
    s,
    books: new Map(allBooks.map((b) => [b.name, b])),
    // SENT semantics both ways: only verified/sent picks count against the caps.
    sentTodayByBook: (book) => repos.trades.countByBookToday(book, day),
    sentThisWeekByBookMarket: (book, market) => repos.trades.countByBookMarketSince(book, market, now - WEEK_MS),
  };
  const profileId = repos.profiles.all()[0]!.id; // seeded default profile

  let created = 0;
  let killed = 0;
  // Plan 5: disabled books/sports never become candidates; the full snapshot
  // stays cached (deps.lastQuotes) for the UI and the pinnacle benchmark.
  detectCandidates(eligibleQuotes(quotes, allBooks, s), s).forEach((c, i) => {
    const t = tradeFromCandidate(c, profileId, now, s, deps.rng, i);
    const verdict = runKillBattery(c, ctx);
    if (verdict.verdict === 'kill') {
      // Battery kills persist too — the graveyard shows every reason — but with
      // verified_at NULL they never count toward any SENT counter or the cap.
      t.status = 'KILLED';
      t.killReason = verdict.reason;
      killed += 1;
    } else {
      created += 1;
    }
    repos.trades.insert(t, day, c.market); // market stamped at insert — feeds the breadth cap
  });

  repos.eventsLog.add(now, 'scan', JSON.stringify({ created, killed, quotes: quotes.length }));
  return { created, killed };
}

function tradeFromCandidate(
  c: Candidate,
  profileId: number,
  now: number,
  s: Settings,
  rng: () => number,
  i: number,
): Trade {
  return {
    // Unique and reproducible under a seeded rng: instant + per-scan index + rng tag.
    id: `t-${now.toString(36)}-${i.toString(36)}-${Math.floor(rng() * 0x100000000).toString(36)}`,
    profileId,
    category: c.category,
    event: c.event,
    sport: c.sport,
    legs: c.legs.map((l) => ({ book: l.book, selection: l.selection, odds: l.odds, stakeCents: null })),
    marginInitial: c.edge,
    marginRecheck: null,
    marginFinal: null,
    status: 'PENDING',
    killReason: null,
    resultCents: null,
    createdAt: now,
    verifyDueAt: now + s.verifyGapSecs * 1000,
    verifiedAt: null,
    freshUntil: null,
    settledAt: null,
    eventStartsAt: c.eventStartsAt,
  };
}
