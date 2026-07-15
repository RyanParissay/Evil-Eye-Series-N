// Demo Data seed (feat-demo-seed): a single additive, simulation-only backfill
// that gives the beta preview a populated board on first open — every trade
// status, book heat derived through the real reportLimited action, and a
// bankroll history — without ever touching a network or a wall clock. All
// time is derived from the caller's `now`; the PRNG is seeded from a fixed
// constant, so re-running with the same `now` reproduces byte-identical rows
// (see seed.test.ts's determinism assertion). Gated off in live mode and
// idempotent: the first trade id ('demo-0000') is the existence check.
import { arbMargin, middleMetrics } from '../engine/odds.js';
import { confirmTrade, reportLimited, settleTrade } from '../pipeline/actions.js';
import type { PipeDeps } from '../pipeline/scan.js';
import { dayKey } from '../scheduler/vancouverTime.js';
import type { KillReason, Leg, Strategy, Trade } from '../shared/types.js';

export interface DemoSeedResult {
  gated: boolean;
  alreadySeeded: boolean;
  inserted: { trades: number; snapshots: number; journal: number; limitsReports: number };
}

const ZERO_COUNTS = { trades: 0, snapshots: 0, journal: 0, limitsReports: 0 } as const;

// ---- local deterministic PRNG (copied from the house test helper — never Math.random) --

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- roster vocabulary (matches the sim provider's seeded books/sports) ----------------

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const SPORTS = ['basketball', 'baseball', 'hockey', 'soccer', 'tennis'] as const;
type Sport = (typeof SPORTS)[number];

const SPORT_BOOKS: Record<Sport, string[]> = {
  basketball: ['bet365', 'fanduel', 'pointsbet'],
  baseball: ['draftkings', 'betmgm', 'betrivers'],
  hockey: ['caesars', 'bet99', 'leovegas'],
  soccer: ['sportsinteraction', 'betway', 'bwin', 'betvictor'],
  tennis: ['unibet', 'bodog'],
};

const TEAMS: Record<Sport, string[]> = {
  basketball: ['Lakers', 'Celtics', 'Warriors', 'Nets', 'Heat', 'Nuggets', 'Bucks', 'Suns'],
  baseball: ['Yankees', 'Red Sox', 'Dodgers', 'Mets', 'Braves', 'Astros', 'Cubs', 'Giants'],
  hockey: ['Canucks', 'Oilers', 'Maple Leafs', 'Bruins', 'Rangers', 'Avalanche', 'Kraken', 'Flames'],
  soccer: ['Arsenal', 'Chelsea', 'Man United', 'Bayern Munich', 'Real Madrid', 'Barcelona', 'Liverpool', 'PSG'],
  tennis: ['Alcaraz', 'Djokovic', 'Sinner', 'Medvedev', 'Zverev', 'Rublev', 'Tsitsipas', 'Ruud'],
};

function eventTeams(sport: Sport, idx: number): [string, string] {
  const teams = TEAMS[sport];
  const home = teams[idx % teams.length]!;
  const away = teams[(idx + 1) % teams.length]!;
  return [home, away];
}

function eventString(sport: Sport, home: string, away: string): string {
  const sep = sport === 'soccer' || sport === 'tennis' ? ' vs ' : ' @ ';
  return `${home}${sep}${away}`;
}

function marketFor(sport: Sport, selection: string): string {
  if (selection === 'over' || selection === 'under') return 'total';
  return sport === 'soccer' ? '1X2' : 'moneyline';
}

const round = (x: number, decimals: number): number => {
  const p = 10 ** decimals;
  return Math.round(x * p) / p;
};

/**
 * The main entry point (POST /api/demo/seed): SIM-GATE first, then IDEMPOTENCY
 * (the existence of 'demo-0000' is the check), then — only on a truly fresh db —
 * write the whole demo history and return the counts written.
 */
export function seedDemo(deps: PipeDeps, now: number): DemoSeedResult {
  const liveMode = ((deps.s() as unknown) as { liveMode?: number }).liveMode;
  if (liveMode === 1) {
    return { gated: true, alreadySeeded: false, inserted: { ...ZERO_COUNTS } };
  }
  if (deps.repos.trades.byId('demo-0000')) {
    return { gated: false, alreadySeeded: true, inserted: { ...ZERO_COUNTS } };
  }

  const { repos } = deps;
  const rng = mulberry32(fnv1a32('evil-eye-demo-v1'));
  const profileId = repos.profiles.all()[0]!.id;

  let idx = 0;
  const nextId = (): string => `demo-${String(idx++).padStart(4, '0')}`;

  let tradesInserted = 0;
  let limitsWritten = 0;
  let journalWritten = 0;

  // Spread SETTLED trades' createdAt over ~25 days, cycling deterministically.
  let settledSeq = 0;
  const nextDayOffset = (): number => {
    const d = 1 + (settledSeq % 25);
    settledSeq += 1;
    return d;
  };
  const jitterHours = (i: number): number => i % 10;

  const insertAndCount = (t: Trade, market: string): void => {
    repos.trades.insert(t, dayKey(t.createdAt), market);
    tradesInserted += 1;
  };

  // ---- capture ids for the book-heat demonstration (bet365/fanduel/betmgm) --------------
  let bet365Id = '';
  let fanduelId = '';
  let betmgmId = '';

  // ============================================================================
  // SETTLED ARB — 36, always WON, margin/magnitude fully derived from leg odds.
  // ============================================================================
  const ARB_N = 36;
  for (let i = 0; i < ARB_N; i++) {
    const isThreeLeg = i % 4 === 3 && i >= 3;
    let sport: Sport;
    let event: string;
    let legs: Leg[];

    if (i === 0) {
      // Guaranteed bet365 + fanduel coverage for the heat demonstration below.
      sport = 'basketball';
      const [home, away] = eventTeams(sport, i);
      event = eventString(sport, home, away);
      legs = [
        { book: 'bet365', selection: 'home', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
        { book: 'fanduel', selection: 'away', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
      ];
    } else if (i === 1) {
      // Guaranteed betmgm coverage.
      sport = 'baseball';
      const [home, away] = eventTeams(sport, i);
      event = eventString(sport, home, away);
      legs = [
        { book: 'betmgm', selection: 'home', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
        { book: 'betrivers', selection: 'away', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
      ];
    } else if (isThreeLeg) {
      sport = 'soccer';
      const [home, away] = eventTeams(sport, i);
      event = eventString(sport, home, away);
      legs = [
        { book: 'sportsinteraction', selection: 'home', odds: round(3.03 + rng() * 0.06, 3), stakeCents: null },
        { book: 'betway', selection: 'draw', odds: round(3.03 + rng() * 0.06, 3), stakeCents: null },
        { book: 'bwin', selection: 'away', odds: round(3.03 + rng() * 0.06, 3), stakeCents: null },
      ];
    } else {
      const rotation: Sport[] = ['basketball', 'baseball', 'hockey'];
      sport = rotation[i % rotation.length]!;
      const books = SPORT_BOOKS[sport];
      const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
      const [pa, pb] = pairs[i % pairs.length]!;
      const [home, away] = eventTeams(sport, i);
      event = eventString(sport, home, away);
      legs = [
        { book: books[pa]!, selection: 'home', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
        { book: books[pb]!, selection: 'away', odds: round(2.03 + rng() * 0.04, 3), stakeCents: null },
      ];
    }

    const stakePer = legs.length === 3 ? [3000, 3500, 4000][i % 3]! : [5000, 6000, 7000][i % 3]!;
    legs = legs.map((l) => ({ ...l, stakeCents: stakePer }));
    const marginFinal = arbMargin(legs.map((l) => l.odds));
    const totalStaked = legs.reduce((s, l) => s + (l.stakeCents ?? 0), 0);
    const magnitude = Math.round(totalStaked * marginFinal);

    const id = nextId();
    if (i === 0) bet365Id = id;
    if (i === 0) fanduelId = id;
    if (i === 1) betmgmId = id;

    const d = nextDayOffset();
    const createdAt = now - d * DAY_MS - jitterHours(i) * HOUR_MS;
    const verifiedAt = createdAt + 75_000;
    const eventStartsAt = createdAt + 2 * HOUR_MS;
    const settledAt = eventStartsAt + 3 * HOUR_MS + (i % 5) * 60_000;

    const t: Trade = {
      id, profileId, category: 'ARB', event, sport, legs,
      marginInitial: marginFinal, marginRecheck: marginFinal, marginFinal,
      status: 'VERIFIED', killReason: null, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt + 120_000,
      settledAt: null, eventStartsAt,
    };
    insertAndCount(t, marketFor(sport, legs[0]!.selection));
    confirmTrade(repos, id, verifiedAt + 60_000);
    settleTrade(repos, id, 'WON', magnitude, settledAt);
  }

  // ============================================================================
  // SETTLED EV — 34, single leg, WON 1-in-4 by index (matches the ~48% expected
  // win prob at these odds/edges, so the grade lands squarely in the yellow band).
  // ============================================================================
  const EV_N = 34;
  for (let j = 0; j < EV_N; j++) {
    const sport = SPORTS[j % SPORTS.length]!;
    const books = SPORT_BOOKS[sport];
    const book = books[j % books.length]!;
    const [home, away] = eventTeams(sport, j);
    const event = eventString(sport, home, away);
    const odds = round(2.0 + rng() * 0.3, 3);
    const edge = round(0.021 + rng() * 0.014, 4);
    const stake = [1000, 1500, 2000][j % 3]!;
    const legs: Leg[] = [{ book, selection: 'away', odds, stakeCents: stake }];

    const id = nextId();
    const d = nextDayOffset();
    const createdAt = now - d * DAY_MS - jitterHours(j) * HOUR_MS;
    const verifiedAt = createdAt + 75_000;
    const eventStartsAt = createdAt + 2 * HOUR_MS;
    const settledAt = eventStartsAt + 3 * HOUR_MS + (j % 5) * 60_000;

    const t: Trade = {
      id, profileId, category: 'EV', event, sport, legs,
      marginInitial: edge, marginRecheck: edge, marginFinal: edge,
      status: 'VERIFIED', killReason: null, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt + 120_000,
      settledAt: null, eventStartsAt,
    };
    insertAndCount(t, 'moneyline');
    confirmTrade(repos, id, verifiedAt + 60_000);
    const won = j % 4 === 0;
    const magnitude = won ? Math.round(odds * stake) - stake : stake;
    settleTrade(repos, id, won ? 'WON' : 'LOST', magnitude, settledAt);
  }

  // ============================================================================
  // SETTLED MIDDLE — 32, two legs over/under, WON 1-in-8 by index.
  // ============================================================================
  const MIDDLE_N = 32;
  for (let k = 0; k < MIDDLE_N; k++) {
    const rotation: Sport[] = ['basketball', 'hockey', 'baseball'];
    const sport = rotation[k % rotation.length]!;
    const books = SPORT_BOOKS[sport];
    const bookA = books[k % books.length]!;
    const bookB = books[(k + 1) % books.length]!;
    const [home, away] = eventTeams(sport, k);
    const event = eventString(sport, home, away);
    const oA = round(1.85 + rng() * 0.05, 3);
    const oB = round(1.85 + rng() * 0.05, 3);
    const sA = 5000;
    const sB = 5000;
    const legs: Leg[] = [
      { book: bookA, selection: 'over', odds: oA, stakeCents: sA },
      { book: bookB, selection: 'under', odds: oB, stakeCents: sB },
    ];
    const m = middleMetrics(oA, oB);
    const marginFinal = m.bothWinPayoutFrac - Math.max(m.costFrac, 0);

    const id = nextId();
    const d = nextDayOffset();
    const createdAt = now - d * DAY_MS - jitterHours(k) * HOUR_MS;
    const verifiedAt = createdAt + 75_000;
    const eventStartsAt = createdAt + 2 * HOUR_MS;
    const settledAt = eventStartsAt + 3 * HOUR_MS + (k % 5) * 60_000;

    const t: Trade = {
      id, profileId, category: 'MIDDLE', event, sport, legs,
      marginInitial: marginFinal, marginRecheck: marginFinal, marginFinal,
      status: 'VERIFIED', killReason: null, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt + 120_000,
      settledAt: null, eventStartsAt,
    };
    insertAndCount(t, 'total');
    confirmTrade(repos, id, verifiedAt + 60_000);
    const won = k % 8 === 0;
    const magnitude = won
      ? Math.round(oA * sA + oB * sB) - (sA + sB)
      : (sA + sB) - Math.round(Math.min(oA * sA, oB * sB));
    settleTrade(repos, id, won ? 'WON' : 'LOST', magnitude, settledAt);
  }

  // ============================================================================
  // CONFIRMED (open, unsettled) — 2 per category, event in the future.
  // ============================================================================
  const CATS: Strategy[] = ['ARB', 'EV', 'MIDDLE'];
  for (const cat of CATS) {
    for (let r = 0; r < 2; r++) {
      const sport = (cat === 'ARB' ? 'basketball' : cat === 'EV' ? 'baseball' : 'hockey') as Sport;
      const books = SPORT_BOOKS[sport];
      const [home, away] = eventTeams(sport, r + 20);
      const event = eventString(sport, home, away);
      let legs: Leg[];
      let marginFinal: number;
      if (cat === 'ARB') {
        const oA = round(2.03 + rng() * 0.04, 3);
        const oB = round(2.03 + rng() * 0.04, 3);
        legs = [
          { book: books[0]!, selection: 'home', odds: oA, stakeCents: 5000 },
          { book: books[1]!, selection: 'away', odds: oB, stakeCents: 5000 },
        ];
        marginFinal = arbMargin([oA, oB]);
      } else if (cat === 'EV') {
        const odds = round(2.0 + rng() * 0.3, 3);
        const edge = round(0.021 + rng() * 0.014, 4);
        legs = [{ book: books[0]!, selection: 'away', odds, stakeCents: 1500 }];
        marginFinal = edge;
      } else {
        const oA = round(1.85 + rng() * 0.05, 3);
        const oB = round(1.85 + rng() * 0.05, 3);
        legs = [
          { book: books[0]!, selection: 'over', odds: oA, stakeCents: 5000 },
          { book: books[1]!, selection: 'under', odds: oB, stakeCents: 5000 },
        ];
        const m = middleMetrics(oA, oB);
        marginFinal = m.bothWinPayoutFrac - Math.max(m.costFrac, 0);
      }

      const id = nextId();
      const createdAt = now - (2 + r) * HOUR_MS;
      const verifiedAt = createdAt + 75_000;
      const eventStartsAt = now + (6 + r * 12 + (cat === 'EV' ? 3 : 0)) * HOUR_MS;

      const t: Trade = {
        id, profileId, category: cat, event, sport, legs,
        marginInitial: marginFinal, marginRecheck: marginFinal, marginFinal,
        status: 'VERIFIED', killReason: null, resultCents: null,
        createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt + 120_000,
        settledAt: null, eventStartsAt,
      };
      insertAndCount(t, marketFor(sport, legs[0]!.selection));
      confirmTrade(repos, id, verifiedAt + 60_000);
    }
  }

  // ============================================================================
  // UNCONFIRMED — 4, direct insert (no action produces this status), future event.
  // ============================================================================
  const unconfirmedCats: Strategy[] = ['ARB', 'EV', 'MIDDLE', 'ARB'];
  for (let u = 0; u < 4; u++) {
    const cat = unconfirmedCats[u]!;
    const sport = SPORTS[(u + 2) % SPORTS.length]!;
    const books = SPORT_BOOKS[sport];
    const [home, away] = eventTeams(sport, u + 40);
    const event = eventString(sport, home, away);
    let legs: Leg[];
    let marginFinal: number;
    if (cat === 'ARB') {
      const oA = round(2.03 + rng() * 0.04, 3);
      const oB = round(2.03 + rng() * 0.04, 3);
      legs = [
        { book: books[0]!, selection: 'home', odds: oA, stakeCents: 5000 },
        { book: books[Math.min(1, books.length - 1)]!, selection: 'away', odds: oB, stakeCents: 5000 },
      ];
      marginFinal = arbMargin([oA, oB]);
    } else if (cat === 'EV') {
      const odds = round(2.0 + rng() * 0.3, 3);
      const edge = round(0.021 + rng() * 0.014, 4);
      legs = [{ book: books[0]!, selection: 'away', odds, stakeCents: 1500 }];
      marginFinal = edge;
    } else {
      const oA = round(1.85 + rng() * 0.05, 3);
      const oB = round(1.85 + rng() * 0.05, 3);
      legs = [
        { book: books[0]!, selection: 'over', odds: oA, stakeCents: 5000 },
        { book: books[Math.min(1, books.length - 1)]!, selection: 'under', odds: oB, stakeCents: 5000 },
      ];
      const m = middleMetrics(oA, oB);
      marginFinal = m.bothWinPayoutFrac - Math.max(m.costFrac, 0);
    }

    const id = nextId();
    const createdAt = now - (3 + u) * HOUR_MS;
    const verifiedAt = createdAt + 75_000;
    const eventStartsAt = now + (40 + u * 20) * HOUR_MS;

    const t: Trade = {
      id, profileId, category: cat, event, sport, legs,
      marginInitial: marginFinal, marginRecheck: marginFinal, marginFinal,
      status: 'UNCONFIRMED', killReason: null, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt + 120_000,
      settledAt: null, eventStartsAt,
    };
    insertAndCount(t, marketFor(sport, legs[0]!.selection));
  }

  // ============================================================================
  // EXPIRED — 6, direct insert, no money, spread over past days.
  // ============================================================================
  const expiredDays = [2, 5, 9, 14, 18, 23];
  for (let e = 0; e < 6; e++) {
    const cat = CATS[e % CATS.length]!;
    const sport = SPORTS[e % SPORTS.length]!;
    const books = SPORT_BOOKS[sport];
    const [home, away] = eventTeams(sport, e + 60);
    const event = eventString(sport, home, away);
    const selection = cat === 'MIDDLE' ? 'over' : 'home';
    const odds = round(1.9 + rng() * 0.3, 3);
    const legs: Leg[] = [{ book: books[0]!, selection, odds, stakeCents: null }];

    const createdAt = now - expiredDays[e]! * DAY_MS - HOUR_MS;
    // The first two rows model "verified but never confirmed, went stale" —
    // verifiedAt WAS stamped. Rows 2-3 model a held-back recheck (verified_at
    // null, margin_recheck set). Rows 4-5 are a plain pre-verify stale sweep.
    const wasVerified = e < 2;
    const heldBack = e >= 2 && e < 4;
    const verifiedAt = wasVerified ? createdAt + 75_000 : null;
    const marginRecheck = wasVerified || heldBack ? round(0.01 + rng() * 0.01, 4) : null;

    const id = nextId();
    const t: Trade = {
      id, profileId, category: cat, event, sport, legs,
      marginInitial: marginRecheck ?? round(0.01 + rng() * 0.01, 4), marginRecheck, marginFinal: null,
      status: 'EXPIRED', killReason: null, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt, freshUntil: verifiedAt ? verifiedAt + 120_000 : null,
      settledAt: null, eventStartsAt: createdAt + 2 * HOUR_MS,
    };
    insertAndCount(t, marketFor(sport, selection));
  }

  // ============================================================================
  // KILLED — 10, direct insert, cycling every KillReason; FAILED_VERIFICATION
  // rows carry marginRecheck (they died at the recheck), battery kills don't.
  // ============================================================================
  const KILL_REASONS: KillReason[] = [
    'ONE_SPORT_RULE', 'HEAT_GATE', 'SHARP_VELOCITY_CAP', 'MARKET_BREADTH_CAP',
    'ROUNDING_DESTROYS_MARGIN', 'QUOTE_STALE', 'FAILED_VERIFICATION',
  ];
  for (let m = 0; m < 10; m++) {
    const reason = KILL_REASONS[m % KILL_REASONS.length]!;
    const cat = CATS[m % CATS.length]!;
    const sport = SPORTS[m % SPORTS.length]!;
    const books = SPORT_BOOKS[sport];
    const [home, away] = eventTeams(sport, m + 80);
    const event = eventString(sport, home, away);
    const selection = cat === 'MIDDLE' ? 'under' : 'away';
    const odds = round(1.9 + rng() * 0.3, 3);
    const legs: Leg[] = [{ book: books[0]!, selection, odds, stakeCents: null }];

    // A couple of these land on today's dayKey(now); the rest spread over past days.
    const createdAt = m < 2 ? now - (m + 1) * HOUR_MS : now - (2 + m * 2) * DAY_MS - HOUR_MS;
    const failedVerification = reason === 'FAILED_VERIFICATION';
    const marginRecheck = failedVerification ? round(0.005 + rng() * 0.005, 4) : null;
    const marginInitial = round(0.015 + rng() * 0.01, 4);

    const id = nextId();
    const t: Trade = {
      id, profileId, category: cat, event, sport, legs,
      marginInitial, marginRecheck, marginFinal: null,
      status: 'KILLED', killReason: reason, resultCents: null,
      createdAt, verifyDueAt: createdAt + 75_000, verifiedAt: null, freshUntil: null,
      settledAt: null, eventStartsAt: createdAt + 2 * HOUR_MS,
    };
    insertAndCount(t, marketFor(sport, selection));
  }

  // ============================================================================
  // BOOK HEAT — via the real reportLimited action (derived, never hardcoded).
  // ============================================================================
  reportLimited(repos, bet365Id, 'bet365', 20_000, now - 4 * DAY_MS);
  limitsWritten += 1;
  reportLimited(repos, bet365Id, 'bet365', 10_000, now - 2 * DAY_MS);
  limitsWritten += 1;
  reportLimited(repos, bet365Id, 'bet365', 2_500, now - 1 * DAY_MS);
  limitsWritten += 1;

  reportLimited(repos, fanduelId, 'fanduel', 12_000, now - 3 * DAY_MS);
  limitsWritten += 1;

  reportLimited(repos, betmgmId, 'betmgm', 40_000, now - 5 * DAY_MS);
  limitsWritten += 1;
  reportLimited(repos, betmgmId, 'betmgm', 25_000, now - 2 * DAY_MS);
  limitsWritten += 1;

  // Tune-up: if bet365 didn't cross stopHeat, one more recent report closes the gap.
  if ((repos.books.byName('bet365')?.health ?? 'green') !== 'red') {
    reportLimited(repos, bet365Id, 'bet365', 1_000, now - 6 * HOUR_MS);
    limitsWritten += 1;
  }

  // ============================================================================
  // JOURNAL flavor — honesty marker first (oldest), then a handful of plain lines.
  // ============================================================================
  const journalLines: Array<[number, string]> = [
    [now - 25 * DAY_MS + 1_000, 'Demo data loaded — simulated paper history for the beta preview, not a live track record.'],
    [now - 20 * DAY_MS, 'Reviewed the arbitrage settlement batch for the week — margins tracking close to plan.'],
    [now - 14 * DAY_MS, 'Checked book health after the bet365 reports — running hot in this demo set, as expected.'],
    [now - 8 * DAY_MS, 'MIDDLE strategy holding a steady edge across the sample so far.'],
    [now - 2 * DAY_MS, 'Bankroll curve has been smooth over the past few weeks in this demo set.'],
  ];
  for (const [ts, text] of journalLines) {
    repos.journal.add(ts, text);
    journalWritten += 1;
  }

  // ============================================================================
  // BANKROLL SNAPSHOTS — bucket settled resultCents by dayKey(settledAt), then
  // walk every calendar day from the earliest settle-day through dayKey(now).
  // ============================================================================
  const settledTrades = [
    ...repos.trades.byStatus('SETTLED'),
  ].filter((t) => t.settledAt !== null);
  const byDay = new Map<string, number>();
  let earliestSettledAt = now;
  for (const t of settledTrades) {
    const day = dayKey(t.settledAt!);
    byDay.set(day, (byDay.get(day) ?? 0) + (t.resultCents ?? 0));
    if (t.settledAt! < earliestSettledAt) earliestSettledAt = t.settledAt!;
  }

  const startingCash = repos.profiles.all()[0]!.startingCashCents;
  const untilDay = dayKey(now);
  let cumulative = 0;
  let cursor = earliestSettledAt;
  let cursorDay = dayKey(cursor);
  let snapshotsWritten = 0;
  const seenDays = new Set<string>();
  // Bounded walk (at most ~40 calendar days for a 25-day-old seed) — never infinite.
  for (let guard = 0; guard < 60; guard++) {
    if (!seenDays.has(cursorDay)) {
      seenDays.add(cursorDay);
      cumulative += byDay.get(cursorDay) ?? 0;
      repos.snapshots.writeDaily(profileId, cursorDay, startingCash + cumulative);
      snapshotsWritten += 1;
    }
    if (cursorDay === untilDay) break;
    cursor += DAY_MS;
    cursorDay = dayKey(cursor);
  }

  return {
    gated: false,
    alreadySeeded: false,
    inserted: { trades: tradesInserted, snapshots: snapshotsWritten, journal: journalWritten, limitsReports: limitsWritten },
  };
}
