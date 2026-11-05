import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GespenstMock } from '../test/gespenst-mock';
import {
  createWllamaMock,
  contentChunk,
  finishChunk,
  never,
  reasoningChunk,
  toolCallChunk,
} from '../test/wllama-mock';

const wllama = vi.hoisted(() => ({ current: null as null | { module: unknown } }));

vi.mock('@gespenst/core', async () => {
  const { createGespenstMock } = await import('../test/gespenst-mock');
  return { createTerminal: vi.fn(async () => createGespenstMock()) };
});
vi.mock('@gespenst/web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function() {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock('./ai/wllama-loader', () => ({
  loadWllama: vi.fn(async () => wllama.current!.module),
  getWllamaWasmUrl: () => 'https://cdn.test/wllama.wasm',
  getWllamaModuleUrl: () => 'https://cdn.test/wllama.js',
  getWllamaCompatUrls: () => ({ worker: 'https://cdn.test/compat/wllama.js', wasm: 'https://cdn.test/compat/wllama.wasm' }),
  canRunDefaultBuild: () => true,
}));
vi.mock('./database', () => ({
  Database: vi.fn().mockImplementation(function() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      loadPoachedExtension: vi.fn().mockResolvedValue(false),
      isPoachedLoaded: vi.fn().mockReturnValue(false),
      tokenizeSQL: vi.fn().mockResolvedValue(null),
      validateSQL: vi.fn().mockResolvedValue(undefined),
      cancelActiveQuery: vi.fn().mockResolvedValue(true),
      canPaginateQuery: vi.fn().mockResolvedValue(true),
      getAllDDL: vi.fn().mockResolvedValue('CREATE TABLE orders (id INTEGER, status VARCHAR);'),
      getTables: vi.fn().mockResolvedValue(['orders']),
      getTableSchema: vi.fn().mockResolvedValue([{ name: 'id', type: 'INTEGER' }, { name: 'status', type: 'VARCHAR' }]),
      executeQueryLimited: vi.fn().mockResolvedValue({
        columns: ['count'], columnTypes: ['BIGINT'], rows: [[3]], rowCount: 1, duration: 1,
      }),
      executeQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, duration: 1 }),
    };
  }),
}));
vi.mock('./utils/history', () => ({
  HistoryStore: vi.fn().mockImplementation(function() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn().mockReturnValue(null),
      next: vi.fn().mockReturnValue(null),
      getAll: vi.fn().mockReturnValue([]),
      reset: vi.fn(),
      close: vi.fn(),
    };
  }),
}));

import { DuckDBTerminal } from './terminal';
import { AI_MODELS, getModelUrl } from './ai/models';
import { SELECTED_MODEL_STORAGE_KEY } from './ai/assistant';

interface Internals {
  handleInput(data: string): void;
  loadedFiles: Map<string, unknown>;
  commandBusy: boolean;
  lastQueryResult: unknown;
  terminalAdapter: { terminal: GespenstMock };
  history: { add: ReturnType<typeof vi.fn> };
  database: {
    canPaginateQuery: ReturnType<typeof vi.fn>;
    executeQuery: ReturnType<typeof vi.fn>;
    executeQueryLimited: ReturnType<typeof vi.fn>;
    getTables: ReturnType<typeof vi.fn>;
  };
}

describe('Local AI commands', () => {
  let terminal: DuckDBTerminal;
  let internals: Internals;
  let mock: ReturnType<typeof createWllamaMock>;

  /** Everything written to the terminal, in order, without ANSI codes. */
  function output(): string {
    const native = internals.terminalAdapter.terminal;
    const calls = [
      ...native.write.mock.calls.map((call, i) => [native.write.mock.invocationCallOrder[i], call[0]] as const),
      ...native.writeAsync.mock.calls.map((call, i) => [native.writeAsync.mock.invocationCallOrder[i], call[0]] as const),
    ].sort((a, b) => a[0] - b[0]);
    return calls.map(([, text]) => String(text)).join('').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  }

  const type = (text: string) => internals.handleInput(text);
  const waitForOutput = (text: string) => vi.waitFor(() => expect(output()).toContain(text));
  const waitUntilIdle = () => vi.waitFor(() => expect(internals.commandBusy).toBe(false));

  beforeEach(async () => {
    localStorage.clear();
    mock = createWllamaMock();
    wllama.current = mock;
    terminal = new DuckDBTerminal({ container: document.createElement('div'), welcomeMessage: false });
    await terminal.start();
    internals = terminal as unknown as Internals;
  });

  afterEach(async () => {
    await terminal.destroy();
  });

  describe('.model', () => {
    it('lists the models with sizes and cancels the installation on "no"', async () => {
      type('.model\r');
      await waitForOutput('Select a model (1-4): ');

      expect(output()).toMatch(/1\. Qwen3\.5 0\.8B \(Q4_0\)\s+537 MiB/);
      expect(output()).toMatch(/4\. Qwen3\.5 4B \(Q4_K_XL\)\s+2777 MiB/);
      expect(output()).toContain('WebGPU is not available in this browser');

      type('1\r');
      await waitForOutput('Do you want to install the selected model (size 537 MiB) in your browser (yes/no) ');
      type('no\r');
      await waitForOutput('Installation cancelled.');
      await waitUntilIdle();

      expect(mock.state.downloads).toEqual([]);
    });

    it('downloads the model after "yes" and selects it', async () => {
      type('.model\r');
      await waitForOutput('Select a model');
      type('2\r');
      await waitForOutput('(yes/no)');
      type('yes\r');
      await waitForOutput('Installed MiniCPM5 1B (Q4_K_M).');
      await waitUntilIdle();

      expect(mock.state.downloads).toEqual([getModelUrl(AI_MODELS[1])]);
      expect(output()).toContain('Downloading MiniCPM5 1B (Q4_K_M)… 50%');
      expect(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)).toBe('minicpm5-1b');

      const before = output().length;
      const latest = () => output().slice(before);
      type('.model\r');
      await vi.waitFor(() => expect(latest()).toContain('Select a model'));
      expect(latest()).toMatch(/2\. MiniCPM5 1B \(Q4_K_M\)\s+656 MiB {2}installed, selected/);
      type('\r');
      await vi.waitFor(() => expect(latest()).toContain('No model selected.'));
    });

    it('selects an installed model without asking again', async () => {
      mock.state.cachedUrls.add(getModelUrl(AI_MODELS[2]));
      type('.model 3\r');
      await waitForOutput('Using Qwen3.5 2B (Q4_K_XL).');
      await waitUntilIdle();

      expect(output()).not.toContain('(yes/no)');
      expect(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)).toBe('qwen3.5-2b');
    });

    it('rejects an invalid selection', async () => {
      type('.model 9\r');
      await waitForOutput('Invalid selection: 9. Enter a number from 1 to 4.');
    });

    it('edits the answer with backspace and cancels the download with Ctrl+C', async () => {
      mock.state.downloadGate = never();
      type('.model\r');
      await waitForOutput('Select a model');
      type('5');
      type('\x7f');
      type('1\r');
      await waitForOutput('(yes/no)');
      type('y\r');
      await waitForOutput('Downloading');

      type('\x03');
      await waitForOutput('Download cancelled.');
      await waitUntilIdle();
      expect(mock.state.cachedUrls.size).toBe(0);
    });
  });

  describe('.clearmodels', () => {
    it('is listed in .help', async () => {
      type('.help\r');
      await waitForOutput('SQL statements must end with a semicolon');
      expect(output()).toMatch(/\.clearhistory {2}Clear command history\s+\.clearmodels {2}Remove downloaded AI models from the browser\s+\.copy/);
    });

    it('says when no models are stored', async () => {
      type('.clearmodels\r');
      await waitForOutput('No AI models are stored in this browser.');
      await waitUntilIdle();
      expect(output()).not.toContain('(yes/no)');
    });

    it('lists the stored models and keeps them on "no"', async () => {
      mock.state.cachedUrls.add(getModelUrl(AI_MODELS[0]));
      mock.state.cachedUrls.add(getModelUrl(AI_MODELS[2]));
      mock.state.invalidUrls.add(getModelUrl(AI_MODELS[2]));
      type('.clearmodels\r');
      await waitForOutput('Remove all 2 (0 MiB) from your browser? (yes/no) ');

      expect(output()).toMatch(/Qwen3\.5 0\.8B \(Q4_0\)\s+0 MiB/);
      expect(output()).toMatch(/Qwen3\.5 2B \(Q4_K_XL\)\s+0 MiB\s+incomplete download/);
      type('no\r');
      await waitForOutput('Nothing removed.');
      await waitUntilIdle();
      expect(mock.state.removed).toEqual([]);
    });

    it('removes the models after "yes" and forgets the selected one', async () => {
      mock.state.cachedUrls.add(getModelUrl(AI_MODELS[0]));
      mock.state.sizes.set(getModelUrl(AI_MODELS[0]), 563_036_064);
      type('.model 1\r');
      await waitForOutput('Using Qwen3.5 0.8B (Q4_0).');
      await waitUntilIdle();

      type('.clearmodels\r');
      await waitForOutput('Remove it (537 MiB) from your browser? (yes/no) ');
      type('yes\r');
      await waitForOutput('Removed 1 model (537 MiB). Run .model to download one again.');
      await waitUntilIdle();

      expect(mock.state.removed).toEqual([getModelUrl(AI_MODELS[0])]);
      expect(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)).toBeNull();
      type('.ai hi\r');
      await waitForOutput('No model selected');
    });
  });

  describe('.ai', () => {
    function selectInstalledModel() {
      mock.state.cachedUrls.add(getModelUrl(AI_MODELS[0]));
      localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, AI_MODELS[0].id);
    }

    it('explains its usage without a prompt', async () => {
      type('.ai\r');
      await waitForOutput('Usage: .ai <prompt>');
      expect(output()).toContain('No model selected yet: run .model');
    });

    it('asks for a model first', async () => {
      type('.ai how many orders?\r');
      await waitForOutput('No model selected. Run .model to choose and install one.');
      await waitUntilIdle();
    });

    it('streams thinking, runs the requested query, and answers', async () => {
      selectInstalledModel();
      mock.state.scripts.push(
        [reasoningChunk('Count the orders.'), toolCallChunk('SELECT count(*) AS count FROM orders'), finishChunk('tool_calls')],
        [contentChunk('There are 3 orders.'), finishChunk('stop', 5)],
      );

      type('.ai how many orders?\r');
      await waitForOutput('(5 tokens · 10.0 tok/s)');
      await waitUntilIdle();

      const text = output();
      const order = ['Thinking', 'Count the orders.', 'SELECT count(*) AS count FROM orders', '│', 'There are 3 orders.']
        .map((part) => text.indexOf(part));
      expect(order.every((index) => index >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith('SELECT count(*) AS count FROM orders', 50);
      expect(internals.history.add).toHaveBeenCalledWith('SELECT count(*) AS count FROM orders');
      expect(internals.lastQueryResult).toMatchObject({ rows: [[3]] });
      expect(mock.state.requests[1].at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('count\n3') });
    });

    it('passes the prompt through unchanged, including quotes', async () => {
      selectInstalledModel();
      mock.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

      type(`.ai  what's in "orders"?\r`);
      await waitUntilIdle();
      await waitForOutput('ok');

      expect(mock.state.requests[0][1].content).toMatch(/^what's in "orders"\?\n\n--- Database schema ---/);
    });

    it('runs statements that change data without asking', async () => {
      selectInstalledModel();
      internals.database.executeQueryLimited.mockResolvedValue({ columns: [], rows: [], rowCount: 0, duration: 1 });
      mock.state.scripts.push(
        [toolCallChunk('DROP TABLE orders'), finishChunk('tool_calls')],
        [contentChunk('Dropped.'), finishChunk('stop')],
      );

      type('.ai drop the orders table\r');
      await waitForOutput('Dropped.');
      await waitUntilIdle();

      expect(output()).not.toContain('(yes/no)');
      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith('DROP TABLE orders', 50);
      expect(mock.state.requests[1].at(-1)).toMatchObject({
        role: 'tool', content: expect.stringContaining('Statement executed successfully'),
      });
    });

    it('sends query errors to the model', async () => {
      selectInstalledModel();
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT nope')) throw new Error('Binder Error: Referenced column "nope" not found in FROM clause!');
        return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push(
        [toolCallChunk('SELECT nope FROM orders'), finishChunk('tool_calls')],
        [contentChunk('The column does not exist.'), finishChunk('stop')],
      );

      type('.ai show nope\r');
      await waitForOutput('The column does not exist.');
      await waitUntilIdle();

      expect(output()).not.toContain('(yes/no)');
      expect(output()).toContain('Error: Binder Error: Referenced column "nope" not found');
      expect(mock.state.requests[1].at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Binder Error') });
    });

    it('sends sample rows and the values of short text columns with the schema', async () => {
      selectInstalledModel();
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => (
        sql.includes('DISTINCT')
          ? { columns: ['status'], rows: [['cancelled'], ['completed']], rowCount: 2, duration: 1 }
          : {
            columns: ['id', 'status', 'order_ts'],
            columnTypes: ['Int32', 'Utf8', 'Timestamp<MICROSECOND>'],
            rows: [[1, 'completed', 1735672255000]],
            rowCount: 1,
            duration: 1,
          }
      ));
      mock.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

      type('.ai what is in orders?\r');
      await waitUntilIdle();
      await waitForOutput('ok');

      const context = String(mock.state.requests[0][1].content);
      // Timestamps arrive from Arrow as epoch milliseconds; the model needs DuckDB's text form.
      expect(context).toContain('-- First rows of orders:\nid,status,order_ts\n1,completed,2024-12-31 19:10:55');
      expect(context).toContain("-- All values of short text columns in orders:\nstatus: 'cancelled', 'completed'");
      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith('SELECT * FROM "orders" LIMIT 3', 3);
    });

    it('tells the model about loaded files it can query, except files already loaded as tables', async () => {
      selectInstalledModel();
      internals.loadedFiles.set('events.csv', {});
      internals.loadedFiles.set('orders.csv', {});
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.startsWith('DESCRIBE')) return { columns: ['column_name', 'column_type'], rows: [['event_time', 'TIMESTAMP'], ['event_type', 'VARCHAR']], rowCount: 2, duration: 1 };
        if (sql.includes("read_csv('events.csv') LIMIT")) return { columns: ['event_time', 'event_type'], rows: [['2024-12-01', 'purchase']], rowCount: 1, duration: 1 };
        return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

      type('.ai what is in events.csv?\r');
      await waitUntilIdle();
      await waitForOutput('ok');

      const context = String(mock.state.requests[0][1].content);
      expect(context).toContain("-- Files you can query directly with SQL (they are not tables), for example SELECT * FROM read_csv('events.csv'):");
      expect(context).toContain("-- read_csv('events.csv') has the columns: event_time TIMESTAMP, event_type VARCHAR");
      expect(context).toContain('-- First rows of events.csv:\nevent_time,event_type\n2024-12-01,purchase');
      expect(context).not.toContain("read_csv('orders.csv')");
    });

    it('describes the files at URLs in the question, and says when one cannot be read', async () => {
      selectInstalledModel();
      const csv = 'https://example.com/data/trips.csv';
      const parquet = 'https://example.com/data/missing.parquet';
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.includes(parquet)) throw new Error('Invalid Error: NetworkError: Failed to load the file\nLINE 1: ...');
        if (sql.startsWith('DESCRIBE')) return { columns: ['column_name', 'column_type'], rows: [['trip_id', 'BIGINT'], ['start_city', 'VARCHAR']], rowCount: 2, duration: 1 };
        return { columns: ['trip_id', 'start_city'], rows: [[1, 'Berlin']], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

      type(`.ai trips per city in ${csv} and ${parquet}?\r`);
      await waitUntilIdle();
      await waitForOutput('ok');

      const context = String(mock.state.requests[0][1].content);
      expect(context).toContain('-- Files on the web named in this conversation; query them with their full URL:');
      expect(context).toContain(`-- read_csv('${csv}') has the columns: trip_id BIGINT, start_city VARCHAR`);
      expect(context).toContain(`-- First rows of ${csv}:\ntrip_id,start_city\n1,Berlin`);
      expect(context).toContain(`-- read_parquet('${parquet}') cannot be read: Invalid Error: NetworkError: Failed to load the file`);
      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith(`DESCRIBE SELECT * FROM read_csv('${csv}')`, 200);
    });

    it('tells the model to attach database files, or the name they are attached under', async () => {
      selectInstalledModel();
      internals.loadedFiles.set('shop.duckdb', {});
      const url = 'https://example.com/data/iam.duckdb';
      internals.database.executeQuery.mockImplementation(async (sql: string) => (
        sql.includes('duckdb_databases')
          ? { columns: ['database_name', 'path'], rows: [['memory', null], ['shop', 'shop.duckdb']], rowCount: 2, duration: 1 }
          : { columns: [], rows: [], rowCount: 0, duration: 1 }
      ));
      mock.state.scripts.push([contentChunk('ok'), finishChunk('stop')], [contentChunk('still ok'), finishChunk('stop')]);

      type(`.ai which services are in ${url}?\r`);
      await waitUntilIdle();
      await waitForOutput('still ok');

      // A database still to attach comes first, before the tables of other data.
      const context = String(mock.state.requests[0][1].content);
      expect(context).toContain(
        '--- Database schema ---\n-- DuckDB database files (attached with ATTACH, never read with read_csv or read_parquet):\n'
      );
      expect(context).toContain('-- shop.duckdb is attached as shop: its tables are the shop. tables above; query them by exactly those names.');
      expect(context).toContain(
        `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ATTACH '${url}' AS iam (READ_ONLY);`
      );
      expect(context).not.toContain('Files you can query directly');
      // The answer did not use the database, so the model is asked once to attach it.
      expect(mock.state.requests[1].at(-1)).toMatchObject({
        role: 'user', content: expect.stringContaining(`Your next tool call must be: query({"query": "ATTACH '${url}' AS iam (READ_ONLY);"})`),
      });
    });

    it('tells the model the tables of a database it attached', async () => {
      selectInstalledModel();
      // Without guardrails the model continues with this result; with them, the question is asked again.
      terminal.getAssistant().setTuning({ guardrails: false });
      const url = 'https://example.com/data/iam.duckdb';
      let attached = false;
      internals.database.executeQuery.mockImplementation(async () => ({
        columns: ['database_name', 'path'],
        rows: attached ? [['memory', null], ['iam', url]] : [['memory', null]],
        rowCount: 1,
        duration: 1,
      }));
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ATTACH')) {
          attached = true;
          return { columns: ['Success'], rows: [], rowCount: 0, duration: 1 };
        }
        if (sql.includes('duckdb_columns')) {
          return {
            columns: ['schema_name', 'table_name', 'columns'],
            rows: [['main', 'actions', 'action_id INTEGER'], ['main', 'services', 'service_id INTEGER, name VARCHAR']],
            rowCount: 2,
            duration: 1,
          };
        }
        return { columns: ['count'], rows: [[3]], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push(
        [toolCallChunk(`ATTACH '${url}' AS iam (READ_ONLY)`), finishChunk('tool_calls')],
        [contentChunk('Attached.'), finishChunk('stop')],
      );

      type(`.ai attach ${url} and list the services\r`);
      await waitForOutput('Attached.');
      await waitUntilIdle();

      // The tables with their first rows.
      expect(mock.state.requests[1].at(-1)).toMatchObject({
        role: 'tool',
        content: expect.stringContaining(
          'The database is now attached as iam.\n\n' +
          'Its tables, to query with the iam. prefix:\n' +
          'CREATE TABLE iam.actions (action_id INTEGER);\nCREATE TABLE iam.services (service_id INTEGER, name VARCHAR);\n\n' +
          '-- First 3 rows of iam.actions (a sample, not all rows):\ncount\n3\n\n' +
          '-- First 3 rows of iam.services (a sample, not all rows):\ncount\n3'
        ),
      });
      expect(internals.database.executeQueryLimited).toHaveBeenCalledWith('SELECT * FROM "iam"."main"."services" LIMIT 3', 3);
    });

    it('reports a database attached by a statement whose later part failed', async () => {
      selectInstalledModel();
      terminal.getAssistant().setTuning({ guardrails: false });
      const url = 'https://example.com/data/iam.duckdb';
      let attached = false;
      internals.database.executeQuery.mockImplementation(async () => ({
        columns: ['database_name', 'path'], rows: attached ? [['memory', null], ['iam', url]] : [['memory', null]], rowCount: 1, duration: 1,
      }));
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ATTACH')) {
          attached = true;
          throw new Error('Catalog Error: Table with name iam does not exist!');
        }
        if (sql.includes('duckdb_columns')) return { columns: ['schema_name', 'table_name', 'columns'], rows: [['main', 'services', 'name VARCHAR']], rowCount: 1, duration: 1 };
        return { columns: ['name'], rows: [['ec2']], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push(
        [toolCallChunk(`ATTACH '${url}' AS iam; SELECT * FROM iam`), finishChunk('tool_calls')],
        [contentChunk('Done.'), finishChunk('stop')],
      );

      type(`.ai list the services in ${url}\r`);
      await waitForOutput('Done.');
      await waitUntilIdle();

      const result = String(mock.state.requests[1].at(-1)?.content);
      expect(result).toContain('Error: Catalog Error: Table with name iam does not exist!\n\nThe database is now attached as iam.');
      expect(result).toContain('CREATE TABLE iam.services (name VARCHAR);');
    });

    it('answers a request to attach a database once the model attached it', async () => {
      selectInstalledModel();
      const url = 'https://example.com/data/iam.duckdb';
      let attached = false;
      internals.database.executeQuery.mockImplementation(async () => ({
        columns: ['database_name', 'path'], rows: attached ? [['memory', null], ['iam', url]] : [['memory', null]], rowCount: 1, duration: 1,
      }));
      internals.database.executeQueryLimited.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ATTACH')) {
          attached = true;
          return { columns: ['Success'], rows: [], rowCount: 0, duration: 1 };
        }
        return { columns: ['schema_name', 'table_name', 'columns'], rows: [['main', 'services', 'service_id INTEGER']], rowCount: 1, duration: 1 };
      });
      mock.state.scripts.push([toolCallChunk(`ATTACH '${url}' AS iam (READ_ONLY)`), finishChunk('tool_calls')]);

      type(`.ai attach the remote database ${url}\r`);
      await waitForOutput('Attached the database as iam (read-only). Its table: services.');
      await waitUntilIdle();

      expect(mock.state.requests).toHaveLength(1);
      // No empty result table and no repeated statement after the answer.
      expect(output()).not.toContain('Success');
      expect(output()).not.toContain('```');
    });

    it('stops generation with Ctrl+C', async () => {
      selectInstalledModel();
      mock.state.scripts.push([never()]);

      type('.ai summarize everything\r');
      await vi.waitFor(() => expect(mock.state.requests).toHaveLength(1));
      type('\x03');
      await waitForOutput('Stopped.');
      await waitUntilIdle();
      expect(mock.state.exits).toBe(1);
    });
  });
});
