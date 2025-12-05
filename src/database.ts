import * as duckdb from '@duckdb/duckdb-wasm';
import type { QueryResult, CompletionSuggestion } from '@/types';

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
export class Database {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private initialized = false;
  private options: DatabaseOptions;

  constructor(options: DatabaseOptions = {}) {
    this.options = {
      storage: 'memory',
      databasePath: ':memory:',
      ...options,
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

    // Get the appropriate bundle
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    // Create worker
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: 'text/javascript',
      })
    );

    this.worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    this.db = new duckdb.AsyncDuckDB(logger, this.worker);

    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    // Open database
    if (this.options.storage === 'opfs' && this.options.databasePath) {
      await this.db.open({
        path: this.options.databasePath,
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      });
    } else {
      await this.db.open({
        path: ':memory:',
      });
    }

    // Create connection
    this.conn = await this.db.connect();
    this.initialized = true;
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
    if (!this.conn) {
      throw new Error('Database not initialized');
    }

    const startTime = performance.now();
    const result = await this.conn.query(sql);
    const duration = performance.now() - startTime;

    // Get column names
    const columns = result.schema.fields.map((field) => field.name);

    // Get rows
    const rows: unknown[][] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: unknown[] = [];
      for (let j = 0; j < columns.length; j++) {
        const column = result.getChildAt(j);
        row.push(column?.get(i));
      }
      rows.push(row);
    }

    // DuckDB may return BigInt for numRows, convert to number
    const numRows = typeof result.numRows === 'bigint' ? Number(result.numRows) : result.numRows;

    return {
      columns,
      rows,
      rowCount: numRows,
      duration,
    };
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
   * Queries the information_schema to retrieve table names from the 'main' schema.
   *
   * @returns A promise that resolves to an array of table names
   *
   * @example
   * ```typescript
   * const tables = await db.getTables();
   * console.log('Tables:', tables); // ['users', 'products', 'orders']
   * ```
   */
  async getTables(): Promise<string[]> {
    if (!this.conn) {
      return [];
    }

    try {
      const result = await this.executeQuery(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
      );
      return result.rows.map((row) => String(row[0]));
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
      // Escape single quotes in table name to prevent SQL injection
      const escapedTableName = tableName.replace(/'/g, "''");
      const result = await this.executeQuery(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escapedTableName}' ORDER BY ordinal_position`
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
    this.initialized = false;
  }
}
