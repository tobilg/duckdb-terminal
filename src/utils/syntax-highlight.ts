/**
 * SQL Syntax Highlighting
 */

import * as vt100 from './vt100';

// SQL Keywords
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'USING',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'EXCEPT', 'INTERSECT', 'ALL', 'DISTINCT',
  'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'BETWEEN', 'LIKE', 'ILIKE', 'EXISTS', 'ANY', 'SOME',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'WITH', 'RECURSIVE', 'OVER', 'PARTITION', 'WINDOW',
  'CAST', 'COALESCE', 'NULLIF', 'EXTRACT', 'INTERVAL',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'CONSTRAINT', 'CASCADE', 'RESTRICT', 'NO', 'ACTION',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT',
  'GRANT', 'REVOKE', 'PRIVILEGES', 'TO', 'PUBLIC',
  'IF', 'REPLACE', 'TEMPORARY', 'TEMP', 'VIRTUAL', 'MATERIALIZED',
]);

// SQL Data Types
const TYPES = new Set([
  'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'HUGEINT',
  'FLOAT', 'DOUBLE', 'REAL', 'DECIMAL', 'NUMERIC',
  'VARCHAR', 'CHAR', 'TEXT', 'STRING', 'BLOB', 'BYTEA',
  'BOOLEAN', 'BOOL', 'BIT',
  'DATE', 'TIME', 'TIMESTAMP', 'DATETIME', 'TIMESTAMPTZ',
  'UUID', 'JSON', 'ARRAY', 'LIST', 'MAP', 'STRUCT',
]);

// SQL Functions
const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TOTAL',
  'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC', 'TRUNCATE',
  'SQRT', 'POWER', 'POW', 'EXP', 'LOG', 'LOG10', 'LOG2', 'LN',
  'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2',
  'LENGTH', 'CHAR_LENGTH', 'OCTET_LENGTH', 'BIT_LENGTH',
  'UPPER', 'LOWER', 'INITCAP', 'TRIM', 'LTRIM', 'RTRIM',
  'SUBSTR', 'SUBSTRING', 'LEFT', 'RIGHT', 'LPAD', 'RPAD',
  'CONCAT', 'CONCAT_WS', 'REPLACE', 'REVERSE', 'REPEAT',
  'POSITION', 'STRPOS', 'INSTR', 'LOCATE',
  'SPLIT_PART', 'STRING_SPLIT', 'STRING_AGG', 'LISTAGG', 'ARRAY_AGG',
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'DATE_PART', 'DATE_TRUNC', 'DATE_DIFF', 'DATE_ADD', 'DATE_SUB',
  'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'COALESCE', 'NULLIF', 'IFNULL', 'NVL', 'IIF',
  'GREATEST', 'LEAST', 'RANDOM', 'SETSEED',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  'TYPEOF', 'TRY_CAST', 'UNNEST', 'GENERATE_SERIES', 'RANGE',
  'READ_CSV', 'READ_PARQUET', 'READ_JSON',
]);

// Token types
export type TokenType = 'keyword' | 'type' | 'function' | 'string' | 'number' | 'comment' | 'operator' | 'identifier' | 'whitespace';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

/**
 * Tokenize SQL string
 */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < sql.length) {
    const char = sql[pos];

    // Whitespace
    if (/\s/.test(char)) {
      const start = pos;
      while (pos < sql.length && /\s/.test(sql[pos])) {
        pos++;
      }
      tokens.push({ type: 'whitespace', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // Single-line comment
    if (sql.slice(pos, pos + 2) === '--') {
      const start = pos;
      while (pos < sql.length && sql[pos] !== '\n') {
        pos++;
      }
      tokens.push({ type: 'comment', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // Multi-line comment
    if (sql.slice(pos, pos + 2) === '/*') {
      const start = pos;
      pos += 2;
      while (pos < sql.length - 1 && sql.slice(pos, pos + 2) !== '*/') {
        pos++;
      }
      pos += 2;
      tokens.push({ type: 'comment', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // String (single quote)
    if (char === "'") {
      const start = pos;
      pos++;
      while (pos < sql.length) {
        if (sql[pos] === "'" && sql[pos + 1] === "'") {
          pos += 2; // Escaped quote
        } else if (sql[pos] === "'") {
          pos++;
          break;
        } else {
          pos++;
        }
      }
      tokens.push({ type: 'string', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // String (double quote - identifier)
    if (char === '"') {
      const start = pos;
      pos++;
      while (pos < sql.length && sql[pos] !== '"') {
        pos++;
      }
      pos++;
      tokens.push({ type: 'identifier', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // Number
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[pos + 1] || ''))) {
      const start = pos;
      // Integer part
      while (pos < sql.length && /[0-9]/.test(sql[pos])) {
        pos++;
      }
      // Decimal part
      if (sql[pos] === '.' && /[0-9]/.test(sql[pos + 1] || '')) {
        pos++;
        while (pos < sql.length && /[0-9]/.test(sql[pos])) {
          pos++;
        }
      }
      // Exponent part
      if (sql[pos] === 'e' || sql[pos] === 'E') {
        pos++;
        if (sql[pos] === '+' || sql[pos] === '-') {
          pos++;
        }
        while (pos < sql.length && /[0-9]/.test(sql[pos])) {
          pos++;
        }
      }
      tokens.push({ type: 'number', value: sql.slice(start, pos), start, end: pos });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(char)) {
      const start = pos;
      while (pos < sql.length && /[a-zA-Z0-9_]/.test(sql[pos])) {
        pos++;
      }
      const value = sql.slice(start, pos);
      const upper = value.toUpperCase();

      let type: TokenType = 'identifier';
      if (KEYWORDS.has(upper)) {
        type = 'keyword';
      } else if (TYPES.has(upper)) {
        type = 'type';
      } else if (FUNCTIONS.has(upper)) {
        type = 'function';
      }

      tokens.push({ type, value, start, end: pos });
      continue;
    }

    // Operators and punctuation
    const start = pos;
    pos++;
    tokens.push({ type: 'operator', value: sql.slice(start, pos), start, end: pos });
  }

  return tokens;
}

/**
 * Get color for token type
 */
function getTokenColor(type: TokenType): string {
  switch (type) {
    case 'keyword':
      return vt100.FG_BLUE;
    case 'type':
      return vt100.FG_CYAN;
    case 'function':
      return vt100.FG_YELLOW;
    case 'string':
      return vt100.FG_GREEN;
    case 'number':
      return vt100.FG_MAGENTA;
    case 'comment':
      return vt100.FG_BRIGHT_BLACK;
    case 'operator':
      return vt100.FG_WHITE;
    case 'identifier':
    case 'whitespace':
    default:
      return '';
  }
}

/**
 * Highlight SQL string with ANSI colors
 */
export function highlightSQL(sql: string): string {
  const tokens = tokenize(sql);
  let result = '';

  for (const token of tokens) {
    const color = getTokenColor(token.type);
    if (color) {
      result += color + token.value + vt100.RESET;
    } else {
      result += token.value;
    }
  }

  return result;
}

/**
 * Check if SQL appears complete (ends with semicolon outside of string/comment)
 */
export function isSQLComplete(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;

  const tokens = tokenize(trimmed);
  const lastNonWhitespace = [...tokens].reverse().find(t => t.type !== 'whitespace');

  return lastNonWhitespace?.value === ';';
}

// Note: debounce function moved to ./debounce.ts for reusability
