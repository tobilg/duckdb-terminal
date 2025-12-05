import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @duckdb/duckdb-wasm
const mockQuery = vi.fn();
const mockClose = vi.fn();
const mockTerminate = vi.fn();
const mockConnect = vi.fn();
const mockOpen = vi.fn();
const mockRegisterFileBuffer = vi.fn();
const mockDropFile = vi.fn();

vi.mock('@duckdb/duckdb-wasm', () => ({
  getJsDelivrBundles: vi.fn(() => ({
    mainModule: 'mock-module',
    mainWorker: 'mock-worker',
    pthreadWorker: 'mock-pthread',
  })),
  selectBundle: vi.fn().mockResolvedValue({
    mainModule: 'mock-module',
    mainWorker: 'mock-worker',
    pthreadWorker: 'mock-pthread',
  }),
  ConsoleLogger: vi.fn().mockImplementation(function() {}),
  AsyncDuckDB: vi.fn().mockImplementation(function() {
    return {
      instantiate: vi.fn().mockResolvedValue(undefined),
      open: mockOpen,
      connect: mockConnect.mockResolvedValue({
        query: mockQuery,
        close: mockClose,
      }),
      terminate: mockTerminate,
      registerFileBuffer: mockRegisterFileBuffer,
      dropFile: mockDropFile,
    };
  }),
  DuckDBAccessMode: {
    READ_WRITE: 1,
  },
}));

// Mock Worker
class MockWorker {
  terminate = vi.fn();
}
vi.stubGlobal('Worker', MockWorker);

// Mock URL.createObjectURL and revokeObjectURL
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

import { Database } from './database';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const database = new Database();
      expect(database.isReady()).toBe(false);
    });

    it('should accept custom options', () => {
      const database = new Database({
        storage: 'opfs',
        databasePath: '/test.db',
      });
      expect(database.isReady()).toBe(false);
    });
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      await db.init();
      expect(db.isReady()).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await db.init();
      await db.init(); // Second call should be no-op
      expect(db.isReady()).toBe(true);
    });
  });

  describe('executeQuery', () => {
    it('should throw if not initialized', async () => {
      await expect(db.executeQuery('SELECT 1')).rejects.toThrow('Database not initialized');
    });

    it('should execute query and return results', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: {
          fields: [{ name: 'result' }],
        },
        numRows: 1,
        getChildAt: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(1),
        }),
      });

      await db.init();
      const result = await db.executeQuery('SELECT 1 as result');

      expect(result.columns).toEqual(['result']);
      expect(result.rowCount).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCompletions', () => {
    it('should return empty array if not initialized', async () => {
      const suggestions = await db.getCompletions('SEL', 3);
      expect(suggestions).toEqual([]);
    });

    it('should return keyword suggestions', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_name' }] },
        numRows: 0,
        getChildAt: vi.fn().mockReturnValue({ get: vi.fn() }),
      });

      await db.init();
      const suggestions = await db.getCompletions('SEL', 3);

      expect(suggestions.some(s => s.value === 'SELECT')).toBe(true);
      expect(suggestions.some(s => s.type === 'keyword')).toBe(true);
    });

    it('should return empty for empty prefix', async () => {
      await db.init();
      const suggestions = await db.getCompletions('', 0);
      expect(suggestions).toEqual([]);
    });

    it('should return function suggestions', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_name' }] },
        numRows: 0,
        getChildAt: vi.fn().mockReturnValue({ get: vi.fn() }),
      });

      await db.init();
      const suggestions = await db.getCompletions('abs', 3);

      expect(suggestions.some(s => s.value === 'abs')).toBe(true);
      expect(suggestions.some(s => s.type === 'function')).toBe(true);
    });
  });

  describe('getTables', () => {
    it('should return empty array if not initialized', async () => {
      const tables = await db.getTables();
      expect(tables).toEqual([]);
    });

    it('should return table names', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_name' }] },
        numRows: 2,
        getChildAt: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation((i: number) => ['users', 'products'][i]),
        }),
      });

      await db.init();
      const tables = await db.getTables();

      expect(tables).toEqual(['users', 'products']);
    });
  });

  describe('getTableSchema', () => {
    it('should return empty array if not initialized', async () => {
      const schema = await db.getTableSchema('users');
      expect(schema).toEqual([]);
    });

    it('should return column info', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'column_name' }, { name: 'data_type' }] },
        numRows: 2,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['id', 'INTEGER'],
              ['name', 'VARCHAR'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const schema = await db.getTableSchema('users');

      expect(schema).toEqual([
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'VARCHAR' },
      ]);
    });

    it('should escape single quotes in table name to prevent SQL injection', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'column_name' }, { name: 'data_type' }] },
        numRows: 0,
        getChildAt: vi.fn().mockImplementation(() => ({
          get: vi.fn().mockReturnValue(null),
        })),
      });

      await db.init();
      await db.getTableSchema("users'; DROP TABLE users; --");

      // Verify the escaped query was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("users''; DROP TABLE users; --")
      );
    });
  });

  describe('registerFile', () => {
    it('should throw if not initialized', async () => {
      await expect(db.registerFile('test.csv', new Uint8Array())).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('should register file successfully', async () => {
      await db.init();
      await db.registerFile('test.csv', new Uint8Array([1, 2, 3]));
      expect(mockRegisterFileBuffer).toHaveBeenCalledWith('test.csv', expect.any(Uint8Array));
    });
  });

  describe('dropFile', () => {
    it('should throw if not initialized', async () => {
      await expect(db.dropFile('test.csv')).rejects.toThrow('Database not initialized');
    });

    it('should drop file successfully', async () => {
      await db.init();
      await db.dropFile('test.csv');
      expect(mockDropFile).toHaveBeenCalledWith('test.csv');
    });
  });

  describe('isReady', () => {
    it('should return false before init', () => {
      expect(db.isReady()).toBe(false);
    });

    it('should return true after init', async () => {
      await db.init();
      expect(db.isReady()).toBe(true);
    });

    it('should return false after close', async () => {
      await db.init();
      await db.close();
      expect(db.isReady()).toBe(false);
    });
  });

  describe('close', () => {
    it('should close without error', async () => {
      await db.init();
      await expect(db.close()).resolves.not.toThrow();
    });

    it('should handle close when not initialized', async () => {
      await expect(db.close()).resolves.not.toThrow();
    });
  });
});
