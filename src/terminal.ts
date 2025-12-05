import { TerminalAdapter } from './terminal-adapter';
import { Database } from './database';
import { InputBuffer } from './utils/input-buffer';
import { HistoryStore } from './utils/history';
import { formatTable, formatCSV, formatTSV, formatJSON } from './utils/table-formatter';
import {
  pickFiles,
  readFileAsBuffer,
  formatFileSize,
  getFileExtension,
  getFileInfo,
  setupDragAndDrop,
  type FileInfo,
} from './utils/file-handler';
import { copyToClipboard, readFromClipboard } from './utils/clipboard';
import { highlightSQL } from './utils/syntax-highlight';
import { debounce } from './utils/debounce';
import { parseCommand } from './utils/command-parser';
import { LinkProvider } from './utils/link-provider';
import * as vt100 from './utils/vt100';
import type {
  TerminalConfig,
  TerminalState,
  TerminalInterface,
  QueryResult,
  Command,
  Theme,
  TerminalEvents,
  TerminalEventListener,
} from './types';
import { saveTheme, getSavedTheme, getTheme } from './themes';

/** Default primary prompt displayed before each command */
const DEFAULT_PROMPT = '🦆 ';
/** Default continuation prompt displayed for multi-line SQL statements */
const DEFAULT_CONTINUATION_PROMPT = '  > ';

/**
 * A browser-based SQL terminal for DuckDB, powered by Ghostty terminal emulator.
 *
 * DuckDBTerminal provides a full-featured SQL REPL (Read-Eval-Print Loop) that runs
 * entirely in the browser using DuckDB WASM. It supports:
 *
 * - Multi-line SQL statements with syntax highlighting
 * - Command history with arrow key navigation
 * - Tab completion for SQL keywords, table names, and functions
 * - Dot commands (`.help`, `.tables`, `.schema`, etc.)
 * - Multiple output formats (table, CSV, JSON)
 * - File loading via drag-and-drop or file picker
 * - Result pagination for large datasets
 * - Custom theming
 * - Customizable prompts (via config or `.prompt` command)
 * - Event system for integration with host applications
 *
 * @implements {TerminalInterface}
 *
 * @example Basic usage
 * ```typescript
 * const terminal = new DuckDBTerminal({
 *   container: '#terminal',
 *   theme: 'dark',
 * });
 * await terminal.start();
 * ```
 *
 * @example With custom prompts
 * ```typescript
 * const terminal = new DuckDBTerminal({
 *   container: '#terminal',
 *   prompt: 'SQL> ',
 *   continuationPrompt: '... ',
 * });
 * await terminal.start();
 * ```
 *
 * @example With event listeners
 * ```typescript
 * const terminal = new DuckDBTerminal({ container: '#terminal' });
 *
 * terminal.on('queryEnd', ({ sql, result, duration }) => {
 *   console.log(`Query "${sql}" completed in ${duration}ms`);
 * });
 *
 * terminal.on('error', ({ message, source }) => {
 *   console.error(`Error from ${source}: ${message}`);
 * });
 *
 * await terminal.start();
 * ```
 *
 * @example Programmatic SQL execution
 * ```typescript
 * const terminal = new DuckDBTerminal({ container: '#terminal' });
 * await terminal.start();
 *
 * const result = await terminal.executeSQL('SELECT * FROM users LIMIT 10;');
 * console.log(result.columns); // ['id', 'name', 'email']
 * console.log(result.rows);    // [[1, 'Alice', 'alice@example.com'], ...]
 * ```
 */
export class DuckDBTerminal implements TerminalInterface {
  private terminalAdapter: TerminalAdapter;
  private database: Database;
  private inputBuffer: InputBuffer;
  private history: HistoryStore;
  private state: TerminalState = 'idle';
  private collectedSQL: string[] = [];
  private commands: Map<string, Command> = new Map();
  private showTimer: boolean = false;
  private outputMode: 'table' | 'csv' | 'tsv' | 'json' = 'table';
  private currentThemeName: 'dark' | 'light' | 'custom';
  private customTheme: Theme | null = null;
  private config: TerminalConfig;
  private loadedFiles: Map<string, FileInfo> = new Map();
  private syntaxHighlighting: boolean = true;
  private lastQueryResult: QueryResult | null = null;
  private linkProvider: LinkProvider;

  // Event emitter
  private eventListeners: Map<keyof TerminalEvents, Set<TerminalEventListener<any>>> = new Map();

  // Pagination state (0 = disabled by default)
  private pageSize: number = 0;
  private paginationQuery: string | null = null;
  private currentPage: number = 0;
  private totalRows: number = 0;

  // Prompt customization
  private prompt: string;
  private continuationPrompt: string;

  // Debounced syntax highlighting (150ms delay to avoid excessive redraws)
  private debouncedHighlight = debounce(() => this.redrawLineHighlighted(), 150);

  // Query queue to prevent race conditions
  private queryQueue: Promise<QueryResult | null> = Promise.resolve(null);

  // Cleanup function for drag-and-drop
  private dragDropCleanup: (() => void) | null = null;

  constructor(config: TerminalConfig) {
    this.config = config;
    this.terminalAdapter = new TerminalAdapter();
    this.database = new Database({
      storage: config.storage ?? 'memory',
      databasePath: config.databasePath,
    });
    this.inputBuffer = new InputBuffer();
    this.history = new HistoryStore();
    this.linkProvider = new LinkProvider();

    // Configure link detection (default: enabled)
    if (config.linkDetection === false) {
      this.linkProvider.setEnabled(false);
    }

    // Initialize prompts from config or defaults
    this.prompt = config.prompt ?? DEFAULT_PROMPT;
    this.continuationPrompt = config.continuationPrompt ?? DEFAULT_CONTINUATION_PROMPT;

    // Handle theme configuration
    if (typeof config.theme === 'object') {
      // Custom theme object provided
      this.customTheme = config.theme;
      this.currentThemeName = 'custom';
    } else {
      // Built-in theme name or default
      this.currentThemeName = config.theme ?? getSavedTheme();
    }

    this.registerCommands();
  }

  // ==================== Event Emitter ====================

  /**
   * Subscribes to a terminal event.
   *
   * The terminal emits various events during its lifecycle that you can
   * subscribe to for monitoring, logging, or integrating with your application.
   *
   * @typeParam K - The event type key from {@link TerminalEvents}
   * @param event - The event name to subscribe to
   * @param listener - The callback function to invoke when the event occurs
   * @returns An unsubscribe function that removes the listener when called
   *
   * @example Subscribe to query events
   * ```typescript
   * const unsubscribe = terminal.on('queryEnd', ({ sql, result, duration }) => {
   *   console.log(`Query completed in ${duration}ms`);
   * });
   *
   * // Later, to stop listening:
   * unsubscribe();
   * ```
   *
   * @example Monitor state changes
   * ```typescript
   * terminal.on('stateChange', ({ state, previous }) => {
   *   console.log(`Terminal state: ${previous} -> ${state}`);
   * });
   * ```
   */
  on<K extends keyof TerminalEvents>(
    event: K,
    listener: TerminalEventListener<K>
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Unsubscribes a listener from a terminal event.
   *
   * This is an alternative to using the unsubscribe function returned by {@link on}.
   *
   * @typeParam K - The event type key from {@link TerminalEvents}
   * @param event - The event name to unsubscribe from
   * @param listener - The callback function to remove
   *
   * @example
   * ```typescript
   * const handler = ({ sql }) => console.log(sql);
   * terminal.on('queryStart', handler);
   *
   * // Later:
   * terminal.off('queryStart', handler);
   * ```
   */
  off<K extends keyof TerminalEvents>(
    event: K,
    listener: TerminalEventListener<K>
  ): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * Emits an event to all registered listeners.
   *
   * @internal
   * @typeParam K - The event type key from {@link TerminalEvents}
   * @param event - The event name to emit
   * @param payload - The event payload to pass to listeners
   */
  private emit<K extends keyof TerminalEvents>(
    event: K,
    payload: TerminalEvents[K]
  ): void {
    this.eventListeners.get(event)?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Error in ${event} event listener:`, error);
      }
    });
  }

  /**
   * Sets the terminal state and emits a stateChange event.
   *
   * @internal
   * @param newState - The new terminal state
   */
  private setState(newState: TerminalState): void {
    const previous = this.state;
    if (previous !== newState) {
      this.state = newState;
      this.emit('stateChange', { state: newState, previous });
    }
  }

  // ==================== Syntax Highlighting ====================

  /**
   * Returns SQL with syntax highlighting applied.
   *
   * @param sql - The SQL string to highlight
   * @returns The SQL with VT100 color codes applied, or the original SQL if highlighting is disabled
   */
  private getHighlightedSQL(sql: string): string {
    if (!this.syntaxHighlighting) {
      return sql;
    }
    return highlightSQL(sql);
  }

  /**
   * Redraws the current input line with syntax highlighting applied.
   *
   * This method clears the current line content and rewrites it with
   * color codes for SQL keywords, strings, numbers, etc. Called on
   * delimiter characters (space, semicolon, parentheses, comma) via debouncing.
   */
  private redrawLineHighlighted(): void {
    if (!this.syntaxHighlighting) {
      return;
    }

    const content = this.inputBuffer.getContent();
    if (content.length === 0) {
      return;
    }

    const cursorPos = this.inputBuffer.getCursorPos();
    const highlighted = highlightSQL(content);

    // Move cursor to start of input (after prompt)
    if (cursorPos > 0) {
      this.write(vt100.cursorLeft(cursorPos));
    }

    // Clear line from cursor and write highlighted content
    this.write(vt100.CLEAR_TO_END);
    this.write(highlighted);

    // Move cursor back to original position
    const charsAfterCursor = content.length - cursorPos;
    if (charsAfterCursor > 0) {
      this.write(vt100.cursorLeft(charsAfterCursor));
    }
  }

  /**
   * Returns the current theme object for terminal styling.
   *
   * @returns The custom theme if set, otherwise the built-in theme ('dark' or 'light')
   */
  private getCurrentThemeObject(): Theme {
    if (this.customTheme) {
      return this.customTheme;
    }
    return getTheme(this.currentThemeName as 'dark' | 'light');
  }

  /**
   * Initializes and starts the terminal.
   *
   * This method performs the following initialization steps:
   * 1. Resolves the container element
   * 2. Initializes the terminal adapter (Ghostty), database (DuckDB), and history store in parallel
   * 3. Sets up input handling and drag-and-drop file loading
   * 4. Displays the welcome message (if enabled)
   * 5. Shows the command prompt
   * 6. Emits the 'ready' event
   *
   * @returns A promise that resolves when the terminal is fully initialized
   *
   * @throws Error if the container element cannot be found
   * @throws Error if DuckDB WASM initialization fails
   *
   * @example
   * ```typescript
   * const terminal = new DuckDBTerminal({ container: '#terminal' });
   * await terminal.start();
   * console.log('Terminal is ready!');
   * ```
   *
   * @fires ready - Emitted when initialization is complete
   */
  async start(): Promise<void> {
    const container = this.resolveContainer();

    // Initialize terminal adapter first so we can show loading progress
    await this.terminalAdapter.init(container, {
      fontFamily: this.config.fontFamily,
      fontSize: this.config.fontSize,
      theme: this.getCurrentThemeObject(),
      scrollback: this.config.scrollback,
    });

    // Show header with loading indicator
    if (this.config.welcomeMessage !== false) {
      this.writeln(vt100.bold('DuckDB Terminal') + ` v${__APP_VERSION__}`);
      this.write(vt100.dim('Loading DuckDB WASM...'));
    }

    // Initialize database and history in parallel
    await Promise.all([
      this.database.init(),
      this.history.init(),
    ]);

    // Clear loading message and show full welcome
    if (this.config.welcomeMessage !== false) {
      // Clear the "Loading DuckDB WASM..." line and rewrite
      this.write('\r' + vt100.CLEAR_TO_END);
      this.writeln(vt100.dim('Powered by DuckDB WASM and Ghostty'));
      this.writeln('');
      this.writeln('Type ' + vt100.colorize('.help', vt100.FG_CYAN) + ' for available commands');
      this.writeln('Enter SQL statements ending with ' + vt100.colorize(';', vt100.FG_YELLOW));
      this.writeln('');
    }

    // Set up input handling
    this.terminalAdapter.onData(this.handleInput.bind(this));

    // Set up drag and drop (store cleanup function for destroy)
    this.dragDropCleanup = setupDragAndDrop(container, (files) => {
      this.handleDroppedFiles(files);
    });

    // Show prompt
    this.showPrompt();

    // Emit ready event
    this.emit('ready', {});
  }

  /**
   * Cleans up resources and event listeners.
   *
   * Call this method when disposing of the terminal to prevent memory leaks.
   * This removes drag-and-drop handlers and clears internal state.
   */
  destroy(): void {
    // Clean up drag-and-drop event listeners
    if (this.dragDropCleanup) {
      this.dragDropCleanup();
      this.dragDropCleanup = null;
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Cancel any pending debounced operations
    this.debouncedHighlight.cancel();
  }

  /**
   * Processes files dropped onto the terminal via drag-and-drop.
   *
   * Uses Promise.allSettled to ensure all files are attempted even if some fail.
   *
   * @param files - Array of File objects to load into DuckDB
   */
  private async handleDroppedFiles(files: File[]): Promise<void> {
    // Use Promise.allSettled to load files in parallel and handle failures gracefully
    const results = await Promise.allSettled(
      files.map((file) => this.loadFile(file))
    );

    // Count successes and failures
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - succeeded;

    if (failed > 0 && succeeded > 0) {
      this.writeln(
        vt100.dim(`Loaded ${succeeded} of ${results.length} files (${failed} failed)`)
      );
    }

    this.showPrompt();
  }

  /**
   * Loads a file into DuckDB's virtual filesystem.
   *
   * Registers the file and displays usage hints for supported file types
   * (CSV, Parquet, JSON). Emits a 'fileLoaded' event on success.
   *
   * @param file - The file to load
   * @returns True if the file was loaded successfully, false otherwise
   */
  private async loadFile(file: File): Promise<boolean> {
    const ext = getFileExtension(file.name);
    const info = getFileInfo(file);

    try {
      const buffer = await readFileAsBuffer(file);
      await this.database.registerFile(file.name, buffer);
      this.loadedFiles.set(file.name, info);

      // Emit fileLoaded event
      this.emit('fileLoaded', {
        filename: file.name,
        size: file.size,
        type: ext,
      });

      this.writeln('');
      this.writeln(
        vt100.colorize(`Loaded: ${file.name}`, vt100.FG_GREEN) +
          ` (${formatFileSize(file.size)})`
      );

      // Escape single quotes in filename for SQL hints
      const safeFilename = file.name.replace(/'/g, "''");

      // Auto-create table for CSV files
      if (ext === 'csv') {
        const tableName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        this.writeln(
          vt100.dim(`Hint: SELECT * FROM read_csv('${safeFilename}');`)
        );
        this.writeln(
          vt100.dim(`  or: CREATE TABLE ${tableName} AS SELECT * FROM read_csv('${safeFilename}');`)
        );
      } else if (ext === 'parquet') {
        this.writeln(
          vt100.dim(`Hint: SELECT * FROM read_parquet('${safeFilename}');`)
        );
      } else if (ext === 'json') {
        this.writeln(
          vt100.dim(`Hint: SELECT * FROM read_json('${safeFilename}');`)
        );
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeln(vt100.colorize(`Error loading ${file.name}: ${message}`, vt100.FG_RED));
      return false;
    }
  }

  /**
   * Resolves the container element from the configuration.
   *
   * @returns The resolved HTML element to attach the terminal to
   * @throws Error if the container selector doesn't match any element
   */
  private resolveContainer(): HTMLElement {
    if (typeof this.config.container === 'string') {
      const el = document.querySelector(this.config.container);
      if (!el) {
        throw new Error(`Container not found: ${this.config.container}`);
      }
      return el as HTMLElement;
    }
    return this.config.container;
  }

  /**
   * Registers all built-in dot commands (.help, .tables, .schema, etc.).
   *
   * Called during construction to populate the commands map with handlers
   * for terminal commands.
   */
  private registerCommands(): void {
    this.commands.set('.help', {
      name: '.help',
      description: 'Show available commands',
      handler: () => this.cmdHelp(),
    });

    this.commands.set('.clear', {
      name: '.clear',
      description: 'Clear the terminal',
      handler: () => this.clear(),
    });

    this.commands.set('.tables', {
      name: '.tables',
      description: 'List all tables',
      handler: () => this.cmdTables(),
    });

    this.commands.set('.schema', {
      name: '.schema',
      description: 'Show table schema',
      usage: '.schema <table_name>',
      handler: (args) => this.cmdSchema(args),
    });

    this.commands.set('.timer', {
      name: '.timer',
      description: 'Toggle query timing',
      usage: '.timer on|off',
      handler: (args) => this.cmdTimer(args),
    });

    this.commands.set('.mode', {
      name: '.mode',
      description: 'Set output mode',
      usage: '.mode table|csv|tsv|json',
      handler: (args) => this.cmdMode(args),
    });

    this.commands.set('.theme', {
      name: '.theme',
      description: 'Set color theme (clears screen)',
      usage: '.theme dark|light',
      handler: (args) => this.cmdTheme(args),
    });

    this.commands.set('.examples', {
      name: '.examples',
      description: 'Show example queries',
      handler: () => this.cmdExamples(),
    });

    this.commands.set('.files', {
      name: '.files',
      description: 'Manage loaded files',
      usage: '.files [list|add|remove <name|index>]',
      handler: (args) => this.cmdFiles(args),
    });

    this.commands.set('.open', {
      name: '.open',
      description: 'Open a file picker to load files',
      handler: () => this.cmdOpen(),
    });

    this.commands.set('.copy', {
      name: '.copy',
      description: 'Copy last result to clipboard',
      handler: async () => { await this.copyLastResult(); },
    });

    this.commands.set('.highlight', {
      name: '.highlight',
      description: 'Toggle syntax highlighting',
      usage: '.highlight on|off',
      handler: (args) => this.cmdHighlight(args),
    });

    this.commands.set('.links', {
      name: '.links',
      description: 'Toggle clickable URL detection',
      usage: '.links on|off',
      handler: (args) => this.cmdLinks(args),
    });

    this.commands.set('.pagesize', {
      name: '.pagesize',
      description: 'Enable pagination for large results (default: off)',
      usage: '.pagesize <number> (0 = disabled)',
      handler: (args) => this.cmdPageSize(args),
    });

    this.commands.set('.reset', {
      name: '.reset',
      description: 'Reset database and all settings to defaults',
      handler: () => this.cmdReset(),
    });

    this.commands.set('.prompt', {
      name: '.prompt',
      description: 'Get or set the command prompt',
      usage: '.prompt [primary [continuation]]',
      handler: (args) => this.cmdPrompt(args),
    });
  }

  /**
   * Displays the command prompt (primary or continuation based on state).
   *
   * Sets terminal state to 'idle' if not currently collecting multi-line SQL.
   */
  private showPrompt(): void {
    const promptText = this.state === 'collecting' ? this.continuationPrompt : this.prompt;
    this.inputBuffer.setPromptLength(promptText.length);
    this.write(vt100.colorize(promptText, vt100.FG_GREEN));
    if (this.state !== 'collecting') {
      this.setState('idle');
    }
  }

  /**
   * Handles raw terminal input data.
   *
   * Routes input to the appropriate handler based on terminal state
   * (executing, paginating, or normal input mode). Processes escape
   * sequences separately from regular character input.
   *
   * @param data - The raw input data from the terminal
   */
  private handleInput(data: string): void {
    if (this.state === 'executing') {
      return; // Ignore input while executing
    }

    // Handle pagination mode
    if (this.state === 'paginating') {
      this.handlePaginationInput(data);
      return;
    }

    // Check for escape sequences first
    if (data.startsWith('\x1b[')) {
      this.handleEscapeSequence(data);
      return;
    }

    for (const char of data) {
      this.handleChar(char);
    }
  }

  /**
   * Handles input during pagination mode.
   *
   * Supports: [n]ext page, [p]revious page, [q]uit, page number entry,
   * and arrow keys for navigation.
   *
   * @param data - The input character or escape sequence
   */
  private async handlePaginationInput(data: string): Promise<void> {
    const totalPages = Math.ceil(this.totalRows / this.pageSize);

    // Handle single character commands
    const char = data.toLowerCase();

    if (char === 'n' || data === '\x1b[B') {
      // Next page
      if (this.currentPage < totalPages - 1) {
        this.currentPage++;
        await this.executePaginatedQuery();
      } else {
        this.writeln(vt100.dim('Already on last page'));
      }
      return;
    }

    if (char === 'p' || data === '\x1b[A') {
      // Previous page
      if (this.currentPage > 0) {
        this.currentPage--;
        await this.executePaginatedQuery();
      } else {
        this.writeln(vt100.dim('Already on first page'));
      }
      return;
    }

    if (char === 'q' || char === '\x1b' || char === '\x03') {
      // Quit pagination (q, Escape, or Ctrl+C)
      this.writeln('');
      this.exitPagination();
      this.writeln('');
      this.showPrompt();
      return;
    }

    // Handle page number input (number + Enter)
    if (char === '\r' || char === '\n') {
      const content = this.inputBuffer.getContent().trim();
      if (content) {
        const pageNum = parseInt(content, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
          this.currentPage = pageNum - 1;
          this.inputBuffer.clear();
          await this.executePaginatedQuery();
        } else {
          this.writeln(vt100.colorize(`Invalid page number. Enter 1-${totalPages}`, vt100.FG_RED));
          this.inputBuffer.clear();
        }
      }
      return;
    }

    // Accumulate digits for page number
    if (/^\d$/.test(char)) {
      this.write(this.inputBuffer.insert(char));
      return;
    }

    // Backspace
    if (char === '\x7f' || char === '\b') {
      this.write(this.inputBuffer.backspace());
      return;
    }
  }

  /**
   * Processes a single character of user input.
   *
   * Handles special characters (Enter, Backspace, Tab, Ctrl sequences)
   * and regular printable characters including Unicode.
   *
   * @param char - The single character to process
   */
  private handleChar(char: string): void {
    const code = char.charCodeAt(0);

    // Handle special characters
    switch (char) {
      case '\r': // Enter
      case '\n':
        this.handleEnter();
        return;

      case '\x7f': // Backspace
      case '\b':
        this.write(this.inputBuffer.backspace());
        return;

      case '\x1b': // Escape sequence start
        return; // Will be handled by escape sequence

      case '\t': // Tab (auto-complete)
        this.handleTab();
        return;

      case '\x03': // Ctrl+C
        this.handleCtrlC();
        return;

      case '\x16': // Ctrl+V (paste)
        this.handlePaste();
        return;

      case '\x01': // Ctrl+A (start of line)
        this.write(this.inputBuffer.moveToStart());
        return;

      case '\x05': // Ctrl+E (end of line)
        this.write(this.inputBuffer.moveToEnd());
        return;

      case '\x0b': // Ctrl+K (clear to end)
        this.write(this.inputBuffer.clearToEnd());
        return;

      case '\x15': // Ctrl+U (clear line)
        this.write(this.inputBuffer.clearLine());
        return;
    }

    // Handle escape sequences (single char won't match, handled via handleInput)
    if (char === '\x1b') {
      // Escape key or start of sequence - ignore single char
      return;
    }

    // Regular printable character
    if (code >= 32 && code < 127) {
      this.write(this.inputBuffer.insert(char));
      // Trigger debounced syntax highlighting on delimiter characters
      if (this.isHighlightTrigger(char)) {
        this.debouncedHighlight();
      }
    } else if (code >= 128) {
      // Unicode character
      this.write(this.inputBuffer.insert(char));
    }
  }

  /**
   * Checks if a character should trigger syntax highlighting redraw.
   *
   * @param char - The character to check
   * @returns True if the character is a highlighting trigger (space, semicolon, parentheses, comma)
   */
  private isHighlightTrigger(char: string): boolean {
    // Trigger on: space, semicolon, parentheses, comma
    return char === ' ' || char === ';' || char === '(' || char === ')' || char === ',';
  }

  /**
   * Processes VT100 escape sequences for special keys.
   *
   * Handles arrow keys (up/down for history, left/right for cursor),
   * Home, End, and Delete keys.
   *
   * @param seq - The escape sequence string (e.g., '\x1b[A' for Arrow Up)
   */
  private handleEscapeSequence(seq: string): void {
    switch (seq) {
      case '\x1b[A': // Arrow Up
        this.handleArrowUp();
        break;
      case '\x1b[B': // Arrow Down
        this.handleArrowDown();
        break;
      case '\x1b[C': // Arrow Right
        this.write(this.inputBuffer.moveRight());
        break;
      case '\x1b[D': // Arrow Left
        this.write(this.inputBuffer.moveLeft());
        break;
      case '\x1b[H': // Home
        this.write(this.inputBuffer.moveToStart());
        break;
      case '\x1b[F': // End
        this.write(this.inputBuffer.moveToEnd());
        break;
      case '\x1b[3~': // Delete
        this.write(this.inputBuffer.delete());
        break;
    }
  }

  /**
   * Handles the Enter key press.
   *
   * For dot commands, executes immediately. For SQL, collects lines until
   * a semicolon terminates the statement, then executes.
   */
  private async handleEnter(): Promise<void> {
    const input = this.inputBuffer.getContent();
    this.writeln('');

    if (input.trim() === '' && this.state !== 'collecting') {
      this.showPrompt();
      return;
    }

    // Check for dot command
    if (input.trim().startsWith('.') && this.state !== 'collecting') {
      this.writeln(''); // Add spacing before command output
      await this.history.add(input.trim());
      await this.executeCommand(input.trim());
      this.inputBuffer.clear();
      this.writeln(''); // Add spacing after command output
      this.showPrompt();
      return;
    }

    // Collect SQL
    this.collectedSQL.push(input);

    // Check if SQL is complete
    const fullSQL = this.collectedSQL.join('\n').trim();
    if (fullSQL.endsWith(';')) {
      this.writeln(''); // Add spacing before query output
      await this.executeSQL(fullSQL);
      this.collectedSQL = [];
      // Don't reset state if we're now paginating
      if (this.state !== 'paginating') {
        this.setState('idle');
      }
    } else {
      this.setState('collecting');
    }

    this.inputBuffer.clear();
    // Don't show prompt if we're in pagination mode
    if (this.state !== 'paginating') {
      // Add spacing after SQL execution output, but not for continuation prompts
      if (fullSQL.endsWith(';')) {
        this.writeln('');
      }
      this.showPrompt();
    }
  }

  /**
   * Navigates to the previous command in history (Arrow Up).
   */
  private handleArrowUp(): void {
    const previous = this.history.previous(this.inputBuffer.getContent());
    if (previous !== null) {
      this.write(this.inputBuffer.clearLine());
      this.inputBuffer.setContent(previous);
      this.write(this.getHighlightedSQL(previous));
    }
  }

  /**
   * Navigates to the next command in history (Arrow Down).
   */
  private handleArrowDown(): void {
    const next = this.history.next();
    if (next !== null) {
      this.write(this.inputBuffer.clearLine());
      this.inputBuffer.setContent(next);
      this.write(this.getHighlightedSQL(next));
    }
  }

  /**
   * Handles Tab key for auto-completion.
   *
   * Provides suggestions for SQL keywords, table names, and functions.
   * Single match is applied directly; multiple matches are displayed.
   */
  private async handleTab(): Promise<void> {
    const input = this.inputBuffer.getContent();
    const cursorPos = this.inputBuffer.getCursorPos();

    const suggestions = await this.database.getCompletions(input, cursorPos);
    if (suggestions.length === 0) {
      return;
    }

    if (suggestions.length === 1) {
      // Single suggestion, apply it
      this.write(this.inputBuffer.replaceWordBeforeCursor(suggestions[0].value));
      this.redrawLineHighlighted();
    } else {
      // Multiple suggestions, show them
      this.writeln('');
      const formatted = suggestions
        .map((s) => {
          const color =
            s.type === 'keyword'
              ? vt100.FG_BLUE
              : s.type === 'table'
                ? vt100.FG_GREEN
                : s.type === 'function'
                  ? vt100.FG_YELLOW
                  : vt100.FG_WHITE;
          return vt100.colorize(s.value, color);
        })
        .join('  ');
      this.writeln(formatted);

      // Find common prefix
      const prefix = this.findCommonPrefix(suggestions.map((s) => s.value));
      const currentWord = this.inputBuffer.getWordBeforeCursor();
      if (prefix.length > currentWord.length) {
        this.write(this.inputBuffer.replaceWordBeforeCursor(prefix));
      }

      // Reshow prompt and current input with highlighting
      const promptText = this.state === 'collecting' ? this.continuationPrompt : this.prompt;
      this.write(vt100.colorize(promptText, vt100.FG_GREEN));
      this.write(this.getHighlightedSQL(this.inputBuffer.getContent()));
    }
  }

  /**
   * Finds the longest common prefix among an array of strings.
   *
   * Used for auto-completion to expand to the longest unambiguous prefix.
   *
   * @param strings - Array of strings to find common prefix for
   * @returns The longest common prefix (case-insensitive comparison)
   */
  private findCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];

    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (!strings[i].toLowerCase().startsWith(prefix.toLowerCase())) {
        prefix = prefix.slice(0, -1);
        if (prefix === '') return '';
      }
    }
    return prefix;
  }

  /**
   * Handles Ctrl+C to cancel current input or multi-line collection.
   */
  private handleCtrlC(): void {
    this.writeln('^C');
    this.inputBuffer.clear();
    this.collectedSQL = [];
    this.setState('idle');
    this.showPrompt();
  }

  /**
   * Handles Ctrl+V to paste content from clipboard.
   *
   * Inserts text character-by-character, skipping newlines.
   */
  private async handlePaste(): Promise<void> {
    const text = await readFromClipboard();
    if (text) {
      // Insert pasted text character by character
      for (const char of text) {
        if (char === '\n' || char === '\r') {
          // Handle newlines in pasted content
          continue;
        }
        this.write(this.inputBuffer.insert(char));
      }
    }
  }

  /**
   * Copy last query result to clipboard
   */
  async copyLastResult(): Promise<boolean> {
    if (!this.lastQueryResult) {
      this.writeln(vt100.dim('No query result to copy'));
      return false;
    }

    let text: string;
    switch (this.outputMode) {
      case 'csv':
        text = formatCSV(this.lastQueryResult.columns, this.lastQueryResult.rows);
        break;
      case 'tsv':
        text = formatTSV(this.lastQueryResult.columns, this.lastQueryResult.rows);
        break;
      case 'json':
        text = formatJSON(this.lastQueryResult.columns, this.lastQueryResult.rows);
        break;
      default:
        text = formatTable(this.lastQueryResult.columns, this.lastQueryResult.rows);
    }

    const success = await copyToClipboard(text);
    if (success) {
      this.writeln(vt100.colorize('Result copied to clipboard', vt100.FG_GREEN));
    } else {
      this.writeln(vt100.colorize('Failed to copy to clipboard', vt100.FG_RED));
    }
    return success;
  }

  /**
   * Executes a dot command (e.g., .help, .tables, .schema).
   *
   * Parses the command and arguments, looks up the handler, and executes it.
   * Emits 'commandExecute' event on execution and 'error' on failure.
   *
   * @param input - The full command string including arguments
   */
  private async executeCommand(input: string): Promise<void> {
    const { command: cmdName, args } = parseCommand(input);

    const command = this.commands.get(cmdName);
    if (!command) {
      this.writeln(vt100.colorize(`Unknown command: ${cmdName}`, vt100.FG_RED));
      this.writeln('Type .help for available commands');
      this.emit('error', { message: `Unknown command: ${cmdName}`, source: 'command' });
      return;
    }

    // Emit commandExecute event
    this.emit('commandExecute', { command: cmdName, args });

    try {
      await command.handler(args, this);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeln(vt100.colorize(`Error: ${message}`, vt100.FG_RED));
      this.emit('error', { message, source: 'command' });
    }
  }

  /**
   * Executes a SQL query and displays the results.
   *
   * This method executes the provided SQL statement against the DuckDB database,
   * displays the results in the configured output format (table, CSV, or JSON),
   * and adds the query to the command history.
   *
   * For large result sets (when pagination is enabled via `.pagesize`), the method
   * will automatically paginate the results and enter pagination mode.
   *
   * @param sql - The SQL statement to execute (should end with a semicolon)
   * @returns A promise that resolves to the query result, or null if an error occurred
   *
   * @fires queryStart - Emitted before query execution begins
   * @fires queryEnd - Emitted after query execution completes (success or failure)
   * @fires error - Emitted if the query fails
   *
   * @example Execute a SELECT query
   * ```typescript
   * const result = await terminal.executeSQL('SELECT * FROM users;');
   * if (result) {
   *   console.log(`Retrieved ${result.rowCount} rows in ${result.duration}ms`);
   *   console.log('Columns:', result.columns);
   *   console.log('First row:', result.rows[0]);
   * }
   * ```
   *
   * @example Execute DDL statements
   * ```typescript
   * await terminal.executeSQL('CREATE TABLE products (id INTEGER, name VARCHAR);');
   * await terminal.executeSQL("INSERT INTO products VALUES (1, 'Widget');");
   * ```
   */
  async executeSQL(sql: string): Promise<QueryResult | null> {
    // Chain through query queue to prevent race conditions
    const execution = this.queryQueue.then(() => this.executeSQLInternal(sql));
    this.queryQueue = execution.catch(() => null); // Ensure queue continues even on error
    return execution;
  }

  /**
   * Internal SQL execution logic.
   *
   * @internal
   * @param sql - The SQL statement to execute
   * @returns The query result, or null on error
   */
  private async executeSQLInternal(sql: string): Promise<QueryResult | null> {
    this.setState('executing');
    const startTime = performance.now();

    // Emit queryStart event
    this.emit('queryStart', { sql });

    try {
      // Add to history
      await this.history.add(sql);

      // Check if pagination is enabled and this is a SELECT query
      const trimmedSQL = sql.trim().replace(/;+$/, '');
      const isSelectQuery = /^\s*SELECT\s/i.test(trimmedSQL);
      // Skip pagination if query already has LIMIT or OFFSET (user is controlling result size)
      const hasLimitOffset = /\b(LIMIT|OFFSET)\b/i.test(trimmedSQL);

      if (this.pageSize > 0 && isSelectQuery && !hasLimitOffset) {
        // Get total row count first
        const countSQL = `SELECT COUNT(*) as cnt FROM (${trimmedSQL}) AS _count_subquery`;
        const countResult = await this.database.executeQuery(countSQL);
        const countValue = countResult.rows[0]?.[0];
        // DuckDB returns BigInt for COUNT(*), convert to number for comparison
        const totalCount = typeof countValue === 'bigint' ? Number(countValue) : (countValue as number ?? 0);

        if (totalCount > this.pageSize) {
          // Enable pagination
          this.paginationQuery = trimmedSQL;
          this.totalRows = totalCount;
          this.currentPage = 0;
          return await this.executePaginatedQuery();
        }
      }

      // Execute without pagination
      const result = await this.database.executeQuery(sql);
      const duration = performance.now() - startTime;

      // Store last result for copy command
      this.lastQueryResult = result;

      if (result.columns.length > 0) {
        this.displayResult(result);
      }

      if (this.showTimer) {
        this.writeln(
          vt100.dim(`Time: ${result.duration.toFixed(2)}ms`)
        );
      }

      // Emit queryEnd event
      this.emit('queryEnd', { sql, result, duration });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duration = performance.now() - startTime;

      // Display error with context - show the failed SQL for multi-line queries
      this.writeln(vt100.colorize(`Error: ${message}`, vt100.FG_RED));
      if (sql.includes('\n') || sql.length > 80) {
        // For multi-line or long queries, show the failed query for context
        const truncatedSQL = sql.length > 200 ? sql.substring(0, 200) + '...' : sql;
        this.writeln(vt100.dim(`  Query: ${truncatedSQL.replace(/\n/g, ' ')}`));
      }

      // Emit queryEnd with error and error event
      this.emit('queryEnd', { sql, result: null, error: message, duration });
      this.emit('error', { message, source: 'query' });

      return null;
    } finally {
      if ((this.state as TerminalState) !== 'paginating') {
        this.setState('idle');
      }
    }
  }

  /**
   * Executes the current paginated query for the current page.
   *
   * Adds LIMIT/OFFSET to the stored query and displays results with
   * pagination controls.
   *
   * @returns The query result for the current page, or null on error
   */
  private async executePaginatedQuery(): Promise<QueryResult | null> {
    if (!this.paginationQuery) return null;

    const offset = this.currentPage * this.pageSize;
    const paginatedSQL = `${this.paginationQuery} LIMIT ${this.pageSize} OFFSET ${offset}`;

    try {
      const result = await this.database.executeQuery(paginatedSQL);
      this.lastQueryResult = result;

      if (result.columns.length > 0) {
        this.displayResult(result);
      }

      const totalPages = Math.ceil(this.totalRows / this.pageSize);
      const startRow = offset + 1;
      const endRow = Math.min(offset + this.pageSize, this.totalRows);

      this.writeln('');
      this.writeln(
        vt100.dim(`Showing rows ${startRow}-${endRow} of ${this.totalRows} (page ${this.currentPage + 1}/${totalPages})`)
      );
      this.writeln(
        vt100.colorize('  [n]ext  [p]rev  [q]uit  or enter page number', vt100.FG_CYAN)
      );

      this.setState('paginating');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeln(vt100.colorize(`Error: ${message}`, vt100.FG_RED));
      if (paginatedSQL.length > 80) {
        const truncatedSQL = paginatedSQL.length > 200 ? paginatedSQL.substring(0, 200) + '...' : paginatedSQL;
        this.writeln(vt100.dim(`  Query: ${truncatedSQL.replace(/\n/g, ' ')}`));
      }
      this.exitPagination();
      return null;
    }
  }

  /**
   * Exits pagination mode and resets pagination state.
   */
  private exitPagination(): void {
    this.paginationQuery = null;
    this.currentPage = 0;
    this.totalRows = 0;
    this.setState('idle');
  }

  /**
   * Displays a query result in the current output mode.
   *
   * Formats and writes the result as table, CSV, TSV, or JSON based on
   * the current outputMode setting.
   *
   * @param result - The query result to display
   */
  private displayResult(result: QueryResult): void {
    switch (this.outputMode) {
      case 'csv':
        this.writeln(formatCSV(result.columns, result.rows));
        break;
      case 'tsv':
        this.writeln(formatTSV(result.columns, result.rows));
        break;
      case 'json':
        this.writeln(formatJSON(result.columns, result.rows));
        break;
      case 'table':
      default:
        this.writeln(formatTable(result.columns, result.rows));
        break;
    }

    this.writeln(
      vt100.dim(
        `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''}`
      )
    );
  }

  // Command handlers
  private cmdHelp(): void {
    this.writeln(vt100.bold('Available commands:'));
    this.writeln('');
    for (const cmd of this.commands.values()) {
      const usage = cmd.usage ? `  ${vt100.dim(cmd.usage)}` : '';
      this.writeln(`  ${vt100.colorize(cmd.name, vt100.FG_CYAN)}  ${cmd.description}${usage}`);
    }
    this.writeln('');
    this.writeln('SQL statements must end with a semicolon (;)');
  }

  private async cmdTables(): Promise<void> {
    const tables = await this.database.getTables();
    if (tables.length === 0) {
      this.writeln(vt100.dim('No tables found'));
      return;
    }
    for (const table of tables) {
      this.writeln(table);
    }
  }

  private async cmdSchema(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.writeln('Usage: .schema <table_name>');
      return;
    }
    const schema = await this.database.getTableSchema(args[0]);
    if (schema.length === 0) {
      this.writeln(vt100.dim(`Table not found: ${args[0]}`));
      return;
    }
    for (const col of schema) {
      this.writeln(`  ${col.name} ${vt100.dim(col.type)}`);
    }
  }

  private cmdTimer(args: string[]): void {
    if (args.length === 0) {
      this.writeln(`Timer is ${this.showTimer ? 'on' : 'off'}`);
      return;
    }
    const value = args[0].toLowerCase();
    if (value === 'on') {
      this.showTimer = true;
      this.writeln('Timer is now on');
    } else if (value === 'off') {
      this.showTimer = false;
      this.writeln('Timer is now off');
    } else {
      this.writeln('Usage: .timer on|off');
    }
  }

  private cmdMode(args: string[]): void {
    if (args.length === 0) {
      this.writeln(`Output mode: ${this.outputMode}`);
      return;
    }
    const mode = args[0].toLowerCase();
    if (mode === 'table' || mode === 'csv' || mode === 'tsv' || mode === 'json') {
      this.outputMode = mode;
      this.writeln(`Output mode set to ${mode}`);
    } else {
      this.writeln('Usage: .mode table|csv|tsv|json');
    }
  }

  private cmdTheme(args: string[]): void {
    if (args.length === 0) {
      const themeName = this.customTheme ? this.customTheme.name : this.currentThemeName;
      this.writeln(`Theme: ${themeName}`);
      return;
    }
    const theme = args[0].toLowerCase();
    if (theme === 'dark' || theme === 'light') {
      this.setTheme(theme);
    } else {
      this.writeln('Usage: .theme dark|light');
    }
  }

  private cmdExamples(): void {
    this.writeln(vt100.bold('Example queries:'));
    this.writeln('');
    this.writeln(vt100.colorize("  -- Create a table", vt100.FG_BRIGHT_BLACK));
    this.writeln('  ' + this.getHighlightedSQL("CREATE TABLE users (id INTEGER, name VARCHAR);"));
    this.writeln('');
    this.writeln(vt100.colorize("  -- Insert data", vt100.FG_BRIGHT_BLACK));
    this.writeln('  ' + this.getHighlightedSQL("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');"));
    this.writeln('');
    this.writeln(vt100.colorize("  -- Query data", vt100.FG_BRIGHT_BLACK));
    this.writeln('  ' + this.getHighlightedSQL("SELECT * FROM users WHERE name LIKE 'A%';"));
    this.writeln('');
    this.writeln(vt100.colorize("  -- Use built-in functions", vt100.FG_BRIGHT_BLACK));
    this.writeln('  ' + this.getHighlightedSQL("SELECT range(10), current_timestamp;"));
  }

  private async cmdFiles(args: string[]): Promise<void> {
    const subcommand = args[0]?.toLowerCase() ?? 'list';

    if (subcommand === 'list') {
      if (this.loadedFiles.size === 0) {
        this.writeln(vt100.dim('No files loaded'));
        this.writeln(vt100.dim('Use .open or drag-and-drop to add files'));
        return;
      }
      this.writeln(vt100.bold('Loaded files:'));
      let index = 1;
      for (const [name, info] of this.loadedFiles) {
        this.writeln(`  ${vt100.dim(`${index}.`)} ${name} ${vt100.dim(`(${formatFileSize(info.size)})`)}`);
        index++;
      }
    } else if (subcommand === 'add') {
      await this.cmdOpen();
    } else if (subcommand === 'remove' || subcommand === 'rm') {
      const target = args.slice(1).join(' ');
      if (!target) {
        this.writeln('Usage: .files remove <filename|index>');
        return;
      }

      // Try to parse as index first
      const index = parseInt(target, 10);
      let filenameToRemove: string | null = null;

      if (!isNaN(index) && index >= 1) {
        // Get filename by index
        const filesArray = Array.from(this.loadedFiles.keys());
        if (index <= filesArray.length) {
          filenameToRemove = filesArray[index - 1];
        } else {
          this.writeln(vt100.colorize(`Invalid index: ${index}. Use .files list to see available files.`, 'red'));
          return;
        }
      } else {
        // Treat as filename
        if (this.loadedFiles.has(target)) {
          filenameToRemove = target;
        } else {
          this.writeln(vt100.colorize(`File not found: ${target}`, 'red'));
          return;
        }
      }

      if (filenameToRemove) {
        try {
          await this.database.dropFile(filenameToRemove);
          this.loadedFiles.delete(filenameToRemove);
          this.writeln(vt100.colorize(`Removed: ${filenameToRemove}`, 'green'));
        } catch (error) {
          this.writeln(vt100.colorize(`Error removing file: ${error}`, 'red'));
        }
      }
    } else {
      this.writeln('Usage: .files [list|add|remove <name|index>]');
    }
  }

  private async cmdOpen(): Promise<void> {
    this.writeln(vt100.dim('Opening file picker...'));
    const files = await pickFiles({
      multiple: true,
      accept: '.csv,.parquet,.json,.db,.duckdb',
    });

    if (files.length === 0) {
      this.writeln(vt100.dim('No files selected'));
      return;
    }

    for (const file of files) {
      await this.loadFile(file);
    }
  }

  private cmdHighlight(args: string[]): void {
    if (args.length === 0) {
      this.writeln(`Syntax highlighting is ${this.syntaxHighlighting ? 'on' : 'off'}`);
      return;
    }
    const value = args[0].toLowerCase();
    if (value === 'on') {
      this.syntaxHighlighting = true;
      this.writeln('Syntax highlighting is now on');
    } else if (value === 'off') {
      this.syntaxHighlighting = false;
      this.writeln('Syntax highlighting is now off');
    } else {
      this.writeln('Usage: .highlight on|off');
    }
  }

  private cmdLinks(args: string[]): void {
    if (args.length === 0) {
      this.writeln(`URL link detection is ${this.linkProvider.isEnabled() ? 'on' : 'off'}`);
      return;
    }
    const value = args[0].toLowerCase();
    if (value === 'on') {
      this.linkProvider.setEnabled(true);
      this.writeln('URL link detection is now on');
    } else if (value === 'off') {
      this.linkProvider.setEnabled(false);
      this.writeln('URL link detection is now off');
    } else {
      this.writeln('Usage: .links on|off');
    }
  }

  private cmdPageSize(args: string[]): void {
    if (args.length === 0) {
      if (this.pageSize === 0) {
        this.writeln('Pagination is disabled (showing all rows)');
      } else {
        this.writeln(`Page size: ${this.pageSize} rows`);
      }
      return;
    }
    const size = parseInt(args[0], 10);
    if (isNaN(size) || size < 0) {
      this.writeln('Usage: .pagesize <number> (0 = no pagination)');
      return;
    }
    this.pageSize = size;
    if (size === 0) {
      this.writeln('Pagination disabled (will show all rows)');
    } else {
      this.writeln(`Page size set to ${size} rows`);
    }
  }

  private async cmdReset(): Promise<void> {
    try {
      // Get all tables
      const tables = await this.database.getTables();
      const tableCount = tables.length;

      // Drop all tables
      for (const table of tables) {
        await this.database.executeQuery(`DROP TABLE IF EXISTS "${table}";`);
      }

      // Clear loaded files from virtual filesystem
      const fileCount = this.loadedFiles.size;
      for (const filename of this.loadedFiles.keys()) {
        try {
          await this.database.dropFile(filename);
        } catch {
          // Ignore errors if file doesn't exist
        }
      }
      this.loadedFiles.clear();

      // Clear last query result
      this.lastQueryResult = null;

      // Clear history state
      this.history.reset();

      // Reset user-configurable settings to defaults
      this.showTimer = false;
      this.outputMode = 'table';
      this.syntaxHighlighting = true;
      this.pageSize = 0;
      this.linkProvider.setEnabled(true);
      this.prompt = DEFAULT_PROMPT;
      this.continuationPrompt = DEFAULT_CONTINUATION_PROMPT;

      // Reset pagination state
      this.paginationQuery = null;
      this.currentPage = 0;
      this.totalRows = 0;

      this.writeln(
        vt100.colorize(
          `Reset complete: dropped ${tableCount} table${tableCount !== 1 ? 's' : ''}, cleared ${fileCount} file${fileCount !== 1 ? 's' : ''}, settings restored to defaults`,
          vt100.FG_GREEN
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeln(vt100.colorize(`Error during reset: ${message}`, vt100.FG_RED));
    }
  }

  private cmdPrompt(args: string[]): void {
    if (args.length === 0) {
      // Show current prompts
      this.writeln(`Primary prompt: "${this.prompt}"`);
      this.writeln(`Continuation prompt: "${this.continuationPrompt}"`);
      return;
    }

    // Set primary prompt (first arg)
    const newPrompt = args[0];
    this.prompt = newPrompt;

    // Optionally set continuation prompt (second arg)
    if (args.length >= 2) {
      this.continuationPrompt = args[1];
      this.writeln(`Prompts set to "${this.prompt}" and "${this.continuationPrompt}"`);
    } else {
      this.writeln(`Primary prompt set to "${this.prompt}"`);
    }
  }

  // ==================== TerminalInterface Implementation ====================

  /**
   * Writes text to the terminal without a trailing newline.
   *
   * Use this method for inline output where you don't want to start a new line.
   * The text is written directly to the terminal without any processing.
   *
   * @param text - The text to write to the terminal
   *
   * @example
   * ```typescript
   * terminal.write('Loading');
   * terminal.write('...');
   * terminal.write(' Done!\n');
   * ```
   */
  write(text: string): void {
    this.terminalAdapter.write(text);
  }

  /**
   * Writes text to the terminal followed by a newline.
   *
   * The text is processed for clickable URLs (if link detection is enabled)
   * and newlines are normalized to CRLF for proper terminal display.
   *
   * @param text - The text to write to the terminal
   *
   * @example
   * ```typescript
   * terminal.writeln('Query completed successfully!');
   * terminal.writeln('Visit https://duckdb.org for documentation');
   * ```
   */
  writeln(text: string): void {
    // Process text for clickable URLs
    const processed = this.linkProvider.process(text);
    // Replace \n with \r\n for proper terminal line endings
    const normalized = processed.replace(/\r?\n/g, '\r\n');
    this.terminalAdapter.writeln(normalized);
  }

  /**
   * Clears the terminal screen.
   *
   * This removes all content from the terminal display and moves the cursor
   * to the top-left corner.
   *
   * @example
   * ```typescript
   * terminal.clear();
   * terminal.writeln('Screen cleared!');
   * ```
   */
  clear(): void {
    this.terminalAdapter.clear();
  }

  /**
   * Sets the terminal color theme.
   *
   * You can set a built-in theme ('dark' or 'light') or provide a custom
   * theme object with your own colors. Built-in theme preferences are
   * persisted to localStorage.
   *
   * @param theme - The theme to apply: 'dark', 'light', or a custom Theme object
   *
   * @fires themeChange - Emitted after the theme is changed
   *
   * @example Set a built-in theme
   * ```typescript
   * terminal.setTheme('light');
   * ```
   *
   * @example Set a custom theme
   * ```typescript
   * terminal.setTheme({
   *   name: 'my-theme',
   *   colors: {
   *     background: '#1a1b26',
   *     foreground: '#a9b1d6',
   *     cursor: '#c0caf5',
   *     // ... other color properties
   *   },
   * });
   * ```
   */
  setTheme(theme: 'dark' | 'light' | Theme): void {
    const previousTheme = this.getCurrentThemeObject();

    if (typeof theme === 'object') {
      // Custom theme object
      this.customTheme = theme;
      this.currentThemeName = 'custom';
      this.terminalAdapter.setTheme(theme);
      this.writeln(`Theme set to ${theme.name}`);
    } else {
      // Built-in theme
      this.customTheme = null;
      this.currentThemeName = theme;
      this.terminalAdapter.setTheme(getTheme(theme));
      saveTheme(theme);
      this.writeln(`Theme set to ${theme}`);
    }

    // Emit themeChange event
    const newTheme = this.getCurrentThemeObject();
    this.emit('themeChange', { theme: newTheme, previous: previousTheme });

    // Update body class for page styling
    const isLight = this.currentThemeName === 'light' ||
      (this.customTheme?.name === 'light');
    document.body.classList.toggle('light', isLight);
    document.body.classList.toggle('dark', !isLight);
  }

  /**
   * Gets the current theme mode.
   *
   * Returns 'dark' or 'light' based on the current theme. For custom themes,
   * this returns 'light' if the theme name is 'light', otherwise 'dark'.
   *
   * @returns The current theme mode: 'dark' or 'light'
   *
   * @example
   * ```typescript
   * const mode = terminal.getTheme();
   * console.log(`Current theme mode: ${mode}`);
   * ```
   */
  getTheme(): 'dark' | 'light' {
    // Return 'dark' or 'light' based on current theme
    if (this.currentThemeName === 'custom' && this.customTheme) {
      // For custom themes, return based on theme name or default to 'dark'
      return this.customTheme.name === 'light' ? 'light' : 'dark';
    }
    return this.currentThemeName as 'dark' | 'light';
  }
}
