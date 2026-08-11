import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaginationHandler, parsePageSize, type PaginationContext } from './pagination';

describe('PaginationHandler', () => {
  let ctx: PaginationContext;
  let handler: PaginationHandler;

  beforeEach(() => {
    ctx = {
      write: vi.fn(),
      writeln: vi.fn(),
      getDatabase: vi.fn().mockReturnValue({
        executeQuery: vi.fn().mockResolvedValue({
          columns: ['id', 'name'],
          rows: [
            [1, 'Alice'],
            [2, 'Bob'],
          ],
          rowCount: 2,
          duration: 5,
        }),
      }),
      displayResult: vi.fn(),
      getInputContent: vi.fn().mockReturnValue(''),
      clearInput: vi.fn(),
      insertChar: vi.fn().mockImplementation((char) => char),
      backspace: vi.fn().mockReturnValue('\b \b'),
    };
    handler = new PaginationHandler(ctx);
  });

  describe('initialization', () => {
    it('should not be active by default', () => {
      expect(handler.isActive()).toBe(false);
      expect(handler.getTotalPages()).toBe(0);
    });

    it('should start pagination', () => {
      handler.start('SELECT * FROM users', 100, 20);

      expect(handler.isActive()).toBe(true);
      expect(handler.getTotalPages()).toBe(5);
      expect(handler.getCurrentPageDisplay()).toBe(1);
    });

    it('should represent an empty result as one empty page', () => {
      handler.start('SELECT * FROM users WHERE false', 0, 20);

      expect(handler.getTotalPages()).toBe(1);
      expect(handler.getCurrentPageDisplay()).toBe(1);
    });

    it('should leave totals unknown until a last page is observed', () => {
      handler.start('SELECT * FROM users', null, 20);

      expect(handler.getTotalPages()).toBeNull();
      expect(handler.getState().totalRows).toBeNull();
    });

    it('should exit pagination', () => {
      handler.start('SELECT * FROM users', 100, 20);
      handler.exit();

      expect(handler.isActive()).toBe(false);
    });

    it('should reject unsafe pagination bounds', () => {
      expect(() => handler.start('SELECT 1', null, 0)).toThrow(RangeError);
      expect(() => handler.start('SELECT 1', -1, 20)).toThrow(RangeError);
    });
  });

  describe('page navigation', () => {
    beforeEach(() => {
      handler.start('SELECT * FROM users', 100, 20);
    });

    it('should handle next page', async () => {
      const handled = await handler.handleInput('n');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(2);
    });

    it('should handle previous page', async () => {
      // Move to page 2 first
      await handler.handleInput('n');
      const handled = await handler.handleInput('p');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(1);
    });

    it('should not go past last page', async () => {
      // Try to go beyond page 5
      for (let i = 0; i < 10; i++) {
        await handler.handleInput('n');
      }

      expect(handler.getCurrentPageDisplay()).toBe(5);
    });

    it('should not go before first page', async () => {
      await handler.handleInput('p');

      expect(handler.getCurrentPageDisplay()).toBe(1);
    });

    it('should handle quit', async () => {
      const handled = await handler.handleInput('q');

      expect(handled).toBe(true);
      expect(handler.isActive()).toBe(false);
    });

    it('should handle escape key', async () => {
      const handled = await handler.handleInput('\x1b');

      expect(handled).toBe(true);
      expect(handler.isActive()).toBe(false);
    });

    it('should handle Ctrl+C', async () => {
      const handled = await handler.handleInput('\x03');

      expect(handled).toBe(true);
      expect(handler.isActive()).toBe(false);
    });

    it('should handle digit input', async () => {
      const handled = await handler.handleInput('5');

      expect(handled).toBe(true);
      expect(ctx.write).toHaveBeenCalled();
    });

    it('should handle backspace', async () => {
      const handled = await handler.handleInput('\x7f');

      expect(handled).toBe(true);
      expect(ctx.backspace).toHaveBeenCalled();
    });

    it('should handle page number on Enter', async () => {
      (ctx.getInputContent as ReturnType<typeof vi.fn>).mockReturnValue('3');

      const handled = await handler.handleInput('\r');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(3);
      expect(ctx.clearInput).toHaveBeenCalled();
    });

    it('should use Enter as next when no page number was entered', async () => {
      const handled = await handler.handleInput('\r');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(2);
    });

    it('should reject invalid page number', async () => {
      (ctx.getInputContent as ReturnType<typeof vi.fn>).mockReturnValue('99');

      const handled = await handler.handleInput('\r');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(1); // Should stay on page 1
    });

    it('should report a navigation error and leave pagination mode', async () => {
      const database = ctx.getDatabase() as unknown as { executeQuery: ReturnType<typeof vi.fn> };
      database.executeQuery.mockRejectedValueOnce(new Error('page failed'));

      await handler.handleInput('n');

      expect(ctx.writeln).toHaveBeenCalledWith(expect.stringContaining('Error: page failed'));
      expect(handler.isActive()).toBe(false);
    });
  });

  describe('look-ahead pagination', () => {
    it('should retain one page and omit unknown totals when another row exists', async () => {
      const database = ctx.getDatabase() as unknown as { executeQuery: ReturnType<typeof vi.fn> };
      database.executeQuery.mockResolvedValueOnce({
        columns: ['id'],
        rows: [[1], [2], [3]],
        rowCount: 3,
        duration: 1,
      });
      handler.start('SELECT id FROM users', null, 2);

      const result = await handler.executeCurrentPage();

      expect(database.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM (SELECT id FROM users) AS _page_subquery LIMIT 3 OFFSET 0'
      );
      expect(result?.rows).toEqual([[1], [2]]);
      expect(result?.rowCount).toBe(2);
      expect(result?.pagination).toEqual({
        page: 1,
        pageSize: 2,
        hasPreviousPage: false,
        hasNextPage: true,
      });
      expect(ctx.displayResult).toHaveBeenCalledWith(result, 'SELECT id FROM users');
      expect(handler.getTotalPages()).toBeNull();
    });

    it('should derive exact totals when the last page is reached', async () => {
      const database = ctx.getDatabase() as unknown as { executeQuery: ReturnType<typeof vi.fn> };
      database.executeQuery
        .mockResolvedValueOnce({
          columns: ['id'],
          rows: [[1], [2], [3]],
          rowCount: 3,
          duration: 1,
        })
        .mockResolvedValueOnce({
          columns: ['id'],
          rows: [[3]],
          rowCount: 1,
          duration: 1,
        });
      handler.start('SELECT id FROM users', null, 2);

      await handler.executeCurrentPage();
      await handler.handleInput('n');

      const displayed = (ctx.displayResult as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(displayed.pagination).toEqual({
        page: 2,
        pageSize: 2,
        hasPreviousPage: true,
        hasNextPage: false,
        totalRows: 3,
        totalPages: 2,
      });
      expect(handler.getState().totalRows).toBe(3);
      expect(handler.getTotalPages()).toBe(2);
    });

    it('should reject an unknown page beyond the result and retain the current page', async () => {
      const database = ctx.getDatabase() as unknown as { executeQuery: ReturnType<typeof vi.fn> };
      database.executeQuery
        .mockResolvedValueOnce({
          columns: ['id'],
          rows: [[1], [2], [3]],
          rowCount: 3,
          duration: 1,
        })
        .mockResolvedValueOnce({
          columns: ['id'],
          rows: [],
          rowCount: 0,
          duration: 1,
        });
      handler.start('SELECT id FROM users', null, 2);
      await handler.executeCurrentPage();
      (ctx.getInputContent as ReturnType<typeof vi.fn>).mockReturnValue('99');

      await handler.handleInput('\r');

      expect(handler.getCurrentPageDisplay()).toBe(1);
      expect(handler.getState().totalRows).toBeNull();
      expect(ctx.writeln).toHaveBeenCalledWith(expect.stringContaining('Page 99 has no rows'));
    });
  });

  it('should let an initial page error propagate to the query executor', async () => {
    const database = ctx.getDatabase() as unknown as { executeQuery: ReturnType<typeof vi.fn> };
    database.executeQuery.mockRejectedValueOnce(new Error('initial page failed'));
    handler.start('SELECT * FROM users', 100, 20);

    await expect(handler.executeCurrentPage()).rejects.toThrow('initial page failed');
  });

  describe('static methods', () => {
    describe('parsePageSize', () => {
      it('resolves zero to the safe maximum', () => {
        expect(parsePageSize('0', 1_000)).toEqual({ pageSize: 1_000, reset: true });
      });

      it('accepts only whole numbers within the safe maximum', () => {
        expect(parsePageSize('50', 1_000)).toEqual({ pageSize: 50, reset: false });
        expect(parsePageSize('50rows', 1_000)).toBeNull();
        expect(parsePageSize('1.5', 1_000)).toBeNull();
        expect(parsePageSize('1001', 1_000)).toBeNull();
      });
    });

    describe('shouldPaginate', () => {
      it('should return false when pagination is disabled', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users', 100, 0)).toBe(false);
      });

      it('should return false when row count is less than page size', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users', 10, 20)).toBe(false);
      });

      it('should rely on prepared-query eligibility rather than SQL text', () => {
        expect(PaginationHandler.shouldPaginate('any pageable statement', 100, 20)).toBe(true);
      });

      it('should paginate around an existing LIMIT', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users LIMIT 10', 100, 20)).toBe(true);
      });

      it('should paginate around an existing OFFSET', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users OFFSET 5', 100, 20)).toBe(true);
      });

      it('should return true for pageable SELECT query', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users', 100, 20)).toBe(true);
      });
    });

    describe('prepareQuery', () => {
      it('should strip trailing semicolon', () => {
        expect(PaginationHandler.prepareQuery('SELECT * FROM users;')).toBe('SELECT * FROM users');
      });

      it('should handle query without semicolon', () => {
        expect(PaginationHandler.prepareQuery('SELECT * FROM users')).toBe('SELECT * FROM users');
      });

      it('should handle semicolon with trailing whitespace', () => {
        expect(PaginationHandler.prepareQuery('SELECT * FROM users;  \n')).toBe('SELECT * FROM users');
      });
    });

    describe('createPageQuery', () => {
      it('should wrap the original query before adding the page window', () => {
        expect(PaginationHandler.createPageQuery('SELECT * FROM users LIMIT 100;', 20, 40))
          .toBe('SELECT * FROM (SELECT * FROM users LIMIT 100) AS _page_subquery LIMIT 20 OFFSET 40');
      });
    });
  });
});
