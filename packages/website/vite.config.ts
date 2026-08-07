import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  publicDir: 'public',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        guide: resolve(__dirname, 'guide/index.html'),
      },
      output: {
        manualChunks(id) {
          // Keep the terminal emulator separate from the application bundle.
          if (id.includes('ghostty-web')) {
            return 'ghostty';
          }

          // Separate DuckDB WASM into its own chunk.
          if (id.includes('@duckdb/duckdb-wasm')) {
            return 'duckdb';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
