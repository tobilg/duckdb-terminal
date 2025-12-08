import { defineConfig } from 'vite';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to find package.json in node_modules (handles hoisting)
function findPackageJson(packageName: string): Record<string, unknown> {
  const paths = [
    join(__dirname, 'node_modules', packageName, 'package.json'),
    join(__dirname, '..', '..', 'node_modules', packageName, 'package.json'),
  ];
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      continue;
    }
  }
  throw new Error(`Could not find package.json for ${packageName}`);
}

// Read version from ghostty-web for CDN path
const ghosttyPkg = findPackageJson('ghostty-web');

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
      // Externalize ghostty-web - load from CDN at runtime
      external: ['ghostty-web'],
      output: {
        // Use CDN path for ghostty-web
        paths: {
          'ghostty-web': `https://cdn.jsdelivr.net/npm/ghostty-web@${ghosttyPkg.version}/dist/ghostty-web.js`,
        },
        manualChunks: {
          // Separate DuckDB WASM into its own chunk
          duckdb: ['@duckdb/duckdb-wasm'],
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
