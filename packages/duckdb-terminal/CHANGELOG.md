# Changelog

All notable changes to `duckdb-terminal` are documented here.

## 0.8.0 (2026-11-05)

The AI assistant now runs locally in the browser instead of through a text-to-SQL proxy, and the terminal moves to new DuckDB-Wasm and Gespenst releases.

### Breaking changes

- **`.ai` uses a local model.** The text-to-SQL proxy is no longer used, and its subcommands are gone: `.ai query`, `.ai provider list|set`, and `.ai endpoint get|set`. Choose a model with `.model` and ask with `.ai <prompt>`.
- **Removed exports:**
  - The proxy client and its settings: `getAISettings`, `saveAISettings`, `getDefaultEndpoint`, `getDefaultProvider`, `clearAISettings`, `checkProxyAvailable`, `fetchProviders`, `generateSQL`, `AIClientError`, and the types `AISettings` and `AIProvider`.
  - `createCommands` and `CommandContext`: `DuckDBTerminal` registers its commands itself. The `Command` and `CommandHandler` types are still exported.
  - `Database.streamQuery()` and `StreamQueryResult`: use `executeQuery()` or `executeQueryLimited()`.
- **Peer dependencies:** `@duckdb/duckdb-wasm` 1.33.1-dev113.0 (was 1.33.1-dev64.0) and `@gespenst/core` 0.2.0 (was 0.1.2). `@gespenst/web-links` is now 0.2.0.

  ```bash
  npm install duckdb-terminal@0.8.0 @duckdb/duckdb-wasm@1.33.1-dev113.0 @gespenst/core@0.2.0
  ```

### Local AI assistant

- `.model` lists four models that run in the browser with [wllama](https://github.com/ngxson/wllama), accelerated with WebGPU:
  - Qwen3.5 0.8B, MiniCPM5 1B, Qwen3.5 2B, and Qwen3.5 4B (537 MiB to 2.7 GiB).
  - The chosen model downloads once from Hugging Face and is cached in OPFS.
  - `.model <n>` skips the menu, and Ctrl+C cancels a download.
- `.ai <prompt>` asks the selected model about your data:
  - It streams the model's reasoning and answer.
  - The model can run SQL through a `query` tool, and you see each statement and its result. The statements also go into the command history and become the last result for `.copy`, `.download`, and `.chart`.
  - Follow-up questions continue the conversation. `.reset` or switching models starts a new one, and Ctrl+C stops the model.
- **The model's statements run without confirmation,** including ones that change data or schema.
- **What the model sees with each question:**
  - The tables' columns, sample rows, and common values.
  - Loaded files, and Parquet, CSV, or JSON URLs named in the question.
  - DuckDB database URLs (`.duckdb`, `.ddb`, `.db`): the model attaches these read-only itself, and then gets the attached tables.
- **`search_docs` tool:** searches about 2,100 sections of the DuckDB documentation that ship with the package as `dist/duckdb-docs.json` (1.9 MB, 470 KB gzipped). The file is fetched on the first search, and the terminal lists the sections the model reads, with links to duckdb.org.
- **Guardrails** help small models stay correct:
  - The model is asked to run SQL it answered with but did not run, or SQL that has placeholders.
  - Repeated queries are caught.
  - Hints name the full URL or the `ATTACH` statement to use.
  - The user's own table and column names are left out of docs searches.
- New exports: `AI_MODELS`, `getModelUrl`, `formatMiB`, `AIModel`, and `AIModelSampling`.

### Fixes and improvements

- **Output:**
  - TIMESTAMP, DATE, and TIME values appear as DuckDB prints them in table, CSV, TSV, and JSON output, not as epoch numbers.
  - New export `toDisplayValue()`. The CSV, TSV, and JSON formatters accept an optional `columnTypes` argument.
  - HUGEINT and UHUGEINT values, such as the sum of an integer column, are written as numbers in every output format. JSON quotes them only beyond JavaScript's safe integer range.
- **Errors:** DuckDB-Wasm parser errors are shown as DuckDB's text (`Parser Error: …`) instead of JSON, in the terminal, in `queryEnd` and `error` events, and to the AI model.
- **Statements on the shared connection run one at a time,** so a statement started while another result is still being read cannot take that result over.
- **A truncated or cancelled result is released,** so later statements do not fail with "connection has an open result", for example during pagination after a truncated result.
- **DuckDB now starts where OPFS is unavailable,** such as WebKit's ephemeral sessions and some private windows. DuckDB-Wasm 1.33.1-dev113 sets up OPFS scratch storage whenever it opens a database, and fails to open without it. For in-memory databases, the terminal now restarts DuckDB without OPFS. `storage: 'opfs'` still needs OPFS. Reported upstream as [duckdb/duckdb-wasm#2302](https://github.com/duckdb/duckdb-wasm/issues/2302).
- **Syntax highlighting:** a pending highlighting redraw no longer repaints the submitted line over a command's output.
- **Docs:** `databasePath` documentation and examples now use the `opfs://` prefix. A path without it is not persisted.
- **Links:** a click on a link while output is still being written (right after a query, or while the AI assistant streams) is no longer lost when the link overlay is redrawn mid-click.
- The npm package now includes this changelog, a README, and the MIT `LICENSE`.

## 0.7.0 (2026-09-15)

- Switched the terminal to [Gespenst](https://gespenst.dev/) (`@gespenst/core` 0.1.2) with the Ghostty VT engine; see "Migrating to Gespenst" in the [README](https://github.com/tobilg/duckdb-terminal#migrating-to-gespenst).
