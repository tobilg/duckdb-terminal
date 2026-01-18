import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkProxyAvailable, fetchProviders, generateSQL, AIClientError } from './ai-client';

describe('ai-client', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('checkProxyAvailable', () => {
    it('returns true when proxy responds with ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [] }),
      });

      const result = await checkProxyAvailable('http://localhost:4000');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/providers',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns false when proxy responds with error status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await checkProxyAvailable('http://localhost:4000');

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkProxyAvailable('http://localhost:4000');

      expect(result).toBe(false);
    });

    it('normalizes endpoint URL by removing trailing slash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [] }),
      });

      await checkProxyAvailable('http://localhost:4000/');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/providers',
        expect.any(Object)
      );
    });
  });

  describe('fetchProviders', () => {
    it('fetches providers successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          providers: [
            { name: 'openai', description: 'OpenAI GPT' },
            { name: 'anthropic', description: 'Anthropic Claude' },
          ],
        }),
      });

      const providers = await fetchProviders('http://localhost:4000');

      expect(providers).toHaveLength(2);
      expect(providers[0].name).toBe('openai');
      expect(providers[1].name).toBe('anthropic');
    });

    it('returns empty array when providers is undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const providers = await fetchProviders('http://localhost:4000');

      expect(providers).toEqual([]);
    });

    it('throws AIClientError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetchProviders('http://localhost:4000')).rejects.toThrow(AIClientError);
    });

    it('throws AIClientError with status code on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      try {
        await fetchProviders('http://localhost:4000');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AIClientError);
        expect((error as AIClientError).statusCode).toBe(404);
      }
    });

    it('throws AIClientError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      await expect(fetchProviders('http://localhost:4000')).rejects.toThrow(AIClientError);
    });
  });

  describe('generateSQL', () => {
    it('generates SQL successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sql: 'SELECT * FROM users;' }),
      });

      const sql = await generateSQL(
        'http://localhost:4000',
        'CREATE TABLE users (id INT);',
        'Show all users'
      );

      expect(sql).toBe('SELECT * FROM users;');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/generate-sql',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ddl: 'CREATE TABLE users (id INT);',
            question: 'Show all users',
          }),
        })
      );
    });

    it('includes provider when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sql: 'SELECT 1;' }),
      });

      await generateSQL('http://localhost:4000', 'CREATE TABLE t (x INT);', 'Test query', 'openai');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            ddl: 'CREATE TABLE t (x INT);',
            question: 'Test query',
            provider: 'openai',
          }),
        })
      );
    });

    it('throws AIClientError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Missing required field: ddl',
      });

      await expect(
        generateSQL('http://localhost:4000', '', 'Test query')
      ).rejects.toThrow(AIClientError);
    });

    it('throws AIClientError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        generateSQL('http://localhost:4000', 'CREATE TABLE t (x INT);', 'Test')
      ).rejects.toThrow(AIClientError);
    });

    it('includes endpoint in AIClientError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      try {
        await generateSQL('http://localhost:4000', 'DDL', 'Question');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AIClientError);
        expect((error as AIClientError).endpoint).toBe('http://localhost:4000/generate-sql');
      }
    });
  });

  describe('AIClientError', () => {
    it('has correct name', () => {
      const error = new AIClientError('Test error');
      expect(error.name).toBe('AIClientError');
    });

    it('stores status code', () => {
      const error = new AIClientError('Test error', 404);
      expect(error.statusCode).toBe(404);
    });

    it('stores endpoint', () => {
      const error = new AIClientError('Test error', 404, 'http://test.com/api');
      expect(error.endpoint).toBe('http://test.com/api');
    });
  });
});
