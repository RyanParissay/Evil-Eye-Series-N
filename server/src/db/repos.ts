import type { Leg, Trade, TradeStatus } from '../shared/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';
import type { Db } from './db.js';

export type BookHealth = 'green' | 'yellow' | 'red';
export interface Book {
  name: string; sport: string; sharpExempt: 0 | 1; heat: number;
  health: BookHealth; maxBeliefCents: number | null; enabled: 0 | 1;
}
export interface Profile { id: number; name: string; startingCashCents: number; createdDate: string; }
export interface JournalEntry { id: number; ts: number; text: string; }
export interface EventLogEntry { id: number; ts: number; kind: string; payload: string; }
export interface CreditsEntry { id: number; ts: number; n: number; }
export interface LimitsReport { id: number; tradeId: string; book: string; maxAllowedCents: number; sentAt: number; }
export interface BankrollSnapshot { profileId: number; dayKey: string; bankrollCents: number; }

interface TradeRow {
  id: string; profile_id: number; category: Trade['category']; event: string; sport: string;
  market: string | null; legs: string; margin_initial: number; margin_recheck: number | null;
  margin_final: number | null; status: TradeStatus; kill_reason: Trade['killReason'];
  result_cents: number | null; created_at: number; verify_due_at: number; verified_at: number | null;
  fresh_until: number | null; settled_at: number | null; event_starts_at: number; day_key: string;
}
interface BookRow {
  name: string; sport: string; sharp_exempt: 0 | 1; heat: number;
  health: BookHealth; max_belief_cents: number | null; enabled: 0 | 1;
}

function rowToTrade(r: TradeRow): Trade {
  return {
    id: r.id, profileId: r.profile_id, category: r.category, event: r.event, sport: r.sport,
    legs: JSON.parse(r.legs) as Leg[], marginInitial: r.margin_initial, marginRecheck: r.margin_recheck,
    marginFinal: r.margin_final, status: r.status, killReason: r.kill_reason, resultCents: r.result_cents,
    createdAt: r.created_at, verifyDueAt: r.verify_due_at, verifiedAt: r.verified_at,
    freshUntil: r.fresh_until, settledAt: r.settled_at, eventStartsAt: r.event_starts_at,
  };
}

function rowToBook(r: BookRow): Book {
  return {
    name: r.name, sport: r.sport, sharpExempt: r.sharp_exempt, heat: r.heat,
    health: r.health, maxBeliefCents: r.max_belief_cents, enabled: r.enabled,
  };
}

// Thin prepared-statement wrappers. JSON (de)serialization happens ONLY for trades.legs and settings values.
export function Repos(db: Db) {
  const st = {
    tradeInsert: db.prepare(`INSERT INTO trades (
        id, profile_id, category, event, sport, market, legs, margin_initial, margin_recheck, margin_final,
        status, kill_reason, result_cents, created_at, verify_due_at, verified_at, fresh_until, settled_at,
        event_starts_at, day_key)
      VALUES (@id, @profileId, @category, @event, @sport, @market, @legs, @marginInitial, @marginRecheck,
        @marginFinal, @status, @killReason, @resultCents, @createdAt, @verifyDueAt, @verifiedAt, @freshUntil,
        @settledAt, @eventStartsAt, @dayKey)`),
    tradeUpdate: db.prepare(`UPDATE trades SET
        profile_id = @profileId, category = @category, event = @event, sport = @sport, legs = @legs,
        margin_initial = @marginInitial, margin_recheck = @marginRecheck, margin_final = @marginFinal,
        status = @status, kill_reason = @killReason, result_cents = @resultCents, created_at = @createdAt,
        verify_due_at = @verifyDueAt, verified_at = @verifiedAt, fresh_until = @freshUntil,
        settled_at = @settledAt, event_starts_at = @eventStartsAt
      WHERE id = @id`), // market + day_key are stamped at insert and immutable
    tradeById: db.prepare('SELECT * FROM trades WHERE id = ?'),
    tradeByStatus: db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY created_at ASC'),
    tradeVerifiedSentToday: db.prepare(
      'SELECT COUNT(*) AS n FROM trades WHERE day_key = ? AND verified_at IS NOT NULL'),
    tradeCountByBookToday: db.prepare(`SELECT COUNT(*) AS n FROM trades t
      WHERE t.day_key = @dayKey AND t.verified_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(t.legs) WHERE json_extract(json_each.value, '$.book') = @book)`),
    tradeCountByBookMarketSince: db.prepare(`SELECT COUNT(*) AS n FROM trades t
      WHERE t.market = @market AND t.verified_at IS NOT NULL AND t.verified_at >= @sinceMs
        AND EXISTS (SELECT 1 FROM json_each(t.legs) WHERE json_extract(json_each.value, '$.book') = @book)`),
    settingsAll: db.prepare('SELECT k, v FROM settings'),
    settingsUpsert: db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
    booksAll: db.prepare('SELECT * FROM books ORDER BY rowid ASC'),
    bookByName: db.prepare('SELECT * FROM books WHERE name = ?'),
    journalAdd: db.prepare('INSERT INTO journal (ts, text) VALUES (?, ?)'),
    journalAll: db.prepare('SELECT * FROM journal ORDER BY ts ASC, id ASC'),
    eventAdd: db.prepare('INSERT INTO events_log (ts, kind, payload) VALUES (?, ?, ?)'),
    eventsAll: db.prepare('SELECT * FROM events_log ORDER BY ts ASC, id ASC'),
    creditsAdd: db.prepare('INSERT INTO credits_usage (ts, n) VALUES (?, ?)'),
    creditsAll: db.prepare('SELECT * FROM credits_usage ORDER BY ts ASC, id ASC'),
    snapshotWrite: db.prepare(`INSERT INTO bankroll_snapshots (profile_id, day_key, bankroll_cents)
      VALUES (?, ?, ?) ON CONFLICT(profile_id, day_key) DO UPDATE SET bankroll_cents = excluded.bankroll_cents`),
    snapshotsByProfile: db.prepare(
      'SELECT profile_id, day_key, bankroll_cents FROM bankroll_snapshots WHERE profile_id = ? ORDER BY day_key ASC'),
    profilesAll: db.prepare('SELECT * FROM profiles ORDER BY id ASC'),
    profileCreate: db.prepare('INSERT INTO profiles (name, starting_cash_cents, created_date) VALUES (?, ?, ?)'),
    limitsAdd: db.prepare('INSERT INTO limits_reports (trade_id, book, max_allowed_cents, sent_at) VALUES (?, ?, ?, ?)'),
    limitsAll: db.prepare('SELECT * FROM limits_reports ORDER BY sent_at ASC, id ASC'),
    bookUpdate: db.prepare(
      'UPDATE books SET heat = @heat, health = @health, max_belief_cents = @maxBeliefCents WHERE name = @name'),
    tradeCountToday: db.prepare('SELECT COUNT(*) AS n FROM trades WHERE day_key = ?'),
    tradeHeldBackToday: db.prepare(`SELECT COUNT(*) AS n FROM trades
      WHERE day_key = ? AND status = 'EXPIRED' AND verified_at IS NULL AND margin_recheck IS NOT NULL`),
    tradeKilledTodayByReason: db.prepare(`SELECT kill_reason AS reason, COUNT(*) AS n FROM trades
      WHERE day_key = ? AND status = 'KILLED' GROUP BY kill_reason`),
    tradeRecheckRows: db.prepare(`SELECT margin_initial AS mi, margin_recheck AS mr, status
      FROM trades WHERE margin_recheck IS NOT NULL ORDER BY created_at ASC, id ASC`),
    tradeSentVolumeByBook: db.prepare(`SELECT verified_at AS va, market FROM trades t
      WHERE t.verified_at IS NOT NULL AND t.status IN ('CONFIRMED', 'SETTLED')
        AND EXISTS (SELECT 1 FROM json_each(t.legs) WHERE json_extract(json_each.value, '$.book') = @book)
      ORDER BY verified_at ASC, id ASC`),
    eventsByKind: db.prepare('SELECT * FROM events_log WHERE kind = ? ORDER BY ts ASC, id ASC'),
    bookSetEnabled: db.prepare('UPDATE books SET enabled = ? WHERE name = ?'),
    bookSetSport: db.prepare('UPDATE books SET sport = ? WHERE name = ?'),
    tradeSentTodayByCategory: db.prepare(
      'SELECT COUNT(*) AS n FROM trades WHERE day_key = ? AND category = ? AND verified_at IS NOT NULL'),
    tradeExportRows: db.prepare('SELECT * FROM trades ORDER BY created_at ASC, id ASC'),
    tradeExportColumns: db.prepare('PRAGMA table_info(trades)'),
  };

  const bindTrade = (t: Trade) => ({
    id: t.id, profileId: t.profileId, category: t.category, event: t.event, sport: t.sport,
    legs: JSON.stringify(t.legs), marginInitial: t.marginInitial, marginRecheck: t.marginRecheck,
    marginFinal: t.marginFinal, status: t.status, killReason: t.killReason, resultCents: t.resultCents,
    createdAt: t.createdAt, verifyDueAt: t.verifyDueAt, verifiedAt: t.verifiedAt, freshUntil: t.freshUntil,
    settledAt: t.settledAt, eventStartsAt: t.eventStartsAt,
  });

  const trades = {
    /** dayKey = Vancouver 'YYYY-MM-DD' of `t.createdAt` (caller computes it — Task 8's clock).
     *  market = the candidate's market, needed by countByBookMarketSince; optional so the
     *  brief's 2-arg contract holds. */
    insert(t: Trade, dayKey: string, market: string | null = null): void {
      st.tradeInsert.run({ ...bindTrade(t), market, dayKey });
    },
    update(t: Trade): void {
      st.tradeUpdate.run(bindTrade(t));
    },
    byId(id: string): Trade | null {
      const row = st.tradeById.get(id) as TradeRow | undefined;
      return row ? rowToTrade(row) : null;
    },
    byStatus(s: TradeStatus): Trade[] {
      return (st.tradeByStatus.all(s) as TradeRow[]).map(rowToTrade);
    },
    /** Trades SENT today (verified_at stamped) for the given Vancouver dayKey — feeds the daily pick cap. */
    verifiedSentToday(dayKey: string): number {
      return (st.tradeVerifiedSentToday.get(dayKey) as { n: number }).n;
    },
    /** Sent trades today with a leg at `book` — feeds SHARP_VELOCITY_CAP via GateContext.sentTodayByBook. */
    countByBookToday(book: string, dayKey: string): number {
      return (st.tradeCountByBookToday.get({ book, dayKey }) as { n: number }).n;
    },
    /** Sent trades since `sinceMs` (by verified_at) at `book` in `market` — feeds MARKET_BREADTH_CAP. */
    countByBookMarketSince(book: string, market: string, sinceMs: number): number {
      return (st.tradeCountByBookMarketSince.get({ book, market, sinceMs }) as { n: number }).n;
    },
    /** Every trade stamped with this Vancouver day (all statuses) — the rationale's "candidates". */
    countToday(dayKey: string): number {
      return (st.tradeCountToday.get(dayKey) as { n: number }).n;
    },
    /** Passed the recheck but never promoted (daily cap / zero stake): EXPIRED + recheck set + verified_at null. */
    heldBackToday(dayKey: string): number {
      return (st.tradeHeldBackToday.get(dayKey) as { n: number }).n;
    },
    killedTodayByReason(dayKey: string): Partial<Record<NonNullable<Trade['killReason']>, number>> {
      const out: Partial<Record<NonNullable<Trade['killReason']>, number>> = {};
      for (const row of st.tradeKilledTodayByReason.all(dayKey) as { reason: NonNullable<Trade['killReason']>; n: number }[]) {
        out[row.reason] = row.n;
      }
      return out;
    },
    /** Every trade that completed the 75s recheck — the DOUBLE VERIFICATION tile's population. */
    recheckRows(): { marginInitial: number; marginRecheck: number; status: TradeStatus }[] {
      return (st.tradeRecheckRows.all() as { mi: number; mr: number; status: TradeStatus }[])
        .map((r) => ({ marginInitial: r.mi, marginRecheck: r.mr, status: r.status }));
    },
    /** Confirmed-or-settled sent trades with a leg at `book` — the heat model's volume/breadth input. */
    sentVolumeByBook(book: string): { verifiedAt: number; market: string | null }[] {
      return (st.tradeSentVolumeByBook.all({ book }) as { va: number; market: string | null }[])
        .map((r) => ({ verifiedAt: r.va, market: r.market }));
    },
    /** SENT semantics per category — the strategy-mix allowance's counter. */
    sentTodayByCategory(dayKey: string, category: Trade['category']): number {
      return (st.tradeSentTodayByCategory.get(dayKey, category) as { n: number }).n;
    },
    /** Raw whole-table dump (snake_case, legs as stored JSON) — exports only, never a view. */
    exportRows(): Record<string, unknown>[] {
      return st.tradeExportRows.all() as Record<string, unknown>[];
    },
    exportColumns(): string[] {
      return (st.tradeExportColumns.all() as { name: string }[]).map((c) => c.name);
    },
  };

  const settings = {
    all(): Settings {
      const stored: Record<string, unknown> = {};
      for (const row of st.settingsAll.all() as { k: string; v: string }[]) stored[row.k] = JSON.parse(row.v);
      return { ...DEFAULT_SETTINGS, ...stored } as Settings; // fresh copy every call
    },
    set(patch: Partial<Settings>): Settings {
      db.transaction(() => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          st.settingsUpsert.run(k, JSON.stringify(v));
        }
      })();
      return settings.all();
    },
  };

  const books = {
    all(): Book[] {
      return (st.booksAll.all() as BookRow[]).map(rowToBook);
    },
    byName(n: string): Book | null {
      const row = st.bookByName.get(n) as BookRow | undefined;
      return row ? rowToBook(row) : null;
    },
    /** The brain pass is the ONLY writer of these three columns. */
    update(name: string, heat: number, health: BookHealth, maxBeliefCents: number | null): void {
      st.bookUpdate.run({ name, heat, health, maxBeliefCents });
    },
    /** MY BOOKS panel writers (Plan 5). The route guards sharp books; these don't. */
    setEnabled(name: string, enabled: 0 | 1): void { st.bookSetEnabled.run(enabled, name); },
    setSport(name: string, sport: string): void { st.bookSetSport.run(sport, name); },
  };

  const journal = {
    add(ts: number, text: string): void { st.journalAdd.run(ts, text); },
    all(): JournalEntry[] { return st.journalAll.all() as JournalEntry[]; },
  };

  const eventsLog = {
    add(ts: number, kind: string, payloadJson: string): void { st.eventAdd.run(ts, kind, payloadJson); },
    all(): EventLogEntry[] { return st.eventsAll.all() as EventLogEntry[]; },
    byKind(kind: string): EventLogEntry[] {
      return st.eventsByKind.all(kind) as EventLogEntry[];
    },
  };

  const credits = {
    add(ts: number, n: number): void { st.creditsAdd.run(ts, n); },
    all(): CreditsEntry[] { return st.creditsAll.all() as CreditsEntry[]; },
  };

  const snapshots = {
    /** Upserts: one row per profile per day; last write for the day wins (drives the charts). */
    writeDaily(profileId: number, dayKey: string, bankrollCents: number): void {
      st.snapshotWrite.run(profileId, dayKey, bankrollCents);
    },
    byProfile(profileId: number): BankrollSnapshot[] {
      return (st.snapshotsByProfile.all(profileId) as
        { profile_id: number; day_key: string; bankroll_cents: number }[])
        .map((r) => ({ profileId: r.profile_id, dayKey: r.day_key, bankrollCents: r.bankroll_cents }));
    },
  };

  const profiles = {
    all(): Profile[] {
      return (st.profilesAll.all() as
        { id: number; name: string; starting_cash_cents: number; created_date: string }[])
        .map((r) => ({ id: r.id, name: r.name, startingCashCents: r.starting_cash_cents, createdDate: r.created_date }));
    },
    create(name: string, startingCashCents: number, createdDate: string): Profile {
      const info = st.profileCreate.run(name, startingCashCents, createdDate);
      return { id: Number(info.lastInsertRowid), name, startingCashCents, createdDate };
    },
  };

  const limitsReports = {
    add(tradeId: string, book: string, maxAllowedCents: number, sentAt: number): void {
      st.limitsAdd.run(tradeId, book, maxAllowedCents, sentAt);
    },
    all(): LimitsReport[] {
      return (st.limitsAll.all() as
        { id: number; trade_id: string; book: string; max_allowed_cents: number; sent_at: number }[])
        .map((r) => ({ id: r.id, tradeId: r.trade_id, book: r.book, maxAllowedCents: r.max_allowed_cents, sentAt: r.sent_at }));
    },
  };

  return { trades, settings, books, journal, eventsLog, credits, snapshots, profiles, limitsReports };
}

export type Repos = ReturnType<typeof Repos>;
