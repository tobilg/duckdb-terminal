import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import pkg from './package.json';
import ghosttyPkg from './node_modules/ghostty-web/package.json';
import uplotPkg from './node_modules/uplot/package.json';

export default defineConfig(({ mode }) => {
  const isLibrary = mode === 'library';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __GHOSTTY_VERSION__: JSON.stringify(ghosttyPkg.version),
      __UPLOT_VERSION__: JSON.stringify(uplotPkg.version),
    },
    plugins: [
      // Only generate declaration files for library builds
      ...(isLibrary
        ? [
            dts({
              include: ['src/**/*.ts'],
              exclude: ['src/**/*.test.ts'],
              // Bundle all type declarations into a single lib.d.ts file
              rollupTypes: true,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: isLibrary
      ? {
          lib: {
            entry: resolve(__dirname, 'src/lib.ts'),
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
        }
      : {
          outDir: 'website',
          chunkSizeWarningLimit: 600,
          rollupOptions: {
            input: {
              main: resolve(__dirname, 'index.html'),
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
                'duckdb': ['@duckdb/duckdb-wasm'],
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
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,ts}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
      },
    },
  };
});
