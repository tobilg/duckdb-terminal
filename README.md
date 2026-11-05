# DuckDB Terminal

A browser-based SQL Terminal for [DuckDB](https://duckdb.org/) powered by [Gespenst](https://gespenst.dev/), using the Ghostty VT engine.

## Try it live
The latest version is always deployed to [https://duckdb-terminal.com](https://duckdb-terminal.com).

## API Docs
The TypeScript API Docs can be found at [https://tobilg.github.io/duckdb-terminal](https://tobilg.github.io/duckdb-terminal/).

## Changelog
See [packages/duckdb-terminal/CHANGELOG.md](packages/duckdb-terminal/CHANGELOG.md).

## Features

- **Full SQL REPL** - Execute SQL queries with multi-line support
- **Command History** - Navigate previous commands with arrow keys (persisted in IndexedDB)
- **Auto-Complete** - Tab completion for SQL keywords, table names, and functions
- **Multiple Output Modes** - Table, CSV, TSV, or JSON output formats
- **Clipboard Support** - Copy query results to clipboard in any output format
- **Result Pagination** - Navigate large result sets page by page
- **Syntax Highlighting** - Color-coded SQL keywords, strings, and numbers
- **Clickable URLs** - Automatically detect and make URLs clickable in results
- **File Loading** - Load CSV, Parquet, and JSON files via drag-and-drop or file picker
- **Dark/Light Themes** - Switchable themes with custom theme support
- **Customizable Prompts** - Configure primary and continuation prompts
- **Dot Commands** - Terminal commands like `.help`, `.tables`, `.schema`
- **Query Timing** - Optional execution time display
- **Persistent Storage** - Optional OPFS storage for data persistence
- **Interactive Charts** - Visualize query results with auto-detected chart types (line, bar, scatter, histogram)
- **Query Sharing** - Share SQL queries via URL for collaboration
- **Local AI Assistant** - Ask questions about your data with a small language model that runs in your browser (WebGPU) and can run SQL itself

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 Browser                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                          DuckDB Terminal                              │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                         Terminal                                │  │  │
│  │  │                                                                 │  │  │
│  │  │  - REPL (input, output, history)                                │  │  │
│  │  │  - Command parsing (SQL, dot commands, multi-line)              │  │  │
│  │  │  - Result formatting (table, CSV, TSV, JSON)                    │  │  │
│  │  │  - Syntax highlighting                                          │  │  │
│  │  └───────┬─────────────────────┬─────────────────────────┬─────────┘  │  │
│  │          │                     │                         │            │  │
│  │          ▼                     ▼                         │            │  │
│  │  ┌───────────────┐   ┌─────────────────────┐             │            │  │
│  │  │ Terminal      │   │      Database       │             │            │  │
│  │  │ Adapter       │   │                     │             │            │  │
│  │  │               │   │ - DuckDB WASM       │             │            │  │
│  │  │ - Gespenst    │   │   wrapper           │             │            │  │
│  │  │ - Themes      │   │ - Query execution   │             │            │  │
│  │  │ - Keyboard    │   │ - Auto-complete     │             │            │  │
│  │  │ - Mobile      │   │ - File loading      │             │            │  │
│  │  └───────┬───────┘   └─────────┬───────────┘             │            │  │
│  │          │                     │                         │            │  │
│  └──────────┼─────────────────────┼─────────────────────────┼────────────┘  │
│             │                     │                         │               │
│             ▼                     ▼                         ▼               │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │     Gespenst       │  │    DuckDB WASM      │  │     IndexedDB       │   │
│  │    (npm package)   │  │    (Web Worker)     │  │  (Command History)  │   │
│  │                    │  │                     │  │                     │   │
│  │ - Canvas rendering │  │ - SQL engine        │  └─────────────────────┘   │
│  │ - VT100 emulation  │  │ - Query processing  │                            │
│  └────────────────────┘  └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │        OPFS         │                            │
│                          │  (Database Storage) │                            │
│                          └─────────────────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install duckdb-terminal @duckdb/duckdb-wasm@1.33.1-dev113.0 @gespenst/core@0.2.0
```

Both peer dependencies are pinned to exact versions. See the [changelog](packages/duckdb-terminal/CHANGELOG.md) for what changed in each release, including the breaking changes in 0.8.0.

## Quick Start

### As a Library

```typescript
import { createTerminal } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';

const Terminal = await createTerminal({
  container: '#terminal',
  theme: 'dark',
});
```

Give the container an explicit height, for example `height: 32rem`. Import the stylesheet once in the embedding application. The package is browser-only ESM and requires an asset-aware bundler such as Vite. Its two WASM files are shipped with the library; the terminal worker comes from the pinned Gespenst peer dependency.

### As a Standalone App

```bash
git clone https://github.com/tobilg/duckdb-terminal.git
cd duckdb-terminal
pnpm install
pnpm run build:lib
pnpm run dev
```

Open http://localhost:5173 in your browser.

## Configuration

```typescript
interface TerminalConfig {
  // Container element or CSS selector
  container: HTMLElement | string;

  // Font family (default: 'Fira Code', 'Cascadia Code', etc.)
  fontFamily?: string;

  // Font size in pixels (default: 14)
  fontSize?: number;

  // Theme: 'dark' | 'light' | Theme (default: 'dark')
  theme?: 'dark' | 'light' | Theme;

  // Storage: 'memory' | 'opfs' (default: 'memory')
  storage?: 'memory' | 'opfs';

  // Database path for OPFS storage, such as 'opfs://mydata.duckdb' (without opfs:// nothing is persisted)
  databasePath?: string;

  // Maximum DuckDB execution threads (default: 1)
  maximumThreads?: number;

  // DuckDB-Wasm bundle manifest. A `coi` entry is required for >1 thread.
  duckdbBundles?: DuckDBBundles;

  // Show welcome message (default: true)
  // When enabled, displays loading progress during DuckDB initialization
  welcomeMessage?: boolean;

  // Primary prompt string (default: '🦆 ')
  prompt?: string;

  // Continuation prompt for multi-line SQL (default: '  > ')
  continuationPrompt?: string;

  // Enable clickable URL detection (default: true)
  linkDetection?: boolean;

  // Maximum retained scrollback lines (default: 10000; 0 disables history)
  scrollbackLines?: number;

  // Enable interactive charts feature (default: false)
  enableCharts?: boolean;

  // Maximum rows shown per result page (default: 1000)
  maxDisplayRows?: number;

  // Eagerly count all result rows before page 1 (default: false)
  exactRowCount?: boolean;
}
```

### Opt-in multithreading

The terminal deliberately uses DuckDB-Wasm's smaller, single-threaded bundle by default. Setting `threads` from SQL cannot add thread support to that build. To enable multiple threads, provide the experimental COI bundle at initialization and set `maximumThreads`:

```typescript
import { createTerminal } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';
import { getJsDelivrBundles, getPlatformFeatures } from '@duckdb/duckdb-wasm';

const features = await getPlatformFeatures();
const maximumThreads = Math.min(navigator.hardwareConcurrency || 2, 4);
const canUseThreads =
  maximumThreads > 1 &&
  features.crossOriginIsolated &&
  features.wasmExceptions &&
  features.wasmSIMD &&
  features.wasmThreads;

await createTerminal({
  container: '#terminal',
  ...(canUseThreads
    ? {
        maximumThreads,
        duckdbBundles: {
          ...getJsDelivrBundles(),
          coi: {
            mainModule: '/duckdb/duckdb-coi.wasm',
            mainWorker: '/duckdb/duckdb-browser-coi.worker.js',
            pthreadWorker: '/duckdb/duckdb-browser-coi.pthread.worker.js',
          },
        },
      }
    : {}),
});
```

Serve all three COI assets from the page's own origin. The page must also send these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Only the bundle selected for the current browser is downloaded. If `maximumThreads` is greater than 1 but DuckDB-Wasm cannot select the COI bundle, initialization fails immediately with an actionable error instead of failing later on `SET threads`.

DuckDB-Wasm's published `wasm_threads` extensions currently cannot be loaded by the COI bundle because their memory is not linked as shared. This affects Parquet, JSON, spatial, and other dynamically loaded extensions. See [duckdb-wasm#2041](https://github.com/duckdb/duckdb-wasm/issues/2041) and [extension-ci-tools#391](https://github.com/duckdb/extension-ci-tools/issues/391). Applications opting into multithreading must either avoid those extensions or provide compatible custom builds.

This repository's hosted demo intentionally uses the default single-threaded DuckDB bundle so file import and extension autoloading remain available, and it does not serve COI assets. It is served cross-origin isolated (`packages/website/public/_headers`), so the AI assistant can use several CPU threads; DuckDB stays single-threaded because the default jsDelivr manifest has no threaded bundle.

## Terminal Commands

| Command | Description |
|---------|-------------|
| `.ai <prompt>` | Ask the selected local AI model about your data |
| `.chart [options]` | Show interactive chart of last query result |
| `.clear` | Clear the terminal |
| `.clearhistory` | Clear command history |
| `.clearmodels` | Remove the downloaded AI models from the browser |
| `.copy` | Copy last query results to clipboard |
| `.download [filename]` | Download last result as file (format based on mode) |
| `.examples` | Show example queries |
| `.files [list\|add\|remove]` | Manage loaded files (list, add, or remove) |
| `.help` | Show available commands |
| `.highlight on\|off` | Toggle syntax highlighting |
| `.links on\|off` | Toggle clickable URL detection |
| `.mode table\|csv\|tsv\|json` | Set output format |
| `.model [1-4]` | Choose, download, and select a local AI model |
| `.open` | Open file picker to load data files |
| `.pagesize <n>` | Set result page size (0 resets to the safe maximum) |
| `.prompt [primary [cont]]` | Get or set the command prompt |
| `.reset` | Reset database and all settings to defaults |
| `.schema <table>` | Show table schema |
| `.share` | Open sharing modal to share queries via URL |
| `.tables` | List all tables |
| `.theme dark\|light` | Switch color theme without clearing output |
| `.timer on\|off` | Toggle query timing |

## Charts

The terminal includes an interactive charting feature powered by [uPlot](https://github.com/leeoniya/uPlot). Charts are displayed as an overlay on top of the terminal and support hover tooltips, legends, and PNG export.

> **Note:** Charts must be enabled in the configuration with `enableCharts: true`. The uPlot library (~50KB) is loaded from CDN on first use.

### Basic Usage

```sql
-- Run a query, then visualize it
SELECT date, revenue, cost FROM sales;
.chart
```

### Chart Type Auto-Detection

The chart type is automatically detected based on your data:

| Data Pattern | Chart Type | Example |
|--------------|------------|---------|
| Temporal + Numeric columns | **Line** | `DATE` + `revenue` → time series |
| Categorical + Numeric columns | **Bar** | `category` + `total` → bar chart |
| Two Numeric columns only | **Scatter** | `x_value` + `y_value` → scatter plot |
| Single Numeric column | **Histogram** | `value` → distribution histogram |
| Multiple Numeric columns | **Line** | `col1`, `col2`, `col3` → multi-series line |

### Command Options

| Option | Description | Example |
|--------|-------------|---------|
| `type=TYPE` | Force chart type: `line`, `bar`, `scatter`, `histogram` | `.chart type=bar` |
| `x=COLUMN` | Specify X-axis column | `.chart x=date` |
| `y=COLUMN` | Specify Y-axis column(s), comma-separated | `.chart y=revenue,cost` |
| `export` | Export chart as PNG | `.chart export` |

### Examples

```sql
-- Line chart: Time series with multiple series
SELECT DATE '2024-01-01' + INTERVAL (i) DAY AS date,
       100 + random() * 50 AS revenue,
       80 + random() * 30 AS cost
FROM generate_series(0, 11) AS t(i);
.chart

-- Bar chart: Categorical data
SELECT category, SUM(amount) as total
FROM (VALUES
    ('Electronics', 1500),
    ('Clothing', 800),
    ('Food', 1200),
    ('Books', 400),
    ('Toys', 600)
) AS t(category, amount)
GROUP BY category;
.chart

-- Scatter plot: Two numeric columns
SELECT random() * 100 AS x_value,
       random() * 100 AS y_value
FROM generate_series(1, 50);
.chart

-- Histogram: Single numeric column distribution
SELECT (random() * 100)::INTEGER AS value
FROM generate_series(1, 200);
.chart

-- Multi-series bar chart
SELECT region,
       SUM(CASE WHEN product = 'A' THEN sales ELSE 0 END) as product_a,
       SUM(CASE WHEN product = 'B' THEN sales ELSE 0 END) as product_b
FROM (VALUES
    ('North', 'A', 120), ('North', 'B', 90),
    ('South', 'A', 80), ('South', 'B', 150),
    ('East', 'A', 200), ('East', 'B', 110),
    ('West', 'A', 95), ('West', 'B', 130)
) AS t(region, product, sales)
GROUP BY region;
.chart

-- Line chart with numeric X axis (sine/cosine waves)
SELECT i AS x,
       sin(i * 0.5) * 50 + 50 AS sine_wave,
       cos(i * 0.5) * 50 + 50 AS cosine_wave
FROM generate_series(0, 20) AS t(i);
.chart

-- Force specific chart type and axes
.chart type=line x=date y=revenue,cost
```

### Chart Interaction

| Key | Action |
|-----|--------|
| Hover | Show tooltip with values at cursor position |
| `ESC` | Close the chart |
| `Ctrl+S` / `Cmd+S` | Export chart as PNG |

## Query Sharing

Share SQL queries via URL to collaborate with others. When someone opens a shared link, the queries execute automatically.

### Opening the Share Modal

- Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac)
- Click the share button in the sidebar (desktop) or mobile action bar

### Selecting Queries

1. The modal shows your recent SQL queries (dot commands are excluded)
2. Click or press `Space` to select/deselect queries
3. The character count shows how much of the 2000 character URL limit is used
4. Selected queries will execute in order (oldest first) when the link is opened

### URL Format

Shared URLs use a hash-based format:
```
https://duckdb-terminal.com/#$queries=v1,ENCODED_QUERY_1,ENCODED_QUERY_2,...
```

- Each query is URL-safe Base64 encoded
- Maximum URL length is 2000 characters for browser compatibility
- URLs are versioned (v1) for future compatibility

### Keyboard Shortcuts in Share Modal

| Key | Action |
|-----|--------|
| `Space` | Select/deselect query |
| `↑` / `↓` | Navigate query list |
| `Enter` | Copy shareable link |
| `Escape` | Close modal |

## Local AI Assistant

Ask questions about your data in plain language. A small language model runs entirely in your browser with [wllama](https://github.com/ngxson/wllama) (llama.cpp compiled to WebAssembly, accelerated with WebGPU): there is no server and no API key, and your data never leaves the page. The setup follows the [duckdb-wasm-shell-wllama](https://github.com/thomas-0816/duckdb-wasm-shell-wllama) demo.

### Choosing a model

Run `.model` to list the models, pick one, and confirm the download:

```
🦆 .model
Local AI models (run in your browser with wllama)
  1. Qwen3.5 0.8B (Q4_0)    537 MiB
  2. MiniCPM5 1B (Q4_K_M)   656 MiB
  3. Qwen3.5 2B (Q4_K_XL)  1278 MiB
  4. Qwen3.5 4B (Q4_K_XL)  2777 MiB

Select a model (1-4): 1
Do you want to install the selected model (size 537 MiB) in your browser (yes/no) yes
Installed Qwen3.5 0.8B (Q4_0). Ask it with .ai <prompt>
```

Each model is downloaded once from the Hugging Face Hub and cached in the browser's Origin Private File System. Picking a model that is already installed switches to it without asking. `.model 2` skips the menu, and Ctrl+C cancels a download. `.clearmodels` lists the downloaded models, including interrupted downloads, and removes them after you confirm.

| # | Model | Hugging Face repository | Size |
|---|-------|-------------------------|------|
| 1 | Qwen3.5 0.8B (Q4_0) | [ggml-org/Qwen3.5-0.8B-GGUF](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF) | 537 MiB |
| 2 | MiniCPM5 1B (Q4_K_M) | [openbmb/MiniCPM5-1B-GGUF](https://huggingface.co/openbmb/MiniCPM5-1B-GGUF) | 656 MiB |
| 3 | Qwen3.5 2B (Q4_K_XL) | [unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF) | 1278 MiB |
| 4 | Qwen3.5 4B (Q4_K_XL) | [unsloth/Qwen3.5-4B-GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF) | 2777 MiB |

All four models are Apache-2.0 licensed. Larger models give better answers but need more GPU memory, so start with the smallest.

### Asking questions

```sql
CREATE TABLE orders AS SELECT * FROM 'orders.csv';
.ai Which customer spent the most in total?
```

The terminal streams the model's reasoning (dimmed, under "Thinking") and then its answer. To answer, the model has two tools:

- `query` runs SQL. Each statement and its result appear in the terminal like a query you typed; the statement is added to the command history, and the result becomes the last result for `.copy`, `.download`, and `.chart`.
- `search_docs` searches the DuckDB documentation that ships with the library. The terminal lists the sections the model reads, with their duckdb.org links, so you can check its sources.

- The model's statements run without asking, including ones that change data or schema (`CREATE`, `DELETE`, `DROP`, `COPY ... TO`). Keep a copy of data you cannot recreate, especially in a persistent (OPFS) database.
- The current schema is sent with every prompt, and the model sees at most 50 rows of each result.
- Questions can name files on the web (`https://…/data.parquet`, `.csv`, `.json`); the terminal describes their columns to the model like loaded tables. For a DuckDB database URL (`.duckdb`, `.ddb`, `.db`), the model runs `ATTACH … (READ_ONLY)` itself and then queries its tables. The server must allow CORS (and range requests, for Parquet and database files).
- Follow-up prompts continue the conversation. Switching models or running `.reset` starts a new one.
- Ctrl+C stops the model.

### Bundled documentation

`search_docs` searches `dist/duckdb-docs.json` (about 1.9 MB, 470 KB gzipped), which is fetched from your page's origin the first time the model searches. It holds about 2,100 sections of the DuckDB documentation, generated from DuckDB's [single-file Markdown export](https://blobs.duckdb.org/docs/duckdb-docs.md) by `pnpm run build:docs`: other client APIs, contributor docs, and the spatial extension are left out, and markup the model does not need is removed. Regenerate it when the bundled DuckDB-Wasm moves to a new DuckDB release. The search uses BM25 over lightly stemmed words (a search for "truncation" finds `date_trunc`), with snake_case names also matched by their parts. The documentation is MIT licensed; see `THIRD_PARTY_NOTICES.md`.

### Requirements

- WebGPU for usable speed: current Chrome, Edge, and Safari. Safari runs wllama's compatibility build (16 MB, also from jsDelivr), because Safari 27 cannot compile the default build's 64-bit memory ([ngxson/wllama#297](https://github.com/ngxson/wllama/issues/297)). Without WebGPU the model runs on the CPU, which is much slower (and single-threaded unless the page is cross-origin isolated).
- Firefox runs the model on the CPU: its WebGPU waits about 100 ms for each GPU synchronization ([Mozilla bug 1870699](https://bugzilla.mozilla.org/show_bug.cgi?id=1870699)), which makes it far slower than the CPU ([ngxson/wllama#296](https://github.com/ngxson/wllama/issues/296)). On the CPU, wllama uses several threads only on cross-origin isolated pages (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, as on duckdb-terminal.com). Even then the first answer takes a few minutes in Firefox, mostly reading the prompt; follow-up questions reuse it.
- Not on iPhone and iPad: every browser there uses WebKit, which gives a tab too little memory. Loading even the smallest model briefly takes about 3 GB, and the tab crashes, so `.model` and `.ai` explain this instead of loading a model.
- The Origin Private File System for the model cache. Some private browsing modes do not provide it.
- Network access to `cdn.jsdelivr.net`, where wllama is loaded from on first use (pinned to the version the library was built with), and to `huggingface.co` and its download CDN (`*.hf.co`). Pages with a Content Security Policy must allow these origins and `blob:` workers.
- Disk space for the cached models and enough GPU memory for the selected model.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Execute command/SQL |
| `Tab` | Auto-complete |
| `Backspace` | Delete character before cursor |
| `Delete` | Delete character at cursor |
| `↑` / `↓` | Navigate history |
| `←` / `→` | Move cursor |
| `Home` | Move to start of line |
| `End` | Move to end of line |
| `Ctrl+A` | Move to start of line |
| `Ctrl+E` | Move to end of line |
| `Ctrl+K` | Clear from cursor to end of line |
| `Ctrl+U` | Clear entire line |
| `Ctrl+V` | Paste from clipboard |
| `Ctrl+C` | Cancel current input or running query |

### Pagination Mode

When viewing paginated results, the following keys are available:

| Key | Action |
|-----|--------|
| `n` / `↓` / `Enter` | Next page |
| `p` / `↑` | Previous page |
| `q` / `Escape` / `Ctrl+C` | Quit pagination |

## Example Usage

```sql
-- Create a table
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name VARCHAR,
  email VARCHAR
);

-- Insert data
INSERT INTO users VALUES
  (1, 'Alice', 'alice@example.com'),
  (2, 'Bob', 'bob@example.com');

-- Query data
SELECT * FROM users WHERE name LIKE 'A%';

-- Use built-in functions
SELECT range(10), current_timestamp;
```

## Querying and Copying Results

The terminal supports four output formats and provides an easy way to copy query results to your clipboard.

### Output Formats

Use the `.mode` command to switch between output formats:

```sql
-- Table format (default) - human-readable ASCII table
.mode table
SELECT * FROM users;
+----+-------+-------------------+
| id | name  | email             |
+----+-------+-------------------+
| 1  | Alice | alice@example.com |
| 2  | Bob   | bob@example.com   |
+----+-------+-------------------+

-- CSV format - comma-separated values
.mode csv
SELECT * FROM users;
id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com

-- TSV format - tab-separated values
.mode tsv
SELECT * FROM users;
id	name	email
1	Alice	alice@example.com
2	Bob	bob@example.com

-- JSON format - array of objects
.mode json
SELECT * FROM users;
[
  {"id": 1, "name": "Alice", "email": "alice@example.com"},
  {"id": 2, "name": "Bob", "email": "bob@example.com"}
]
```

### Copying Results

After running a query, use `.copy` to copy the results to your clipboard in the current output format:

```sql
-- Run your query
SELECT * FROM users WHERE active = true;

-- Copy results to clipboard (uses current .mode format)
.copy
```

The copied content respects your current output mode, so you can:
1. Use `.mode csv` or `.mode tsv` then `.copy` to paste into a spreadsheet
2. Use `.mode json` then `.copy` to paste into a JSON file or API tool
3. Use `.mode table` then `.copy` to paste formatted output into documentation

### Pagination for Large Results

Large result sets are paginated automatically, with 1,000 rows per page by default. Each page fetches one extra row to determine whether a next page exists, avoiding a full count before the first page. Use `.pagesize` to select a smaller page:

```sql
-- Use 50 rows per page
.pagesize 50

-- Run a query with many results
SELECT * FROM large_table;

-- Navigate pages:
-- n or Down Arrow - next page
-- p or Up Arrow - previous page
-- 1-9 - jump to page number
-- q - quit pagination
```

Set `.pagesize 0` to restore the configured safe maximum (`maxDisplayRows`, 1,000 by default). Unlimited terminal rendering is intentionally not available because it can exhaust browser memory or overwhelm the terminal renderer.

Queries that already contain `LIMIT` or `OFFSET` are wrapped safely, so their result can still be paginated without changing their meaning. Statements that cannot be wrapped are streamed only until the safe maximum and are marked as truncated when more rows exist.

The terminal reports the current page and whether previous or next pages exist. Exact totals become available automatically when the last page is reached. Set `exactRowCount: true` if your application requires exact totals before page 1; this runs a separate `COUNT(*)` query and can substantially increase work for expensive queries.

Programmatic `executeSQL()` calls, `queryEnd` events, `.copy`, `.download`, and charts use the current page. The returned `QueryResult.pagination` object always reports page navigation state and includes `totalRows` and `totalPages` once known.

## Custom Themes

You can create custom themes by providing a `Theme` object instead of `'dark'` or `'light'`:

```typescript
import { createTerminal, type Theme, type ThemeColors } from 'duckdb-terminal';

// Define custom colors
const myColors: ThemeColors = {
  background: '#1a1b26',    // Terminal background
  foreground: '#a9b1d6',    // Default text color
  cursor: '#c0caf5',        // Cursor color
  selection: '#33467c',     // Selection highlight
  // Standard ANSI colors
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  // Bright variants
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

// Create theme object
const tokyoNight: Theme = {
  name: 'tokyo-night',
  colors: myColors,
};

// Use custom theme
const Terminal = await createTerminal({
  container: '#terminal',
  theme: tokyoNight,
});

// You can also change theme at runtime
await Terminal.setTheme(tokyoNight);
```

### ThemeColors Reference

| Property | Description | ANSI Code |
|----------|-------------|-----------|
| `background` | Terminal background color | - |
| `foreground` | Default text color | - |
| `cursor` | Cursor color | - |
| `selection` | Text selection highlight | - |
| `black` | ANSI black | `\x1b[30m` |
| `red` | ANSI red | `\x1b[31m` |
| `green` | ANSI green | `\x1b[32m` |
| `yellow` | ANSI yellow | `\x1b[33m` |
| `blue` | ANSI blue | `\x1b[34m` |
| `magenta` | ANSI magenta | `\x1b[35m` |
| `cyan` | ANSI cyan | `\x1b[36m` |
| `white` | ANSI white | `\x1b[37m` |
| `brightBlack` | Bright black (gray) | `\x1b[90m` |
| `brightRed` | Bright red | `\x1b[91m` |
| `brightGreen` | Bright green | `\x1b[92m` |
| `brightYellow` | Bright yellow | `\x1b[93m` |
| `brightBlue` | Bright blue | `\x1b[94m` |
| `brightMagenta` | Bright magenta | `\x1b[95m` |
| `brightCyan` | Bright cyan | `\x1b[96m` |
| `brightWhite` | Bright white | `\x1b[97m` |

### Built-in Themes

The library exports two built-in themes that you can use directly or extend:

```typescript
import { darkTheme, lightTheme } from 'duckdb-terminal';

// Use directly
const Terminal = await createTerminal({
  container: '#terminal',
  theme: darkTheme,
});

// Or extend
const myTheme: Theme = {
  name: 'my-dark',
  colors: {
    ...darkTheme.colors,
    background: '#000000',  // Override specific colors
    cursor: '#ff0000',
  },
};
```

## API

### createTerminal(config)

Creates and starts a DuckDB Terminal instance.

```typescript
import { createTerminal } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';

const Terminal = await createTerminal({
  container: document.getElementById('terminal'),
  theme: 'dark',
});

// Write to terminal
Terminal.write('Hello, World!');
Terminal.writeln('With newline');

// Execute SQL programmatically
const result = await Terminal.executeSQL('SELECT 1+1 as answer');
console.log(result); // { columns: ['answer'], rows: [[2]], rowCount: 1, duration: 5 }

// Change theme
await Terminal.setTheme('light');

// Clear terminal
Terminal.clear();

// Clean up when done (removes event listeners, closes database)
await Terminal.destroy();
```

### Events

The Terminal emits events that you can subscribe to for monitoring and integrating with your application:

```typescript
import { createTerminal, type TerminalEvents } from 'duckdb-terminal';

const Terminal = await createTerminal({
  container: '#terminal',
  theme: 'dark',
});

// Subscribe to events
Terminal.on('ready', () => {
  console.log('Terminal is ready!');
});

Terminal.on('queryStart', ({ sql }) => {
  console.log('Executing:', sql);
});

Terminal.on('queryEnd', ({ sql, result, error, duration }) => {
  if (error) {
    console.error('Query failed:', error);
  } else {
    console.log(`Query completed in ${duration}ms, ${result?.rowCount} rows`);
  }
});

Terminal.on('stateChange', ({ state, previous }) => {
  console.log(`State changed: ${previous} -> ${state}`);
});

Terminal.on('themeChange', ({ theme, previous }) => {
  console.log(`Theme changed to: ${theme.name}`);
});

Terminal.on('fileLoaded', ({ filename, size, type }) => {
  console.log(`Loaded file: ${filename} (${size} bytes)`);
});

Terminal.on('commandExecute', ({ command, args }) => {
  console.log(`Command: ${command}`, args);
});

Terminal.on('error', ({ message, source }) => {
  console.error(`Error from ${source}: ${message}`);
});

// Unsubscribe using the returned function
const unsubscribe = Terminal.on('queryEnd', handler);
unsubscribe(); // Stop listening

// Or use off() directly
Terminal.off('queryEnd', handler);
```

#### Available Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | `{}` | Terminal is fully initialized |
| `queryStart` | `{ sql }` | SQL query execution started |
| `queryEnd` | `{ sql, result, error?, duration }` | SQL query completed or failed |
| `stateChange` | `{ state, previous }` | Terminal state changed (idle, collecting, executing, paginating) |
| `themeChange` | `{ theme, previous }` | Theme was changed |
| `fileLoaded` | `{ filename, size, type }` | File was loaded via drag-drop or picker |
| `commandExecute` | `{ command, args }` | Dot command was executed |
| `error` | `{ message, source }` | An error occurred |

### Advanced Usage

```typescript
import {
  DuckDBTerminal,
  Database,
  TerminalAdapter,
  formatTable,
  formatCSV,
  formatJSON
} from 'duckdb-terminal';

// Use Database directly
const db = new Database({ storage: 'memory' });
await db.init();
const result = await db.executeQuery('SELECT 42');

// Use formatters
console.log(formatTable(result.columns, result.rows));
console.log(formatCSV(result.columns, result.rows));
console.log(formatJSON(result.columns, result.rows));

// Get completions
const suggestions = await db.getCompletions('SEL', 3);
```

## Migrating to Gespenst

- Use ESM imports; UMD and CommonJS builds have been removed.
- Install the exact `@gespenst/core@0.2.0` peer and import `duckdb-terminal/style.css`.
- Replace `scrollback` (bytes) with `scrollbackLines` (lines). The default is 10,000 lines; zero disables scrollback. The removed byte option throws an explanatory error rather than silently changing units.
- Await `terminal.setTheme(theme)` and `terminal.destroy()`. Theme changes preserve output, input, and the database; destruction cancels active work and closes rendering and database resources.
- Use `terminal.focus()` and `await terminal.runCommand('.help')` for host controls. `runCommand` accepts one dot command, preserves pending input, and rejects while the REPL is busy or collecting multiline SQL. Invoke file commands directly inside a user click handler, before any unrelated `await`.
- URLs use Command-click on macOS or Ctrl-click elsewhere; keyboard and touch activation need no modifier. `.links off` removes link overlays.

The native terminal uses a dedicated worker with automatic fallback and does not add a cross-origin isolation requirement. Both WASM URLs are explicitly supplied to Gespenst so rebundled workers do not depend on missing relative assets. Preserve the package assets when publishing or rebundling, including below a URL base path.

## Browser Requirements

- Modern browser with WebAssembly support
- The default single-threaded build does not require `SharedArrayBuffer` or cross-origin isolation
- Multithreading requires `SharedArrayBuffer`, WebAssembly threads, a COI bundle, and COOP/COEP headers

Embedding applications that enable multithreading must configure their development and production servers with the isolation headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Building

```bash
# Development
npm run dev

# Production build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck
```

### Browser integration tests

```bash
pnpm exec playwright install chromium firefox webkit
pnpm run test:browser
```

The suite builds the library, website, and a separate consumer served under `/nested/`. It verifies the real Gespenst worker, rendered SQL, editing, themes, links, and cleanup in Chromium, Firefox, and WebKit, with additional Chromium checks for pagination, cancellation, and mobile controls. It serves the installed DuckDB, uPlot, and wllama assets through test routes, blocks model downloads, and disables optional remote extensions for deterministic startup; this does not change production extension loading. Physical iOS/Android virtual keyboards still need device testing.

## Bundle Outputs

| File | Format | Usage |
|------|--------|-------|
| `dist/duckdb-terminal.js` | ESM | Modern bundlers |
| `dist/duckdb-terminal.css` | CSS | Import `duckdb-terminal/style.css` |
| `dist/ghostty-*.wasm` | WASM | Version-matched Gespenst runtime assets |
| `dist/duckdb-docs.json` | JSON | DuckDB documentation for the AI assistant, fetched on first use |
| `dist/*.d.ts` | TypeScript | Type definitions |

## Dependencies

- [@duckdb/duckdb-wasm](https://www.npmjs.com/package/@duckdb/duckdb-wasm) - DuckDB WebAssembly build
- [@gespenst/core](https://www.npmjs.com/package/@gespenst/core) - Browser terminal with worker rendering
- [@gespenst/web-links](https://www.npmjs.com/package/@gespenst/web-links) - HTTP(S) link detection
- [@wllama/wllama](https://www.npmjs.com/package/@wllama/wllama) - In-browser LLM inference for `.ai` (loaded from jsDelivr on first use)
- [uPlot](https://github.com/leeoniya/uPlot) - Charts for `.chart` (loaded from jsDelivr on first use)

## License

MIT, see [LICENSE](LICENSE).

## Credits

- [DuckDB](https://duckdb.org/) - The in-process analytical database
- [Ghostty](https://ghostty.org/) - Fast, native terminal emulator
- [Gespenst](https://gespenst.dev/) - Browser terminal toolkit using Ghostty VT
