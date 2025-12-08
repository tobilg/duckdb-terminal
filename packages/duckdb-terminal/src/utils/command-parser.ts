/**
 * Command argument parser for dot commands.
 *
 * This module provides utilities for parsing command-line style arguments
 * with support for quoted strings and escape sequences.
 *
 * @module utils/command-parser
 */

/**
 * Result of parsing a command string.
 */
export interface ParsedCommand {
  /** The command name (first argument, lowercased) */
  command: string;
  /** The remaining arguments after the command name */
  args: string[];
  /** All arguments including the command name */
  allArgs: string[];
}

/**
 * Parses a command string into individual arguments.
 *
 * Supports:
 * - Space-separated arguments
 * - Double-quoted strings (with escape sequences)
 * - Single-quoted strings (literal, no escape processing)
 * - Escape sequences: `\n`, `\t`, `\r`, `\\`, `\"`, `\'`
 *
 * @param input - The command string to parse
 * @returns Array of parsed arguments
 *
 * @example Basic usage
 * ```typescript
 * parseArgs('.mode csv');
 * // Returns ['.mode', 'csv']
 *
 * parseArgs('.prompt "SQL> " "... "');
 * // Returns ['.prompt', 'SQL> ', '... ']
 *
 * parseArgs(".echo 'Hello\\nWorld'");
 * // Returns ['.echo', 'Hello\\nWorld'] (single quotes are literal)
 *
 * parseArgs('.echo "Hello\\nWorld"');
 * // Returns ['.echo', 'Hello\nWorld'] (double quotes process escapes)
 * ```
 */
export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let escaped = false;
  let hadQuote = false; // Track if current arg had a quoted section

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      // Handle escape sequences
      switch (char) {
        case 'n':
          current += '\n';
          break;
        case 't':
          current += '\t';
          break;
        case 'r':
          current += '\r';
          break;
        case '\\':
          current += '\\';
          break;
        case '"':
          current += '"';
          break;
        case "'":
          current += "'";
          break;
        case ' ':
          // Escaped space is literal space (doesn't split arguments)
          current += ' ';
          break;
        default:
          // For unknown escapes, include the backslash and character
          current += '\\' + char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\' && inQuote !== "'") {
      // Backslash escapes in double quotes or outside quotes
      // Single quotes are literal - no escape processing
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      // Start of quoted string
      inQuote = char;
      hadQuote = true;
      continue;
    }

    if (char === inQuote) {
      // End of quoted string
      inQuote = null;
      continue;
    }

    if (char === ' ' && !inQuote) {
      // Space outside quotes - end of argument
      if (current || hadQuote) {
        args.push(current);
        current = '';
        hadQuote = false;
      }
      continue;
    }

    current += char;
  }

  // Don't forget the last argument
  if (current || hadQuote) {
    args.push(current);
  }

  return args;
}

/**
 * Parses a command string and extracts the command name and arguments.
 *
 * @param input - The command string to parse
 * @returns Parsed command with command name and arguments
 *
 * @example
 * ```typescript
 * parseCommand('.mode csv');
 * // Returns { command: '.mode', args: ['csv'], allArgs: ['.mode', 'csv'] }
 *
 * parseCommand('.HELP');
 * // Returns { command: '.help', args: [], allArgs: ['.HELP'] }
 * ```
 */
export function parseCommand(input: string): ParsedCommand {
  const allArgs = parseArgs(input);
  const command = allArgs[0]?.toLowerCase() ?? '';
  const args = allArgs.slice(1);

  return { command, args, allArgs };
}

/**
 * Checks if a command string has unterminated quotes.
 *
 * @param input - The command string to check
 * @returns True if there are unterminated quotes
 *
 * @example
 * ```typescript
 * hasUnterminatedQuotes('.prompt "Hello');    // true
 * hasUnterminatedQuotes(".prompt 'Hello");    // true
 * hasUnterminatedQuotes('.prompt "Hello"');   // false
 * ```
 */
export function hasUnterminatedQuotes(input: string): boolean {
  let inQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inQuote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = char;
      continue;
    }

    if (char === inQuote) {
      inQuote = null;
      continue;
    }
  }

  return inQuote !== null;
}
