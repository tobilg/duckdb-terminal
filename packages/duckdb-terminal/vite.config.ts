import { defineConfig } from 'vite';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to find package.json in node_modules (handles hoisting)
function findPackageJson(packageName: string): Record<string, unknown> {
  // Try local node_modules first, then workspace root
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

// Read versions from package.json files
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const ghosttyPkg = findPackageJson('ghostty-web');
const uplotPkg = findPackageJson('uplot');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GHOSTTY_VERSION__: JSON.stringify(ghosttyPkg.version),
    __UPLOT_VERSION__: JSON.stringify(uplotPkg.version),
  },
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Bundle all type declarations into a single index.d.ts file
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'DuckDBTerminal',
      formats: ['es', 'umd'],
      fileName: (format) =>
        format === 'es' ? 'duckdb-terminal.js' : 'duckdb-terminal.umd.cjs',
    },
    rollupOptions: {
      external: ['@duckdb/duckdb-wasm', 'ghostty-web'],
      output: {
        globals: {
          '@duckdb/duckdb-wasm': 'duckdb',
          'ghostty-web': 'GhosttyWeb',
        },
      },
    },
    minify: 'esbuild',
    target: 'es2020',
    // Don't copy public folder for library builds
    copyPublicDir: false,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
