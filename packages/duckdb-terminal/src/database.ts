import * as duckdb from '@duckdb/duckdb-wasm';
import type * as arrow from 'apache-arrow';
import type { QueryResult, CompletionSuggestion } from './types';

/**
 * Configuration options for the Database class.
 */
export interface DatabaseOptions {
  /**
   * The storage backend to use.
   * - 'memory': In-memory database (default, data lost on page refresh)
   * - 'opfs': Origin Private File System (persistent storage)
   */
  storage?: 'memory' | 'opfs';
  /**
   * The database file path when using OPFS storage.
   * Defaults to ':memory:' for in-memory storage.
   */
  databasePath?: string;
  /**
   * Maximum number of DuckDB execution threads.
   *
   * Values greater than 1 require a compatible COI bundle and a page served
   * with cross-origin isolation headers. The default bundle set is
   * intentionally single-threaded, so callers opting into multithreading must
   * also provide `bundles` with a `coi` entry.
   *
   * @defaultValue 1
   */
  maximumThreads?: number;
  /**
   * DuckDB-Wasm bundle manifest used during feature-based bundle selection.
   * Omit this to use DuckDB-Wasm's default, single-threaded jsDelivr bundles.
   */
  bundles?: duckdb.DuckDBBundles;
}

/**
 * A wrapper around DuckDB WASM that provides a simplified interface for
 * executing SQL queries and managing the database lifecycle.
 *
 * This class handles:
 * - DuckDB WASM initialization and worker setup
 * - Query execution and result formatting
 * - Auto-completion suggestions for SQL keywords, tables, and functions
 * - Virtual filesystem for loading external files (CSV, Parquet, JSON)
 *
 * @example Basic usage
 * ```typescript
 * const db = new Database({ storage: 'memory' });
 * await db.init();
 *
 * const result = await db.executeQuery('SELECT 1 + 1 as answer;');
 * console.log(result.rows); // [[2]]
 *
 * await db.close();
 * ```
 *
 * @example With OPFS persistent storage
 * ```typescript
 * const db = new Database({
 *   storage: 'opfs',
 *   databasePath: '/mydata.duckdb',
 * });
 * await db.init();
 * // Data persists across page refreshes
 * ```
 *
 * @example Loading external files
 * ```typescript
 * const db = new Database();
 * await db.init();
 *
 * // Register a file in DuckDB's virtual filesystem
 * const csvData = new Uint8Array([...]); // CSV file contents
 * await db.registerFile('data.csv', csvData);
 *
 * // Query the file
 * const result = await db.executeQuery("SELECT * FROM read_csv('data.csv');");
 * ```
 */
/**
 * Token from DuckDB's tokenize_sql() function
 */
export interface SQLToken {
  /** Byte position in the SQL string */
  position: number;
  /** Token category (KEYWORD, IDENTIFIER, OPERATOR, etc.) */
  category: string;
}

/**
 * SQL error information from DuckDB's sql_error_message() function
 */
export interface SQLError {
  /** Type of exception (e.g., "Parser", "Binder") */
  exceptionType: string;
  /** The error message */
  exceptionMessage: string;
  /** Position in the SQL string where the error occurred */
  position: string;
  /** Additional error subtype information */
  errorSubtype: string;
}

export interface StreamQueryResult {
  columns: string[];
  columnTypes: string[];
  rowBatches: AsyncIterable<unknown[][]>;
}

export interface ResetSettingsResult {
  /** Number of settings that differed from their initial values. */
  resetCount: number;
  /** Whether resetting required replacing the DuckDB instance. */
  restarted: boolean;
}

export interface ResetSettingsOptions {
  /**
   * Recreate DuckDB if an in-place reset fails. Recreating an in-memory
   * database discards its contents, so callers must opt in explicitly.
   */
  recreateOnFailure?: boolean;
}

type DatabaseSettingValue = string | null;
type NormalizedDatabaseOptions = DatabaseOptions & {
  storage: 'memory' | 'opfs';
  databasePath: string;
  maximumThreads: number;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class Database {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private activeSentQuery: symbol | null = null;
  private worker: Worker | null = null;
  private initialized = false;
  private options: NormalizedDatabaseOptions;
  private poachedLoaded = false;
  private initialSettings: Map<string, DatabaseSettingValue> | null = null;

  constructor(options: DatabaseOptions = {}) {
    const maximumThreads = options.maximumThreads ?? 1;
    if (!Number.isSafeInteger(maximumThreads) || maximumThreads <= 0) {
      throw new RangeError('maximumThreads must be a positive integer');
    }

    this.options = {
      ...options,
      storage: options.storage ?? 'memory',
      databasePath: options.databasePath ?? ':memory:',
      maximumThreads,
    };
  }

  /**
   * Initializes the DuckDB database.
   *
   * This method performs the following setup:
   * 1. Downloads the appropriate DuckDB WASM bundle
   * 2. Creates a Web Worker for database operations
   * 3. Instantiates the DuckDB instance
   * 4. Opens the database (in-memory or OPFS-backed)
   * 5. Creates a connection for query execution
   *
   * @returns A promise that resolves when initialization is complete
   *
   * @throws Error if initialization fails (network issues, WASM loading, etc.)
   *
   * @example
   * ```typescript
   * const db = new Database();
   * await db.init();
   * console.log('Database ready:', db.isReady());
   * ```
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // DuckDB's default manifest intentionally excludes the experimental COI
    // bundle. A caller must provide that bundle explicitly when opting into
    // multithreading.
    const bundles = this.options.bundles ?? duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const maximumThreads = this.options.maximumThreads;

    if (!bundle.mainWorker) {
      throw new Error('The selected DuckDB bundle does not provide a main worker.');
    }

    if (maximumThreads > 1 && !bundle.pthreadWorker) {
      throw new Error(
        `DuckDB multithreading was requested with maximumThreads=${maximumThreads}, ` +
        'but no compatible COI bundle was selected. Provide a bundle manifest with a ' +
        'coi entry and serve the page with COOP/COEP cross-origin isolation headers.'
      );
    }

    // COI workers must retain their real script URL so Emscripten can pass it
    // to pthread workers during bootstrap. Single-threaded CDN workers still
    // need the blob/importScripts bridge because classic workers are subject
    // to the same-origin restriction.
    let workerUrl: string | undefined;
    if (bundle.pthreadWorker) {
      this.worker = new Worker(bundle.mainWorker);
    } else {
      workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: 'text/javascript',
        })
      );
      this.worker = new Worker(workerUrl);
    }
    const logger = new duckdb.VoidLogger();
    this.db = new duckdb.AsyncDuckDB(logger, this.worker);

    try {
      await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    } finally {
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
    }

    // Note: We intentionally do NOT use castBigIntToDouble here.
    // While it would simplify JSON serialization, it corrupts array values
    // (e.g., range(10) returns garbage like [5e-324, 1e-323, ...]).
    // Instead, BigInt is handled in table-formatter.ts via toString().
    const queryConfig: duckdb.DuckDBQueryConfig = {
      castDecimalToDouble: true,
    };

    // Build the shared open configuration once so storage and threading
    // options cannot drift between the in-memory and OPFS paths.
    const useOPFS = this.options.storage === 'opfs' && Boolean(this.options.databasePath);
    const openConfig: duckdb.DuckDBConfig = {
      path: useOPFS ? this.options.databasePath : ':memory:',
      query: queryConfig,
      maximumThreads,
      ...(useOPFS ? { accessMode: duckdb.DuckDBAccessMode.READ_WRITE } : {}),
    };
    await this.db.open(openConfig);

    // Create connection
    this.conn = await this.db.connect();
    this.initialized = true;

    try {
      this.initialSettings = await this.readSettings();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Executes a SQL query and returns the results.
   *
   * @param sql - The SQL statement to execute
   * @returns A promise that resolves to the query result containing columns, rows, row count, and duration
   *
   * @throws Error if the database is not initialized
   * @throws Error if the SQL query is invalid or fails
   *
   * @example SELECT query
   * ```typescript
   * const result = await db.executeQuery('SELECT * FROM users WHERE age > 18;');
   * console.log('Columns:', result.columns); // ['id', 'name', 'age']
   * console.log('Rows:', result.rows);       // [[1, 'Alice', 25], [2, 'Bob', 30]]
   * console.log('Duration:', result.duration); // 5.23 (milliseconds)
   * ```
   *
   * @example DDL statement
   * ```typescript
   * await db.executeQuery('CREATE TABLE products (id INTEGER, name VARCHAR);');
   * ```
   */
  async executeQuery(sql: string): Promise<QueryResult> {
    return this.executeSentQuery(sql);
  }

  /**
   * Executes a query while retaining at most `maxRows` rows.
   *
   * One additional row is consumed to determine whether the result was
   * truncated. If it was, the remaining DuckDB stream is cancelled.
   */
  async executeQueryLimited(sql: string, maxRows: number): Promise<QueryResult> {
    if (!this.conn) {
      throw new Error('Database not initialized');
    }
    if (!Number.isInteger(maxRows) || maxRows <= 0) {
      throw new RangeError('maxRows must be a positive integer');
    }

    return this.executeSentQuery(sql, maxRows);
  }

  /**
   * Cancels the query currently being consumed through DuckDB's pending-query API.
   *
   * @returns Whether DuckDB accepted a cancellation request
   */
  async cancelActiveQuery(): Promise<boolean> {
    if (!this.conn || !this.activeSentQuery) {
      return false;
    }

    return this.conn.cancelSent();
  }

  private async executeSentQuery(sql: string, maxRows?: number): Promise<QueryResult> {
    const startTime = performance.now();
    const { reader, queryToken } = await this.startSentQuery(sql);

    try {
      const columns = reader.schema.fields.map((field) => field.name);
      const columnTypes = reader.schema.fields.map((field) => String(field.type));
      const rows: unknown[][] = [];
      let truncated = false;

      outer: for await (const batch of reader) {
        const remainingRows = maxRows === undefined
          ? Number.POSITIVE_INFINITY
          : maxRows - rows.length + 1;
        const batchRows = this.rowsFromBatch(batch, columns.length, remainingRows);
        for (const row of batchRows) {
          if (maxRows !== undefined && rows.length === maxRows) {
            truncated = true;
            break outer;
          }
          rows.push(row);
        }
      }

      if (truncated) {
        await this.cancelActiveQuery();
      }

      return {
        columns,
        columnTypes,
        rows,
        rowCount: rows.length,
        duration: performance.now() - startTime,
        truncated: truncated || undefined,
      };
    } finally {
      this.finishSentQuery(queryToken);
    }
  }

  /**
   * Check whether a statement can be safely wrapped as a paginated subquery.
   * Preparing a zero-row wrapper validates the shape without scanning the result.
   */
  async canPaginateQuery(sql: string): Promise<boolean> {
    if (!this.conn) {
      throw new Error('Database not initialized');
    }

    const pageSQL = `SELECT * FROM (${sql}) AS _page_subquery LIMIT 0`;
    let statement: Awaited<ReturnType<duckdb.AsyncDuckDBConnection['prepare']>>;
    try {
      statement = await this.conn.prepare(pageSQL);
    } catch {
      return false;
    }

    await statement.close();
    return true;
  }

  /**
   * Return the exact row count when a statement can be used as a subquery.
   * A null result means the statement should use bounded, non-pageable output.
   */
  async getQueryRowCount(sql: string): Promise<number | null> {
    if (!this.conn) {
      throw new Error('Database not initialized');
    }

    const countSQL = `SELECT COUNT(*) AS cnt FROM (${sql}) AS _count_subquery`;
    try {
      const result = await this.executeSentQuery(countSQL);
      const value = result.rows[0]?.[0];
      if (value === null || value === undefined) return null;
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 0) return null;
      return count;
    } catch {
      return null;
    }
  }

  /**
   * Sends a SQL query and returns Arrow record batches as row arrays.
   *
   * This is intended for output modes that can display rows incrementally.
   * Callers that need a fully materialized result should keep using
   * {@link executeQuery}.
   *
   * @param sql - The SQL statement to execute
   * @returns A stream result containing column metadata and async row batches
   *
   * @throws Error if the database is not initialized
   * @throws Error if the SQL query is invalid or fails
   */
  async streamQuery(sql: string): Promise<StreamQueryResult> {
    const { reader, queryToken } = await this.startSentQuery(sql);
    const columns = reader.schema.fields.map((field) => field.name);
    const columnTypes = reader.schema.fields.map((field) => String(field.type));

    return {
      columns,
      columnTypes,
      rowBatches: this.readRowBatches(reader, columns.length, queryToken),
    };
  }

  private async startSentQuery(sql: string): Promise<{
    reader: arrow.AsyncRecordBatchStreamReader;
    queryToken: symbol;
  }> {
    if (!this.conn) {
      throw new Error('Database not initialized');
    }

    const queryToken = Symbol('sent-query');
    this.activeSentQuery = queryToken;
    try {
      const reader = await this.conn.send(sql, true);
      await reader.open();
      return { reader, queryToken };
    } catch (error) {
      this.finishSentQuery(queryToken);
      throw error;
    }
  }

  private finishSentQuery(queryToken: symbol): void {
    if (this.activeSentQuery === queryToken) {
      this.activeSentQuery = null;
    }
  }

  private async *readRowBatches(
    reader: arrow.AsyncRecordBatchStreamReader,
    columnCount: number,
    queryToken: symbol
  ): AsyncIterable<unknown[][]> {
    try {
      for await (const batch of reader) {
        yield this.rowsFromBatch(batch, columnCount);
      }
    } finally {
      this.finishSentQuery(queryToken);
    }
  }

  private rowsFromBatch(
    batch: Pick<arrow.RecordBatch, 'numRows' | 'getChildAt'>,
    columnCount: number,
    maxRows: number = Number.POSITIVE_INFINITY
  ): unknown[][] {
    const rowCount = Math.min(batch.numRows, maxRows);
    const vectors = Array.from({ length: columnCount }, (_, index) => batch.getChildAt(index));
    const rows: unknown[][] = [];

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      rows.push(vectors.map((column) => column?.get(rowIndex)));
    }

    return rows;
  }

  /**
   * Gets auto-completion suggestions for the current input.
   *
   * Provides suggestions for:
   * - SQL keywords (SELECT, FROM, WHERE, etc.)
   * - Table names from the current database
   * - Common SQL functions
   *
   * @param text - The current input text
   * @param cursorPosition - The cursor position within the text
   * @returns A promise that resolves to an array of completion suggestions
   *
   * @example
   * ```typescript
   * const suggestions = await db.getCompletions('SEL', 3);
   * console.log(suggestions);
   * // [{ value: 'SELECT', type: 'keyword' }]
   * ```
   */
  async getCompletions(
    text: string,
    cursorPosition: number
  ): Promise<CompletionSuggestion[]> {
    if (!this.db) {
      return [];
    }

    try {
      // Find the current word being typed
      const beforeCursor = text.substring(0, cursorPosition);
      const match = beforeCursor.match(/[\w.]*$/);
      const prefix = match ? match[0].toLowerCase() : '';

      if (!prefix) {
        return [];
      }

      const suggestions: CompletionSuggestion[] = [];

      // SQL keywords
      const keywords = [
        'SELECT',
        'FROM',
        'WHERE',
        'AND',
        'OR',
        'NOT',
        'INSERT',
        'INTO',
        'VALUES',
        'UPDATE',
        'SET',
        'DELETE',
        'CREATE',
        'TABLE',
        'DROP',
        'ALTER',
        'INDEX',
        'VIEW',
        'JOIN',
        'LEFT',
        'RIGHT',
        'INNER',
        'OUTER',
        'ON',
        'GROUP',
        'BY',
        'ORDER',
        'HAVING',
        'LIMIT',
        'OFFSET',
        'UNION',
        'EXCEPT',
        'INTERSECT',
        'AS',
        'DISTINCT',
        'ALL',
        'NULL',
        'TRUE',
        'FALSE',
        'CASE',
        'WHEN',
        'THEN',
        'ELSE',
        'END',
        'IS',
        'IN',
        'BETWEEN',
        'LIKE',
        'EXISTS',
        'COUNT',
        'SUM',
        'AVG',
        'MIN',
        'MAX',
        'CAST',
        'COALESCE',
        'NULLIF',
      ];

      // Add matching keywords
      for (const keyword of keywords) {
        if (keyword.toLowerCase().startsWith(prefix)) {
          suggestions.push({ value: keyword, type: 'keyword' });
        }
      }

      // Get table names from the database
      try {
        const tablesResult = await this.executeQuery(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
        );
        for (const row of tablesResult.rows) {
          const tableName = String(row[0]);
          if (tableName.toLowerCase().startsWith(prefix)) {
            suggestions.push({ value: tableName, type: 'table' });
          }
        }
      } catch {
        // Ignore errors from information_schema query
      }

      // Get function names
      const functions = [
        'abs',
        'ceil',
        'floor',
        'round',
        'sqrt',
        'log',
        'exp',
        'power',
        'length',
        'lower',
        'upper',
        'trim',
        'ltrim',
        'rtrim',
        'replace',
        'substring',
        'concat',
        'now',
        'current_date',
        'current_time',
        'current_timestamp',
        'date_part',
        'date_trunc',
        'extract',
        'array_agg',
        'string_agg',
        'list_agg',
        'first',
        'last',
        'any_value',
      ];

      for (const func of functions) {
        if (func.toLowerCase().startsWith(prefix)) {
          suggestions.push({ value: func, type: 'function' });
        }
      }

      // Sort by relevance (exact prefix matches first)
      suggestions.sort((a, b) => {
        const aExact = a.value.toLowerCase() === prefix;
        const bExact = b.value.toLowerCase() === prefix;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.value.localeCompare(b.value);
      });

      return suggestions.slice(0, 20); // Limit to 20 suggestions
    } catch {
      return [];
    }
  }

  /**
   * Gets a list of all tables in the database.
   *
   * Queries all attached databases and returns tables with their qualified names
   * when multiple databases are present, or just the table name when only the
   * default 'memory' database exists.
   *
   * @returns A promise that resolves to an array of table names (qualified if multiple databases)
   *
   * @example
   * ```typescript
   * // Single database
   * const tables = await db.getTables();
   * console.log('Tables:', tables); // ['users', 'products', 'orders']
   *
   * // With attached database
   * const tables = await db.getTables();
   * console.log('Tables:', tables); // ['users', 'mydb.products']
   * ```
   */
  async getTables(): Promise<string[]> {
    if (!this.conn) {
      return [];
    }

    try {
      // Get all databases to find which one is the default (internal = true)
      // The default database doesn't need a prefix
      const dbResult = await this.executeQuery(
        'SELECT database_name, internal FROM duckdb_databases()'
      );
      const databases = dbResult.rows.map((row) => ({
        name: String(row[0]),
        internal: Boolean(row[1]),
      }));
      const defaultDbName = databases.find((db) => db.internal)?.name || 'memory';
      const hasMultipleDatabases = databases.length > 1;

      // Get all tables from all databases (all schemas, not just 'main')
      const result = await this.executeQuery(
        'SELECT table_catalog, table_schema, table_name FROM information_schema.tables ORDER BY table_catalog, table_schema, table_name'
      );

      return result.rows.map((row) => {
        const catalog = String(row[0]);
        const schema = String(row[1]);
        const tableName = String(row[2]);

        // Build qualified name based on context:
        // - <default_db>.main.table -> table (default database and schema)
        // - <default_db>.other.table -> other.table (non-default schema)
        // - mydb.main.table -> mydb.table (attached database, default schema)
        // - mydb.other.table -> mydb.other.table (attached database, non-default schema)
        const needsCatalog = hasMultipleDatabases && catalog !== defaultDbName;
        const needsSchema = schema !== 'main';

        if (needsCatalog && needsSchema) {
          return `${catalog}.${schema}.${tableName}`;
        } else if (needsCatalog) {
          return `${catalog}.${tableName}`;
        } else if (needsSchema) {
          return `${schema}.${tableName}`;
        }
        return tableName;
      });
    } catch {
      return [];
    }
  }

  /**
   * Gets the schema (column definitions) for a specific table.
   *
   * @param tableName - The name of the table to get the schema for
   * @returns A promise that resolves to an array of column definitions
   *
   * @example
   * ```typescript
   * const schema = await db.getTableSchema('users');
   * console.log(schema);
   * // [
   * //   { name: 'id', type: 'INTEGER' },
   * //   { name: 'name', type: 'VARCHAR' },
   * //   { name: 'email', type: 'VARCHAR' }
   * // ]
   * ```
   */
  async getTableSchema(
    tableName: string
  ): Promise<{ name: string; type: string }[]> {
    if (!this.conn) {
      return [];
    }

    try {
      // Parse qualified table name (catalog.schema.table, schema.table, or just table)
      const parts = tableName.split('.');
      let whereClause: string;

      if (parts.length === 3) {
        // catalog.schema.table
        const catalog = parts[0].replace(/'/g, "''");
        const schema = parts[1].replace(/'/g, "''");
        const table = parts[2].replace(/'/g, "''");
        whereClause = `table_catalog = '${catalog}' AND table_schema = '${schema}' AND table_name = '${table}'`;
      } else if (parts.length === 2) {
        // Could be catalog.table (with main schema) or schema.table (with default catalog)
        // Try to match either way
        const first = parts[0].replace(/'/g, "''");
        const second = parts[1].replace(/'/g, "''");
        whereClause = `((table_catalog = '${first}' AND table_name = '${second}') OR (table_schema = '${first}' AND table_name = '${second}'))`;
      } else {
        // Just table name
        const table = tableName.replace(/'/g, "''");
        whereClause = `table_name = '${table}'`;
      }

      const result = await this.executeQuery(
        `SELECT column_name, data_type FROM information_schema.columns WHERE ${whereClause} ORDER BY ordinal_position`
      );
      return result.rows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Gets CREATE TABLE statements for all tables and views in the database.
   *
   * This method queries the database catalog and generates DDL statements
   * that describe the schema, useful for providing context to AI assistants.
   *
   * @returns A promise that resolves to a string containing all CREATE TABLE statements,
   *          or an empty string if no tables exist
   *
   * @example
   * ```typescript
   * const ddl = await db.getAllDDL();
   * console.log(ddl);
   * // CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR);
   * // CREATE TABLE orders (id INTEGER, user_id INTEGER, total DECIMAL);
   * ```
   */
  async getAllDDL(): Promise<string> {
    if (!this.conn) {
      return '';
    }

    try {
      const tables = await this.getTables();
      if (tables.length === 0) {
        return '';
      }

      const ddlStatements: string[] = [];

      for (const tableName of tables) {
        const schema = await this.getTableSchema(tableName);
        if (schema.length > 0) {
          const columns = schema.map((col) => `${col.name} ${col.type}`).join(', ');
          ddlStatements.push(`CREATE TABLE ${tableName} (${columns});`);
        }
      }

      return ddlStatements.join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Registers a file in DuckDB's virtual filesystem.
   *
   * This allows you to load external files (CSV, Parquet, JSON) into DuckDB
   * and query them using functions like `read_csv()`, `read_parquet()`, etc.
   *
   * @param filename - The virtual filename to register (e.g., 'data.csv')
   * @param data - The file contents as a Uint8Array
   *
   * @throws Error if the database is not initialized
   *
   * @example
   * ```typescript
   * // Load a CSV file
   * const response = await fetch('https://example.com/data.csv');
   * const data = new Uint8Array(await response.arrayBuffer());
   * await db.registerFile('data.csv', data);
   *
   * // Query the file
   * const result = await db.executeQuery("SELECT * FROM read_csv('data.csv');");
   * ```
   */
  async registerFile(filename: string, data: Uint8Array): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await this.db.registerFileBuffer(filename, data);
  }

  /**
   * Removes a file from DuckDB's virtual filesystem.
   *
   * @param filename - The filename to remove
   *
   * @throws Error if the database is not initialized
   *
   * @example
   * ```typescript
   * await db.dropFile('data.csv');
   * ```
   */
  async dropFile(filename: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await this.db.dropFile(filename);
  }

  /**
   * Checks if the database is initialized and ready for queries.
   *
   * @returns True if the database is ready, false otherwise
   *
   * @example
   * ```typescript
   * if (db.isReady()) {
   *   const result = await db.executeQuery('SELECT 1;');
   * }
   * ```
   */
  isReady(): boolean {
    return this.initialized && this.conn !== null;
  }

  /**
   * Restores DuckDB configuration settings to the values present immediately
   * after initialization.
   *
   * Only settings whose normalized values changed are reset. If DuckDB refuses
   * an in-place reset (for example because configuration was locked), callers
   * can opt into recreating the instance so global and session settings are
   * both restored.
   */
  async resetSettings(options: ResetSettingsOptions = {}): Promise<ResetSettingsResult> {
    if (!this.conn || !this.initialSettings) {
      throw new Error('Database not initialized');
    }

    const initialSettings = this.initialSettings;
    const poachedWasLoaded = this.poachedLoaded;
    let changedSettings: string[] = [];

    try {
      const currentSettings = await this.readSettings();
      changedSettings = [...currentSettings].flatMap(([name, value]) => {
        const initialValue = initialSettings.get(name);
        return !initialSettings.has(name) || initialValue !== value ? [name] : [];
      });

      for (const name of changedSettings) {
        await this.conn.query(`RESET ${quoteIdentifier(name)}`);
      }

      if (changedSettings.length > 0) {
        const resetSettings = await this.readSettings();
        const restored = changedSettings.every((name) => {
          if (!initialSettings.has(name)) {
            // Extension settings discovered after initialization have no local
            // baseline, so a successful DuckDB RESET is authoritative.
            return true;
          }
          return resetSettings.get(name) === initialSettings.get(name);
        });
        if (!restored) {
          throw new Error('DuckDB settings did not return to their initial values');
        }
      }

      return { resetCount: changedSettings.length, restarted: false };
    } catch (error) {
      if (!options.recreateOnFailure) {
        throw error;
      }
      await this.reinitialize(poachedWasLoaded);
      return { resetCount: changedSettings.length, restarted: true };
    }
  }

  private async readSettings(): Promise<Map<string, DatabaseSettingValue>> {
    if (!this.conn) {
      throw new Error('Database not initialized');
    }

    const result = await this.conn.query(
      'SELECT name, value FROM duckdb_settings() ORDER BY name'
    );
    const names = result.getChildAt(0);
    const values = result.getChildAt(1);
    const settings = new Map<string, DatabaseSettingValue>();

    for (let rowIndex = 0; rowIndex < result.numRows; rowIndex++) {
      const name = names?.get(rowIndex);
      if (name === null || name === undefined) {
        continue;
      }
      const value = values?.get(rowIndex);
      settings.set(String(name), value === null || value === undefined ? null : String(value));
    }

    return settings;
  }

  private async reinitialize(reloadPoached: boolean): Promise<void> {
    await this.close();
    await this.init();
    if (reloadPoached) {
      await this.loadPoachedExtension();
    }
  }

  /**
   * Loads the poached extension for SQL tokenization.
   *
   * The poached extension provides tokenize_sql() which uses DuckDB's internal
   * parser for accurate SQL syntax highlighting.
   *
   * @returns A promise that resolves to true if loaded successfully, false otherwise
   */
  async loadPoachedExtension(): Promise<boolean> {
    if (this.poachedLoaded) {
      return true;
    }

    if (!this.conn) {
      return false;
    }

    try {
      await this.executeQuery('INSTALL poached FROM community');
      await this.executeQuery('LOAD poached');
      this.poachedLoaded = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if the poached extension is loaded.
   *
   * @returns True if the poached extension is available
   */
  isPoachedLoaded(): boolean {
    return this.poachedLoaded;
  }

  /**
   * Tokenizes SQL using DuckDB's internal parser via the poached extension.
   *
   * Returns token positions and categories for syntax highlighting.
   * Categories include: KEYWORD, IDENTIFIER, OPERATOR, NUMERIC_CONSTANT,
   * STRING_CONSTANT, COMMENT, ERROR
   *
   * @param sql - The SQL string to tokenize
   * @returns A promise that resolves to an array of tokens, or null if tokenization fails
   *
   * @example
   * ```typescript
   * const tokens = await db.tokenizeSQL('SELECT * FROM users');
   * // [
   * //   { position: 0, category: 'KEYWORD' },      // SELECT
   * //   { position: 7, category: 'OPERATOR' },     // *
   * //   { position: 9, category: 'KEYWORD' },      // FROM
   * //   { position: 14, category: 'IDENTIFIER' }   // users
   * // ]
   * ```
   */
  async tokenizeSQL(sql: string): Promise<SQLToken[] | null> {
    if (!this.conn || !this.poachedLoaded) {
      return null;
    }

    try {
      // Escape single quotes in SQL for the query
      const escapedSQL = sql.replace(/'/g, "''");
      const result = await this.executeQuery(
        `SELECT byte_position, category FROM tokenize_sql('${escapedSQL}')`
      );

      return result.rows.map((row) => ({
        position: Number(row[0]),
        category: String(row[1]),
      }));
    } catch {
      return null;
    }
  }

  /**
   * Validates SQL and returns error information if invalid.
   *
   * This combines `is_valid_sql()` and `sql_error_message()` in a single query
   * for efficiency. Returns validation result and error details in one call.
   *
   * @param sql - The SQL string to validate
   * @returns A promise that resolves to an object with `isValid` boolean and
   *          optional `error` with details, or undefined if extension unavailable
   *
   * @example
   * ```typescript
   * const result = await db.validateSQL('SELECT * FROM users WHERE');
   * if (result && !result.isValid) {
   *   console.log(result.error?.exceptionMessage); // "syntax error at end of input"
   * }
   * ```
   */
  async validateSQL(sql: string): Promise<{ isValid: boolean; error?: SQLError } | undefined> {
    if (!this.conn || !this.poachedLoaded) {
      return undefined;
    }

    try {
      // Escape single quotes in SQL for the query
      const escapedSQL = sql.replace(/'/g, "''");
      const result = await this.executeQuery(
        `SELECT is_valid_sql('${escapedSQL}'), sql_error_message('${escapedSQL}')::json`
      );

      const isValid = result.rows[0]?.[0] === true;
      const jsonStr = result.rows[0]?.[1];

      if (isValid) {
        return { isValid: true };
      }

      // Parse error details if available
      if (jsonStr) {
        const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        if (parsed.exception_message || parsed.exception_type) {
          return {
            isValid: false,
            error: {
              exceptionType: parsed.exception_type || '',
              exceptionMessage: parsed.exception_message || '',
              position: parsed.position || '',
              errorSubtype: parsed.error_subtype || '',
            },
          };
        }
      }

      return { isValid: false };
    } catch {
      return undefined;
    }
  }

  /**
   * Closes the database connection and releases resources.
   *
   * This method:
   * 1. Closes the database connection
   * 2. Terminates the DuckDB instance
   * 3. Terminates the Web Worker
   *
   * After calling this method, {@link init} must be called again before
   * executing any queries.
   *
   * @returns A promise that resolves when cleanup is complete
   *
   * @example
   * ```typescript
   * await db.close();
   * console.log('Database closed:', !db.isReady());
   * ```
   */
  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      await this.db.terminate();
      this.db = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.activeSentQuery = null;
    this.initialSettings = null;
    this.poachedLoaded = false;
    this.initialized = false;
  }
}
