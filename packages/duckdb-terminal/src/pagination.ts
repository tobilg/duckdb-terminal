/**
 * Pagination handler for DuckDB Terminal
 *
 * This module handles the pagination of large query results,
 * including navigation between pages and user input handling.
 *
 * @module pagination
 */

import type { Database } from './database';
import type { QueryResult } from './types';
import * as vt100 from './utils/vt100';

/**
 * Interface for the terminal context needed by pagination
 */
export interface PaginationContext {
  /** Write text to terminal (no newline) */
  write: (text: string) => void;
  /** Write text to terminal with newline */
  writeln: (text: string) => void;
  /** Get the database instance */
  getDatabase: () => Database;
  /** Display query result */
  displayResult: (result: QueryResult, showTiming: boolean) => void;
  /** Get input buffer content */
  getInputContent: () => string;
  /** Clear input buffer */
  clearInput: () => void;
  /** Insert character into input buffer */
  insertChar: (char: string) => string;
  /** Backspace in input buffer */
  backspace: () => string;
}

/**
 * State for pagination
 */
export interface PaginationState {
  /** The original query being paginated */
  query: string | null;
  /** Current page index (0-based) */
  currentPage: number;
  /** Total number of rows in result */
  totalRows: number;
  /** Number of rows per page */
  pageSize: number;
  /** Whether pagination is active */
  isActive: boolean;
}

/**
 * PaginationHandler manages the pagination of large query results
 */
export class PaginationHandler {
  private state: PaginationState = {
    query: null,
    currentPage: 0,
    totalRows: 0,
    pageSize: 0,
    isActive: false,
  };

  private ctx: PaginationContext;

  constructor(ctx: PaginationContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize pagination for a query
   */
  start(query: string, totalRows: number, pageSize: number): void {
    this.state = {
      query,
      currentPage: 0,
      totalRows,
      pageSize,
      isActive: true,
    };
  }

  /**
   * Exit pagination mode
   */
  exit(): void {
    this.state = {
      query: null,
      currentPage: 0,
      totalRows: 0,
      pageSize: 0,
      isActive: false,
    };
  }

  /**
   * Check if pagination is currently active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get current state
   */
  getState(): Readonly<PaginationState> {
    return this.state;
  }

  /**
   * Get the total number of pages
   */
  getTotalPages(): number {
    if (this.state.pageSize === 0) return 0;
    return Math.ceil(this.state.totalRows / this.state.pageSize);
  }

  /**
   * Get current page (1-indexed for display)
   */
  getCurrentPageDisplay(): number {
    return this.state.currentPage + 1;
  }

  /**
   * Execute the paginated query for the current page
   */
  async executeCurrentPage(): Promise<void> {
    if (!this.state.query) return;

    const offset = this.state.currentPage * this.state.pageSize;
    const paginatedSQL = `${this.state.query} LIMIT ${this.state.pageSize} OFFSET ${offset}`;

    try {
      const result = await this.ctx.getDatabase().executeQuery(paginatedSQL);
      this.ctx.displayResult(result, false);
      this.showNavigationHint();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.writeln(vt100.colorize(`Error: ${message}`, vt100.FG_RED));
    }
  }

  /**
   * Show navigation hint
   */
  showNavigationHint(): void {
    const totalPages = this.getTotalPages();
    this.ctx.writeln('');
    this.ctx.writeln(
      vt100.dim(
        `Page ${this.getCurrentPageDisplay()}/${totalPages} ` +
          `(${this.state.totalRows} rows) - ` +
          `n:next p:prev 1-${totalPages}:goto q:quit`
      )
    );
  }

  /**
   * Handle user input during pagination
   * @returns true if the input was handled, false otherwise
   */
  async handleInput(data: string): Promise<boolean> {
    if (!this.state.isActive) return false;

    const totalPages = this.getTotalPages();
    const char = data.toLowerCase();

    // Next page
    if (char === 'n' || data === '\x1b[B') {
      if (this.state.currentPage < totalPages - 1) {
        this.state.currentPage++;
        await this.executeCurrentPage();
      } else {
        this.ctx.writeln(vt100.dim('Already on last page'));
      }
      return true;
    }

    // Previous page
    if (char === 'p' || data === '\x1b[A') {
      if (this.state.currentPage > 0) {
        this.state.currentPage--;
        await this.executeCurrentPage();
      } else {
        this.ctx.writeln(vt100.dim('Already on first page'));
      }
      return true;
    }

    // Quit pagination
    if (char === 'q' || char === '\x1b' || char === '\x03') {
      this.ctx.writeln('');
      this.exit();
      return true;
    }

    // Handle page number input (number + Enter)
    if (char === '\r' || char === '\n') {
      const content = this.ctx.getInputContent().trim();
      if (content) {
        const pageNum = parseInt(content, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
          this.state.currentPage = pageNum - 1;
          this.ctx.clearInput();
          await this.executeCurrentPage();
        } else {
          this.ctx.writeln(vt100.colorize(`Invalid page number. Enter 1-${totalPages}`, vt100.FG_RED));
          this.ctx.clearInput();
        }
      }
      return true;
    }

    // Accumulate digits for page number
    if (/^\d$/.test(char)) {
      this.ctx.write(this.ctx.insertChar(char));
      return true;
    }

    // Backspace
    if (char === '\x7f' || char === '\b') {
      this.ctx.write(this.ctx.backspace());
      return true;
    }

    return false;
  }

  /**
   * Check if a query should use pagination
   * @param sql The SQL query
   * @param rowCount The total row count
   * @param pageSize The configured page size (0 = disabled)
   * @returns Whether pagination should be enabled
   */
  static shouldPaginate(sql: string, rowCount: number, pageSize: number): boolean {
    if (pageSize === 0) return false;
    if (rowCount <= pageSize) return false;

    // Only paginate SELECT queries
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) return false;

    // Skip if query already has LIMIT or OFFSET
    if (/\b(LIMIT|OFFSET)\b/i.test(sql)) return false;

    return true;
  }

  /**
   * Strip trailing semicolon from SQL for pagination
   */
  static prepareQuery(sql: string): string {
    return sql.replace(/;\s*$/, '');
  }
}
