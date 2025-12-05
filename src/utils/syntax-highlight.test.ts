import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tokenize, highlightSQL, isSQLComplete } from './syntax-highlight';
import { debounce } from './debounce';
import { stripAnsiCodes, visibleLength } from './vt100';

describe('syntax-highlight', () => {
  describe('tokenize', () => {
    it('should tokenize keywords', () => {
      const tokens = tokenize('SELECT FROM WHERE');
      expect(tokens).toEqual([
        { type: 'keyword', value: 'SELECT', start: 0, end: 6 },
        { type: 'whitespace', value: ' ', start: 6, end: 7 },
        { type: 'keyword', value: 'FROM', start: 7, end: 11 },
        { type: 'whitespace', value: ' ', start: 11, end: 12 },
        { type: 'keyword', value: 'WHERE', start: 12, end: 17 },
      ]);
    });

    it('should tokenize identifiers', () => {
      const tokens = tokenize('users table_name');
      expect(tokens.filter(t => t.type === 'identifier')).toEqual([
        { type: 'identifier', value: 'users', start: 0, end: 5 },
        { type: 'identifier', value: 'table_name', start: 6, end: 16 },
      ]);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenize('123 45.67');
      expect(tokens.filter(t => t.type === 'number')).toEqual([
        { type: 'number', value: '123', start: 0, end: 3 },
        { type: 'number', value: '45.67', start: 4, end: 9 },
      ]);
    });

    it('should tokenize single-quoted strings', () => {
      const tokens = tokenize("'hello world'");
      expect(tokens.filter(t => t.type === 'string')).toEqual([
        { type: 'string', value: "'hello world'", start: 0, end: 13 },
      ]);
    });

    it('should tokenize double-quoted identifiers', () => {
      const tokens = tokenize('"column name"');
      expect(tokens.filter(t => t.type === 'identifier')).toEqual([
        { type: 'identifier', value: '"column name"', start: 0, end: 13 },
      ]);
    });

    it('should tokenize operators', () => {
      const tokens = tokenize('= < >');
      const operators = tokens.filter(t => t.type === 'operator');
      expect(operators.map(t => t.value)).toEqual(['=', '<', '>']);
    });

    it('should tokenize punctuation as operators', () => {
      const tokens = tokenize('(a, b)');
      const operators = tokens.filter(t => t.type === 'operator');
      expect(operators.map(t => t.value)).toEqual(['(', ',', ')']);
    });

    it('should tokenize single-line comments', () => {
      const tokens = tokenize('SELECT -- comment\n*');
      expect(tokens.filter(t => t.type === 'comment')).toEqual([
        { type: 'comment', value: '-- comment', start: 7, end: 17 },
      ]);
    });

    it('should tokenize SQL types as type tokens', () => {
      const tokens = tokenize('INTEGER VARCHAR BOOLEAN');
      const types = tokens.filter(t => t.type === 'type');
      expect(types.map(t => t.value)).toEqual(['INTEGER', 'VARCHAR', 'BOOLEAN']);
    });

    it('should tokenize functions', () => {
      const tokens = tokenize('COUNT(*)');
      expect(tokens.filter(t => t.type === 'function')).toEqual([
        { type: 'function', value: 'COUNT', start: 0, end: 5 },
      ]);
    });

    it('should tokenize mixed SQL statement', () => {
      const sql = "SELECT id, name FROM users WHERE age > 18;";
      const tokens = tokenize(sql);

      // Check we got the expected token types
      const types = tokens.map(t => t.type);
      expect(types).toContain('keyword');
      expect(types).toContain('identifier');
      expect(types).toContain('number');
      expect(types).toContain('operator');
    });

    it('should handle escaped quotes in strings', () => {
      const tokens = tokenize("'it''s a test'");
      expect(tokens.filter(t => t.type === 'string')).toEqual([
        { type: 'string', value: "'it''s a test'", start: 0, end: 14 },
      ]);
    });

    it('should tokenize multi-line comments', () => {
      const tokens = tokenize('SELECT /* multi\nline */ *');
      expect(tokens.filter(t => t.type === 'comment')).toEqual([
        { type: 'comment', value: '/* multi\nline */', start: 7, end: 23 },
      ]);
    });

    it('should tokenize scientific notation', () => {
      const tokens = tokenize('1e10 2.5E-3');
      const numbers = tokens.filter(t => t.type === 'number');
      expect(numbers.map(t => t.value)).toEqual(['1e10', '2.5E-3']);
    });
  });

  describe('highlightSQL', () => {
    it('should return highlighted string with ANSI codes', () => {
      const result = highlightSQL('SELECT * FROM users');
      // Should contain ANSI escape codes
      expect(result).toContain('\x1b[');
    });

    it('should highlight keywords in blue', () => {
      const result = highlightSQL('SELECT');
      // Blue ANSI code is \x1b[34m
      expect(result).toContain('\x1b[34m');
    });

    it('should highlight strings in green', () => {
      const result = highlightSQL("'hello'");
      // Green ANSI code is \x1b[32m
      expect(result).toContain('\x1b[32m');
    });

    it('should highlight numbers in magenta', () => {
      const result = highlightSQL('123');
      // Magenta ANSI code is \x1b[35m
      expect(result).toContain('\x1b[35m');
    });

    it('should preserve whitespace', () => {
      const result = highlightSQL('SELECT  *  FROM');
      // Should contain double spaces
      expect(result.replace(/\x1b\[[0-9;]*m/g, '')).toContain('  ');
    });

    it('should handle empty string', () => {
      const result = highlightSQL('');
      expect(result).toBe('');
    });

    it('should preserve original text when stripped of ANSI codes', () => {
      const sql = 'SELECT id, name FROM users WHERE age > 18;';
      const result = highlightSQL(sql);
      // Strip ANSI codes and compare using vt100 utility
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
