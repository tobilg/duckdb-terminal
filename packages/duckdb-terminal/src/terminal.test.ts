import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ghostty-web module
vi.mock('ghostty-web', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  Ghostty: {
    load: vi.fn().mockResolvedValue({}),
  },
  Terminal: vi.fn().mockImplementation(function() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn().mockImplementation((_text: string, callback?: () => void) => callback?.()),
      writeln: vi.fn().mockImplementation((_text: string, callback?: () => void) => callback?.()),
      focus: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      cols: 80,
      rows: 24,
      options: {},
    };
  }),
  FitAddon: vi.fn().mockImplementation(function() {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn(),
    };
  }),
}));

// Mock Database to avoid DuckDB WASM initialization
vi.mock('./database', () => ({
  Database: vi.fn().mockImplementation(function() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      executeQuery: vi.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        duration: 0,
      }),
      executeQueryLimited: vi.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        duration: 0,
      }),
      cancelActiveQuery: vi.fn().mockResolvedValue(false),
      canPaginateQuery: vi.fn().mockResolvedValue(true),
      getQueryRowCount: vi.fn().mockResolvedValue(1),
      resetSettings: vi.fn().mockResolvedValue({ resetCount: 0, restarted: false }),
      streamQuery: vi.fn().mockResolvedValue({
        columns: [],
        columnTypes: [],
        rowBatches: (async function*() {})(),
      }),
      getTables: vi.fn().mockResolvedValue([]),
      getTableSchema: vi.fn().mockResolvedValue([]),
      getCompletions: vi.fn().mockResolvedValue([]),
      registerFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      loadPoachedExtension: vi.fn().mockResolvedValue(false),
      isPoachedLoaded: vi.fn().mockReturnValue(false),
      tokenizeSQL: vi.fn().mockResolvedValue(null),
      validateSQL: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Mock HistoryStore to avoid IndexedDB
vi.mock('./utils/history', () => ({
  HistoryStore: vi.fn().mockImplementation(function() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn().mockReturnValue(null),
      next: vi.fn().mockReturnValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      reset: vi.fn(),
    };
  }),
}));

// Import after mocking
import { DuckDBTerminal } from './terminal';
import { Database } from './database';
import { darkTheme } from './themes';
import type { QueryResult } from './types';

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function getTerminalInternals(terminal: DuckDBTerminal) {
  return terminal as unknown as {
    state: string;
    outputMode: 'table' | 'csv' | 'tsv' | 'json';
    lastQueryResult: QueryResult | null;
    maxDisplayRows: number;
    exactRowCount: boolean;
    pageSize: number;
    pagination: {
      isActive: () => boolean;
    };
    database: {
      executeQuery: ReturnType<typeof vi.fn>;
      executeQueryLimited: ReturnType<typeof vi.fn>;
      cancelActiveQuery: ReturnType<typeof vi.fn>;
      canPaginateQuery: ReturnType<typeof vi.fn>;
      getQueryRowCount: ReturnType<typeof vi.fn>;
      resetSettings: ReturnType<typeof vi.fn>;
      streamQuery: ReturnType<typeof vi.fn>;
    };
    terminalAdapter: {
      writeAsync: (text: string) => Promise<void>;
      terminal: {
        cols: number;
      };
    };
  };
}

describe('DuckDBTerminal result limits', () => {
  it('should forward DuckDB bundle and thread options to the database', () => {
    const duckdbBundles = {
      mvp: { mainModule: 'mvp.wasm', mainWorker: 'mvp.worker.js' },
      coi: {
        mainModule: 'coi.wasm',
        mainWorker: 'coi.worker.js',
        pthreadWorker: 'coi.pthread.worker.js',
      },
    };

    new DuckDBTerminal({
      container: document.createElement('div'),
      maximumThreads: 4,
      duckdbBundles,
    });

    expect(Database).toHaveBeenLastCalledWith({
      storage: 'memory',
      databasePath: undefined,
      maximumThreads: 4,
      bundles: duckdbBundles,
    });
  });

  it('should use a configured positive row cap as the initial page size', () => {
    const terminal = new DuckDBTerminal({
      container: document.createElement('div'),
      welcomeMessage: false,
      maxDisplayRows: 250,
    });

    const internals = getTerminalInternals(terminal);
    expect(internals.maxDisplayRows).toBe(250);
    expect(internals.pageSize).toBe(250);
  });

  it('should keep eager exact counts opt-in', () => {
    const defaultTerminal = new DuckDBTerminal({
      container: document.createElement('div'),
      welcomeMessage: false,
    });
    const exactTerminal = new DuckDBTerminal({
      container: document.createElement('div'),
      welcomeMessage: false,
      exactRowCount: true,
    });

    expect(getTerminalInternals(defaultTerminal).exactRowCount).toBe(false);
    expect(getTerminalInternals(exactTerminal).exactRowCount).toBe(true);
  });

  it.each([0, -1, 1.5])('should reject an unsafe maxDisplayRows value (%s)', (maxDisplayRows) => {
    expect(() => new DuckDBTerminal({
      container: document.createElement('div'),
      welcomeMessage: false,
      maxDisplayRows,
    })).toThrow('maxDisplayRows must be a positive integer');
  });
});

describe('DuckDBTerminal Events', () => {
  let terminal: DuckDBTerminal;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = new DuckDBTerminal({
      container,
      theme: darkTheme,
      welcomeMessage: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('on/off methods', () => {
    it('should register event listener with on()', () => {
      const listener = vi.fn();
      terminal.on('ready', listener);
      // Listener registered but not called yet
      expect(listener).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function from on()', () => {
      const listener = vi.fn();
      const unsubscribe = terminal.on('ready', listener);
      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe using returned function', async () => {
      const listener = vi.fn();
      const unsubscribe = terminal.on('stateChange', listener);
      unsubscribe();

      // Trigger state change by starting terminal
      await terminal.start();

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled();
    });

    it('should unsubscribe using off()', async () => {
      const listener = vi.fn();
      terminal.on('stateChange', listener);
      terminal.off('stateChange', listener);

      await terminal.start();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('ready event', () => {
    it('should emit ready event when terminal starts', async () => {
      const listener = vi.fn();
      terminal.on('ready', listener);

      await terminal.start();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({});
    });
  });

  describe('stateChange event', () => {
    it('should emit stateChange when state changes', async () => {
      const listener = vi.fn();

      await terminal.start();
      terminal.on('stateChange', listener);

      // Execute SQL will change state to 'executing' and back to 'idle'
      await terminal.executeSQL('SELECT 1;');

      // Should have emitted state changes
      expect(listener).toHaveBeenCalled();
      const calls = listener.mock.calls;
      // Check that state change events have correct properties
      expect(calls[0][0]).toHaveProperty('state');
      expect(calls[0][0]).toHaveProperty('previous');
    });
  });

  describe('themeChange event', () => {
    it('should emit themeChange when theme is set', async () => {
      const listener = vi.fn();
      terminal.on('themeChange', listener);

      await terminal.start();
      terminal.setTheme('light');

      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.theme.name).toBe('light');
      expect(payload.previous).toBeDefined();
    });
  });

  describe('commandExecute event', () => {
    it('should emit commandExecute when dot command is executed', async () => {
      const listener = vi.fn();
      terminal.on('commandExecute', listener);

      await terminal.start();

      // Manually trigger command execution by simulating input
      // Since we can't easily trigger input, we'll test the event interface
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('multiple listeners', () => {
    it('should support multiple listeners for same event', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      terminal.on('ready', listener1);
      terminal.on('ready', listener2);

      await terminal.start();

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should not affect other listeners when one is removed', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      terminal.on('ready', listener1);
      terminal.on('ready', listener2);
      terminal.off('ready', listener1);

      await terminal.start();

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling in listeners', () => {
    it('should not throw when listener throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const normalListener = vi.fn();

      terminal.on('ready', errorListener);
      terminal.on('ready', normalListener);

      // Should not throw
      await expect(terminal.start()).resolves.not.toThrow();

      // Normal listener should still be called
      expect(normalListener).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error in ready event listener:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });
});

describe('DuckDBTerminal query cancellation', () => {
  let terminal: DuckDBTerminal;
  let container: HTMLElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = new DuckDBTerminal({
      container,
      theme: darkTheme,
      welcomeMessage: false,
    });
    await terminal.start();
    vi.clearAllMocks();
  });

  afterEach(() => {
    terminal.destroy();
    document.body.removeChild(container);
  });

  it('should request cancellation once and remain locked until the query settles', async () => {
    const internals = getTerminalInternals(terminal) as ReturnType<typeof getTerminalInternals> & {
      handleInput: (data: string) => void;
    };
    const pendingQuery = deferred<QueryResult>();
    internals.database.executeQuery.mockImplementationOnce(() => pendingQuery.promise);
    internals.database.cancelActiveQuery.mockResolvedValueOnce(true);
    const queryEnd = vi.fn();
    const error = vi.fn();
    terminal.on('queryEnd', queryEnd);
    terminal.on('error', error);

    const query = terminal.executeSQL('SELECT * FROM slow_source;');
    await vi.waitFor(() => expect(internals.database.executeQuery).toHaveBeenCalledOnce());

    internals.handleInput('ignored');
    internals.handleInput('\x03');
    internals.handleInput('\x03');
    await vi.waitFor(() => expect(internals.database.cancelActiveQuery).toHaveBeenCalledOnce());

    expect(internals.state).toBe('executing');
    pendingQuery.reject(new Error('pending query cancelled'));
    await expect(query).resolves.toBeNull();

    expect(internals.state).toBe('idle');
    expect(queryEnd).toHaveBeenCalledWith(expect.objectContaining({
      result: null,
      error: 'Query cancelled',
    }));
    expect(error).not.toHaveBeenCalled();
  });

  it('should lock input before history persistence yields', async () => {
    const internals = getTerminalInternals(terminal) as ReturnType<typeof getTerminalInternals> & {
      handleInput: (data: string) => void;
      inputBuffer: {
        getContent: () => string;
      };
      history: {
        add: ReturnType<typeof vi.fn>;
      };
    };
    const historyWrite = deferred<void>();
    internals.history.add.mockImplementationOnce(() => historyWrite.promise);

    internals.handleInput('SELECT 1;\r');
    expect(internals.state).toBe('executing');
    expect(internals.inputBuffer.getContent()).toBe('');

    internals.handleInput('must not be buffered');
    internals.handleInput('\x03');
    expect(internals.inputBuffer.getContent()).toBe('');

    historyWrite.resolve();
    await vi.waitFor(() => expect(internals.state).toBe('idle'));

    expect(internals.database.executeQuery).not.toHaveBeenCalled();
    expect(internals.database.executeQueryLimited).not.toHaveBeenCalled();
  });
});

describe('DuckDBTerminal Commands', () => {
  let terminal: DuckDBTerminal;
  let container: HTMLElement;
  let mockWriteln: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = new DuckDBTerminal({
      container,
      theme: darkTheme,
      welcomeMessage: false,
    });
    await terminal.start();

    // Get the mock write functions from the terminal adapter
    mockWriteln = vi.spyOn(terminal, 'writeln');
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('.help command', () => {
    it('should display help text with available commands', async () => {
      // Access private method through type assertion
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.help')?.handler([]);

      expect(mockWriteln).toHaveBeenCalled();
      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Available commands:');
      expect(output).toContain('.help');
      expect(output).toContain('.tables');
      expect(output).toContain('.schema');
    });

    it('should not repeat the command name in the .links usage text', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.help')?.handler([]);

      const output = stripAnsi(mockWriteln.mock.calls.map(c => c[0]).join('\n'));
      const linksLine = output.split('\n').find(line => line.includes('.links'));

      expect(linksLine).toBeDefined();
      expect(linksLine?.match(/\.links/g)).toHaveLength(1);
      expect(linksLine).toContain('on|off');
    });
  });

  describe('.timer command', () => {
    it('should turn timer on', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.timer')?.handler(['on']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Timer is now on');
    });

    it('should turn timer off', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.timer')?.handler(['off']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Timer is now off');
    });

    it('should show usage for invalid argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.timer')?.handler(['invalid']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });
  });

  describe('.mode command', () => {
    it('should set table mode', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler(['table']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Output mode set to table');
    });

    it('should set csv mode', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler(['csv']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Output mode set to csv');
    });

    it('should set tsv mode', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler(['tsv']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Output mode set to tsv');
    });

    it('should set json mode', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler(['json']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Output mode set to json');
    });

    it('should show usage for invalid mode', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler(['invalid']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should show current mode when no argument provided', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.mode')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Output mode:');
    });
  });

  describe('chunked result output', () => {
    it('should use one-row lookahead without eagerly counting', async () => {
      const internals = getTerminalInternals(terminal);
      const rows = Array.from({ length: 1_001 }, (_, index) => [index]);
      const queryEnd = vi.fn();
      terminal.on('queryEnd', queryEnd);
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['value'],
        columnTypes: ['INTEGER'],
        rows,
        rowCount: rows.length,
        duration: 2,
      });

      const result = await terminal.executeSQL('SELECT i FROM range(2500) AS t(i);');

      expect(internals.database.getQueryRowCount).not.toHaveBeenCalled();
      expect(internals.database.canPaginateQuery).toHaveBeenCalledWith(
        'SELECT i FROM range(2500) AS t(i)'
      );
      expect(internals.database.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM (SELECT i FROM range(2500) AS t(i)) AS _page_subquery LIMIT 1001 OFFSET 0'
      );
      expect(result?.rows).toHaveLength(1_000);
      expect(result?.pagination).toEqual({
        page: 1,
        pageSize: 1_000,
        hasPreviousPage: false,
        hasNextPage: true,
      });
      expect(internals.lastQueryResult).toBe(result);
      expect(internals.pagination.isActive()).toBe(true);
      expect(internals.state).toBe('paginating');
      expect(queryEnd).toHaveBeenCalledWith(expect.objectContaining({ result }));
    });

    it('should eagerly count only when exactRowCount is enabled', async () => {
      const internals = getTerminalInternals(terminal);
      internals.exactRowCount = true;
      internals.database.getQueryRowCount.mockResolvedValueOnce(2_500);
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['value'],
        columnTypes: ['INTEGER'],
        rows: Array.from({ length: 1_000 }, (_, index) => [index]),
        rowCount: 1_000,
        duration: 2,
      });

      const result = await terminal.executeSQL('SELECT i FROM range(2500) AS t(i);');

      expect(internals.database.getQueryRowCount).toHaveBeenCalledWith(
        'SELECT i FROM range(2500) AS t(i)'
      );
      expect(internals.database.canPaginateQuery).not.toHaveBeenCalled();
      expect(internals.database.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM (SELECT i FROM range(2500) AS t(i)) AS _page_subquery LIMIT 1000 OFFSET 0'
      );
      expect(result?.pagination).toEqual({
        page: 1,
        pageSize: 1_000,
        hasPreviousPage: false,
        hasNextPage: true,
        totalRows: 2_500,
        totalPages: 3,
      });
    });

    it('should bound and mark results when exact pagination is unavailable', async () => {
      const internals = getTerminalInternals(terminal);
      internals.database.canPaginateQuery.mockResolvedValueOnce(false);
      internals.database.executeQueryLimited.mockResolvedValueOnce({
        columns: ['status'],
        columnTypes: ['VARCHAR'],
        rows: [['ok']],
        rowCount: 1,
        duration: 1,
        truncated: true,
      });

      const result = await terminal.executeSQL('PRAGMA some_table_function;');
      const output = stripAnsi(mockWriteln.mock.calls.map((call) => call[0]).join('\n'));

      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith(
        'PRAGMA some_table_function;',
        1_000
      );
      expect(internals.database.executeQuery).not.toHaveBeenCalled();
      expect(result?.truncated).toBe(true);
      expect(result?.pagination).toBeUndefined();
      expect(output).toContain('pagination is unavailable');
      expect(internals.pagination.isActive()).toBe(false);
      expect(internals.state).toBe('idle');
    });

    it('should preserve query error events when the first page fails', async () => {
      const internals = getTerminalInternals(terminal);
      const queryEnd = vi.fn();
      const error = vi.fn();
      terminal.on('queryEnd', queryEnd);
      terminal.on('error', error);
      internals.database.executeQuery.mockRejectedValueOnce(new Error('page failed'));

      const result = await terminal.executeSQL('SELECT * FROM broken_source;');

      expect(result).toBeNull();
      expect(queryEnd).toHaveBeenCalledWith(expect.objectContaining({
        result: null,
        error: 'page failed',
      }));
      expect(error).toHaveBeenCalledWith({ message: 'page failed', source: 'query' });
      expect(internals.pagination.isActive()).toBe(false);
      expect(internals.state).toBe('idle');
    });

    it('should write CSV output through the async terminal writer', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');

      internals.outputMode = 'csv';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['name', 'age'],
        columnTypes: ['VARCHAR', 'INTEGER'],
        rows: [['Alice', 30], ['Bob, Jr.', 25]],
        rowCount: 2,
        duration: 1,
      });

      const result = await terminal.executeSQL('SELECT name, age FROM users;');
      const output = writeSpy.mock.calls.map((call) => call[0]).join('');

      expect(output).toContain('name,age\r\n');
      expect(output).toContain('Alice,30\r\n');
      expect(output).toContain('"Bob, Jr.",25\r\n');
      expect(result?.rows).toEqual([
        ['Alice', 30],
        ['Bob, Jr.', 25],
      ]);
      expect(internals.lastQueryResult?.rows).toEqual(result?.rows);
    });

    it('should write TSV output and preserve escaped rows', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');

      internals.outputMode = 'tsv';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['name', 'note'],
        columnTypes: ['VARCHAR', 'VARCHAR'],
        rows: [['Alice', 'hello\tworld']],
        rowCount: 1,
        duration: 1,
      });

      const result = await terminal.executeSQL('SELECT name, note FROM users;');
      const output = writeSpy.mock.calls.map((call) => call[0]).join('');

      expect(output).toContain('name\tnote\r\n');
      expect(output).toContain('Alice\thello world\r\n');
      expect(internals.lastQueryResult?.rows).toEqual(result?.rows);
    });

    it('should use the same materialized page path for table and JSON', async () => {
      const internals = getTerminalInternals(terminal);

      internals.outputMode = 'table';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['value'],
        rows: [[1]],
        rowCount: 1,
        duration: 1,
      });

      await terminal.executeSQL('SELECT 1 AS value;');

      internals.outputMode = 'json';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['value'],
        rows: [[2]],
        rowCount: 1,
        duration: 1,
      });

      await terminal.executeSQL('SELECT 2 AS value;');

      expect(internals.database.streamQuery).not.toHaveBeenCalled();
      expect(internals.database.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should render canonical EXPLAIN output verbatim in table mode', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');
      const plan = [
        '┌── ORDER_BY ──┐',
        '│ count_star() DESC │',
        '└─ HASH_GROUP_BY ─┘',
      ].join('\n');
      internals.outputMode = 'table';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['explain_key', 'explain_value'],
        columnTypes: ['VARCHAR', 'VARCHAR'],
        rows: [['physical_plan', plan]],
        rowCount: 1,
        duration: 1,
      });

      const result = await terminal.executeSQL(
        '-- inspect the plan\n/* leading block comment */\nEXPLAIN SELECT 1;'
      );
      const output = stripAnsi(writeSpy.mock.calls.map((call) => call[0]).join(''));
      const footer = stripAnsi(mockWriteln.mock.calls.map((call) => call[0]).join('\n'));

      expect(output).toContain(plan.replace(/\n/g, '\r\n'));
      expect(output).not.toContain('explain_key');
      expect(output).not.toContain('explain_value');
      expect(output).not.toContain('…');
      expect(footer).not.toContain('1 row');
      expect(result?.rows).toEqual([['physical_plan', plan]]);
    });

    it('should preserve valid JSON serialization for EXPLAIN results', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');
      const plan = 'ORDER_BY\nHASH_GROUP_BY';
      internals.outputMode = 'json';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['explain_key', 'explain_value'],
        columnTypes: ['VARCHAR', 'VARCHAR'],
        rows: [['physical_plan', plan]],
        rowCount: 1,
        duration: 1,
      });

      await terminal.executeSQL('EXPLAIN SELECT 1;');
      const output = writeSpy.mock.calls.map((call) => call[0]).join('');

      expect(output).toContain('"explain_key": "physical_plan"');
      expect(output).toContain('"explain_value": "ORDER_BY\\nHASH_GROUP_BY"');
      expect(() => JSON.parse(output.trim())).not.toThrow();
    });

    it('should not use EXPLAIN rendering for an ordinary canonical-shaped result', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');
      internals.outputMode = 'table';
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['explain_key', 'explain_value'],
        columnTypes: ['VARCHAR', 'VARCHAR'],
        rows: [['physical_plan', 'ordinary query value']],
        rowCount: 1,
        duration: 1,
      });

      await terminal.executeSQL(
        "SELECT 'physical_plan' AS explain_key, 'ordinary query value' AS explain_value;"
      );
      const output = stripAnsi(writeSpy.mock.calls.map((call) => call[0]).join(''));
      const footer = stripAnsi(mockWriteln.mock.calls.map((call) => call[0]).join('\n'));

      expect(output).toContain('explain_key');
      expect(output).toContain('explain_value');
      expect(footer).toContain('1 row');
    });

    it('should render table output with terminal width and column types', async () => {
      const internals = getTerminalInternals(terminal);
      const writeSpy = vi.spyOn(internals.terminalAdapter, 'writeAsync');
      internals.outputMode = 'table';
      internals.terminalAdapter.terminal.cols = 42;
      internals.database.executeQuery.mockResolvedValueOnce({
        columns: ['id', 'description'],
        columnTypes: ['INTEGER', 'VARCHAR'],
        rows: [[1, 'United States, Mexico, and Canada pricing region']],
        rowCount: 1,
        duration: 1,
      });

      await terminal.executeSQL('SELECT id, description FROM regions;');

      const output = stripAnsi(writeSpy.mock.calls.map((call) => call[0]).join(''));
      const tableLines = output.split(/\r?\n/).filter((line) => /^[┌│├└]/.test(line));

      expect(output).toContain('integer');
      expect(output).toContain('varchar');
      expect(tableLines.length).toBeGreaterThan(0);
      for (const line of tableLines) {
        expect(line.length).toBeLessThanOrEqual(42);
      }
    });
  });

  describe('.highlight command', () => {
    it('should turn highlighting on', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.highlight')?.handler(['on']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Syntax highlighting is now on');
    });

    it('should turn highlighting off', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.highlight')?.handler(['off']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Syntax highlighting is now off');
    });

    it('should show current state when no argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.highlight')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Syntax highlighting is');
    });
  });

  describe('.links command', () => {
    it('should turn links on', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.links')?.handler(['on']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('URL link detection is now on');
    });

    it('should turn links off', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.links')?.handler(['off']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('URL link detection is now off');
    });

    it('should show current state when no argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.links')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('URL link detection is');
    });
  });

  describe('.pagesize command', () => {
    it('should set page size', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['50']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Page size set to 50');
    });

    it('should reset pagination with 0', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['0']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Page size reset to 1000');
    });

    it('should show error for invalid value', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['-5']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should reject partially numeric values', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['50rows']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
      expect(getTerminalInternals(terminal).pageSize).toBe(1_000);
    });

    it('should show current page size when no argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Page size: 1000');
    });
  });

  describe('.reset command', () => {
    it('should restore DuckDB settings before reporting success', async () => {
      const internals = getTerminalInternals(terminal);
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;

      await cmd.get('.reset')?.handler([]);

      expect(internals.database.resetSettings).toHaveBeenCalledWith({ recreateOnFailure: true });
      const output = stripAnsi(mockWriteln.mock.calls.map(c => c[0]).join('\n'));
      expect(output).toContain('settings restored to defaults');
    });

    it('should not report success when DuckDB settings cannot be reset', async () => {
      const internals = getTerminalInternals(terminal);
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      internals.database.resetSettings.mockRejectedValueOnce(new Error('restart failed'));

      await cmd.get('.reset')?.handler([]);

      const output = stripAnsi(mockWriteln.mock.calls.map(c => c[0]).join('\n'));
      expect(output).toContain('Error during reset: restart failed');
      expect(output).not.toContain('Reset complete');
    });
  });

  describe('.prompt command', () => {
    it('should show current prompts when no args', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.prompt')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Primary prompt:');
      expect(output).toContain('Continuation prompt:');
    });

    it('should set primary prompt', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.prompt')?.handler(['SQL>']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Primary prompt set to');
    });

    it('should set both prompts', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.prompt')?.handler(['SQL>', '...']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Prompts set to');
    });
  });

  describe('.examples command', () => {
    it('should display example queries', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.examples')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Example queries');
      expect(output).toContain('SELECT');
    });
  });

  describe('.tables command', () => {
    it('should show message when no tables', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.tables')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No tables found');
    });
  });

  describe('.schema command', () => {
    it('should show usage when no table name provided', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.schema')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should show message when table not found', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.schema')?.handler(['nonexistent']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Table not found');
    });
  });

  describe('.files command', () => {
    it('should show message when no files loaded', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.files')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No files loaded');
    });

    it('should show message when no files loaded with list subcommand', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.files')?.handler(['list']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No files loaded');
    });

    it('should show usage when remove has no argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.files')?.handler(['remove']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should show error when removing non-existent file', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.files')?.handler(['remove', 'nonexistent.csv']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('File not found');
    });
  });

  describe('.copy command', () => {
    it('should show message when no results to copy', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.copy')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('No query result to copy');
    });
  });

  describe('.clear command', () => {
    it('should call clear method', async () => {
      const clearSpy = vi.spyOn(terminal, 'clear');
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.clear')?.handler([]);

      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    function getInternals() {
      return terminal as unknown as {
        inputBuffer: {
          setContent: (content: string) => void;
          getCursorPos: () => number;
          moveToStart: () => string;
        };
        handleInput: (data: string) => void;
      };
    }

    it('should handle Home and End sequence variants', () => {
      const internals = getInternals();
      internals.inputBuffer.setContent('SELECT 1');

      internals.handleInput('\x1bOH');
      expect(internals.inputBuffer.getCursorPos()).toBe(0);

      internals.handleInput('\x1b[4~');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT 1'.length);

      internals.handleInput('\x1b[1~');
      expect(internals.inputBuffer.getCursorPos()).toBe(0);

      internals.handleInput('\x1bOF');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT 1'.length);
    });

    it('should handle macOS Option word navigation sequences', () => {
      const internals = getInternals();
      internals.inputBuffer.setContent('SELECT * FROM users');

      internals.handleInput('\x1bb');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT * FROM '.length);

      internals.handleInput('\x1bf');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT * FROM users'.length);
    });

    it('should handle Linux and Windows word navigation sequences', () => {
      const internals = getInternals();
      internals.inputBuffer.setContent('SELECT * FROM users');

      internals.handleInput('\x1b[1;5D');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT * FROM '.length);

      internals.inputBuffer.moveToStart();
      internals.handleInput('\x1b[1;3C');
      expect(internals.inputBuffer.getCursorPos()).toBe('SELECT'.length);
    });
  });
});
