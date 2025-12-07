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
  private mobileInput: HTMLTextAreaElement | null = null;

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

    // Set up Safari clipboard workaround
    // Safari requires clipboard operations to happen synchronously within a user gesture
    this.setupSafariClipboardWorkaround();

    // Set up mobile keyboard input helper
    this.setupMobileInput();
  }

  /**
   * Sets up a workaround for Safari's clipboard restrictions.
   *
   * Safari requires clipboard operations to happen synchronously within a user gesture.
   * The async Clipboard API loses the gesture context after an await, causing copy to fail.
   * This workaround intercepts Cmd+C and uses the synchronous execCommand method.
   *
   * @internal
   */
  private setupSafariClipboardWorkaround(): void {
    if (!this.terminal) return;

    // Use attachCustomKeyEventHandler to intercept Cmd+C
    (this.terminal as any).attachCustomKeyEventHandler?.((event: KeyboardEvent) => {
      // Only handle Cmd+C (Mac) - Ctrl+C should still send interrupt
      if (event.metaKey && event.code === 'KeyC' && event.type === 'keydown') {
        // Check if there's a selection in the terminal
        const selection = (this.terminal as any).getSelection?.() as string | undefined;
        if (selection && selection.length > 0) {
          // Copy using synchronous execCommand (works in Safari)
          this.copyToClipboardSync(selection);
          return true; // Prevent default handling
        }
      }
      return false; // Let other keys pass through
    });
  }

  /**
   * Copies text to clipboard using synchronous methods that work in Safari.
   *
   * @internal
   * @param text - The text to copy to clipboard
   */
  private copyToClipboardSync(text: string): void {
    // Create a temporary textarea for the copy operation
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';

    document.body.appendChild(textarea);

    const previouslyFocused = document.activeElement as HTMLElement;

    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      // execCommand is synchronous and works in Safari within a user gesture
      const success = document.execCommand('copy');

      if (!success) {
        // Fallback to ClipboardItem API (also Safari-compatible when called synchronously)
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          const blob = new Blob([text], { type: 'text/plain' });
          const clipboardItem = new ClipboardItem({ 'text/plain': blob });
          navigator.clipboard.write([clipboardItem]).catch(() => {
            // Silent fail - user can try again
          });
        }
      }
    } finally {
      document.body.removeChild(textarea);
      // Restore focus to the terminal
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    }
  }

  /**
   * Sets up mobile-specific functionality: touch scrolling and keyboard input.
   * @internal
   */
  private setupMobileInput(): void {
    if (!this.container) return;

    // Only set up on touch devices
    if (!this.isTouchDevice()) return;

    // Set up touch scrolling on the container
    this.setupTouchScrolling();

    // Set up mobile keyboard input
    this.setupMobileKeyboard();
  }

  /**
   * Creates a hidden textarea for mobile keyboard input.
   * Appended to document.body to avoid interfering with terminal touch events.
   * @internal
   */
  private setupMobileKeyboard(): void {
    // Remove existing mobile input if present
    this.mobileInput?.remove();

    // Create textarea for mobile keyboard - append to body, not container
    const input = document.createElement('textarea');
    input.className = 'mobile-keyboard-input';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'send');
    input.setAttribute('aria-label', 'Terminal input');

    // Position fixed at bottom of screen, tiny but not zero-sized
    // iOS requires non-zero size for keyboard to appear
    input.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 1px;
      height: 1px;
      opacity: 0;
      font-size: 16px;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: transparent;
      z-index: -1;
    `;

    // Handle input from mobile keyboard
    input.addEventListener('input', () => {
      const value = input.value;
      if (value && this.dataHandler) {
        this.dataHandler(value);
      }
      // Clear immediately to prevent accumulation
      input.value = '';
    });

    // Handle special keys (Enter, Backspace, etc.)
    input.addEventListener('keydown', (e) => {
      // Let the input event handle regular characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        this.dataHandler?.('\r');
        input.value = '';
        // Dismiss virtual keyboard after sending command
        input.blur();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.dataHandler?.('\x7f');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.dataHandler?.('\t');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.dataHandler?.('\x1b[A');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.dataHandler?.('\x1b[B');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.dataHandler?.('\x1b[D');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.dataHandler?.('\x1b[C');
      }
    });

    // Append to body, not container - this is crucial!
    document.body.appendChild(input);
    this.mobileInput = input;
  }

  /**
   * Sets up touch-based scrolling for the terminal.
   * Translates touch gestures into scroll commands.
   * @internal
   */
  private setupTouchScrolling(): void {
    if (!this.container) return;

    let touchStartY = 0;
    let lastTouchY = 0;
    let isTouchScrolling = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        lastTouchY = touchStartY;
        isTouchScrolling = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const deltaY = lastTouchY - currentY;

      // Only start scrolling if there's significant movement
      if (!isTouchScrolling && Math.abs(currentY - touchStartY) > 10) {
        isTouchScrolling = true;
      }

      if (isTouchScrolling) {
        // Prevent default to stop page scrolling
        e.preventDefault();

        // Scroll the terminal - use scrollLines if available on terminal
        // deltaY > 0 means scrolling up (finger moving up), show older content
        // deltaY < 0 means scrolling down (finger moving down), show newer content
        const lines = Math.round(deltaY / 20); // ~20px per line
        if (lines !== 0 && this.terminal) {
          // Use the terminal's scroll method
          (this.terminal as any).scrollLines?.(lines);
        }

        lastTouchY = currentY;
      }
    };

    const handleTouchEnd = () => {
      isTouchScrolling = false;
    };

    this.container.addEventListener('touchstart', handleTouchStart, { passive: true });
    this.container.addEventListener('touchmove', handleTouchMove, { passive: false });
    this.container.addEventListener('touchend', handleTouchEnd, { passive: true });
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
   * On mobile devices, focuses the hidden input to trigger the virtual keyboard.
   *
   * @example
   * ```typescript
   * adapter.focus();
   * ```
   */
  focus(): void {
    // On touch devices, focus the mobile input to trigger virtual keyboard
    if (this.mobileInput && this.isTouchDevice()) {
      this.mobileInput.focus();
    } else {
      this.terminal?.focus();
    }
  }

  /**
   * Checks if the current device supports touch input.
   * @internal
   */
  private isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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
    this.mobileInput?.remove();
    this.mobileInput = null;
    this.terminal?.dispose();
    this.initialized = false;
    this.container = null;
  }
}
