// Express API + app factory (Task 13). createApp wires the whole simulated
// stack — db, repos, provider, sender, pipeline deps, scheduler — from injected
// clock/timer/rng/dbPath, so supertest runs against :memory: with a fake clock
// and never sleeps. Every response is JSON; errors are { error: { code, message } }.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { openDb, Repos, type Db } from '../db/db.js';
import { SimOddsProvider } from '../providers/simOdds.js';
import type { PipeDeps } from '../pipeline/scan.js';
import {
  ConflictError, NotFoundError, confirmTrade, reportLimited, settleTrade, unconfirmTrade,
} from '../pipeline/actions.js';
import { defaultPlanDeps, startScheduler, type SchedulerHandle, type Timer } from '../scheduler/runner.js';
import { seedDemo } from '../demo/seed.js';
import { ANCHOR_LABELS, buildBrainView } from '../brain/report.js';
import { lastPass, runBrainPass } from '../brain/pass.js';
import { dayKey, isQuietHours } from '../scheduler/vancouverTime.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';
import type { AlertSender, Leg, OddsProvider, Trade, TradeStatus } from '../shared/types.js';

export interface AppOptions {
  dbPath: string;
  clock: () => number;
  timer: Timer;
  rng: () => number;
  /** Overrides for tests; defaults are the sim provider on `rng` and the console+events_log sender. */
  provider?: OddsProvider;
  sender?: AlertSender;
}

export interface App {
  app: Express;
  db: Db;
  repos: Repos;
  deps: PipeDeps;
  scheduler: SchedulerHandle;
}

// ---- TradeView --------------------------------------------------------------

/** Statuses at or past promotion — the only cards allowed to show money. */
const STAKE_VISIBLE: ReadonlySet<TradeStatus> = new Set(['VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED', 'KILLED', 'SETTLED']);

type LegView = Omit<Leg, 'stakeCents'> & { stakeCents?: number | null; bookLabel: string; selectionLabel: string };
export type TradeView = Omit<Trade, 'legs'> & { legs: LegView[]; marginPct: number; edgePct: number };

const pct2 = (frac: number): number => Math.round(frac * 10_000) / 100;

/** Title-case display names for the 16 seeded books; anything else shows its raw slug. */
const BOOK_LABELS: Record<string, string> = {
  pinnacle: 'Pinnacle', bet365: 'bet365', fanduel: 'FanDuel', draftkings: 'DraftKings',
  betmgm: 'BetMGM', caesars: 'Caesars', bet99: 'Bet99', sportsinteraction: 'Sports Interaction',
  betway: 'Betway', pointsbet: 'PointsBet', bwin: 'bwin', unibet: 'Unibet',
  bodog: 'Bodog', betvictor: 'BetVictor', leovegas: 'LeoVegas', betrivers: 'BetRivers',
};

const bookLabel = (book: string): string => BOOK_LABELS[book] ?? book;

const titleCase = (raw: string): string =>
  raw.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(' ');

/** simOdds.ts events read "Home @ Away" / "Home vs Away" — split back into the two team names. */
function eventTeams(event: string): [string, string] | null {
  for (const sep of [' vs ', ' @ ']) {
    const i = event.indexOf(sep);
    if (i >= 0) return [event.slice(0, i), event.slice(i + sep.length)];
  }
  return null;
}

/**
 * Human label for a leg's selection: home/away prefer the team name parsed from the
 * event string (falls back to "Home"/"Away" if the event doesn't split cleanly — e.g.
 * pre-existing data); draw is always "Draw"; everything else (including over/under,
 * which carry no line on a persisted Leg) title-cases the raw slug.
 */
function selectionLabel(event: string, selection: string): string {
  if (selection === 'draw') return 'Draw';
  if (selection === 'home' || selection === 'away') {
    const teams = eventTeams(event);
    if (teams) return selection === 'home' ? teams[0] : teams[1];
    return selection === 'home' ? 'Home' : 'Away';
  }
  return titleCase(selection);
}

/**
 * MIDDLE display edge (this mapping only — internal marginInitial/marginRecheck/
 * marginFinal and the qualification tolerance in engine/odds.ts are untouched).
 * The internal basis (bothWinPayoutFrac - max(costFrac, 0)) is a tolerance-comparison
 * number, not an EV. For display we derive an actual expected value from the locked
 * "MIN MIDDLE QUALITY: 1.5x BREAKEVEN HIT RATE" semantics (qualification requires
 * ratio = bothWinPayoutFrac/costFrac >= settings.middleRatio): assume the middle hits
 * at exactly middleRatio x the breakeven rate. Let C = costFrac, B = bothWinPayoutFrac,
 * R = middleRatio. Breakeven hit rate p0 solves p0*B = (1-p0)*C, i.e. p0*(B+C) = C.
 * At p = R*p0, EV/stake = p*B - (1-p)*C = p*(B+C) - C = R*p0*(B+C) - C = R*C - C =
 * (R-1)*C — independent of B, so only costFrac and the ratio matter for display.
 * Free middles (costFrac <= 0) have no downside: the display edge is just the
 * guaranteed margin, -costFrac. costFrac is recomputed here from the leg odds
 * actually stored on the trade (Σ1/odds - 1), not read off any cached candidate value.
 */
function middleEdgePct(t: Trade, s: Settings): number {
  const costFrac = t.legs.reduce((sum, l) => sum + 1 / l.odds, 0) - 1;
  const frac = costFrac > 0 ? (s.middleRatio - 1) * costFrac : -costFrac;
  return pct2(frac);
}

/**
 * Trade plus display fields. marginPct is the best-known margin as a 2dp percentage
 * (final > recheck > initial). edgePct mirrors marginPct EXCEPT for MIDDLE, where it's
 * the display-scaled EV from middleEdgePct (see its comment) — the UI labels it "margin"
 * on ARB cards and "edge" on EV/MIDDLE cards. PENDING legs NEVER carry stakeCents: a
 * pending card is book + selection + odds only. Every leg also carries bookLabel/
 * selectionLabel; the raw book/selection slugs stay for the client's POSTs.
 */
function tradeView(t: Trade, s: Settings): TradeView {
  const currentPct = pct2(t.marginFinal ?? t.marginRecheck ?? t.marginInitial);
  const rawLegs = STAKE_VISIBLE.has(t.status)
    ? t.legs
    : t.legs.map(({ book, selection, odds }) => ({ book, selection, odds }));
  const legs: LegView[] = rawLegs.map((l) => ({
    ...l, bookLabel: bookLabel(l.book), selectionLabel: selectionLabel(t.event, l.selection),
  }));
  const edgePct = t.category === 'MIDDLE' ? middleEdgePct(t, s) : currentPct;
  return { ...t, legs, marginPct: currentPct, edgePct };
}

const newestFirst = (a: Trade, b: Trade): number => b.createdAt - a.createdAt;

// ---- validation -------------------------------------------------------------

const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const HOUR_KEYS = new Set(['quietStartHour', 'quietEndHour']);
/** Keys allowed to be ≤ 0 or bounded enums (brain knobs). */
const RANGE_RULES: Record<string, { min: number; max: number; integer: boolean }> = {
  heatWeightWithdrawal: { min: -100, max: 0, integer: false },
  anchorIdx: { min: 0, max: 2, integer: true },
  brainKillSwitch: { min: 0, max: 1, integer: true },
};

function settingsPatch(body: unknown): { patch: Partial<Settings> } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const patch: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTINGS_KEYS.has(k)) return { error: `unknown setting: ${k}` };
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${k} must be a finite number` };
    const range = RANGE_RULES[k];
    if (range) {
      if (v < range.min || v > range.max) return { error: `${k} must be between ${range.min} and ${range.max}` };
      if (range.integer && !Number.isInteger(v)) return { error: `${k} must be an integer` };
    } else if (k === 'tolerancePct') {
      if (v < 0 || v > 100) return { error: 'tolerancePct must be between 0 and 100' };
    } else if (HOUR_KEYS.has(k)) {
      if (!Number.isInteger(v) || v < 0 || v > 23) return { error: `${k} must be an integer hour between 0 and 23` };
    } else if (v <= 0) {
      return { error: `${k} must be positive` };
    }
    patch[k] = v;
  }
  return { patch: patch as Partial<Settings> };
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---- factory ----------------------------------------------------------------

/** Default AlertSender: console line (the sim WhatsApp) plus an events_log row. */
function consoleSender(repos: Repos, clock: () => number): AlertSender {
  return {
    sendVerified(t: Trade): void {
      const legs = t.legs
        .map((l) => `${l.book} ${l.selection} @ ${l.odds} — BET $${((l.stakeCents ?? 0) / 100).toFixed(2)}`)
        .join(' | ');
      console.log(`[SIM-WHATSAPP] VERIFIED ${t.category} ${t.event}: ${legs}`);
      repos.eventsLog.add(clock(), 'alert', JSON.stringify({ tradeId: t.id, category: t.category, event: t.event }));
    },
  };
}

export function createApp(o: AppOptions): App {
  const db = openDb(o.dbPath);
  const repos = Repos(db);
  const { clock } = o;
  const deps: PipeDeps = {
    repos,
    provider: o.provider ?? SimOddsProvider(o.rng),
    sender: o.sender ?? consoleSender(repos, clock),
    s: () => repos.settings.all(),
    rng: o.rng,
  };
  const scheduler = startScheduler(deps, defaultPlanDeps(deps), o.timer, clock);

  const app = express();
  app.use(express.json());

  /** Map action errors to HTTP: unknown id → 404 not_found, bad transition → 409 conflict. */
  const withActionErrors = (res: Response, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      if (err instanceof NotFoundError) return fail(res, 404, 'not_found', err.message);
      if (err instanceof ConflictError) return fail(res, 409, 'conflict', err.message);
      throw err;
    }
  };

  app.get('/api/state', (_req, res) => {
    const now = clock();
    const day = dayKey(now);
    const s = repos.settings.all();
    const verified = (['VERIFIED', 'CONFIRMED', 'UNCONFIRMED'] as const)
      .flatMap((st) => repos.trades.byStatus(st))
      .sort(newestFirst)
      .map((t) => tradeView(t, s));
    const pending = repos.trades.byStatus('PENDING').sort(newestFirst).map((t) => tradeView(t, s));
    const killedToday = repos.trades.byStatus('KILLED').filter((t) => dayKey(t.createdAt) === day).length;
    res.json({
      mode: 'SIMULATED',
      now,
      nextScanAt: scheduler.nextScanAt(now),
      quietHours: isQuietHours(now, s),
      trades: { verified, pending },
      counts: { verifiedToday: repos.trades.verifiedSentToday(day), killedToday },
    });
  });

  app.get('/api/trades', (req, res) => {
    const view = req.query.view ?? 'all';
    if (view !== 'all' && view !== 'history') return fail(res, 400, 'bad_request', 'view must be "all" or "history"');
    const statuses: TradeStatus[] = view === 'history'
      ? ['SETTLED', 'EXPIRED', 'KILLED']
      : ['PENDING', 'VERIFIED', 'CONFIRMED', 'UNCONFIRMED', 'EXPIRED', 'KILLED'];
    const s = repos.settings.all();
    const trades = statuses.flatMap((st) => repos.trades.byStatus(st)).sort(newestFirst).map((t) => tradeView(t, s));
    res.json({ view, trades });
  });

  app.post('/api/scan', (_req, res) => {
    const now = clock();
    if (isQuietHours(now, repos.settings.all())) {
      return fail(res, 503, 'quiet_hours', 'scanning is paused during Vancouver quiet hours');
    }
    res.json(scheduler.scanNow(now));
  });

  app.post('/api/trades/:id/confirm', (req, res) => withActionErrors(res, () => {
    res.json({ trade: tradeView(confirmTrade(repos, req.params.id, clock()), repos.settings.all()) });
  }));

  app.post('/api/trades/:id/unconfirm', (req, res) => withActionErrors(res, () => {
    res.json({ trade: tradeView(unconfirmTrade(repos, req.params.id, clock()), repos.settings.all()) });
  }));

  app.post('/api/trades/:id/limited', (req, res) => withActionErrors(res, () => {
    const { book, maxAllowedCents } = (req.body ?? {}) as { book?: unknown; maxAllowedCents?: unknown };
    if (typeof book !== 'string' || book.length === 0) return fail(res, 400, 'bad_request', 'book must be a non-empty string');
    if (typeof maxAllowedCents !== 'number' || !Number.isInteger(maxAllowedCents) || maxAllowedCents < 0) {
      return fail(res, 400, 'bad_request', 'maxAllowedCents must be a non-negative integer');
    }
    reportLimited(repos, req.params.id, book, maxAllowedCents, clock());
    res.json({ ok: true });
  }));

  app.post('/api/trades/:id/settle', (req, res) => withActionErrors(res, () => {
    const { result, amountCents } = (req.body ?? {}) as { result?: unknown; amountCents?: unknown };
    if (result !== 'WON' && result !== 'LOST') return fail(res, 400, 'bad_request', 'result must be "WON" or "LOST"');
    if (typeof amountCents !== 'number' || !Number.isFinite(amountCents) || amountCents < 0) {
      return fail(res, 400, 'bad_request', 'amountCents must be a non-negative number');
    }
    res.json({ trade: tradeView(settleTrade(repos, req.params.id, result, amountCents, clock()), repos.settings.all()) });
  }));

  app.get('/api/settings', (_req, res) => {
    res.json({ settings: repos.settings.all() });
  });

  app.patch('/api/settings', (req, res) => {
    const v = settingsPatch(req.body);
    if ('error' in v) return fail(res, 400, 'bad_request', v.error);
    res.json({ settings: repos.settings.set(v.patch) });
  });

  app.get('/api/brain', (_req, res) => {
    res.json(buildBrainView(deps, clock()));
  });

  // Manual consolidation pass (SETTINGS → UPDATE UNDERSTANDING wires here in Plan 5).
  // Runs even under the kill switch: an explicit user command is not autonomous behavior.
  app.post('/api/brain/pass', (_req, res) => {
    runBrainPass(deps, clock());
    res.json({ lastFullPassAt: lastPass(repos)!.ts });
  });

  app.post('/api/brain/anchor', (req, res) => {
    const { idx } = (req.body ?? {}) as { idx?: unknown };
    if (idx !== 0 && idx !== 1 && idx !== 2) return fail(res, 400, 'bad_request', 'idx must be 0, 1 or 2');
    repos.settings.set({ anchorIdx: idx });
    const note = idx === 0 ? '' : ' — simulated mode maps every anchor to Pinnacle prices';
    repos.journal.add(clock(), `Reference pricer switched to ${ANCHOR_LABELS[idx]}${note}`);
    res.json({ anchor: buildBrainView(deps, clock()).anchor });
  });

  // --- DEMO SEED (feat-demo-seed) — additive, simulation-only backfill ---
  app.post('/api/demo/seed', (_req, res) => {
    const result = seedDemo(deps, clock());
    if (result.gated) return fail(res, 409, 'conflict', 'demo data seed is unavailable in live mode');
    res.json(result);
  });

  app.use((_req, res) => fail(res, 404, 'not_found', 'no such route'));

  // Express error middleware (4-arity is load-bearing): malformed JSON → 400, anything else → 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) return fail(res, 400, 'bad_request', 'malformed JSON body');
    console.error('[api] unhandled error', err);
    fail(res, 500, 'internal', 'internal error');
  });

  return { app, db, repos, deps, scheduler };
}
