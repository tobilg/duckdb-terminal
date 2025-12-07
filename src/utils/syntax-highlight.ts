/**
 * SQL Syntax Highlighting using DuckDB's internal tokenizer
 */

import * as vt100 from './vt100';

/**
 * Map DuckDB token category to color
 */
function getDuckDBTokenColor(category: string): string {
  switch (category) {
    case 'KEYWORD':
      return vt100.FG_BLUE;
    case 'IDENTIFIER':
      return ''; // No color for identifiers
    case 'OPERATOR':
      return vt100.FG_WHITE;
    case 'NUMERIC_CONSTANT':
      return vt100.FG_MAGENTA;
    case 'STRING_CONSTANT':
      return vt100.FG_GREEN;
    case 'COMMENT':
      return vt100.FG_BRIGHT_BLACK;
    case 'ERROR':
      return vt100.FG_RED;
    default:
      return '';
  }
}

/**
 * Token from DuckDB's tokenize_sql() function
 */
export interface DuckDBToken {
  position: number;
  category: string;
}

/**
 * Highlight SQL string using DuckDB tokens from tokenize_sql()
 *
 * This function takes the SQL string and pre-fetched tokens from DuckDB's
 * tokenize_sql() function and applies ANSI color codes.
 *
 * @param sql - The SQL string to highlight
 * @param tokens - Array of tokens from DuckDB's tokenize_sql()
 * @returns The SQL string with ANSI color codes applied
 */
export function highlightSQL(sql: string, tokens: DuckDBToken[]): string {
  if (tokens.length === 0) {
    return sql;
  }

  let result = '';
  let lastEnd = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    const start = token.position;
    const end = nextToken ? nextToken.position : sql.length;

    // Add any text between last token and this one (shouldn't happen normally)
    if (start > lastEnd) {
      result += sql.slice(lastEnd, start);
    }

    // Get the token text
    const tokenText = sql.slice(start, end);
    const color = getDuckDBTokenColor(token.category);

    if (color) {
      result += color + tokenText + vt100.RESET;
    } else {
      result += tokenText;
    }

    lastEnd = end;
  }

  // Add any remaining text
  if (lastEnd < sql.length) {
    result += sql.slice(lastEnd);
  }

  return result;
}

/**
 * Check if SQL appears complete (ends with semicolon outside of string/comment)
 *
 * This is a simple heuristic that checks if the SQL ends with a semicolon,
 * accounting for strings, comments, and escaped quotes. For more robust
 * SQL validation, use Database.isValidSQL() which uses DuckDB's parser.
 */
export function isSQLComplete(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let lastNonWhitespaceChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    // Handle line comment end
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    // Handle block comment
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // Skip the '/'
      }
      continue;
    }

    // Handle single-quoted string
    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
        i++; // Skip escaped quote
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    // Handle double-quoted identifier
    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    // Check for comment starts
    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      i++; // Skip the second '-'
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++; // Skip the '*'
      continue;
    }

    // Check for string starts
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }

    // Track non-whitespace characters
    if (!/\s/.test(char)) {
      lastNonWhitespaceChar = char;
    }
  }

  return lastNonWhitespaceChar === ';';
}
