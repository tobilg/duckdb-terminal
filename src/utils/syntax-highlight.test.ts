import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { highlightSQL, isSQLComplete, type DuckDBToken } from './syntax-highlight';
import { debounce } from './debounce';
import { stripAnsiCodes, visibleLength } from './vt100';

describe('syntax-highlight', () => {
  describe('highlightSQL', () => {
    it('should return original SQL when tokens is empty', () => {
      const sql = 'SELECT * FROM users';
      const result = highlightSQL(sql, []);
      expect(result).toBe(sql);
    });

    it('should highlight keywords in blue', () => {
      const sql = 'SELECT';
      const tokens: DuckDBToken[] = [{ position: 0, category: 'KEYWORD' }];
      const result = highlightSQL(sql, tokens);
      // Blue ANSI code is \x1b[34m
      expect(result).toContain('\x1b[34m');
    });

    it('should highlight strings in green', () => {
      const sql = "'hello'";
      const tokens: DuckDBToken[] = [{ position: 0, category: 'STRING_CONSTANT' }];
      const result = highlightSQL(sql, tokens);
      // Green ANSI code is \x1b[32m
      expect(result).toContain('\x1b[32m');
    });

    it('should highlight numbers in magenta', () => {
      const sql = '123';
      const tokens: DuckDBToken[] = [{ position: 0, category: 'NUMERIC_CONSTANT' }];
      const result = highlightSQL(sql, tokens);
      // Magenta ANSI code is \x1b[35m
      expect(result).toContain('\x1b[35m');
    });

    it('should highlight comments in bright black', () => {
      const sql = '-- comment';
      const tokens: DuckDBToken[] = [{ position: 0, category: 'COMMENT' }];
      const result = highlightSQL(sql, tokens);
      // Bright black ANSI code is \x1b[90m
      expect(result).toContain('\x1b[90m');
    });

    it('should highlight errors in red', () => {
      const sql = '@#$';
      const tokens: DuckDBToken[] = [{ position: 0, category: 'ERROR' }];
      const result = highlightSQL(sql, tokens);
      // Red ANSI code is \x1b[31m
      expect(result).toContain('\x1b[31m');
    });

    it('should not add color for identifiers', () => {
      const sql = 'users';
      const tokens: DuckDBToken[] = [{ position: 0, category: 'IDENTIFIER' }];
      const result = highlightSQL(sql, tokens);
      // Should not contain color codes for identifiers
      expect(result).toBe('users');
    });

    it('should handle multiple tokens', () => {
      const sql = 'SELECT * FROM users';
      const tokens: DuckDBToken[] = [
        { position: 0, category: 'KEYWORD' },   // SELECT
        { position: 6, category: 'OPERATOR' },  // space
        { position: 7, category: 'OPERATOR' },  // *
        { position: 8, category: 'OPERATOR' },  // space
        { position: 9, category: 'KEYWORD' },   // FROM
        { position: 13, category: 'OPERATOR' }, // space
        { position: 14, category: 'IDENTIFIER' }, // users
      ];
      const result = highlightSQL(sql, tokens);
      // Should contain ANSI codes
      expect(result).toContain('\x1b[');
      // Should preserve visible content
      expect(stripAnsiCodes(result)).toBe(sql);
    });

    it('should preserve original text when stripped of ANSI codes', () => {
      const sql = 'SELECT id, name FROM users WHERE age > 18;';
      const tokens: DuckDBToken[] = [
        { position: 0, category: 'KEYWORD' },    // SELECT
        { position: 6, category: 'OPERATOR' },   // space
        { position: 7, category: 'IDENTIFIER' }, // id
        { position: 9, category: 'OPERATOR' },   // ,
        { position: 10, category: 'OPERATOR' },  // space
        { position: 11, category: 'IDENTIFIER' },// name
        { position: 15, category: 'OPERATOR' },  // space
        { position: 16, category: 'KEYWORD' },   // FROM
        { position: 20, category: 'OPERATOR' },  // space
        { position: 21, category: 'IDENTIFIER' },// users
        { position: 26, category: 'OPERATOR' },  // space
        { position: 27, category: 'KEYWORD' },   // WHERE
        { position: 32, category: 'OPERATOR' },  // space
        { position: 33, category: 'IDENTIFIER' },// age
        { position: 36, category: 'OPERATOR' },  // space
        { position: 37, category: 'OPERATOR' },  // >
        { position: 38, category: 'OPERATOR' },  // space
        { position: 39, category: 'NUMERIC_CONSTANT' }, // 18
        { position: 41, category: 'OPERATOR' },  // ;
      ];
      const result = highlightSQL(sql, tokens);
      expect(stripAnsiCodes(result)).toBe(sql);
      expect(visibleLength(result)).toBe(sql.length);
    });
  });

  describe('isSQLComplete', () => {
    it('should return true for statement ending with semicolon', () => {
      expect(isSQLComplete('SELECT * FROM users;')).toBe(true);
    });

    it('should return false for statement without semicolon', () => {
      expect(isSQLComplete('SELECT * FROM users')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isSQLComplete('')).toBe(false);
    });

    it('should return false for whitespace only', () => {
      expect(isSQLComplete('   ')).toBe(false);
    });

    it('should return true for statement with trailing whitespace', () => {
      expect(isSQLComplete('SELECT * FROM users;  ')).toBe(true);
    });

    it('should handle multi-line SQL', () => {
      const sql = `SELECT *
FROM users
WHERE id = 1;`;
      expect(isSQLComplete(sql)).toBe(true);
    });

    it('should return true for semicolon after comment', () => {
      expect(isSQLComplete('SELECT * -- comment\n;')).toBe(true);
    });

    it('should handle multiple statements', () => {
      expect(isSQLComplete('SELECT 1; SELECT 2;')).toBe(true);
    });

    it('should return false for semicolon inside string', () => {
      expect(isSQLComplete("SELECT 'semi;colon'")).toBe(false);
    });

    it('should return true for statement after string with semicolon', () => {
      expect(isSQLComplete("SELECT 'semi;colon';")).toBe(true);
    });

    it('should handle escaped quotes in strings', () => {
      expect(isSQLComplete("SELECT 'it''s a test'")).toBe(false);
      expect(isSQLComplete("SELECT 'it''s a test';")).toBe(true);
    });

    it('should return false for semicolon inside line comment', () => {
      expect(isSQLComplete('SELECT * -- ;comment')).toBe(false);
    });

    it('should return false for semicolon inside block comment', () => {
      expect(isSQLComplete('SELECT * /* ; */ FROM')).toBe(false);
    });

    it('should return true for statement after block comment', () => {
      expect(isSQLComplete('SELECT * /* comment */ FROM users;')).toBe(true);
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should delay function execution', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous call when called again', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(50);
      debounced(); // Reset the timer
      vi.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to the function', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('arg1', 'arg2');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should use last arguments when called multiple times', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('first');
      debounced('second');
      debounced('third');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('third');
    });

    it('should allow multiple separate calls after delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('first');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);

      debounced('second');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
