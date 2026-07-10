/**
 * Vitest does not read tsconfig "paths", so the @shared alias is declared
 * here too. Keep this in sync with tsconfig.json (tsc + tsx read that one).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
});
