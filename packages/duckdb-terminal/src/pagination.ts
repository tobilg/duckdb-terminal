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
  /** Display query result with the SQL statement that produced it */
  displayResult: (result: QueryResult, sql: string) => Promise<void> | void;
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
  /** Exact number of rows, once known */
  totalRows: number | null;
  /** Number of rows per page */
  pageSize: number;
  /** Whether another page is currently known to be available */
  hasNextPage: boolean;
  /** Whether pagination is active */
  isActive: boolean;
}

export interface ParsedPageSize {
  pageSize: number;
  reset: boolean;
}

class PageOutOfRangeError extends Error {
  constructor(readonly page: number) {
    super(`Page ${page} has no rows`);
    this.name = 'PageOutOfRangeError';
  }
}

/**
 * Validate a `.pagesize` argument and resolve zero to the configured safe cap.
 */
export function parsePageSize(value: string, maxDisplayRows: number): ParsedPageSize | null {
  const requested = Number(value);
  if (
    !Number.isInteger(requested) ||
    requested < 0 ||
    requested > maxDisplayRows
  ) {
    return null;
  }
  return {
    pageSize: requested === 0 ? maxDisplayRows : requested,
    reset: requested === 0,
  };
}

/**
 * PaginationHandler manages the pagination of large query results
 */
export class PaginationHandler {
  private state: PaginationState = {
    query: null,
    currentPage: 0,
    totalRows: null,
    pageSize: 0,
    hasNextPage: false,
    isActive: false,
  };

  private ctx: PaginationContext;

  constructor(ctx: PaginationContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize pagination for a query
   */
  start(query: string, totalRows: number | null, pageSize: number): void {
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize <= 0 ||
      pageSize >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError('pageSize must be a positive integer below Number.MAX_SAFE_INTEGER');
    }
    if (totalRows !== null && (!Number.isSafeInteger(totalRows) || totalRows < 0)) {
      throw new RangeError('totalRows must be a non-negative safe integer or null');
    }
    this.state = {
      query,
      currentPage: 0,
      totalRows,
      pageSize,
      hasNextPage: totalRows !== null && totalRows > pageSize,
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
      totalRows: null,
      pageSize: 0,
      hasNextPage: false,
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
  getTotalPages(): number | null {
    if (this.state.pageSize === 0) return 0;
    if (this.state.totalRows === null) return null;
    return Math.max(1, Math.ceil(this.state.totalRows / this.state.pageSize));
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
  async executeCurrentPage(): Promise<QueryResult | null> {
    if (!this.state.query) return null;

    const offset = this.state.currentPage * this.state.pageSize;
    if (!Number.isSafeInteger(offset)) {
      throw new RangeError('Page offset exceeds JavaScript safe integer range');
    }
    const fetchSize = this.state.totalRows === null
      ? this.state.pageSize + 1
      : this.state.pageSize;
    const paginatedSQL = PaginationHandler.createPageQuery(
      this.state.query,
      fetchSize,
      offset
    );

    const result = await this.ctx.getDatabase().executeQuery(paginatedSQL);
    const hasLookahead = result.rows.length > this.state.pageSize;
    if (hasLookahead) {
      result.rows = result.rows.slice(0, this.state.pageSize);
    }
    result.rowCount = result.rows.length;

    if (this.state.totalRows === null && offset > 0 && result.rowCount === 0) {
      throw new PageOutOfRangeError(this.getCurrentPageDisplay());
    }
    if (this.state.totalRows === null && !hasLookahead) {
      this.state.totalRows = offset + result.rowCount;
    }

    this.state.hasNextPage = this.state.totalRows === null
      ? hasLookahead
      : offset + this.state.pageSize < this.state.totalRows;

    const pagination: NonNullable<QueryResult['pagination']> = {
      page: this.getCurrentPageDisplay(),
      pageSize: this.state.pageSize,
      hasPreviousPage: this.state.currentPage > 0,
      hasNextPage: this.state.hasNextPage,
    };
    const totalPages = this.getTotalPages();
    if (this.state.totalRows !== null && totalPages !== null) {
      pagination.totalRows = this.state.totalRows;
      pagination.totalPages = totalPages;
    }
    result.pagination = pagination;
    await this.ctx.displayResult(result, this.state.query);
    if (this.state.hasNextPage || this.state.currentPage > 0) this.showNavigationHint();
    return result;
  }

  /**
   * Show navigation hint
   */
  showNavigationHint(): void {
    const totalPages = this.getTotalPages();
    const location = totalPages === null
      ? `Page ${this.getCurrentPageDisplay()}`
      : `Page ${this.getCurrentPageDisplay()}/${totalPages} (${this.state.totalRows} rows)`;
    const controls = [
      this.state.hasNextPage ? 'n:next' : null,
      this.state.currentPage > 0 ? 'p:prev' : null,
      totalPages === null ? 'number:goto' : `1-${totalPages}:goto`,
      'q:quit',
    ].filter((control): control is string => control !== null);
    this.ctx.writeln('');
    this.ctx.writeln(vt100.dim(`${location} - ${controls.join(' ')}`));
  }

  /**
   * Handle user input during pagination
   * @returns true if the input was handled, false otherwise
   */
  async handleInput(data: string): Promise<boolean> {
    if (!this.state.isActive) return false;

    const char = data.toLowerCase();

    // Next page
    if (char === 'n' || data === '\x1b[B') {
      if (this.state.hasNextPage) {
        await this.navigateToPage(this.state.currentPage + 1);
      } else {
        this.ctx.writeln(vt100.dim('Already on last page'));
      }
      return true;
    }

    // Previous page
    if (char === 'p' || data === '\x1b[A') {
      if (this.state.currentPage > 0) {
        await this.navigateToPage(this.state.currentPage - 1);
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
        const pageNum = Number(content);
        const totalPages = this.getTotalPages();
        const offset = (pageNum - 1) * this.state.pageSize;
        const isValid = Number.isSafeInteger(pageNum) &&
          pageNum >= 1 &&
          Number.isSafeInteger(offset) &&
          (totalPages === null || pageNum <= totalPages);
        if (isValid) {
          this.ctx.clearInput();
          await this.navigateToPage(pageNum - 1);
        } else {
          const range = totalPages === null ? 'a positive page number' : `1-${totalPages}`;
          this.ctx.writeln(vt100.colorize(`Invalid page number. Enter ${range}`, vt100.FG_RED));
          this.ctx.clearInput();
        }
      } else if (this.state.hasNextPage) {
        await this.navigateToPage(this.state.currentPage + 1);
      } else {
        this.ctx.writeln(vt100.dim('Already on last page'));
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

  private async navigateToPage(page: number): Promise<void> {
    const previousPage = this.state.currentPage;
    this.state.currentPage = page;
    try {
      await this.executeCurrentPage();
    } catch (error) {
      if (error instanceof PageOutOfRangeError) {
        this.state.currentPage = previousPage;
        this.ctx.writeln(vt100.dim(error.message));
        this.showNavigationHint();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.writeln(vt100.colorize(`Error: ${message}`, vt100.FG_RED));
      this.exit();
    }
  }

  /**
   * Check if a query should use pagination
   * @param sql The SQL query
   * @param rowCount The total row count
   * @param pageSize The configured page size
   * @returns Whether pagination should be enabled
   */
  static shouldPaginate(sql: string, rowCount: number, pageSize: number): boolean {
    if (pageSize === 0) return false;
    if (rowCount <= pageSize) return false;
    void sql;
    return true;
  }

  /** Build a bounded page query without modifying the original statement. */
  static createPageQuery(sql: string, pageSize: number, offset: number): string {
    const query = PaginationHandler.prepareQuery(sql);
    return `SELECT * FROM (${query}) AS _page_subquery LIMIT ${pageSize} OFFSET ${offset}`;
  }

  /**
   * Strip trailing semicolon from SQL for pagination
   */
  static prepareQuery(sql: string): string {
    return sql.replace(/;\s*$/, '');
  }
}
