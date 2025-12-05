/**
 * VT100/ANSI escape code utilities
 */

// Reset
export const RESET = '\x1b[0m';

// Text styles
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const ITALIC = '\x1b[3m';
export const UNDERLINE = '\x1b[4m';

// Foreground colors
export const FG_BLACK = '\x1b[30m';
export const FG_RED = '\x1b[31m';
export const FG_GREEN = '\x1b[32m';
export const FG_YELLOW = '\x1b[33m';
export const FG_BLUE = '\x1b[34m';
export const FG_MAGENTA = '\x1b[35m';
export const FG_CYAN = '\x1b[36m';
export const FG_WHITE = '\x1b[37m';

// Bright foreground colors
export const FG_BRIGHT_BLACK = '\x1b[90m';
export const FG_BRIGHT_RED = '\x1b[91m';
export const FG_BRIGHT_GREEN = '\x1b[92m';
export const FG_BRIGHT_YELLOW = '\x1b[93m';
export const FG_BRIGHT_BLUE = '\x1b[94m';
export const FG_BRIGHT_MAGENTA = '\x1b[95m';
export const FG_BRIGHT_CYAN = '\x1b[96m';
export const FG_BRIGHT_WHITE = '\x1b[97m';

// Background colors
export const BG_BLACK = '\x1b[40m';
export const BG_RED = '\x1b[41m';
export const BG_GREEN = '\x1b[42m';
export const BG_YELLOW = '\x1b[43m';
export const BG_BLUE = '\x1b[44m';
export const BG_MAGENTA = '\x1b[45m';
export const BG_CYAN = '\x1b[46m';
export const BG_WHITE = '\x1b[47m';

// Cursor movement
export const CURSOR_UP = '\x1b[A';
export const CURSOR_DOWN = '\x1b[B';
export const CURSOR_RIGHT = '\x1b[C';
export const CURSOR_LEFT = '\x1b[D';
export const CURSOR_HOME = '\x1b[H';
export const CURSOR_SAVE = '\x1b[s';
export const CURSOR_RESTORE = '\x1b[u';

// Clear
export const CLEAR_SCREEN = '\x1b[2J';
export const CLEAR_LINE = '\x1b[2K';
export const CLEAR_TO_END = '\x1b[K';
export const CLEAR_TO_START = '\x1b[1K';

/**
 * Move cursor to specific position
 */
export function cursorTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/**
 * Move cursor up N lines
 */
export function cursorUp(n: number): string {
  return `\x1b[${n}A`;
}

/**
 * Move cursor down N lines
 */
export function cursorDown(n: number): string {
  return `\x1b[${n}B`;
}

/**
 * Move cursor right N columns
 */
export function cursorRight(n: number): string {
  return `\x1b[${n}C`;
}

/**
 * Move cursor left N columns
 */
export function cursorLeft(n: number): string {
  return `\x1b[${n}D`;
}

/**
 * Move cursor to column N
 */
export function cursorColumn(n: number): string {
  return `\x1b[${n}G`;
}

/**
 * Hide cursor
 */
export const CURSOR_HIDE = '\x1b[?25l';

/**
 * Show cursor
 */
export const CURSOR_SHOW = '\x1b[?25h';

/**
 * Map of named colors to their VT100 escape codes.
 * Allows using simple color names like 'red' instead of VT100 constants.
 */
const namedColors: Record<string, string> = {
  black: FG_BLACK,
  red: FG_RED,
  green: FG_GREEN,
  yellow: FG_YELLOW,
  blue: FG_BLUE,
  magenta: FG_MAGENTA,
  cyan: FG_CYAN,
  white: FG_WHITE,
  brightBlack: FG_BRIGHT_BLACK,
  brightRed: FG_BRIGHT_RED,
  brightGreen: FG_BRIGHT_GREEN,
  brightYellow: FG_BRIGHT_YELLOW,
  brightBlue: FG_BRIGHT_BLUE,
  brightMagenta: FG_BRIGHT_MAGENTA,
  brightCyan: FG_BRIGHT_CYAN,
  brightWhite: FG_BRIGHT_WHITE,
};

/**
 * Apply color to text.
 * Accepts either a VT100 escape code constant (e.g., FG_RED) or a named color string (e.g., 'red').
 *
 * @param text - The text to colorize
 * @param color - Either a VT100 escape code or a named color ('red', 'green', 'yellow', 'blue', 'cyan', 'magenta', 'white', 'black', or 'bright' variants)
 * @returns The text wrapped with the color escape codes
 *
 * @example
 * // Using VT100 constants
 * colorize('Error', FG_RED)
 *
 * @example
 * // Using named colors
 * colorize('Success', 'green')
 */
export function colorize(text: string, color: string): string {
  const colorCode = namedColors[color] || color;
  return `${colorCode}${text}${RESET}`;
}

/**
 * Apply bold style
 */
export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

/**
 * Apply dim style
 */
export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

/**
 * Strip ANSI escape codes from a string
 * Returns the visible text without any formatting codes
 */
export function stripAnsiCodes(text: string): string {
  // Match all ANSI escape sequences:
  // - CSI sequences: \x1b[ followed by params and a letter
  // - OSC sequences: \x1b] followed by content and terminator
  // - Simple escapes: \x1b followed by a single character
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g, '');
}

/**
 * Get the visible length of a string (excluding ANSI codes)
 */
export function visibleLength(text: string): number {
  return stripAnsiCodes(text).length;
}
