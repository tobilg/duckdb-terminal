# duckdb-terminal

A SQL terminal for [DuckDB](https://duckdb.org/) that runs entirely in the browser: DuckDB-Wasm for the database, [Gespenst](https://gespenst.dev/) (Ghostty VT) for the terminal, and an optional local AI assistant that answers questions about your data without a server.

- **Live demo:** [duckdb-terminal.com](https://duckdb-terminal.com)
- **API docs:** [tobilg.github.io/duckdb-terminal](https://tobilg.github.io/duckdb-terminal/)
- **Full documentation and source:** [github.com/tobilg/duckdb-terminal](https://github.com/tobilg/duckdb-terminal)
- **Changes:** [CHANGELOG.md](https://github.com/tobilg/duckdb-terminal/blob/main/packages/duckdb-terminal/CHANGELOG.md)

## Features

- SQL REPL with multi-line input, syntax highlighting, tab completion, and persistent history
- Table, CSV, TSV, and JSON output; copy or download results; pagination for large results
- Load CSV, Parquet, and JSON files by drag-and-drop or file picker, or query them by URL
- Interactive charts (uPlot), query sharing via URL, dark/light and custom themes
- Optional persistent databases in the browser's Origin Private File System (OPFS)
- Local AI assistant (`.model`, `.ai`): a small language model runs in the browser with WebGPU and can run SQL itself

## Installation

```bash
npm install duckdb-terminal @duckdb/duckdb-wasm@1.33.1-dev113.0 @gespenst/core@0.2.0
```

`@duckdb/duckdb-wasm` and `@gespenst/core` are peer dependencies pinned to exact versions: the Gespenst WASM shipped with this package must match its core. The package is browser-only ESM and needs an asset-aware bundler such as [Vite](https://vite.dev/).

## Quick start

```html
<div id="terminal" style="height: 32rem"></div>
```

```typescript
import { createTerminal } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';

const terminal = await createTerminal({
  container: '#terminal',
  theme: 'dark',
});
```

Give the container an explicit height and import the stylesheet once.

## Configuration

```typescript
const terminal = await createTerminal({
  container: document.getElementById('terminal')!, // element or CSS selector (required)
  theme: 'light',            // 'dark' (default), 'light', or a custom Theme
  fontSize: 13,              // default 14
  fontFamily: 'JetBrains Mono, monospace',
  welcomeMessage: false,     // default true: banner and loading progress
  prompt: 'sql> ',           // default '🦆 '
  continuationPrompt: '...> ', // default '  > '
  enableCharts: true,        // default false: enables .chart (uPlot is loaded on first use)
  linkDetection: true,       // default true: clickable URLs in output
  maxDisplayRows: 500,       // rows per result page, default 1000
  exactRowCount: false,      // count all rows before showing page 1, default false
  scrollbackLines: 10_000,   // default 10,000; 0 disables scrollback
  storage: 'memory',         // 'memory' (default) or 'opfs'
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `container` | (required) | Element or CSS selector to render into |
| `theme` | `'dark'` | `'dark'`, `'light'`, or a `Theme` object |
| `fontFamily` | Fira Code, Cascadia Code, … | Terminal font |
| `fontSize` | `14` | Font size in pixels |
| `storage` | `'memory'` | `'opfs'` keeps the database between visits |
| `databasePath` | | Database file for OPFS storage, such as `'opfs://my-data.duckdb'` |
| `maximumThreads` | `1` | DuckDB threads; more than 1 needs a COI bundle (see below) |
| `duckdbBundles` | jsDelivr bundles | DuckDB-Wasm bundle manifest |
| `welcomeMessage` | `true` | Show the banner and loading progress |
| `prompt` / `continuationPrompt` | `'🦆 '` / `'  > '` | Prompts |
| `linkDetection` | `true` | Make URLs in output clickable |
| `scrollbackLines` | `10000` | Retained scrollback lines |
| `enableCharts` | `false` | Enable `.chart` |
| `maxDisplayRows` | `1000` | Rows per result page |
| `exactRowCount` | `false` | Count all rows before the first page |

## Usage examples

### Run SQL and commands from your application

```typescript
// Query remote files directly (the server must allow CORS)
await terminal.executeSQL(`
  CREATE TABLE trips AS
  SELECT * FROM 'https://example.com/data/trips.parquet';
`);

const result = await terminal.executeSQL('SELECT count(*) AS trips FROM trips;');
console.log(result?.rows); // [[12345]]; null if the statement failed

// Run dot commands as if typed (one command at a time, rejected while a query runs)
await terminal.runCommand('.mode csv');
await terminal.runCommand('.tables');

// Cancel a running query
await terminal.cancelQuery();
```

`executeSQL()` shows the statement and its result in the terminal and emits `queryStart` and `queryEnd`.

### Listen to events

```typescript
const off = terminal.on('queryEnd', ({ sql, result, error, duration }) => {
  if (error) console.error(`Failed: ${sql}`, error);
  else console.log(`${result?.rowCount} rows in ${duration.toFixed(1)} ms`);
});

terminal.on('fileLoaded', ({ filename, size }) => console.log(`Loaded ${filename} (${size} bytes)`));
terminal.on('error', ({ message, source }) => console.error(source, message));

off(); // unsubscribe
```

Events: `ready`, `queryStart`, `queryEnd`, `stateChange`, `themeChange`, `fileLoaded`, `commandExecute`, `error`.

### Wire up buttons

```typescript
document.querySelector('#run-help')!.addEventListener('click', () => {
  terminal.focus();
  void terminal.runCommand('.help');
});

// File pickers need the user's click: call .open directly in the handler, before any other await.
document.querySelector('#open-file')!.addEventListener('click', () => {
  void terminal.runCommand('.open');
});

document.querySelector('#theme')!.addEventListener('click', async () => {
  await terminal.setTheme(terminal.getTheme() === 'dark' ? 'light' : 'dark');
});
```

### Custom theme

```typescript
import { createTerminal, type Theme } from 'duckdb-terminal';

const tokyoNight: Theme = {
  name: 'tokyo-night',
  colors: {
    background: '#1a1b26', foreground: '#a9b1d6', cursor: '#c0caf5', selection: '#33467c',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
    brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  },
};

const terminal = await createTerminal({ container: '#terminal', theme: tokyoNight });
```

### React

```tsx
import { useEffect, useRef } from 'react';
import { createTerminal, type DuckDBTerminal } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';

export function SqlTerminal() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let terminal: DuckDBTerminal | undefined;
    let unmounted = false;
    void createTerminal({ container: container.current! }).then((created) => {
      if (unmounted) void created.destroy();
      else terminal = created;
    });
    return () => {
      unmounted = true;
      void terminal?.destroy();
    };
  }, []);

  return <div ref={container} style={{ height: '32rem' }} />;
}
```

`destroy()` cancels running work and closes the database and the renderer. Await it before creating a new terminal in the same container.

### Use the database without the terminal

```typescript
import { Database, formatTable, formatCSV } from 'duckdb-terminal';

const db = new Database({ storage: 'memory' });
await db.init();

const result = await db.executeQuery("SELECT 42 AS answer, now() AS at");
console.log(formatTable(result.columns, result.rows, { columnTypes: result.columnTypes }));
console.log(formatCSV(result.columns, result.rows, result.columnTypes));

await db.close();
```

Pass `columnTypes` to the formatters: DuckDB-Wasm returns dates and timestamps as numbers, and the formatters turn them back into DuckDB's text form.

## Terminal commands

| Command | Description |
|---------|-------------|
| `.help` | Show available commands |
| `.tables`, `.schema <table>` | List tables, show a table's schema |
| `.mode table\|csv\|tsv\|json` | Output format |
| `.copy`, `.download [file]` | Copy or download the last result |
| `.open`, `.files [list\|add\|remove]` | Load and manage files |
| `.chart [options]` | Chart the last result (needs `enableCharts`) |
| `.share` | Share queries via URL |
| `.model [1-4]` | Choose and download a local AI model |
| `.ai <prompt>` | Ask the local AI model about your data |
| `.theme dark\|light`, `.highlight on\|off`, `.links on\|off`, `.timer on\|off` | Display settings |
| `.pagesize <n>`, `.prompt [primary [cont]]` | Paging and prompts |
| `.reset`, `.clear`, `.clearhistory` | Reset the database and settings, clear the screen, clear the history |

## Local AI assistant

```sql
.model 1
CREATE TABLE orders AS SELECT * FROM 'https://example.com/orders.csv';
.ai Which customer spent the most in total?
```

`.model` lists four models (Qwen3.5 0.8B, MiniCPM5 1B, Qwen3.5 2B, Qwen3.5 4B, from 537 MiB to 2.7 GiB), downloads the chosen one from Hugging Face once, and caches it in OPFS. `.ai` sends the question with the current schema, and the model answers using two tools: `query` runs SQL, and `search_docs` searches the DuckDB documentation that ships with the package. Questions can also name Parquet, CSV, or JSON URLs and DuckDB database URLs, which the model attaches read-only.

- **The model's statements run without confirmation**, including ones that change data. Keep a copy of data you cannot recreate.
- It needs WebGPU for usable speed (current Chrome and Edge) and disk space for the model cache.
- [wllama](https://github.com/ngxson/wllama) is loaded from jsDelivr on first use; nothing AI-related is downloaded until `.model` or `.ai` runs.

## Assets, CDNs, and Content Security Policy

The package ships these files next to `duckdb-terminal.js`; keep them when bundling or deploying (Vite does this automatically):

| File | Purpose |
|------|---------|
| `ghostty-vt.wasm`, `ghostty-callbacks.wasm` | Terminal runtime (Gespenst) |
| `duckdb-docs.json` (1.9 MB, 470 KB gzipped) | DuckDB docs for the AI assistant, fetched on its first search |

At runtime the terminal loads from these origins, which a Content Security Policy must allow (also `blob:` workers):

- `cdn.jsdelivr.net`: DuckDB-Wasm (unless you pass your own `duckdbBundles`), uPlot for charts, wllama for the AI assistant
- `extensions.duckdb.org`: DuckDB extensions loaded on demand, such as Parquet and JSON
- `huggingface.co` and `*.hf.co`: AI model downloads

## Browser support

Current Chrome, Edge, Firefox, and Safari. The default DuckDB build is single-threaded and needs no cross-origin isolation. Where OPFS is unavailable (such as private windows), in-memory databases still work; `storage: 'opfs'` needs it.

For more than one DuckDB thread, pass a COI bundle in `duckdbBundles`, set `maximumThreads`, and serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. See the [multithreading guide](https://github.com/tobilg/duckdb-terminal#opt-in-multithreading) for the details and its limits with extensions.

## License

MIT © TobiLG, see `LICENSE`. The bundled DuckDB documentation is MIT licensed by the DuckDB Foundation; see `THIRD_PARTY_NOTICES.md`.
