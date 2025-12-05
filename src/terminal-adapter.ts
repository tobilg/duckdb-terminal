import { Ghostty, Terminal, FitAddon } from 'ghostty-web';
import type { Theme } from '@/types';

// Injected by Vite at build time from node_modules/ghostty-web/package.json
declare const __GHOSTTY_VERSION__: string;

// CDN URL for ghostty-web WASM - version is injected at build time
const GHOSTTY_CDN_BASE = 'https://cdn.jsdelivr.net/npm/ghostty-web';
const getGhosttyWasmUrl = () =>
  `${GHOSTTY_CDN_BASE}@${__GHOSTTY_VERSION__}/dist/ghostty-vt.wasm`;

/**
 * Configuration options for the terminal adapter.
 */
export interface TerminalOptions {
  /**
   * Font family for the terminal text.
   * Defaults to a stack of monospace fonts.
   */
  fontFamily?: string;
  /**
   * Font size in pixels.
   * @defaultValue 14
   */
  fontSize?: number;
  /**
   * The color theme to apply to the terminal.
   */
  theme?: Theme;
  /**
   * Scrollback buffer size in bytes.
   * @defaultValue 10485760 (10MB)
   */
  scrollback?: number;
}

/**
 * An adapter that wraps the Ghostty terminal emulator for web use.
 *
 * This class provides a simplified interface for:
 * - Initializing the Ghostty WASM terminal
 * - Writing text and handling input
 * - Managing themes and dimensions
 * - Auto-fitting to container size
 *
 * The adapter handles all the low-level details of working with the Ghostty
 * terminal emulator, including WASM initialization, addon loading, and
 * event handling.
 *
 * @example Basic usage
 * ```typescript
 * const adapter = new TerminalAdapter();
 * await adapter.init(document.getElementById('container'), {
 *   fontSize: 16,
 *   theme: darkTheme,
 * });
 *
 * adapter.write('Hello, World!');
 * adapter.onData((input) => {
 *   console.log('User typed:', input);
 * });
 * ```
 *
 * @example Theme switching
 * ```typescript
 * const adapter = new TerminalAdapter();
 * await adapter.init(container);
 *
 * adapter.setTheme(darkTheme);
 * // Later...
 * adapter.setTheme(lightTheme);
 * ```
 */
export class TerminalAdapter {
  private terminal!: Terminal;
  private fitAddon!: FitAddon;
  private ghostty!: Ghostty;
  private dataHandler?: (data: string) => void;
  private resizeHandler?: (cols: number, rows: number) => void;
  private currentTheme: Theme | null = null;
  private initialized = false;
  private container: HTMLElement | null = null;
  private options: TerminalOptions = {};
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Initializes the Ghostty terminal and mounts it to the container.
   *
   * This method:
   * 1. Initializes the Ghostty WASM module
   * 2. Creates the terminal with the specified options
   * 3. Loads the FitAddon for auto-resizing
   * 4. Mounts the terminal to the container
   * 5. Sets up resize observers
   *
   * @param container - The HTML element to mount the terminal into
   * @param options - Configuration options for the terminal
   * @returns A promise that resolves when initialization is complete
   *
   * @example
   * ```typescript
   * const adapter = new TerminalAdapter();
   * await adapter.init(document.getElementById('terminal'), {
   *   fontSize: 14,
   *   fontFamily: 'JetBrains Mono',
   *   theme: darkTheme,
   * });
   * ```
   */
  async init(
    container: HTMLElement,
    options: TerminalOptions = {}
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Store container and options for potential re-initialization
    this.container = container;
    this.options = options;
    this.currentTheme = options.theme ?? null;

    // Load Ghostty WASM from CDN
    this.ghostty = await Ghostty.load(getGhosttyWasmUrl());

    // Create the terminal instance
    this.createTerminal();

    this.initialized = true;
    this.focus();
  }

  /**
   * Creates or recreates the terminal instance.
   * @internal
   */
  private createTerminal(): void {
    if (!this.container) return;

    // Create terminal with options (pass ghostty instance for CDN-loaded WASM)
    this.terminal = new Terminal({
      ghostty: this.ghostty,
      cursorBlink: true,
      fontSize: this.options.fontSize ?? 14,
      fontFamily:
        this.options.fontFamily ??
        '"Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      theme: this.currentTheme ? this.themeToGhostty(this.currentTheme) : undefined,
      // Scrollback is in bytes, not lines. 10MB is a reasonable default.
      scrollback: this.options.scrollback ?? 10 * 1024 * 1024,
    });

    // Load fit addon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Clear container and open terminal
    this.container.innerHTML = '';
    this.terminal.open(this.container);

    // Fit to container
    this.fit();

    // Handle window resize
    window.addEventListener('resize', this.handleResize);

    // Observe container resize
    if (typeof ResizeObserver !== 'undefined') {
      // Dispose previous observer if exists
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => {
        this.fit();
      });
      this.resizeObserver.observe(this.container);
    }

    // Handle input
    this.terminal.onData((data: string) => {
      this.dataHandler?.(data);
    });

    // Handle resize events
    this.terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      this.resizeHandler?.(cols, rows);
    });
  }

  /**
   * Converts a Theme object to Ghostty's theme format.
   *
   * @internal
   * @param theme - The theme to convert
   * @returns The theme in Ghostty's expected format
   */
  private themeToGhostty(theme: Theme): Record<string, string> {
    return {
      background: theme.colors.background,
      foreground: theme.colors.foreground,
      cursor: theme.colors.cursor,
      black: theme.colors.black,
      red: theme.colors.red,
      green: theme.colors.green,
      yellow: theme.colors.yellow,
      blue: theme.colors.blue,
      magenta: theme.colors.magenta,
      cyan: theme.colors.cyan,
      white: theme.colors.white,
      brightBlack: theme.colors.brightBlack,
      brightRed: theme.colors.brightRed,
      brightGreen: theme.colors.brightGreen,
      brightYellow: theme.colors.brightYellow,
      brightBlue: theme.colors.brightBlue,
      brightMagenta: theme.colors.brightMagenta,
      brightCyan: theme.colors.brightCyan,
      brightWhite: theme.colors.brightWhite,
    };
  }

  /**
   * Handles window resize events.
   * @internal
   */
  private handleResize = (): void => {
    this.fit();
  };

  /**
   * Fits the terminal to its container dimensions.
   *
   * This method should be called when the container size changes.
   * It's automatically called on window resize, but you may need
   * to call it manually after dynamic layout changes.
   *
   * @example
   * ```typescript
   * // After changing container size
   * container.style.height = '500px';
   * adapter.fit();
   * ```
   */
  fit(): void {
    if (this.fitAddon) {
      this.fitAddon.fit();
    }
  }

  /**
   * Writes text to the terminal without a trailing newline.
   *
   * @param text - The text to write
   *
   * @example
   * ```typescript
   * adapter.write('Hello');
   * adapter.write(' World');
   * ```
   */
  write(text: string): void {
    this.terminal?.write(text);
  }

  /**
   * Writes text to the terminal followed by a newline.
   *
   * @param text - The text to write
   *
   * @example
   * ```typescript
   * adapter.writeln('First line');
   * adapter.writeln('Second line');
   * ```
   */
  writeln(text: string): void {
    this.terminal?.writeln(text);
  }

  /**
   * Clears the terminal screen and moves cursor to top-left.
   *
   * @example
   * ```typescript
   * adapter.clear();
   * adapter.writeln('Fresh start!');
   * ```
   */
  clear(): void {
    this.terminal?.write('\x1b[2J\x1b[H');
  }

  /**
   * Gives keyboard focus to the terminal.
   *
   * @example
   * ```typescript
   * adapter.focus();
   * ```
   */
  focus(): void {
    this.terminal?.focus();
  }

  /**
   * Registers a callback to receive user input data.
   *
   * The callback is invoked whenever the user types in the terminal.
   * This includes regular characters, control sequences, and escape codes.
   *
   * @param handler - The callback function to handle input data
   *
   * @example
   * ```typescript
   * adapter.onData((data) => {
   *   if (data === '\r') {
   *     console.log('User pressed Enter');
   *   } else {
   *     console.log('User typed:', data);
   *   }
   * });
   * ```
   */
  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  /**
   * Registers a callback to receive terminal resize events.
   *
   * @param handler - The callback function receiving new dimensions
   *
   * @example
   * ```typescript
   * adapter.onResize((cols, rows) => {
   *   console.log(`Terminal resized to ${cols}x${rows}`);
   * });
   * ```
   */
  onResize(handler: (cols: number, rows: number) => void): void {
    this.resizeHandler = handler;
  }

  /**
   * The number of columns (characters per line) in the terminal.
   *
   * @returns The current column count, or 80 if not initialized
   */
  get cols(): number {
    return this.terminal?.cols ?? 80;
  }

  /**
   * The number of rows (lines) in the terminal.
   *
   * @returns The current row count, or 24 if not initialized
   */
  get rows(): number {
    return this.terminal?.rows ?? 24;
  }

  /**
   * Sets the terminal color theme.
   *
   * Since Ghostty-web doesn't fully support runtime theme changes,
   * this method recreates the terminal with the new theme.
   *
   * @param theme - The theme to apply
   *
   * @example
   * ```typescript
   * adapter.setTheme({
   *   name: 'dark',
   *   colors: {
   *     background: '#1e1e1e',
   *     foreground: '#d4d4d4',
   *     // ... other colors
   *   },
   * });
   * ```
   */
  setTheme(theme: Theme): void {
    this.currentTheme = theme;

    if (!this.initialized || !this.container) {
      return;
    }

    // Dispose the old terminal
    window.removeEventListener('resize', this.handleResize);
    this.terminal?.dispose();

    // Recreate the terminal with the new theme
    this.createTerminal();
    this.focus();
  }

  /**
   * Gets the current terminal theme.
   *
   * @returns The current theme, or null if no theme is set
   */
  getTheme(): Theme | null {
    return this.currentTheme;
  }

  /**
   * Disposes of the terminal and cleans up resources.
   *
   * After calling this method, the adapter cannot be used again.
   * Create a new instance if you need another terminal.
   *
   * @example
   * ```typescript
   * adapter.dispose();
   * // adapter is no longer usable
   * ```
   */
  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terminal?.dispose();
    this.initialized = false;
    this.container = null;
  }
}
