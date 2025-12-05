/**
 * Command history store using IndexedDB for persistence.
 *
 * This module provides a persistent command history that survives browser
 * refreshes. History is stored in IndexedDB and falls back to in-memory
 * storage if IndexedDB is unavailable.
 *
 * @module utils/history
 */

/** Name of the IndexedDB database */
const DB_NAME = 'duckdb-terminal';
/** Name of the object store within the database */
const STORE_NAME = 'history';
/** Maximum number of commands to retain in history */
const MAX_HISTORY = 1000;

/**
 * A persistent command history store backed by IndexedDB.
 *
 * Features:
 * - Persists command history to IndexedDB
 * - Falls back to in-memory storage if IndexedDB is unavailable
 * - Supports navigation through history with previous/next
 * - Automatically limits history size to prevent unbounded growth
 * - Deduplicates consecutive identical commands
 *
 * @example Basic usage
 * ```typescript
 * const history = new HistoryStore();
 * await history.init();
 *
 * // Add commands to history
 * await history.add('SELECT * FROM users;');
 * await history.add('SELECT count(*) FROM orders;');
 *
 * // Navigate history
 * const prev = history.previous('');  // Returns 'SELECT count(*) FROM orders;'
 * const prev2 = history.previous(''); // Returns 'SELECT * FROM users;'
 * const next = history.next();        // Returns 'SELECT count(*) FROM orders;'
 * ```
 *
 * @example With input preservation
 * ```typescript
 * const history = new HistoryStore();
 * await history.init();
 *
 * // Current input is preserved when navigating
 * const prev = history.previous('SELECT '); // Saves 'SELECT ' as current input
 * // ... user navigates through history ...
 * const current = history.next(); // Eventually returns 'SELECT '
 * ```
 */
export class HistoryStore {
  private db: IDBDatabase | null = null;
  private history: string[] = [];
  private cursor: number = -1;
  private currentInput: string = '';
  private initialized = false;

  /**
   * Initializes the history store by opening IndexedDB and loading existing history.
   *
   * This method must be called before using other methods. It loads any
   * previously stored commands from IndexedDB. If IndexedDB is unavailable
   * (e.g., in private browsing), the store falls back to in-memory storage.
   *
   * @returns A promise that resolves when initialization is complete
   *
   * @example
   * ```typescript
   * const history = new HistoryStore();
   * await history.init();
   * // Now ready to use
   * ```
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.db = await this.openDatabase();
      this.history = await this.loadHistory();

      // Trim history if it exceeds maximum (e.g., from older versions with different limits)
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(-MAX_HISTORY);
        // Also trim in IndexedDB
        if (this.db) {
          await this.trimHistory();
        }
      }

      this.cursor = this.history.length;
      this.initialized = true;
    } catch (error) {
      // IndexedDB might not be available, use in-memory only
      console.warn('IndexedDB not available, using in-memory history:', error);
      this.initialized = true;
    }
  }

  /**
   * Open IndexedDB database
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      };
    });
  }

  /**
   * Load history from IndexedDB
   */
  private loadHistory(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }

      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = request.result as { id: number; command: string }[];
        // Sort by ID and extract commands
        items.sort((a, b) => a.id - b.id);
        resolve(items.map((item) => item.command));
      };
    });
  }

  /**
   * Adds a command to the history.
   *
   * The command is stored both in memory and persisted to IndexedDB.
   * Empty commands and consecutive duplicates are ignored.
   *
   * @param command - The command to add to history
   * @returns A promise that resolves when the command has been persisted
   *
   * @example
   * ```typescript
   * await history.add('SELECT * FROM users;');
   * await history.add('SELECT * FROM users;'); // Ignored (duplicate)
   * await history.add(''); // Ignored (empty)
   * ```
   */
  async add(command: string): Promise<void> {
    // Don't add empty or duplicate commands
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }

    // Don't add if same as last command
    if (this.history.length > 0 && this.history[this.history.length - 1] === trimmed) {
      this.reset();
      return;
    }

    this.history.push(trimmed);

    // Limit history size
    while (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    // Persist to IndexedDB
    if (this.db) {
      try {
        await this.saveCommand(trimmed);
        await this.trimHistory();
      } catch (error) {
        console.warn('Failed to save history:', error);
      }
    }

    this.reset();
  }

  /**
   * Save command to IndexedDB
   */
  private saveCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add({ command });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Trim history in IndexedDB to max size.
   *
   * Uses a single transaction for all deletions for better performance.
   */
  private trimHistory(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const count = countRequest.result;
        if (count <= MAX_HISTORY) {
          resolve();
          return;
        }

        // Get oldest entries to delete
        const deleteCount = count - MAX_HISTORY;
        const keysRequest = store.getAllKeys();

        keysRequest.onsuccess = () => {
          const keys = keysRequest.result;
          const keysToDelete = keys.slice(0, deleteCount);

          if (keysToDelete.length === 0) {
            resolve();
            return;
          }

          // Use transaction completion to track when all deletes are done
          // All deletes happen within the same transaction for efficiency
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);

          // Queue all deletions in the same transaction
          for (const key of keysToDelete) {
            store.delete(key);
          }
        };

        keysRequest.onerror = () => reject(keysRequest.error);
      };

      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  /**
   * Navigates to the previous command in history.
   *
   * When called from the end of history (most recent position), this method
   * saves the current input so it can be restored when navigating forward.
   *
   * @param currentInput - The current input buffer content to preserve
   * @returns The previous command, or null if at the beginning of history
   *
   * @example
   * ```typescript
   * // Assuming history has ['SELECT 1;', 'SELECT 2;']
   * const cmd1 = history.previous('SELECT 3'); // Returns 'SELECT 2;'
   * const cmd2 = history.previous('');         // Returns 'SELECT 1;'
   * const cmd3 = history.previous('');         // Returns null (at beginning)
   * ```
   */
  previous(currentInput: string): string | null {
    if (this.history.length === 0) {
      return null;
    }

    // Save current input if at end of history
    if (this.cursor === this.history.length) {
      this.currentInput = currentInput;
    }

    if (this.cursor > 0) {
      this.cursor--;
      return this.history[this.cursor];
    }

    return null;
  }

  /**
   * Navigates to the next command in history.
   *
   * When reaching the end of history, returns the previously saved current input.
   *
   * @returns The next command, the saved current input if at the end, or null if beyond
   *
   * @example
   * ```typescript
   * // After navigating backward with previous()
   * const cmd1 = history.next(); // Returns next newer command
   * const cmd2 = history.next(); // Returns original input when at end
   * ```
   */
  next(): string | null {
    if (this.cursor < this.history.length - 1) {
      this.cursor++;
      return this.history[this.cursor];
    } else if (this.cursor === this.history.length - 1) {
      this.cursor++;
      return this.currentInput;
    }

    return null;
  }

  /**
   * Resets the history cursor to the end and clears the saved current input.
   *
   * This should be called after a command is executed to prepare for new navigation.
   */
  reset(): void {
    this.cursor = this.history.length;
    this.currentInput = '';
  }

  /**
   * Returns a copy of all commands in history.
   *
   * @returns An array of all stored commands, oldest first
   */
  getAll(): string[] {
    return [...this.history];
  }

  /**
   * Clears all history from both memory and IndexedDB.
   *
   * @returns A promise that resolves when the history has been cleared
   */
  async clear(): Promise<void> {
    this.history = [];
    this.cursor = 0;
    this.currentInput = '';

    if (this.db) {
      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
  }
}
