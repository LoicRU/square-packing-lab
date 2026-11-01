import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Site multi-pages statique : aucune dépendance runtime, aucun backend.
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        simulator: resolve(import.meta.dirname, 'simulator.html'),
        algorithms: resolve(import.meta.dirname, 'algorithms.html'),
        learn: resolve(import.meta.dirname, 'learn.html'),
        about: resolve(import.meta.dirname, 'about.html'),
        parallel: resolve(import.meta.dirname, 'parallel.html'),
      },
    },
  },
  worker: { format: 'es' },
  // développement : le backend persistant (npm run server) est proxifié, SSE inclus
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787' } } },
  test: { environment: 'node', include: ['tests/**/*.test.js'], testTimeout: 60000 },
});
