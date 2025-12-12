/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeQueryForURL,
  decodeQueryFromURL,
  generateShareableURL,
  parseShareableURL,
  clearShareableURL,
  calculateURLLength,
  wouldExceedLimit,
  getBaseShareURL,
  getEncodedQueryLength,
  MAX_URL_LENGTH,
} from './url-encoding';

describe('url-encoding', () => {
  describe('encodeQueryForURL', () => {
    it('should encode a simple SQL query', () => {
      const query = 'SELECT * FROM users;';
      const encoded = encodeQueryForURL(query);
      // Should be URL-safe Base64 without padding
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should encode queries with special characters', () => {
      const query = "SELECT * FROM users WHERE name = 'O''Brien';";
      const encoded = encodeQueryForURL(query);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should encode queries with unicode characters', () => {
      const query = "SELECT * FROM users WHERE name = '日本語';";
      const encoded = encodeQueryForURL(query);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should produce deterministic output', () => {
      const query = 'SELECT 1;';
      const encoded1 = encodeQueryForURL(query);
      const encoded2 = encodeQueryForURL(query);
      expect(encoded1).toBe(encoded2);
    });
  });

  describe('decodeQueryFromURL', () => {
    it('should decode an encoded query', () => {
      const original = 'SELECT * FROM users;';
      const encoded = encodeQueryForURL(original);
      const decoded = decodeQueryFromURL(encoded);
      expect(decoded).toBe(original);
    });

    it('should decode queries with special characters', () => {
      const original = "SELECT * FROM users WHERE name = 'O''Brien';";
      const encoded = encodeQueryForURL(original);
      const decoded = decodeQueryFromURL(encoded);
      expect(decoded).toBe(original);
    });

    it('should decode queries with unicode characters', () => {
      const original = "SELECT * FROM users WHERE name = '日本語';";
      const encoded = encodeQueryForURL(original);
      const decoded = decodeQueryFromURL(encoded);
      expect(decoded).toBe(original);
    });

    it('should handle queries with newlines', () => {
      const original = 'SELECT\n  *\nFROM\n  users;';
      const encoded = encodeQueryForURL(original);
      const decoded = decodeQueryFromURL(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe('encode/decode roundtrip', () => {
    it('should roundtrip simple queries', () => {
      const queries = [
        'SELECT 1;',
        'SELECT * FROM users;',
        "INSERT INTO users VALUES (1, 'test');",
        'CREATE TABLE foo (id INT, name VARCHAR);',
      ];

      for (const query of queries) {
        const encoded = encodeQueryForURL(query);
        const decoded = decodeQueryFromURL(encoded);
        expect(decoded).toBe(query);
      }
    });

    it('should roundtrip complex queries', () => {
      const query = `
        SELECT
          u.id,
          u.name,
          COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.created_at > '2024-01-01'
        GROUP BY u.id, u.name
        HAVING COUNT(o.id) > 5
        ORDER BY order_count DESC;
      `;

      const encoded = encodeQueryForURL(query);
      const decoded = decodeQueryFromURL(encoded);
      expect(decoded).toBe(query);
    });
  });

  describe('getBaseShareURL', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // Delete the original location and replace with a mock
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
      } as any;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should generate base URL without port', () => {
      const baseUrl = getBaseShareURL();
      expect(baseUrl).toBe('https://example.com/#$queries=v1');
    });

    it('should include port when present', () => {
      (window.location as any).protocol = 'http:';
      (window.location as any).hostname = 'localhost';
      (window.location as any).port = '3000';

      const baseUrl = getBaseShareURL();
      expect(baseUrl).toBe('http://localhost:3000/#$queries=v1');
    });
  });

  describe('getEncodedQueryLength', () => {
    it('should return encoded length plus separator', () => {
      const query = 'SELECT 1;';
      const encoded = encodeQueryForURL(query);
      const length = getEncodedQueryLength(query);
      expect(length).toBe(encoded.length + 1); // +1 for comma separator
    });
  });

  describe('generateShareableURL', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        protocol: 'https:',
        hostname: 'terminal.example.com',
        port: '',
      } as any;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should generate URL for empty queries', () => {
      const result = generateShareableURL([]);
      expect(result.url).toBe('https://terminal.example.com/#$queries=v1');
      expect(result.queryCount).toBe(0);
    });

    it('should generate URL for single query', () => {
      const queries = ['SELECT 1;'];
      const result = generateShareableURL(queries);

      expect(result.url).toContain('https://terminal.example.com/#$queries=v1,');
      expect(result.queryCount).toBe(1);
      expect(result.characterCount).toBeGreaterThan(0);
    });

    it('should generate URL for multiple queries', () => {
      const queries = ['SELECT 1;', 'SELECT 2;', 'SELECT 3;'];
      const result = generateShareableURL(queries);

      expect(result.queryCount).toBe(3);
      // URL should contain version and 3 encoded queries separated by commas
      const parts = result.url.split(',');
      expect(parts.length).toBe(4); // v1 + 3 queries
    });
  });

  describe('calculateURLLength', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
      } as any;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should calculate correct URL length', () => {
      const queries = ['SELECT 1;'];
      const length = calculateURLLength(queries);
      const result = generateShareableURL(queries);
      expect(length).toBe(result.characterCount);
    });
  });

  describe('wouldExceedLimit', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
      } as any;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should return false for small queries', () => {
      const currentQueries = ['SELECT 1;'];
      const newQuery = 'SELECT 2;';
      expect(wouldExceedLimit(currentQueries, newQuery)).toBe(false);
    });

    it('should return true when limit would be exceeded', () => {
      // Create a very long query that would exceed the limit
      const longQuery = 'SELECT ' + 'a'.repeat(2000) + ';';
      expect(wouldExceedLimit([], longQuery)).toBe(true);
    });

    it('should use custom limit', () => {
      const currentQueries = ['SELECT 1;', 'SELECT 2;'];
      const newQuery = 'SELECT 3;';
      // Set a very low limit
      expect(wouldExceedLimit(currentQueries, newQuery, 50)).toBe(true);
    });
  });

  describe('parseShareableURL', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        hash: '',
      } as any;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should return null for non-sharing URL', () => {
      window.location.hash = '';
      expect(parseShareableURL()).toBe(null);

      window.location.hash = '#other';
      expect(parseShareableURL()).toBe(null);
    });

    it('should return null for empty queries', () => {
      window.location.hash = '#$queries=v1';
      expect(parseShareableURL()).toBe(null);
    });

    it('should parse single query', () => {
      const query = 'SELECT 1;';
      const encoded = encodeQueryForURL(query);
      window.location.hash = `#$queries=v1,${encoded}`;

      const queries = parseShareableURL();
      expect(queries).toEqual([query]);
    });

    it('should parse multiple queries', () => {
      const query1 = 'SELECT 1;';
      const query2 = 'SELECT 2;';
      const encoded1 = encodeQueryForURL(query1);
      const encoded2 = encodeQueryForURL(query2);
      window.location.hash = `#$queries=v1,${encoded1},${encoded2}`;

      const queries = parseShareableURL();
      expect(queries).toEqual([query1, query2]);
    });

    it('should return null for unsupported version', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.location.hash = '#$queries=v2,test';

      expect(parseShareableURL()).toBe(null);
      expect(consoleSpy).toHaveBeenCalledWith('Unsupported sharing URL version: v2');

      consoleSpy.mockRestore();
    });

    it('should return null for invalid encoded data', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      window.location.hash = '#$queries=v1,!!!invalid!!!';

      expect(parseShareableURL()).toBe(null);

      consoleSpy.mockRestore();
    });
  });

  describe('clearShareableURL', () => {
    const originalLocation = window.location;
    const originalHistory = window.history;

    beforeEach(() => {
      delete (window as any).location;
      window.location = {
        ...originalLocation,
        protocol: 'https:',
        hostname: 'example.com',
        port: '',
        pathname: '/',
      } as any;

      // Mock history.replaceState
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    });

    afterEach(() => {
      window.location = originalLocation;
      vi.restoreAllMocks();
    });

    it('should clear URL hash using replaceState', () => {
      clearShareableURL();

      expect(window.history.replaceState).toHaveBeenCalledWith(null, '', 'https://example.com/');
    });

    it('should preserve pathname when clearing', () => {
      (window.location as any).pathname = '/app/';
      clearShareableURL();

      expect(window.history.replaceState).toHaveBeenCalledWith(null, '', 'https://example.com/app/');
    });

    it('should include port when present', () => {
      (window.location as any).port = '3000';
      clearShareableURL();

      expect(window.history.replaceState).toHaveBeenCalledWith(null, '', 'https://example.com:3000/');
    });
  });

  describe('MAX_URL_LENGTH', () => {
    it('should be 2000', () => {
      expect(MAX_URL_LENGTH).toBe(2000);
    });
  });
});
