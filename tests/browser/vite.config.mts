import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const library = fileURLToPath(new URL('../../packages/duckdb-terminal/dist/', import.meta.url));
export default {
  root,
  base: '/nested/',
  resolve: { alias: [
    { find: 'duckdb-terminal/style.css', replacement: library + 'duckdb-terminal.css' },
    { find: 'duckdb-terminal', replacement: library + 'duckdb-terminal.js' },
  ] },
  build: { outDir: '../../.browser-test-dist', emptyOutDir: true },
};
