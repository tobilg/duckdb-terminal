# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DuckDB Terminal is a browser-based SQL REPL for DuckDB, powered by Gespenst (using Ghostty VT). It runs entirely in the browser using DuckDB WASM and provides features like syntax highlighting, auto-completion, multiple output formats, file loading, pagination, and interactive charts.

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

# Regenerate the DuckDB documentation the AI assistant searches
pnpm run build:docs

# Deploy website to Cloudflare Pages
npm run deploy

# Clean all node_modules and dist folders
npm run clean
```

## Architecture

This is a monorepo using pnpm workspaces with two packages:

- **`packages/duckdb-terminal`**: The core library (published as `duckdb-terminal` on npm)
- **`packages/website`**: Demo website that uses the library

### Core Library Structure (`packages/duckdb-terminal/src/`)

- **`index.ts`**: Library entry point, exports `createTerminal()` factory and all public APIs
- **`terminal.ts`**: `DuckDBTerminal` class - the main orchestrator implementing the REPL loop, event system, command handling, pagination, and state management
- **`terminal-adapter.ts`**: `TerminalAdapter` class - wraps @gespenst/core, handles terminal rendering, input events, themes
- **`database.ts`**: `Database` class - wraps DuckDB WASM, handles query execution, file registration, auto-completion, SQL validation/tokenization via poached extension
- **`pagination.ts`**: Pagination handler for large result sets

Dot commands (`.help`, `.tables`, `.model`, `.ai`, etc.) are registered and implemented in `DuckDBTerminal.registerCommands()`.

### Key Subdirectories

- **`ai/`**: In-browser AI assistant for `.model` and `.ai`: model catalog, wllama CDN loader, system prompt and `query` tool, streamed response rendering, tool-calling loop
- **`charts/`**: Interactive charting with uPlot (auto-detection of chart types, rendering, export)
- **`themes/`**: Dark/light theme definitions and persistence
- **`types/`**: TypeScript type definitions
- **`utils/`**: Utilities for clipboard, debounce, file handling, command parsing, history (IndexedDB), input buffer, link detection, syntax highlighting, table formatting, VT100 escape codes

### Data Flow

1. User input flows through `TerminalAdapter` (@gespenst/core) to `DuckDBTerminal.handleInput()`
2. SQL statements are collected until complete (ends with `;`), then sent to `Database.executeQuery()`. DuckDB-Wasm reports some errors (parser errors) as JSON; `executeSentQuery()` rethrows them as DuckDB's text (`Parser Error: …`) through `utils/duckdb-error.ts`, so users, events, and the AI model never see the JSON
3. Results are formatted via `utils/table-formatter.ts` and written back through `TerminalAdapter`. Arrow returns TIMESTAMP and DATE values as epoch milliseconds and TIME as micro- or nanoseconds, so pass the result's `columnTypes` to every formatter (table, CSV, TSV, JSON, and text sent to the AI model); `toDisplayValue` turns them into DuckDB's text form. Result rows keep the raw numbers, which charts rely on. HUGEINT and UHUGEINT (such as the sum of an integer column) arrive as Arrow big numbers, whose `toJSON()` quotes them; `formatValue()` and the JSON replacer write their digits.
4. Command history is persisted in IndexedDB via `HistoryStore`
5. Files can be loaded into DuckDB's virtual filesystem via drag-and-drop or file picker
6. `Database.init()` restarts DuckDB once without OPFS (a worker prelude deletes `StorageManager.prototype.getDirectory`) when opening an in-memory database fails: DuckDB-Wasm 1.33.1-dev113 mounts an OPFS scratch file system on every open and fails where OPFS is unavailable (WebKit's ephemeral test contexts, private windows). COI workers and `storage: 'opfs'` are not restarted. Reported upstream as [duckdb/duckdb-wasm#2302](https://github.com/duckdb/duckdb-wasm/issues/2302); when moving to a DuckDB-Wasm release that fixes it, remove the fallback and its tests. OPFS database paths need the `opfs://` prefix; others are not persisted.

## Key Dependencies

- **`@duckdb/duckdb-wasm`**: DuckDB compiled to WebAssembly
- **`@gespenst/core`**: Native browser terminal, worker rendering, fonts, input, and themes
- **`@gespenst/web-links`**: Toggleable HTTP(S) links
- **`uPlot`**: Lightweight charting library (loaded from CDN on first `.chart` use)
- **`@wllama/wllama`**: llama.cpp in WebAssembly/WebGPU for `.ai` (loaded from CDN on first `.model` or `.ai` use)

## Local AI (wllama)

- wllama is not bundled. `ai/wllama-loader.ts` imports its ESM build and WASM from jsDelivr, pinned through `__WLLAMA_VERSION__` to the exact `@wllama/wllama` devDependency. Import types from `@wllama/wllama/esm/index.js`; the package's `main` entry points to a file that is not published.
- Browsers that cannot run wllama's default build (JSPI and Memory64) get its compat build from `@wllama/wllama-compat` at the same version (released in step with wllama). `canRunDefaultBuild()` validates a Memory64 module, because wllama's own check (creating a 64-bit memory) passes in Safari 27, which cannot compile Memory64 ([ngxson/wllama#297](https://github.com/ngxson/wllama/issues/297)); wllama then lost the worker's error and the load hung. `useCompatBuild()` therefore replaces wllama's `getWorkerResources()` on the engine instance: re-check it when updating wllama. Firefox runs models on the CPU (`hasWebGPU()` is false there): its WebGPU completes GPU work only on a 100 ms timer (Mozilla bug 1870699, ngxson/wllama#296), about 0.5 tokens/s. On the CPU wllama uses several threads only on cross-origin isolated pages; `.model` says when it runs on one.
- `ai/models.ts` holds the four models offered by `.model` with exact byte sizes from Hugging Face; update `sizeBytes` whenever a model file changes. wllama caches downloads in OPFS.
- `.model` reads its answers through `readLine()`, which takes over keyboard input while a command waits. Ctrl+C during a busy dot command aborts `commandAbort`.
- Model-requested SQL runs through `runAssistantQuery()` without confirmation, including statements that change data; the README and website guide say so. The system prompts tell the model to change data only when asked.
- File URLs in `.ai` questions (and in the earlier questions the conversation remembers) are described in the schema context like loaded files: `buildSchemaContext()` runs `DESCRIBE` and a sample on them (`AssistantTuning.describeUrls`). The 0.8B model does not reliably look up a remote file's columns itself; the guided prompt still explains how, as a fallback.
- `search_docs` searches `src/ai/docs/duckdb-docs.json`, generated by `scripts/build-docs.mjs` from DuckDB's Markdown export (pruning and cleaning rules in `scripts/docs/extract.mjs`: code the browser cannot run and the output shown after SQL examples are dropped). `formatDocsResults()` reduces sections to their SQL examples, shows each example once, and keeps results under 2,500 characters for small models. It is a committed, generated file: regenerate it with `pnpm run build:docs` when DuckDB-Wasm moves to a new DuckDB release, never edit it by hand. It is emitted as a separate asset through `?url&no-inline` and fetched on first search. The index stems words lightly (a search for "truncation" finds `date_trunc`, function names match exactly) and ranks tables listing functions that have sections of their own below those sections. `docs-search.test.ts` checks the pages found for typical keywords and, for descriptive searches, that the function's name reaches the model.
- Database URLs in a question are never attached by the terminal (a deliberate decision; the model runs ATTACH). The schema block puts a database that is not attached first (`notAttachedNote()`); with guardrails on, the assistant runs only ATTACH statements until the question's database is attached, reminding the model (with the exact tool call from the second time on). Once it is attached, the question is asked again with a fresh schema block that lists the attached tables, as for files on the web. A multi-statement `ATTACH …; SELECT …` whose SELECT fails still counts as attached.
- With guardrails on, `search_docs` leaves names from the user's data out of the model's keywords (tables, columns, values, and file names from the schema block, `dataWordsIn()`), unless the docs have a heading with that word; a search made only of them is answered with a pointer to the schema block. `AssistantTuning.docsContext` sends the docs matching a how-to question (`isDocsQuestion()`) after the schema block; it is off, because in the eval it did not help 0.8B (docs matching a whole question are often off-topic); `stripSchemaContext()` drops both blocks from earlier questions.
- Answer quality is tuned through `ai/tuning.ts` (`DEFAULT_TUNING`; `BASELINE_TUNING` is the original behavior). Judge prompt, tool, sampling, and schema-context changes with `pnpm run eval:ai` (see `tests/ai-eval/README.md`), not with single runs: small models vary a lot between runs. The runner drives `getAssistant()`, `setTuning()`, and the assistant's `messages` through internals; keep them in sync. It serves `tests/ai-eval/data/remote` at `https://data.example.com/` with CORS and range requests for the remote-file and `ATTACH` tasks; `generate-remote.mjs` builds those files with the DuckDB CLI, because DuckDB-Wasm keeps a database file it wrote locked after `DETACH`.
- Browser tests serve wllama from `node_modules`, block `huggingface.co`, and run the AI test in Chromium only, because WebKit test contexts have no usable OPFS.

## Releases

`packages/duckdb-terminal/README.md` is the npm page and `packages/duckdb-terminal/CHANGELOG.md` the release notes (shipped in the package). Update both for user-visible changes, and keep the peer versions in the install lines (both READMEs) equal to `peerDependencies`.

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

The hosted website intentionally uses the default one-thread DuckDB-Wasm
bundle. This keeps DuckDB-Wasm's dynamic extensions, including Parquet,
available while threaded extension artifacts remain incompatible upstream.
It is served cross-origin isolated (`packages/website/public/_headers` for
Cloudflare Pages, and the same headers in the website's Vite dev and preview
servers) so the AI assistant's wllama can use several CPU threads; DuckDB
stays single-threaded because the jsDelivr manifest has no threaded bundle.
With `require-corp`, every cross-origin resource needs CORS or
`Cross-Origin-Resource-Policy` headers (jsDelivr, extensions.duckdb.org, and
Hugging Face send them); check that before adding one. Library consumers can
still opt into a COI bundle explicitly and must serve its assets from the
page's origin.

## Gespenst integration

The library is ESM-only. Import `duckdb-terminal/style.css` when embedding. Pin Gespenst core and web-links to 0.2.0; runtime WASM must match core. The adapter explicitly supplies both packaged WASM URLs via `?url&no-inline`, and the library uses a relative Vite base so downstream bundlers can relocate them. Do not replace these URLs with the worker defaults.

`scrollbackLines` defaults to 10,000 (zero disables history); the old byte-based `scrollback` option is rejected. Theme changes and destruction are asynchronous. Website controls use `focus()` and `runCommand()`; keep file-picker calls in the original click activation. Paste is routed separately from keyboard input and terminal protocol replies never enter the SQL REPL.

The adapter stops link pointer events after the addon's target handler. Gespenst otherwise captures those pointers on the terminal root and redirects clicks away from the links. `@gespenst/web-links` re-creates every link overlay whenever output is written; when that happens between pointerdown and pointerup, the browser fires no click, so the adapter forwards one to the replacement overlay for the same URL (the addon still checks the modifier). Keep the browser link-click regression when changing these handlers.

On phones the website sizes itself to `window.visualViewport` (`fitToVisualViewport()` in `packages/website/src/index.ts`, plus `interactive-widget=resizes-content` in the viewport meta): iOS Safari lays the on-screen keyboard over the page, which hid the prompt. Gespenst refits on the container's resize and keeps the cursor row visible; both have browser tests.

Run `pnpm run test:browser` for production Chromium/Firefox/WebKit coverage. The fixture uses installed DuckDB assets and disables optional remote extensions for deterministic tests; retain normal extension loading in the product.
