-- Evil Eye V2 — SQLite schema (MASTER PROMPT §5). Idempotent: safe to run on every open.
-- Conventions: money = *_cents INTEGER; epoch timestamps = INTEGER ms; day keys = TEXT 'YYYY-MM-DD' (Vancouver-local).

CREATE TABLE IF NOT EXISTS profiles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL UNIQUE,
  starting_cash_cents INTEGER NOT NULL,
  created_date        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  name             TEXT PRIMARY KEY,
  sport            TEXT NOT NULL,
  sharp_exempt     INTEGER NOT NULL DEFAULT 0,
  heat             INTEGER NOT NULL DEFAULT 0,
  health           TEXT NOT NULL DEFAULT 'green',
  max_belief_cents INTEGER
);

CREATE TABLE IF NOT EXISTS trades (
  id              TEXT PRIMARY KEY,
  profile_id      INTEGER NOT NULL,
  category        TEXT NOT NULL,
  event           TEXT NOT NULL,
  sport           TEXT NOT NULL,
  market          TEXT,             -- stamped at insert (candidate market); not part of shared Trade
  legs            TEXT NOT NULL,    -- JSON: [{ book, selection, odds, stakeCents }]
  margin_initial  REAL NOT NULL,
  margin_recheck  REAL,
  margin_final    REAL,
  status          TEXT NOT NULL,
  kill_reason     TEXT,
  result_cents    INTEGER,
  created_at      INTEGER NOT NULL,
  verify_due_at   INTEGER NOT NULL,
  verified_at     INTEGER,
  fresh_until     INTEGER,
  settled_at      INTEGER,
  event_starts_at INTEGER NOT NULL,
  day_key         TEXT NOT NULL     -- Vancouver day stamped at insert
);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_day_key ON trades(day_key);

CREATE TABLE IF NOT EXISTS limits_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id          TEXT NOT NULL,
  book              TEXT NOT NULL,
  max_allowed_cents INTEGER NOT NULL,
  sent_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  payload TEXT NOT NULL             -- JSON
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL                   -- JSON-encoded value
);

CREATE TABLE IF NOT EXISTS credits_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  n  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bankroll_snapshots (
  profile_id     INTEGER NOT NULL,
  day_key        TEXT NOT NULL,
  bankroll_cents INTEGER NOT NULL,
  PRIMARY KEY (profile_id, day_key)
);
