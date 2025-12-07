/**
 * DuckDB Terminal - Library Entry Point
 *
 * This module provides the main entry point for embedding a DuckDB-powered
 * SQL terminal in web applications. It exports factory functions for creating
 * terminals, as well as all necessary types and utilities.
 *
 * @packageDocumentation
 * @module duckdb-terminal
 *
 * @example Basic usage
 * ```typescript
 * import { createTerminal } from 'duckdb-terminal';
 *
 * const terminal = await createTerminal({
 *   container: '#terminal',
 *   theme: 'dark',
 * });
 *
 * // Execute SQL programmatically
 * const result = await terminal.executeSQL('SELECT 1 + 1 as answer');
 * console.log(result); // { columns: ['answer'], rows: [[2]], rowCount: 1, duration: 5 }
 * ```
 *
 * @example With event listeners
 * ```typescript
 * import { createTerminal } from 'duckdb-terminal';
 *
 * const terminal = await createTerminal({
 *   container: document.getElementById('terminal'),
 *   theme: 'dark',
 * });
 *
 * terminal.on('queryEnd', ({ sql, result, duration }) => {
 *   console.log(`Query completed in ${duration}ms`);
 * });
 * ```
 */

import { DuckDBTerminal } from './terminal';
import type { TerminalConfig, TerminalInterface, Theme, ThemeColors, TerminalEvents, TerminalEventListener } from './types';

/**
 * Creates and initializes a DuckDB terminal instance.
 *
 * This is the primary factory function for creating a terminal. It instantiates
 * a new {@link DuckDBTerminal}, initializes all components (terminal adapter,
 * database, history), and returns the ready-to-use terminal.
 *
 * @param config - Configuration options for the terminal
 * @returns A promise that resolves to the initialized terminal instance
 *
 * @throws Error if the container element is not found
 * @throws Error if DuckDB WASM initialization fails
 *
 * @example Create with a CSS selector
 * ```typescript
 * const terminal = await createTerminal({
 *   container: '#my-terminal',
 *   theme: 'dark',
 * });
 * ```
 *
 * @example Create with an HTML element
 * ```typescript
 * const container = document.getElementById('terminal');
 * const terminal = await createTerminal({
 *   container,
 *   fontSize: 16,
 *   fontFamily: 'JetBrains Mono',
 *   theme: 'light',
 * });
 * ```
 *
 * @example Create with custom theme
 * ```typescript
 * const terminal = await createTerminal({
 *   container: '#terminal',
 *   theme: {
 *     name: 'my-theme',
 *     colors: {
 *       background: '#1a1b26',
 *       foreground: '#a9b1d6',
 *       // ... other colors
 *     },
 *   },
 * });
 * ```
 *
 * @example Create with custom prompts
 * ```typescript
 * const terminal = await createTerminal({
 *   container: '#terminal',
 *   prompt: 'SQL> ',
 *   continuationPrompt: '... ',
 * });
 * ```
 */
export async function createTerminal(config: TerminalConfig): Promise<DuckDBTerminal> {
  const terminal = new DuckDBTerminal(config);
  await terminal.start();
  return terminal;
}

/**
 * Embeds a DuckDB terminal into a container element.
 *
 * This is an alias for {@link createTerminal} provided for semantic clarity
 * when embedding the terminal into an existing page.
 *
 * @param config - Configuration options for the terminal
 * @returns A promise that resolves to the initialized terminal instance
 *
 * @example
 * ```typescript
 * const terminal = await embed({
 *   container: '#sql-editor',
 *   theme: 'dark',
 *   welcomeMessage: false,
 * });
 * ```
 */
export async function embed(config: TerminalConfig): Promise<DuckDBTerminal> {
  return createTerminal(config);
}

// Export types
export type { TerminalConfig, TerminalInterface, Theme, ThemeColors, TerminalEvents, TerminalEventListener };

// Export classes for advanced usage
export { DuckDBTerminal } from './terminal';
export { TerminalAdapter } from './terminal-adapter';
export { Database } from './database';
export type { SQLToken, SQLError } from './database';
export { HistoryStore } from './utils/history';
export { InputBuffer } from './utils/input-buffer';

// Export command and pagination modules
export { createCommands, type CommandContext, type Command, type CommandHandler } from './commands';
export { PaginationHandler, type PaginationContext, type PaginationState } from './pagination';

// Export themes
export { darkTheme, lightTheme, getTheme, getSavedTheme, saveTheme } from './themes';

// Export utilities
export { formatTable, formatCSV, formatTSV, formatJSON } from './utils/table-formatter';
export { copyToClipboard, readFromClipboard, isClipboardAvailable } from './utils/clipboard';
export { highlightSQL, isSQLComplete } from './utils/syntax-highlight';
export type { DuckDBToken } from './utils/syntax-highlight';
export { LinkProvider, linkifyText, containsURL, extractURLs, isValidURL } from './utils/link-provider';

// Export VT100 utilities individually
export {
  RESET,
  BOLD,
  DIM,
  FG_RED,
  FG_GREEN,
  FG_YELLOW,
  FG_BLUE,
  FG_CYAN,
  FG_WHITE,
  colorize,
  bold,
  dim,
} from './utils/vt100';
