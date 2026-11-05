import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @duckdb/duckdb-wasm
const mockQuery = vi.fn();
const mockSettingsQuery = vi.fn();
const mockReaderOpen = vi.fn();

function createMockAsyncReader(schema: unknown, getBatches: () => unknown[]) {
  let openedSchema: unknown;
  const reader = {
    get schema() {
      return openedSchema;
    },
    open: vi.fn(async () => {
      mockReaderOpen();
      openedSchema = schema;
      return reader;
    }),
    async *[Symbol.asyncIterator]() {
      for (const batch of getBatches()) {
        yield batch;
      }
    },
  };
  return reader;
}

const mockSend = vi.fn(async (sql: string) => {
  const result = await mockQuery(sql);
  return createMockAsyncReader(result.schema, () => [result]);
});
const mockCancelSent = vi.fn();
const mockPrepare = vi.fn();
const mockClose = vi.fn();
const mockTerminate = vi.fn();
const mockConnect = vi.fn();
const mockOpen = vi.fn();
const mockInstantiate = vi.fn();
const mockRegisterFileBuffer = vi.fn();
const mockDropFile = vi.fn();
const mockDefaultBundles = {
  mvp: {
    mainModule: 'mock-mvp-module',
    mainWorker: 'mock-mvp-worker',
  },
  eh: {
    mainModule: 'mock-eh-module',
    mainWorker: 'mock-eh-worker',
  },
};
const mockSelectBundle = vi.fn();

vi.mock('@duckdb/duckdb-wasm', () => ({
  getJsDelivrBundles: vi.fn(() => mockDefaultBundles),
  selectBundle: (...args: unknown[]) => mockSelectBundle(...args),
  ConsoleLogger: vi.fn().mockImplementation(function() {}),
  VoidLogger: vi.fn().mockImplementation(function() {}),
  AsyncDuckDB: vi.fn().mockImplementation(function() {
    return {
      instantiate: mockInstantiate,
      open: mockOpen,
      connect: mockConnect.mockResolvedValue({
        query: mockSettingsQuery,
        send: mockSend,
        cancelSent: mockCancelSent,
        prepare: mockPrepare,
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
const mockWorkerConstructor = vi.fn();
class MockWorker {
  constructor(url: string | URL) {
    mockWorkerConstructor(url);
  }

  terminate = vi.fn();
}
vi.stubGlobal('Worker', MockWorker);

// Mock URL.createObjectURL and revokeObjectURL
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

import { Database } from './database';

function createMockBatch(rows: unknown[][]) {
  return {
    numRows: rows.length,
    getChildAt: vi.fn().mockImplementation((columnIndex: number) => ({
      get: vi.fn().mockImplementation((rowIndex: number) => rows[rowIndex][columnIndex]),
    })),
  };
}

/** duckdb_databases() as DuckDB reports it: the user's database is not internal; system and temp are. */
const DEFAULT_DATABASES: unknown[][] = [['memory', false, true], ['system', true, false], ['temp', true, false]];

function databasesResult(rows: unknown[][]) {
  return {
    schema: { fields: [{ name: 'database_name' }, { name: 'internal' }, { name: 'is_current' }] },
    numRows: rows.length,
    getChildAt: vi.fn().mockImplementation((j: number) => ({
      get: vi.fn().mockImplementation((i: number) => rows[i][j]),
    })),
  };
}

function createMockReader(fields: Array<{ name: string; type?: unknown }>, batches: unknown[][][]) {
  return createMockAsyncReader(
    { fields },
    () => batches.map((batchRows) => createMockBatch(batchRows))
  );
}

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectBundle.mockResolvedValue({
      mainModule: 'mock-eh-module',
      mainWorker: 'mock-eh-worker',
      pthreadWorker: null,
    });
    mockInstantiate.mockResolvedValue(undefined);
    mockOpen.mockResolvedValue(undefined);
    mockCancelSent.mockResolvedValue(true);
    mockSend.mockImplementation(async (sql: string) => {
      const result = await mockQuery(sql);
      return createMockAsyncReader(result.schema, () => [result]);
    });
    mockSettingsQuery.mockImplementation(async () => createMockBatch([
      ['memory_limit', '3.1 GiB'],
      ['schema', 'main'],
      ['threads', '4'],
    ]));
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

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'should reject invalid maximumThreads value %s',
      (maximumThreads) => {
        expect(() => new Database({ maximumThreads })).toThrow(
          'maximumThreads must be a positive integer'
        );
      }
    );
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      await db.init();
      expect(db.isReady()).toBe(true);
      expect(mockSelectBundle).toHaveBeenCalledWith(mockDefaultBundles);
      expect(mockInstantiate).toHaveBeenCalledWith('mock-eh-module', null);
      expect(mockWorkerConstructor).toHaveBeenCalledWith('blob:mock-url');
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
      expect(mockOpen).toHaveBeenCalledWith({
        path: ':memory:',
        query: { castDecimalToDouble: true },
        maximumThreads: 1,
      });
    });

    it('should not reinitialize if already initialized', async () => {
      await db.init();
      await db.init(); // Second call should be no-op
      expect(db.isReady()).toBe(true);
      expect(mockSelectBundle).toHaveBeenCalledTimes(1);
    });

    it('should use an explicitly configured COI bundle and thread limit', async () => {
      const bundles = {
        ...mockDefaultBundles,
        coi: {
          mainModule: 'mock-coi-module',
          mainWorker: 'mock-coi-worker',
          pthreadWorker: 'mock-coi-pthread-worker',
        },
      };
      mockSelectBundle.mockResolvedValue(bundles.coi);
      db = new Database({ bundles, maximumThreads: 4 });

      await db.init();

      expect(mockSelectBundle).toHaveBeenCalledWith(bundles);
      expect(mockInstantiate).toHaveBeenCalledWith(
        'mock-coi-module',
        'mock-coi-pthread-worker'
      );
      expect(mockWorkerConstructor).toHaveBeenCalledWith('mock-coi-worker');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith({
        path: ':memory:',
        query: { castDecimalToDouble: true },
        maximumThreads: 4,
      });
    });

    it('should fail early when multithreading cannot select a COI bundle', async () => {
      const bundles = {
        ...mockDefaultBundles,
        coi: {
          mainModule: 'mock-coi-module',
          mainWorker: 'mock-coi-worker',
          pthreadWorker: 'mock-coi-pthread-worker',
        },
      };
      db = new Database({ bundles, maximumThreads: 4 });

      await expect(db.init()).rejects.toThrow(
        'no compatible COI bundle was selected'
      );
      expect(mockInstantiate).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should fail when the selected bundle has no main worker', async () => {
      mockSelectBundle.mockResolvedValue({
        mainModule: 'mock-module',
        mainWorker: null,
        pthreadWorker: null,
      });

      await expect(db.init()).rejects.toThrow(
        'does not provide a main worker'
      );
      expect(mockWorkerConstructor).not.toHaveBeenCalled();
      expect(mockInstantiate).not.toHaveBeenCalled();
    });

    it('should apply the same thread configuration to OPFS databases', async () => {
      db = new Database({
        storage: 'opfs',
        databasePath: '/test.db',
        maximumThreads: 1,
      });

      await db.init();

      expect(mockOpen).toHaveBeenCalledWith({
        path: '/test.db',
        accessMode: 1,
        query: { castDecimalToDouble: true },
        maximumThreads: 1,
      });
    });

    describe('without usable OPFS', () => {
      const opfsError = new Error('UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).');
      const workerScripts = () => vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => (blob as Blob).text());
      let warn: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => {
        warn.mockRestore();
        // Unused queued rejections would otherwise fail later tests (the outer beforeEach sets the defaults again).
        mockOpen.mockReset();
        mockInstantiate.mockReset();
      });

      it('restarts DuckDB without OPFS when an in-memory database cannot be opened', async () => {
        mockOpen.mockRejectedValueOnce(opfsError);

        await db.init();

        expect(db.isReady()).toBe(true);
        expect(mockInstantiate).toHaveBeenCalledTimes(2);
        expect(mockOpen).toHaveBeenCalledTimes(2);
        expect(mockTerminate).toHaveBeenCalledOnce();
        const [first, second] = await Promise.all(workerScripts());
        expect(first).toBe('importScripts("mock-eh-worker");');
        expect(second).toBe(
          'if (self.StorageManager) delete self.StorageManager.prototype.getDirectory;\nimportScripts("mock-eh-worker");'
        );
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('restarting it without OPFS'), opfsError);
      });

      it('reports the first error when DuckDB cannot be opened without OPFS either', async () => {
        mockOpen.mockRejectedValueOnce(opfsError).mockRejectedValueOnce(new Error('still failing'));

        await expect(db.init()).rejects.toBe(opfsError);

        expect(db.isReady()).toBe(false);
        expect(mockTerminate).toHaveBeenCalledTimes(2);
      });

      it('does not restart DuckDB for an OPFS database', async () => {
        db = new Database({ storage: 'opfs', databasePath: 'opfs://test.db' });
        mockOpen.mockRejectedValueOnce(opfsError);

        await expect(db.init()).rejects.toBe(opfsError);

        expect(mockInstantiate).toHaveBeenCalledOnce();
        expect(mockTerminate).toHaveBeenCalledOnce();
        expect(warn).not.toHaveBeenCalled();
      });

      it('does not restart a COI worker, which keeps its script URL', async () => {
        const coi = { mainModule: 'mock-coi-module', mainWorker: 'mock-coi-worker', pthreadWorker: 'mock-coi-pthread-worker' };
        mockSelectBundle.mockResolvedValue(coi);
        db = new Database({ bundles: { ...mockDefaultBundles, coi }, maximumThreads: 2 });
        mockOpen.mockRejectedValueOnce(opfsError);

        await expect(db.init()).rejects.toBe(opfsError);

        expect(mockInstantiate).toHaveBeenCalledOnce();
        expect(warn).not.toHaveBeenCalled();
      });

      it('releases the worker when DuckDB cannot be instantiated', async () => {
        mockInstantiate.mockRejectedValueOnce(new Error('wasm failed'));

        await expect(db.init()).rejects.toThrow('wasm failed');

        expect(mockOpen).not.toHaveBeenCalled();
        expect(mockTerminate).toHaveBeenCalledOnce();
      });
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

      expect(mockSend).toHaveBeenCalledWith('SELECT 1 as result', true);
      expect(mockReaderOpen).toHaveBeenCalledOnce();
      expect(result.columns).toEqual(['result']);
      expect(result.rowCount).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetSettings', () => {
    it('should reset only settings that changed and verify their initial values', async () => {
      let settings: unknown[][] = [
        ['memory_limit', '3.1 GiB'],
        ['schema', 'main'],
        ['threads', '4'],
      ];
      mockSettingsQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT name, value')) {
          return createMockBatch(settings);
        }
        if (sql === 'RESET "memory_limit"') {
          settings = settings.map((row) => row[0] === 'memory_limit'
            ? ['memory_limit', '3.1 GiB']
            : row);
        } else if (sql === 'RESET "threads"') {
          settings = settings.map((row) => row[0] === 'threads'
            ? ['threads', '4']
            : row);
        }
        return createMockBatch([]);
      });

      await db.init();
      settings = [
        ['memory_limit', '488.2 MiB'],
        ['schema', 'main'],
        ['threads', '1'],
      ];

      await expect(db.resetSettings()).resolves.toEqual({
        resetCount: 2,
        restarted: false,
      });
      expect(mockSettingsQuery).toHaveBeenCalledWith('RESET "memory_limit"');
      expect(mockSettingsQuery).toHaveBeenCalledWith('RESET "threads"');
      expect(mockSettingsQuery).not.toHaveBeenCalledWith('RESET "schema"');
    });

    it('should avoid RESET statements when settings are already at their defaults', async () => {
      await db.init();

      await expect(db.resetSettings()).resolves.toEqual({
        resetCount: 0,
        restarted: false,
      });
      expect(mockSettingsQuery.mock.calls.some(([sql]) => String(sql).startsWith('RESET ')))
        .toBe(false);
    });

    it('should not replace an in-memory database without explicit permission', async () => {
      let memoryLimit = '3.1 GiB';
      mockSettingsQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT name, value')) {
          return createMockBatch([['memory_limit', memoryLimit]]);
        }
        throw new Error('configuration has been locked');
      });

      await db.init();
      memoryLimit = '488.2 MiB';

      await expect(db.resetSettings()).rejects.toThrow('configuration has been locked');
      expect(mockClose).not.toHaveBeenCalled();
      expect(mockTerminate).not.toHaveBeenCalled();
    });

    it('should recreate the DuckDB instance when an in-place reset is refused', async () => {
      let settings: unknown[][] = [
        ['lock_configuration', 'false'],
        ['memory_limit', '3.1 GiB'],
      ];
      mockSettingsQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT name, value')) {
          return createMockBatch(settings);
        }
        settings = [
          ['lock_configuration', 'false'],
          ['memory_limit', '3.1 GiB'],
        ];
        throw new Error('configuration has been locked');
      });

      await db.init();
      (db as unknown as { poachedLoaded: boolean }).poachedLoaded = true;
      mockSend.mockResolvedValue(createMockReader([], []));
      settings = [
        ['lock_configuration', 'true'],
        ['memory_limit', '488.2 MiB'],
      ];

      await expect(db.resetSettings({ recreateOnFailure: true })).resolves.toEqual({
        resetCount: 2,
        restarted: true,
      });
      expect(mockClose).toHaveBeenCalledOnce();
      expect(mockTerminate).toHaveBeenCalledOnce();
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledWith('INSTALL poached FROM community', true);
      expect(mockSend).toHaveBeenCalledWith('LOAD poached', true);
    });

    it('should reject resets before initialization', async () => {
      await expect(db.resetSettings()).rejects.toThrow('Database not initialized');
    });
  });

  describe('executeQueryLimited', () => {
    it('should retain at most maxRows and cancel the remaining stream', async () => {
      mockSend.mockResolvedValueOnce(createMockReader(
        [{ name: 'value', type: 'INTEGER' }],
        [[[1], [2]], [[3]]]
      ));

      await db.init();
      const result = await db.executeQueryLimited('SELECT value FROM data', 2);

      expect(result.rows).toEqual([[1], [2]]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(true);
      expect(mockCancelSent).toHaveBeenCalledOnce();
      // DuckDB-Wasm keeps the unread rest open and refuses to prepare
      // statements until another query replaces it.
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenLastCalledWith('SELECT 1');
    });

    it('should release a result that fails while streaming', async () => {
      mockSend.mockResolvedValueOnce({
        schema: { fields: [{ name: 'value', type: 'INTEGER' }] },
        open: vi.fn().mockResolvedValue(undefined),
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw new Error('query was canceled');
        },
      });

      await db.init();
      await expect(db.executeQuery('SELECT * FROM big')).rejects.toThrow('query was canceled');

      expect(mockSend).toHaveBeenLastCalledWith('SELECT 1');
    });

    it('should not mark a result at the exact limit as truncated', async () => {
      mockSend.mockResolvedValueOnce(createMockReader(
        [{ name: 'value', type: 'INTEGER' }],
        [[[1], [2]]]
      ));

      await db.init();
      const result = await db.executeQueryLimited('SELECT value FROM data', 2);

      expect(result.rows).toEqual([[1], [2]]);
      expect(result.truncated).toBeUndefined();
      expect(mockCancelSent).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should reject invalid limits', async () => {
      await db.init();
      await expect(db.executeQueryLimited('SELECT 1', 0)).rejects.toThrow(RangeError);
    });
  });

  describe('cancelActiveQuery', () => {
    it('should return false when there is no active sent query', async () => {
      await expect(db.cancelActiveQuery()).resolves.toBe(false);
      await db.init();
      await expect(db.cancelActiveQuery()).resolves.toBe(false);
      expect(mockCancelSent).not.toHaveBeenCalled();
    });

    it('should cancel an active query and clear its token after completion', async () => {
      let finishReading!: () => void;
      const reading = new Promise<void>((resolve) => {
        finishReading = resolve;
      });
      mockSend.mockResolvedValueOnce({
        schema: { fields: [{ name: 'value', type: 'INTEGER' }] },
        open: vi.fn().mockResolvedValue(undefined),
        async *[Symbol.asyncIterator]() {
          await reading;
        },
      });

      await db.init();
      const query = db.executeQuery('SELECT value FROM slow_source');
      await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());

      await expect(db.cancelActiveQuery()).resolves.toBe(true);
      expect(mockCancelSent).toHaveBeenCalledOnce();

      finishReading();
      await query;
      await expect(db.cancelActiveQuery()).resolves.toBe(false);
    });

    it('reports JSON errors from DuckDB-Wasm as DuckDB text', async () => {
      mockSend.mockRejectedValueOnce(new Error(JSON.stringify({
        exception_type: 'Parser',
        exception_message: 'syntax error at or near "descrbe"\n\nLINE 1: descrbe SELECT 1',
        error_subtype: 'SYNTAX_ERROR',
      })));
      await db.init();

      const error = await db.executeQuery('descrbe SELECT 1').catch((reason: Error) => reason);
      expect(error.message).toBe('Parser Error: syntax error at or near "descrbe"\n\nLINE 1: descrbe SELECT 1');
    });

    it('should clear its active token when sending fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('send failed'));
      await db.init();

      await expect(db.executeQuery('SELECT 1')).rejects.toThrow('send failed');
      await expect(db.cancelActiveQuery()).resolves.toBe(false);
    });
  });

  describe('canPaginateQuery', () => {
    it('should validate a zero-row page wrapper without executing the query', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      mockPrepare.mockResolvedValueOnce({ close });

      await db.init();

      await expect(db.canPaginateQuery('SELECT * FROM data')).resolves.toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        'SELECT * FROM (SELECT * FROM data) AS _page_subquery LIMIT 0'
      );
      expect(close).toHaveBeenCalledOnce();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should reject statements that cannot be wrapped', async () => {
      mockPrepare.mockRejectedValueOnce(new Error('Parser Error'));
      await db.init();

      await expect(db.canPaginateQuery('CREATE TABLE test(i INT)')).resolves.toBe(false);
    });
  });

  describe('getQueryRowCount', () => {
    it('should execute a cancellable count wrapper', async () => {
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'cnt', type: 'BIGINT' }] },
        numRows: 1,
        getChildAt: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(3n) }),
      });

      await db.init();
      const count = await db.getQueryRowCount('SELECT * FROM data LIMIT 3');

      expect(count).toBe(3);
      expect(mockSend).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS cnt FROM (SELECT * FROM data LIMIT 3) AS _count_subquery',
        true
      );
    });

    it('should return null when the statement cannot be wrapped', async () => {
      mockSend.mockRejectedValueOnce(new Error('Parser Error'));
      await db.init();
      await expect(db.getQueryRowCount('CREATE TABLE test(i INT)')).resolves.toBeNull();
    });

    it('should fall back when counting fails at runtime', async () => {
      mockSend.mockRejectedValueOnce(new Error('count failed'));

      await db.init();

      await expect(db.getQueryRowCount('SELECT * FROM remote_data')).resolves.toBeNull();
    });
  });

  describe('connection serialization', () => {
    // A sent result whose rows arrive only after `release` is called.
    function createHeldReader(rows: unknown[][]) {
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      const reader = {
        schema: { fields: [{ name: 'value' }] },
        open: vi.fn(async () => reader),
        async *[Symbol.asyncIterator]() {
          await released;
          yield createMockBatch(rows);
        },
      };
      return { reader, release };
    }

    async function settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('should not send another query until the current result is fully read', async () => {
      const held = createHeldReader([[1]]);
      mockSend
        .mockResolvedValueOnce(held.reader)
        .mockResolvedValueOnce(createMockReader([{ name: 'value' }], [[[2]]]));
      await db.init();

      const first = db.executeQuery('SELECT 1');
      const second = db.executeQuery('SELECT 2');
      await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
      await settle();
      expect(mockSend).toHaveBeenCalledTimes(1);

      held.release();
      await expect(first).resolves.toMatchObject({ rows: [[1]] });
      await expect(second).resolves.toMatchObject({ rows: [[2]] });
      expect(mockSend.mock.calls.map(([sql]) => sql)).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('should not prepare a pagination probe while a result is being read', async () => {
      const held = createHeldReader([[1]]);
      mockSend.mockResolvedValueOnce(held.reader);
      mockPrepare.mockResolvedValueOnce({ close: vi.fn().mockResolvedValue(undefined) });
      await db.init();

      const query = db.executeQuery('SELECT 1');
      const probe = db.canPaginateQuery('SELECT 2');
      await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
      await settle();
      expect(mockPrepare).not.toHaveBeenCalled();

      held.release();
      await query;
      await expect(probe).resolves.toBe(true);
      expect(mockPrepare).toHaveBeenCalledOnce();
    });

    it('should cancel the running query without waiting for the connection', async () => {
      const held = createHeldReader([[1]]);
      mockSend.mockResolvedValueOnce(held.reader);
      await db.init();

      const query = db.executeQuery('SELECT 1');
      await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));

      await expect(db.cancelActiveQuery()).resolves.toBe(true);
      expect(mockCancelSent).toHaveBeenCalledOnce();

      held.release();
      await query;
    });

    it('should keep serving queries after one fails', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Parser Error'))
        .mockResolvedValueOnce(createMockReader([{ name: 'value' }], [[[2]]]));
      await db.init();

      const failed = db.executeQuery('SELEC 1');
      const next = db.executeQuery('SELECT 2');

      await expect(failed).rejects.toThrow('Parser Error');
      await expect(next).resolves.toMatchObject({ rows: [[2]] });
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
      // First query: get databases (single database case)
      mockQuery.mockResolvedValueOnce(databasesResult(DEFAULT_DATABASES));
      // Second query: get all tables
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_catalog' }, { name: 'table_schema' }, { name: 'table_name' }] },
        numRows: 2,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['memory', 'main', 'users'],
              ['memory', 'main', 'products'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const tables = await db.getTables();

      expect(tables).toEqual(['users', 'products']);
    });

    it('should return qualified table names only for attached databases', async () => {
      // First query: get databases (multiple databases)
      mockQuery.mockResolvedValueOnce(databasesResult([...DEFAULT_DATABASES, ['mydb', false, false]]));
      // Second query: get all tables
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_catalog' }, { name: 'table_schema' }, { name: 'table_name' }] },
        numRows: 3,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['memory', 'main', 'users'],
              ['mydb', 'main', 'orders'],
              ['mydb', 'main', 'products'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const tables = await db.getTables();

      // memory tables don't need prefix, attached db tables get "dbname.tablename"
      expect(tables).toEqual([
        'users',
        'mydb.orders',
        'mydb.products',
      ]);
    });

    it('should include schema name when not main', async () => {
      // First query: get databases (single database)
      mockQuery.mockResolvedValueOnce(databasesResult(DEFAULT_DATABASES));
      // Second query: get all tables including non-main schema
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_catalog' }, { name: 'table_schema' }, { name: 'table_name' }] },
        numRows: 3,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['memory', 'main', 'users'],
              ['memory', 'main', 'products'],
              ['memory', 'analytics', 'reports'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const tables = await db.getTables();

      // main schema tables don't need prefix, other schemas get "schema.tablename"
      expect(tables).toEqual([
        'users',
        'products',
        'analytics.reports',
      ]);
    });

    it('should handle attached database with non-main schema', async () => {
      // First query: get databases (multiple databases)
      mockQuery.mockResolvedValueOnce(databasesResult([...DEFAULT_DATABASES, ['mydb', false, false]]));
      // Second query: get all tables
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_catalog' }, { name: 'table_schema' }, { name: 'table_name' }] },
        numRows: 3,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['memory', 'main', 'users'],
              ['mydb', 'main', 'orders'],
              ['mydb', 'analytics', 'reports'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const tables = await db.getTables();

      // Full qualification for attached db with non-main schema
      expect(tables).toEqual([
        'users',
        'mydb.orders',
        'mydb.analytics.reports',
      ]);
    });

    it('should show database prefix when only attached database has tables', async () => {
      // First query: get databases (memory + attached)
      mockQuery.mockResolvedValueOnce(databasesResult([...DEFAULT_DATABASES, ['aws_iam', false, false]]));
      // Second query: get all tables (only from attached db)
      mockQuery.mockResolvedValueOnce({
        schema: { fields: [{ name: 'table_catalog' }, { name: 'table_schema' }, { name: 'table_name' }] },
        numRows: 2,
        getChildAt: vi.fn().mockImplementation((j: number) => ({
          get: vi.fn().mockImplementation((i: number) => {
            const data = [
              ['aws_iam', 'main', 'actions'],
              ['aws_iam', 'main', 'services'],
            ];
            return data[i][j];
          }),
        })),
      });

      await db.init();
      const tables = await db.getTables();

      // Attached db tables get prefix even when memory has no tables
      expect(tables).toEqual([
        'aws_iam.actions',
        'aws_iam.services',
      ]);
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
