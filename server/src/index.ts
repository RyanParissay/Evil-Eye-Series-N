// Boot (Task 13): the ONLY place real time exists. Opens the file db, wires
// the sim provider on Math.random, and hands createApp the real clock and the
// codebase's one real setTimeout. Everything else is injected and testable.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from './api/routes.js';

const PORT = 4400;

const dataDir = fileURLToPath(new URL('../data/', import.meta.url)); // server/data, wherever the repo lives
mkdirSync(dataDir, { recursive: true });

const { app } = createApp({
  dbPath: join(dataDir, 'evil-eye.db'),
  clock: () => Date.now(),
  timer: { setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms) },
  rng: Math.random,
});

app.listen(PORT, () => {
  console.log(`Evil Eye V2 — SIMULATED mode — listening on http://localhost:${PORT}`);
});
