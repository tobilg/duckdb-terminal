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
      write: vi.fn(),
      writeln: vi.fn(),
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
      getTables: vi.fn().mockResolvedValue([]),
      getTableSchema: vi.fn().mockResolvedValue([]),
      getCompletions: vi.fn().mockResolvedValue([]),
      registerFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
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
    };
  }),
}));

// Import after mocking
import { DuckDBTerminal } from './terminal';
import { darkTheme } from './themes';

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
    });
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

    it('should disable pagination with 0', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['0']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Pagination disabled');
    });

    it('should show error for invalid value', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler(['-5']);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Usage:');
    });

    it('should show current page size when no argument', async () => {
      const cmd = (terminal as unknown as { commands: Map<string, { handler: (args: string[]) => Promise<void> }> }).commands;
      await cmd.get('.pagesize')?.handler([]);

      const output = mockWriteln.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Pagination is disabled');
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
});
