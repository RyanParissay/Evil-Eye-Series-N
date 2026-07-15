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
import { lastPass, runBrainPass, displayName } from '../brain/pass.js';
import { buildSettingsView, tradesCsv } from '../settings/report.js';
import { dayKey, isQuietHours } from '../scheduler/vancouverTime.js';
import { RANGE_KEYS, buildAnalyticsView, profileView } from '../analytics/report.js';
import type { RangeKey } from '../analytics/series.js';
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
/** Keys allowed to be ≤ 0 or bounded enums (brain + settings-screen knobs). */
const RANGE_RULES: Record<string, { min: number; max: number; integer: boolean }> = {
  heatWeightWithdrawal: { min: -100, max: 0, integer: false },
  anchorIdx: { min: 0, max: 2, integer: true },
  brainKillSwitch: { min: 0, max: 1, integer: true },
  anchorFallback: { min: 0, max: 2, integer: true },
  oneSportRule: { min: 0, max: 1, integer: true },
  journalMinPerDay: { min: 1, max: 4, integer: true },
  mixArbPct: { min: 0, max: 100, integer: true },
  mixMiddlePct: { min: 0, max: 100, integer: true },
  mixEvPct: { min: 0, max: 100, integer: true },
};
const MIX_KEYS = ['mixArbPct', 'mixMiddlePct', 'mixEvPct'] as const;
/** String-typed settings and their validators (null = ok, string = error message). */
const STRING_RULES: Record<string, (v: string) => string | null> = {
  whatsappNumber: (v) =>
    v === '' || /^\+\d[\d ]{6,18}$/.test(v) ? null : 'whatsappNumber must look like +1 604 555 0000 (or be empty)',
  disabledSports: (v) =>
    /^[a-z]*(,[a-z]+)*$/.test(v) ? null : 'disabledSports must be a comma-joined list of lowercase sport slugs',
};

function settingsPatch(body: unknown): { patch: Partial<Settings> } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const patch: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTINGS_KEYS.has(k)) return { error: `unknown setting: ${k}` };
    const stringRule = STRING_RULES[k];
    if (stringRule) {
      if (typeof v !== 'string') return { error: `${k} must be a string` };
      const err = stringRule(v);
      if (err !== null) return { error: err };
      patch[k] = v;
      continue;
    }
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
  // STRATEGY MIX — LOCKED TO 100: the trio moves together or not at all.
  const mixTouched = MIX_KEYS.filter((k) => k in patch);
  if (mixTouched.length > 0) {
    if (mixTouched.length !== 3) return { error: 'mixArbPct, mixMiddlePct and mixEvPct must be patched together' };
    const sum = MIX_KEYS.reduce((acc, k) => acc + (patch[k] as number), 0);
    if (sum !== 100) return { error: 'strategy mix must sum to exactly 100' };
  }
  return { patch: patch as Partial<Settings> };
}

/** §5.7 is literal: advanced-expander keys journal their changes. */
const ADVANCED_JOURNAL_KEYS = new Set([
  'minArbMarginPct', 'minEvEdgePct', 'middleRatio', 'freshWindowSecs',
  'anchorFallback', 'sharpVelocityPerDayPerBook', 'marketBreadthPerWeekPerBook',
  'oneSportRule', 'goGentleHeat', 'stopHeat', 'journalMinPerDay', 'disabledSports',
]);
/** Calm-locked: editable only while every non-sharp book is green (§5.7 helper sentence). */
const SAFETY_KEYS = new Set([
  'sharpVelocityPerDayPerBook', 'marketBreadthPerWeekPerBook', 'oneSportRule', 'goGentleHeat', 'stopHeat',
]);

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
    const parsed = settingsPatch(req.body);
    if ('error' in parsed) return fail(res, 400, 'bad_request', parsed.error);
    if (Object.keys(parsed.patch).some((k) => SAFETY_KEYS.has(k))
      && repos.books.all().some((b) => !b.sharpExempt && b.health !== 'green')) {
      return fail(res, 409, 'conflict', 'account safety rules are locked while any book is amber or red');
    }
    const before = repos.settings.all();
    const settings = repos.settings.set(parsed.patch);
    for (const [k, v] of Object.entries(parsed.patch)) {
      if (ADVANCED_JOURNAL_KEYS.has(k) && before[k as keyof Settings] !== v) {
        repos.journal.add(clock(), `Settings changed: ${k} ${String(before[k as keyof Settings])} → ${String(v)}`);
      }
    }
    res.json({ settings });
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

  app.get('/api/profiles', (_req, res) => {
    res.json({ profiles: repos.profiles.all().map(profileView) });
  });

  app.post('/api/profiles', (req, res) => {
    const { name, startingCashCents } = (req.body ?? {}) as { name?: unknown; startingCashCents?: unknown };
    if (typeof name !== 'string' || name.trim() === '') {
      return fail(res, 400, 'bad_request', 'name must be a non-empty string');
    }
    if (typeof startingCashCents !== 'number' || !Number.isInteger(startingCashCents) || startingCashCents <= 0) {
      return fail(res, 400, 'bad_request', 'startingCashCents must be a positive integer');
    }
    try {
      // STARTS THE DAY YOU CREATE IT — the created date is the Vancouver day of the click.
      const p = repos.profiles.create(name.trim(), startingCashCents, dayKey(clock()));
      res.json({ profile: profileView(p) });
    } catch {
      return fail(res, 409, 'conflict', 'a profile with that name already exists'); // profiles.name UNIQUE
    }
  });

  app.get('/api/analytics', (req, res) => {
    const rangeRaw = typeof req.query.range === 'string' ? req.query.range : '30D';
    if (!(RANGE_KEYS as readonly string[]).includes(rangeRaw)) {
      return fail(res, 400, 'bad_request', 'range must be one of 1D, 5D, 30D, 1Y, MAX');
    }
    const profiles = repos.profiles.all();
    const wanted = typeof req.query.profileId === 'string' ? Number(req.query.profileId) : profiles[0]?.id;
    const profile = profiles.find((p) => p.id === wanted);
    if (!profile) return fail(res, 404, 'not_found', 'no such profile');
    res.json(buildAnalyticsView(deps, profile, rangeRaw as RangeKey, clock()));
  });

  app.get('/api/settings/view', (_req, res) => {
    res.json(buildSettingsView(deps, clock()));
  });

  app.patch('/api/books/:name', (req, res) => {
    const book = repos.books.byName(req.params.name);
    if (!book) return fail(res, 404, 'not_found', 'no such book');
    const { enabled, sport } = (req.body ?? {}) as { enabled?: unknown; sport?: unknown };
    if (enabled === undefined && sport === undefined) return fail(res, 400, 'bad_request', 'nothing to change');
    if (book.sharpExempt === 1) return fail(res, 409, 'conflict', 'sharp books are always on');
    if (enabled !== undefined && enabled !== 0 && enabled !== 1) {
      return fail(res, 400, 'bad_request', 'enabled must be 0 or 1');
    }
    const roster = new Set(repos.books.all().filter((b) => b.sport !== 'ANY').map((b) => b.sport));
    if (sport !== undefined && (typeof sport !== 'string' || !roster.has(sport))) {
      return fail(res, 400, 'bad_request', 'sport must be one of the roster sports');
    }
    // Changes here are written to the brain journal (§5.7 — literal).
    if (enabled !== undefined && enabled !== book.enabled) {
      repos.books.setEnabled(book.name, enabled);
      repos.journal.add(clock(), `Books: ${displayName(book.name)} turned ${enabled === 1 ? 'ON' : 'OFF'}`);
    }
    if (sport !== undefined && sport !== book.sport) {
      repos.books.setSport(book.name, sport);
      repos.journal.add(clock(), `Books: ${displayName(book.name)} sport ${book.sport} → ${sport}`);
    }
    const b = repos.books.byName(book.name)!;
    res.json({
      book: {
        name: b.name, displayName: displayName(b.name), sport: b.sport,
        sharpExempt: b.sharpExempt === 1, enabled: b.enabled === 1,
      },
    });
  });

  app.post('/api/whatsapp/test', (_req, res) => {
    // Plan 5 stub: sim sends NOTHING anywhere — the event row is the whole effect.
    // Plan 6 swaps these internals behind the same route (dev-mode seams only).
    repos.eventsLog.add(clock(), 'wa_test', JSON.stringify({ to: deps.s().whatsappNumber || null, simulated: true }));
    res.json({ ok: true, simulated: true });
  });

  app.get('/api/export/trades.csv', (_req, res) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="evil-eye-trades.csv"');
    res.send(tradesCsv(repos.trades.exportColumns(), repos.trades.exportRows()));
  });

  app.get('/api/export/all.json', (_req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="evil-eye-export.json"');
    res.json({
      exportedAt: clock(),
      settings: repos.settings.all(),
      profiles: repos.profiles.all(),
      books: repos.books.all(),
      trades: repos.trades.exportRows(),
      journal: repos.journal.all(),
      eventsLog: repos.eventsLog.all(),
      creditsUsage: repos.credits.all(),
      limitsReports: repos.limitsReports.all(),
      bankrollSnapshots: repos.profiles.all().flatMap((p) => repos.snapshots.byProfile(p.id)),
    });
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
