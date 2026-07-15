// Boot: the ONLY place real time, real fetch and the real filesystem exist.
// Loads the V1 .env by NAME (values never printed), wires the mode from the
// settings key (SIMULATED unless the user flipped it in a previous session),
// and hands createApp the one real setTimeout. Everything else is injected.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from './api/routes.js';
import { loadV1Env } from './live/env.js';

const PORT = 4400; // locked — the V1 PORT variable belongs to V1's server (Plan 6 Decision 2)

loadV1Env(); // ~/evil-eye-arbitrage/.env (or EE_ENV_PATH) — names only, never overwrites

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });

const { app } = createApp({
  dbPath: join(dataDir, 'evil-eye.db'),
  clock: () => Date.now(),
  timer: { setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms) },
  rng: Math.random,
  fetchImpl: fetch,
  env: process.env,
  backupDir: join(dataDir, 'backups'),
});

app.listen(PORT, () => {
  console.log(`Evil Eye V2 — listening on http://localhost:${PORT}`);
});
