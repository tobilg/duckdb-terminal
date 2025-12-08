/**
 * Configuration options for creating a DuckDB terminal.
 *
 * @example Minimal configuration
 * ```typescript
 * const config: TerminalConfig = {
 *   container: '#terminal',
 * };
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const config: TerminalConfig = {
 *   container: document.getElementById('terminal'),
 *   fontFamily: 'JetBrains Mono',
 *   fontSize: 16,
 *   theme: 'dark',
 *   storage: 'opfs',
 *   databasePath: '/mydata.duckdb',
 *   welcomeMessage: true,
 *   prompt: 'SQL> ',
 *   continuationPrompt: '... ',
 *   linkDetection: true,
 * };
 * ```
 */
export interface TerminalConfig {
  /**
   * The container element or CSS selector where the terminal will be mounted.
   * Can be an HTMLElement or a CSS selector string (e.g., '#terminal', '.container').
   */
  container: HTMLElement | string;
  /**
   * Font family for the terminal text.
   * @defaultValue '"Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, monospace'
   */
  fontFamily?: string;
  /**
   * Font size in pixels.
   * @defaultValue 14
   */
  fontSize?: number;
  /**
   * The color theme for the terminal.
   * Can be 'dark', 'light', or a custom Theme object.
   * @defaultValue 'dark'
   */
  theme?: 'dark' | 'light' | Theme;
  /**
   * The storage backend for the database.
   * - 'memory': In-memory storage (data lost on page refresh)
   * - 'opfs': Origin Private File System (persistent storage)
   * @defaultValue 'memory'
   */
  storage?: 'memory' | 'opfs';
  /**
   * The database file path when using OPFS storage.
   * Only used when storage is 'opfs'.
   */
  databasePath?: string;
  /**
   * Whether to display the welcome message on startup.
   * @defaultValue true
   */
  welcomeMessage?: boolean;
  /**
   * The primary prompt string displayed before each command.
   * @defaultValue '🦆 '
   */
  prompt?: string;
  /**
   * The continuation prompt displayed for multi-line SQL statements.
   * @defaultValue '  > '
   */
  continuationPrompt?: string;
  /**
   * Whether to automatically detect and make URLs clickable in output.
   * @defaultValue true
   */
  linkDetection?: boolean;
  /**
   * Scrollback buffer size in bytes. Larger values allow more history but use more memory.
   * @defaultValue 10485760 (10MB)
   */
  scrollback?: number;
  /**
   * Enable the charts feature (.chart command).
   * When enabled, uPlot is loaded from CDN on first use.
   * @defaultValue false
   */
  enableCharts?: boolean;
}

/**
 * Color definitions for a terminal theme.
 *
 * Includes the standard 16 ANSI colors plus special terminal colors
 * (background, foreground, cursor, selection).
 *
 * @example
 * ```typescript
 * const colors: ThemeColors = {
 *   background: '#1e1e1e',
 *   foreground: '#d4d4d4',
 *   cursor: '#aeafad',
 *   selection: '#264f78',
 *   black: '#000000',
 *   red: '#cd3131',
 *   green: '#0dbc79',
 *   yellow: '#e5e510',
 *   blue: '#2472c8',
 *   magenta: '#bc3fbc',
 *   cyan: '#11a8cd',
 *   white: '#e5e5e5',
 *   brightBlack: '#666666',
 *   brightRed: '#f14c4c',
 *   brightGreen: '#23d18b',
 *   brightYellow: '#f5f543',
 *   brightBlue: '#3b8eea',
 *   brightMagenta: '#d670d6',
 *   brightCyan: '#29b8db',
 *   brightWhite: '#e5e5e5',
 * };
 * ```
 */
export interface ThemeColors {
  /** Terminal background color */
  background: string;
  /** Default text (foreground) color */
  foreground: string;
  /** Cursor color */
  cursor: string;
  /** Text selection highlight color */
  selection: string;
  /** ANSI black (color 0) */
  black: string;
  /** ANSI red (color 1) */
  red: string;
  /** ANSI green (color 2) */
  green: string;
  /** ANSI yellow (color 3) */
  yellow: string;
  /** ANSI blue (color 4) */
  blue: string;
  /** ANSI magenta (color 5) */
  magenta: string;
  /** ANSI cyan (color 6) */
  cyan: string;
  /** ANSI white (color 7) */
  white: string;
  /** ANSI bright black (color 8) */
  brightBlack: string;
  /** ANSI bright red (color 9) */
  brightRed: string;
  /** ANSI bright green (color 10) */
  brightGreen: string;
  /** ANSI bright yellow (color 11) */
  brightYellow: string;
  /** ANSI bright blue (color 12) */
  brightBlue: string;
  /** ANSI bright magenta (color 13) */
  brightMagenta: string;
  /** ANSI bright cyan (color 14) */
  brightCyan: string;
  /** ANSI bright white (color 15) */
  brightWhite: string;
}

/**
 * A complete terminal theme definition.
 *
 * @example
 * ```typescript
 * const myTheme: Theme = {
 *   name: 'my-dark-theme',
 *   colors: {
 *     background: '#1a1b26',
 *     foreground: '#a9b1d6',
 *     // ... other colors
 *   },
 * };
 * ```
 */
export interface Theme {
  /** Unique name for the theme */
  name: string;
  /** Color definitions for the theme */
  colors: ThemeColors;
}

/**
 * The current state of the terminal.
 *
 * - `idle`: Waiting for user input
 * - `collecting`: Collecting multi-line SQL input
 * - `executing`: Running a query
 * - `paginating`: Displaying paginated results
 */
export type TerminalState = 'idle' | 'collecting' | 'executing' | 'paginating';

/**
 * The result of executing a SQL query.
 *
 * @example
 * ```typescript
 * const result: QueryResult = {
 *   columns: ['id', 'name', 'email'],
 *   rows: [
 *     [1, 'Alice', 'alice@example.com'],
 *     [2, 'Bob', 'bob@example.com'],
 *   ],
 *   rowCount: 2,
 *   duration: 5.23,
 * };
 * ```
 */
export interface QueryResult {
  /** Column names from the query result */
  columns: string[];
  /** DuckDB column type names (e.g., 'INTEGER', 'VARCHAR', 'DATE') */
  columnTypes?: string[];
  /** Row data as a 2D array */
  rows: unknown[][];
  /** Total number of rows returned */
  rowCount: number;
  /** Query execution time in milliseconds */
  duration: number;
}

/**
 * Handler function type for dot commands.
 *
 * @param args - Command arguments (words after the command name)
 * @param terminal - The terminal interface for output and operations
 * @returns void or a Promise that resolves when the command completes
 */
export type CommandHandler = (
  args: string[],
  terminal: TerminalInterface
) => Promise<void> | void;

/**
 * Definition of a dot command (e.g., `.help`, `.tables`).
 */
export interface Command {
  /** Command name including the dot prefix (e.g., '.help') */
  name: string;
  /** Short description of what the command does */
  description: string;
  /** Usage example (e.g., '.schema <table_name>') */
  usage?: string;
  /** The function that handles the command */
  handler: CommandHandler;
}

/**
 * Interface for interacting with the terminal from commands.
 *
 * This interface is passed to command handlers and provides methods
 * for writing output and executing SQL.
 */
export interface TerminalInterface {
  /**
   * Writes text to the terminal without a newline.
   * @param text - The text to write
   */
  write(text: string): void;
  /**
   * Writes text to the terminal followed by a newline.
   * @param text - The text to write
   */
  writeln(text: string): void;
  /**
   * Clears the terminal screen.
   */
  clear(): void;
  /**
   * Executes a SQL query and returns the result.
   * @param sql - The SQL statement to execute
   * @returns The query result, or null if an error occurred
   */
  executeSQL(sql: string): Promise<QueryResult | null>;
  /**
   * Sets the terminal theme.
   * @param theme - The theme to apply ('dark' or 'light')
   */
  setTheme(theme: 'dark' | 'light'): void;
  /**
   * Gets the current theme mode.
   * @returns The current theme mode
   */
  getTheme(): 'dark' | 'light';
}

/**
 * An auto-completion suggestion.
 */
export interface CompletionSuggestion {
  /** The suggested completion value */
  value: string;
  /** The type of suggestion (for display styling) */
  type: 'keyword' | 'table' | 'column' | 'function';
}

/**
 * Event payload types for all terminal events.
 *
 * Use with {@link DuckDBTerminal.on} to subscribe to events.
 *
 * @example
 * ```typescript
 * terminal.on('queryEnd', (event: TerminalEvents['queryEnd']) => {
 *   console.log(`Query took ${event.duration}ms`);
 * });
 * ```
 */
export interface TerminalEvents {
  /**
   * Emitted when the terminal is fully initialized and ready for input.
   * The payload is an empty object.
   */
  ready: Record<string, never>;
  /**
   * Emitted when a SQL query starts executing.
   */
  queryStart: {
    /** The SQL statement being executed */
    sql: string;
  };
  /**
   * Emitted when a SQL query completes (success or failure).
   */
  queryEnd: {
    /** The SQL statement that was executed */
    sql: string;
    /** The query result, or null if the query failed */
    result: QueryResult | null;
    /** Error message if the query failed */
    error?: string;
    /** Execution time in milliseconds */
    duration: number;
  };
  /**
   * Emitted when a dot command is executed.
   */
  commandExecute: {
    /** The command name (e.g., '.help') */
    command: string;
    /** Command arguments */
    args: string[];
  };
  /**
   * Emitted when a file is loaded via drag-and-drop or file picker.
   */
  fileLoaded: {
    /** The filename */
    filename: string;
    /** File size in bytes */
    size: number;
    /** File extension/type */
    type: string;
  };
  /**
   * Emitted when the terminal theme changes.
   */
  themeChange: {
    /** The new theme */
    theme: Theme;
    /** The previous theme (null if this is the initial theme) */
    previous: Theme | null;
  };
  /**
   * Emitted when an error occurs.
   */
  error: {
    /** The error message */
    message: string;
    /** Where the error originated (e.g., 'query', 'command') */
    source: string;
  };
  /**
   * Emitted when the terminal state changes.
   */
  stateChange: {
    /** The new state */
    state: TerminalState;
    /** The previous state */
    previous: TerminalState;
  };
}

/**
 * Type for event listener callbacks.
 *
 * @typeParam K - The event name from {@link TerminalEvents}
 *
 * @example
 * ```typescript
 * const listener: TerminalEventListener<'queryEnd'> = (event) => {
 *   console.log(event.duration);
 * };
 * ```
 */
export type TerminalEventListener<K extends keyof TerminalEvents> = (
  event: TerminalEvents[K]
) => void;
