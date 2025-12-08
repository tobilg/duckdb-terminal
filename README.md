# DuckDB Terminal

A browser-based SQL Terminal for [DuckDB](https://duckdb.org/) powered by [Ghostty](https://ghostty.org/) terminal emulator.

## Try it live
The latest version is always deployed to [https://terminal.sql-workbench.com](https://terminal.sql-workbench.com).

## API Docs
The TypeScript API Docs can be found at [https://tobilg.github.io/duckdb-terminal](https://tobilg.github.io/duckdb-terminal/).

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
│  │  │ - Ghostty     │   │   wrapper           │             │            │  │
│  │  │ - Themes      │   │ - Query execution   │             │            │  │
│  │  │ - Keyboard    │   │ - Auto-complete     │             │            │  │
│  │  │ - Mobile      │   │ - File loading      │             │            │  │
│  │  └───────┬───────┘   └─────────┬───────────┘             │            │  │
│  │          │                     │                         │            │  │
│  └──────────┼─────────────────────┼─────────────────────────┼────────────┘  │
│             │                     │                         │               │
│             ▼                     ▼                         ▼               │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │    Ghostty Web     │  │    DuckDB WASM      │  │     IndexedDB       │   │
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
npm install duckdb-terminal
```

## Quick Start

### As a Library

```typescript
import { createTerminal } from 'duckdb-terminal';

const Terminal = await createTerminal({
  container: '#terminal',
  theme: 'dark',
});
```

### As a Standalone App

```bash
git clone https://github.com/tobilg/duckdb-terminal.git
cd duckdb-terminal
npm install
npm run dev
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

  // Database path for OPFS storage
  databasePath?: string;

  // Show welcome message (default: true)
  // When enabled, displays loading progress during DuckDB initialization
  welcomeMessage?: boolean;

  // Primary prompt string (default: '🦆 ')
  prompt?: string;

  // Continuation prompt for multi-line SQL (default: '  > ')
  continuationPrompt?: string;

  // Enable clickable URL detection (default: true)
  linkDetection?: boolean;

  // Scrollback buffer size in bytes (default: 10485760 = 10MB)
  scrollback?: number;

  // Enable interactive charts feature (default: false)
  enableCharts?: boolean;
}
```

## Terminal Commands

| Command | Description |
|---------|-------------|
| `.help` | Show available commands |
| `.clear` | Clear the terminal |
| `.clearhistory` | Clear command history |
| `.tables` | List all tables |
| `.schema <table>` | Show table schema |
| `.timer on\|off` | Toggle query timing |
| `.mode table\|csv\|tsv\|json` | Set output format |
| `.copy` | Copy last query results to clipboard |
| `.download [filename]` | Download last result as file (format based on mode) |
| `.pagesize <n>` | Set pagination size (0 to disable) |
| `.theme dark\|light` | Switch color theme (clears screen) |
| `.highlight on\|off` | Toggle syntax highlighting |
| `.links on\|off` | Toggle clickable URL detection |
| `.files [list\|add\|remove]` | Manage loaded files (list, add, or remove) |
| `.open` | Open file picker to load data files |
| `.prompt [primary [cont]]` | Get or set the command prompt |
| `.examples` | Show example queries |
| `.reset` | Reset database and all settings to defaults |
| `.chart [options]` | Show interactive chart of last query result |

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
| `Ctrl+C` | Cancel current input |

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

For large result sets, enable pagination with `.pagesize`:

```sql
-- Enable pagination (50 rows per page)
.pagesize 50

-- Run a query with many results
SELECT * FROM large_table;

-- Navigate pages:
-- n or Enter - next page
-- p - previous page
-- 1-9 - jump to page number
-- q - quit pagination
```

Set `.pagesize 0` to disable pagination and show all results at once.

**Note:** Queries that already contain `LIMIT` or `OFFSET` clauses bypass pagination, giving you full control over result size.

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
Terminal.setTheme(tokyoNight);
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
Terminal.setTheme('light');

// Clear terminal
Terminal.clear();

// Clean up when done (removes event listeners, closes database)
Terminal.destroy();
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
  Terminal,
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

## Browser Requirements

- Modern browser with WebAssembly support
- SharedArrayBuffer (requires COOP/COEP headers)

For development, Vite automatically sets the required headers. For production, configure your server:

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

## Bundle Outputs

| File | Format | Usage |
|------|--------|-------|
| `dist/duckdb-terminal.js` | ESM | Modern bundlers |
| `dist/duckdb-terminal.umd.cjs` | UMD | Script tags, legacy |
| `dist/*.d.ts` | TypeScript | Type definitions |

## Dependencies

- [@duckdb/duckdb-wasm](https://www.npmjs.com/package/@duckdb/duckdb-wasm) - DuckDB WebAssembly build
- [ghostty-web](https://www.npmjs.com/package/ghostty-web) - Ghostty terminal emulator for web

## License

MIT

## Credits

- [DuckDB](https://duckdb.org/) - The in-process analytical database
- [Ghostty](https://ghostty.org/) - Fast, native terminal emulator
- [ghostty-web](https://github.com/coder/ghostty-web) - Web port by Coder
