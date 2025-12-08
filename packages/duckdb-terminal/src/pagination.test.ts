import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaginationHandler, type PaginationContext } from './pagination';

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
    });

    it('should start pagination', () => {
      handler.start('SELECT * FROM users', 100, 20);

      expect(handler.isActive()).toBe(true);
      expect(handler.getTotalPages()).toBe(5);
      expect(handler.getCurrentPageDisplay()).toBe(1);
    });

    it('should exit pagination', () => {
      handler.start('SELECT * FROM users', 100, 20);
      handler.exit();

      expect(handler.isActive()).toBe(false);
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

    it('should reject invalid page number', async () => {
      (ctx.getInputContent as ReturnType<typeof vi.fn>).mockReturnValue('99');

      const handled = await handler.handleInput('\r');

      expect(handled).toBe(true);
      expect(handler.getCurrentPageDisplay()).toBe(1); // Should stay on page 1
    });
  });

  describe('static methods', () => {
    describe('shouldPaginate', () => {
      it('should return false when pagination is disabled', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users', 100, 0)).toBe(false);
      });

      it('should return false when row count is less than page size', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users', 10, 20)).toBe(false);
      });

      it('should return false for non-SELECT queries', () => {
        expect(PaginationHandler.shouldPaginate('INSERT INTO users VALUES (1)', 100, 20)).toBe(false);
        expect(PaginationHandler.shouldPaginate('UPDATE users SET name = "test"', 100, 20)).toBe(false);
        expect(PaginationHandler.shouldPaginate('DELETE FROM users', 100, 20)).toBe(false);
      });

      it('should return false when query already has LIMIT', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users LIMIT 10', 100, 20)).toBe(false);
      });

      it('should return false when query already has OFFSET', () => {
        expect(PaginationHandler.shouldPaginate('SELECT * FROM users OFFSET 5', 100, 20)).toBe(false);
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
  });
});
