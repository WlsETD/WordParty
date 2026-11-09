import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use shared's TypeScript source directly, so the web app never needs a shared build step.
      '@wordparty/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // In dev, forward Socket.IO to the game server started with `npm run dev -w @wordparty/server`.
    proxy: {
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
