import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

export type Db = Database.Database;
export { Repos } from './repos.js';
export type { Book, Profile } from './repos.js';

// Static asset loaded relative to THIS module (never process.cwd()) so vitest and `npm run dev` agree.
const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const SEED_BOOKS: ReadonlyArray<readonly [name: string, sport: string, sharpExempt: 0 | 1]> = [
  ['pinnacle', 'ANY', 1],
  ['bet365', 'basketball', 0],
  ['fanduel', 'basketball', 0],
  ['draftkings', 'baseball', 0],
  ['betmgm', 'baseball', 0],
  ['caesars', 'hockey', 0],
  ['bet99', 'hockey', 0],
  ['sportsinteraction', 'soccer', 0],
  ['betway', 'soccer', 0],
  ['pointsbet', 'basketball', 0],
  ['bwin', 'soccer', 0],
  ['unibet', 'tennis', 0],
  ['bodog', 'tennis', 0],
  ['betvictor', 'soccer', 0],
  ['leovegas', 'hockey', 0],
  ['betrivers', 'baseball', 0],
];

/** Opens (creating if needed) the SQLite db, runs the idempotent schema, and seeds empty tables. */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // no-op for :memory:, durable-fast for file dbs
  db.exec(schemaSql);
  seedIfEmpty(db);
  return db;
}

function count(db: Db, table: 'settings' | 'profiles' | 'books'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function seedIfEmpty(db: Db): void {
  db.transaction(() => {
    if (count(db, 'settings') === 0) {
      const seed = { ...DEFAULT_SETTINGS }; // copy — DEFAULT_SETTINGS is unfrozen, never hand out the module object
      const insert = db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)');
      for (const [k, v] of Object.entries(seed)) insert.run(k, JSON.stringify(v));
    }
    if (count(db, 'profiles') === 0) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      db.prepare('INSERT INTO profiles (name, starting_cash_cents, created_date) VALUES (?, ?, ?)')
        .run('RYAN', 1_000_000, today);
    }
    if (count(db, 'books') === 0) {
      const insert = db.prepare(
        "INSERT INTO books (name, sport, sharp_exempt, heat, health, max_belief_cents) VALUES (?, ?, ?, 0, 'green', NULL)",
      );
      for (const [name, sport, sharpExempt] of SEED_BOOKS) insert.run(name, sport, sharpExempt);
    }
  })();
}
