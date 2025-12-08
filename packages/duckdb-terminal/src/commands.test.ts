import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCommands, type CommandContext } from './commands';

function createMockContext(): CommandContext & { mockWriteln: ReturnType<typeof vi.fn> } {
  const mockWriteln = vi.fn();
  return {
    mockWriteln,
    write: vi.fn() as (text: string) => void,
    writeln: mockWriteln as (text: string) => void,
    clear: vi.fn() as () => void,
    getDatabase: vi.fn().mockReturnValue({
      getTables: vi.fn().mockResolvedValue([]),
      getTableSchema: vi.fn().mockResolvedValue([]),
      dropFile: vi.fn().mockResolvedValue(undefined),
    }),
    getLoadedFiles: vi.fn().mockReturnValue(new Map()),
    getLastQueryResult: vi.fn().mockReturnValue(null),
    getOutputMode: vi.fn().mockReturnValue('table') as () => 'table' | 'csv' | 'tsv' | 'json',
    setOutputMode: vi.fn() as (mode: 'table' | 'csv' | 'tsv' | 'json') => void,
    getShowTimer: vi.fn().mockReturnValue(false) as () => boolean,
    setShowTimer: vi.fn() as (enabled: boolean) => void,
    getSyntaxHighlighting: vi.fn().mockReturnValue(true) as () => boolean,
    setSyntaxHighlighting: vi.fn() as (enabled: boolean) => void,
    getLinkProvider: vi.fn().mockReturnValue({
      isEnabled: vi.fn().mockReturnValue(true),
      setEnabled: vi.fn(),
    }),
    getPageSize: vi.fn().mockReturnValue(0) as () => number,
    setPageSize: vi.fn() as (size: number) => void,
    getPrompt: vi.fn().mockReturnValue('D > ') as () => string,
    getContinuationPrompt: vi.fn().mockReturnValue('  > ') as () => string,
    setPrompts: vi.fn() as (primary: string, continuation?: string) => void,
    getHighlightedSQL: vi.fn().mockImplementation((sql: string) => sql) as (sql: string) => string,
    setTheme: vi.fn() as (theme: 'dark' | 'light') => void,
    getThemeName: vi.fn().mockReturnValue('dark') as () => string,
    loadFile: vi.fn().mockResolvedValue(undefined) as (file: File) => Promise<void>,
    removeFile: vi.fn().mockResolvedValue(undefined) as (filename: string) => Promise<void>,
    resetState: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
  };
}

describe('Commands', () => {
  let ctx: CommandContext & { mockWriteln: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should create all commands', () => {
    const commands = createCommands(ctx);

    expect(commands.has('.help')).toBe(true);
    expect(commands.has('.clear')).toBe(true);
    expect(commands.has('.tables')).toBe(true);
    expect(commands.has('.schema')).toBe(true);
    expect(commands.has('.timer')).toBe(true);
    expect(commands.has('.mode')).toBe(true);
    expect(commands.has('.theme')).toBe(true);
    expect(commands.has('.examples')).toBe(true);
    expect(commands.has('.files')).toBe(true);
    expect(commands.has('.open')).toBe(true);
    expect(commands.has('.copy')).toBe(true);
    expect(commands.has('.highlight')).toBe(true);
    expect(commands.has('.links')).toBe(true);
    expect(commands.has('.pagesize')).toBe(true);
    expect(commands.has('.reset')).toBe(true);
    expect(commands.has('.prompt')).toBe(true);
  });

  describe('.help command', () => {
    it('should display help text', async () => {
      const commands = createCommands(ctx);
      await commands.get('.help')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Available commands:');
      expect(output).toContain('.help');
    });
  });

  describe('.timer command', () => {
    it('should turn timer on', async () => {
      const commands = createCommands(ctx);
      await commands.get('.timer')?.handler(['on']);

      expect(ctx.setShowTimer).toHaveBeenCalledWith(true);
    });

    it('should turn timer off', async () => {
      const commands = createCommands(ctx);
      await commands.get('.timer')?.handler(['off']);

      expect(ctx.setShowTimer).toHaveBeenCalledWith(false);
    });
  });

  describe('.mode command', () => {
    it('should set output mode', async () => {
      const commands = createCommands(ctx);
      await commands.get('.mode')?.handler(['csv']);

      expect(ctx.setOutputMode).toHaveBeenCalledWith('csv');
    });

    it('should show current mode when no args', async () => {
      const commands = createCommands(ctx);
      await commands.get('.mode')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Output mode:');
    });
  });

  describe('.highlight command', () => {
    it('should enable highlighting', async () => {
      const commands = createCommands(ctx);
      await commands.get('.highlight')?.handler(['on']);

      expect(ctx.setSyntaxHighlighting).toHaveBeenCalledWith(true);
    });

    it('should disable highlighting', async () => {
      const commands = createCommands(ctx);
      await commands.get('.highlight')?.handler(['off']);

      expect(ctx.setSyntaxHighlighting).toHaveBeenCalledWith(false);
    });
  });

  describe('.pagesize command', () => {
    it('should set page size', async () => {
      const commands = createCommands(ctx);
      await commands.get('.pagesize')?.handler(['50']);

      expect(ctx.setPageSize).toHaveBeenCalledWith(50);
    });

    it('should disable pagination with 0', async () => {
      const commands = createCommands(ctx);
      await commands.get('.pagesize')?.handler(['0']);

      expect(ctx.setPageSize).toHaveBeenCalledWith(0);
    });
  });

  describe('.prompt command', () => {
    it('should show current prompts when no args', async () => {
      const commands = createCommands(ctx);
      await commands.get('.prompt')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Primary prompt:');
      expect(output).toContain('Continuation prompt:');
    });

    it('should set primary prompt', async () => {
      const commands = createCommands(ctx);
      await commands.get('.prompt')?.handler(['SQL>']);

      expect(ctx.setPrompts).toHaveBeenCalledWith('SQL>');
    });

    it('should set both prompts', async () => {
      const commands = createCommands(ctx);
      await commands.get('.prompt')?.handler(['SQL>', '...']);

      expect(ctx.setPrompts).toHaveBeenCalledWith('SQL>', '...');
    });
  });

  describe('.clear command', () => {
    it('should call clear', async () => {
      const commands = createCommands(ctx);
      await commands.get('.clear')?.handler([]);

      expect(ctx.clear).toHaveBeenCalled();
    });
  });

  describe('.tables command', () => {
    it('should show no tables message when empty', async () => {
      const commands = createCommands(ctx);
      await commands.get('.tables')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('No tables found');
    });

    it('should list tables', async () => {
      (ctx.getDatabase as ReturnType<typeof vi.fn>).mockReturnValue({
        getTables: vi.fn().mockResolvedValue(['users', 'orders']),
      });

      const commands = createCommands(ctx);
      await commands.get('.tables')?.handler([]);

      expect(ctx.mockWriteln).toHaveBeenCalledWith('users');
      expect(ctx.mockWriteln).toHaveBeenCalledWith('orders');
    });
  });

  describe('.schema command', () => {
    it('should show usage when no table specified', async () => {
      const commands = createCommands(ctx);
      await commands.get('.schema')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should show table not found', async () => {
      const commands = createCommands(ctx);
      await commands.get('.schema')?.handler(['nonexistent']);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Table not found');
    });
  });

  describe('.files command', () => {
    it('should show no files message', async () => {
      const commands = createCommands(ctx);
      await commands.get('.files')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('No files loaded');
    });

    it('should show usage for remove without args', async () => {
      const commands = createCommands(ctx);
      await commands.get('.files')?.handler(['remove']);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });
  });

  describe('.copy command', () => {
    it('should show no results message', async () => {
      const commands = createCommands(ctx);
      await commands.get('.copy')?.handler([]);

      const output = ctx.mockWriteln.mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('No query result to copy');
    });
  });
});
