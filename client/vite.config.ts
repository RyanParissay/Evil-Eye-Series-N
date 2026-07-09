import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // All API traffic goes through the Express server, which holds the key.
    proxy: {
      '/api': 'http://localhost:8787',
    },
    fs: {
      // Allow importing ../shared/types.ts from outside the client root.
      allow: ['..'],
    },
  },
});
