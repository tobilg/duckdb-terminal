# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DuckDB Terminal is a browser-based SQL REPL for DuckDB, powered by the Ghostty terminal emulator (via ghostty-web). It runs entirely in the browser using DuckDB WASM and provides features like syntax highlighting, auto-completion, multiple output formats, file loading, pagination, and interactive charts.

## Build Commands

```bash
# Development (starts Vite dev server at localhost:5173)
npm run dev

# Build library only
npm run build:lib

# Build library + website
npm run build:website

# Type checking
npm run typecheck

# Run tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Generate API docs
npm run generate-docs

# Deploy website to Cloudflare Pages
npm run deploy

# Clean all node_modules and dist folders
npm run clean
```

## Architecture

This is a monorepo using npm workspaces with two packages:

- **`packages/duckdb-terminal`**: The core library (published as `duckdb-terminal` on npm)
- **`packages/website`**: Demo website that uses the library

### Core Library Structure (`packages/duckdb-terminal/src/`)

- **`index.ts`**: Library entry point, exports `createTerminal()` factory and all public APIs
- **`terminal.ts`**: `DuckDBTerminal` class - the main orchestrator implementing the REPL loop, event system, command handling, pagination, and state management
- **`terminal-adapter.ts`**: `TerminalAdapter` class - wraps ghostty-web, handles terminal rendering, input events, themes
- **`database.ts`**: `Database` class - wraps DuckDB WASM, handles query execution, file registration, auto-completion, SQL validation/tokenization via poached extension
- **`commands.ts`**: Dot command definitions (`.help`, `.tables`, `.schema`, etc.)
- **`pagination.ts`**: Pagination handler for large result sets

### Key Subdirectories

- **`charts/`**: Interactive charting with uPlot (auto-detection of chart types, rendering, export)
- **`themes/`**: Dark/light theme definitions and persistence
- **`types/`**: TypeScript type definitions
- **`utils/`**: Utilities for clipboard, debounce, file handling, command parsing, history (IndexedDB), input buffer, link detection, syntax highlighting, table formatting, VT100 escape codes

### Data Flow

1. User input flows through `TerminalAdapter` (ghostty-web) to `DuckDBTerminal.handleInput()`
2. SQL statements are collected until complete (ends with `;`), then sent to `Database.executeQuery()`
3. Results are formatted via `utils/table-formatter.ts` and written back through `TerminalAdapter`
4. Command history is persisted in IndexedDB via `HistoryStore`
5. Files can be loaded into DuckDB's virtual filesystem via drag-and-drop or file picker

## Key Dependencies

- **`@duckdb/duckdb-wasm`**: DuckDB compiled to WebAssembly
- **`ghostty-web`**: Ghostty terminal emulator for web (provides canvas-based terminal rendering)
- **`uPlot`**: Lightweight charting library (loaded from CDN on first `.chart` use)

## Testing

Tests use Vitest with jsdom. Test files are colocated with source files using `.test.ts` suffix.

```bash
# Run specific test file
npx vitest packages/duckdb-terminal/src/utils/table-formatter.test.ts

# Run tests matching pattern
npx vitest -t "formatTable"
```

## Browser Requirements

The default DuckDB-Wasm bundle is single-threaded and does not require
`SharedArrayBuffer`. Opt-in multithreading requires a COI bundle,
`maximumThreads > 1`, WebAssembly threads, and these headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The hosted website intentionally uses the default one-thread EH/MVP bundle and
does not set cross-origin isolation headers. This keeps DuckDB-Wasm's dynamic
extensions, including Parquet, available while threaded extension artifacts
remain incompatible upstream. Library consumers can still opt into a COI
bundle explicitly and must serve its assets from the page's origin.
