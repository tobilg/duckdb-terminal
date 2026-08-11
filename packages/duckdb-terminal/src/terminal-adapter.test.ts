import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { darkTheme, lightTheme } from './themes';

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
      write: vi.fn().mockImplementation((_text: string, callback?: () => void) => callback?.()),
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
      proposeDimensions: vi.fn(),
    };
  }),
}));

// Import after mocking
import { TerminalAdapter } from './terminal-adapter';

describe('TerminalAdapter', () => {
  let adapter: TerminalAdapter;
  let container: HTMLElement;

  beforeEach(() => {
    adapter = new TerminalAdapter();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    adapter.dispose();
    document.body.removeChild(container);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await adapter.init(container);
      // After init, the terminal should be set up
      expect(adapter.cols).toBe(80);
      expect(adapter.rows).toBe(24);
    });

    it('should not reinitialize if already initialized', async () => {
      await adapter.init(container);
      await adapter.init(container); // Second call should be no-op
      // Should still work
      expect(adapter.cols).toBe(80);
    });

    it('should accept custom options', async () => {
      await adapter.init(container, {
        fontSize: 16,
        fontFamily: 'monospace',
        theme: lightTheme,
      });
      expect(adapter.getTheme()?.name).toBe('light');
    });

    it('should prefer proposed fit dimensions for column count', async () => {
      await adapter.init(container);
      const internals = adapter as unknown as {
        fitAddon: {
          proposeDimensions: ReturnType<typeof vi.fn>;
        };
      };
      internals.fitAddon.proposeDimensions.mockReturnValue({ cols: 48, rows: 20 });

      expect(adapter.cols).toBe(48);
    });

    it('should default to null theme if not provided', async () => {
      await adapter.init(container);
      expect(adapter.getTheme()).toBeNull();
    });
  });

  describe('write operations', () => {
    it('should write text', async () => {
      await adapter.init(container);
      adapter.write('Hello');
      // The mock terminal's write should have been called
      // (we can't easily verify this without more complex mocking)
    });

    it('should write text with newline', async () => {
      await adapter.init(container);
      adapter.writeln('Hello');
      // The mock terminal's writeln should have been called
    });

    it('should resolve async writes through the terminal callback', async () => {
      await adapter.init(container);
      const internals = adapter as unknown as {
        terminal: { write: ReturnType<typeof vi.fn> };
      };

      await expect(adapter.writeAsync('Hello')).resolves.toBeUndefined();
      expect(internals.terminal.write).toHaveBeenCalledWith('Hello', expect.any(Function));
    });

    it('should clear terminal', async () => {
      await adapter.init(container);
      adapter.clear();
      // Clear should write escape sequence
    });
  });

  describe('data handling', () => {
    it('should register data handler', async () => {
      const handler = vi.fn();
      adapter.onData(handler);
      // Handler should be registered
      expect(handler).not.toHaveBeenCalled();
    });

    it('should register resize handler', async () => {
      const handler = vi.fn();
      adapter.onResize(handler);
      // Handler should be registered
      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit word navigation for Option/Alt+Arrow keys', async () => {
      const handler = vi.fn();
      adapter.onData(handler);
      await adapter.init(container);

      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }));
      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).toHaveBeenNthCalledWith(1, '\x1bb');
      expect(handler).toHaveBeenNthCalledWith(2, '\x1bf');
    });

    it('should emit word navigation for Ctrl+Arrow keys', async () => {
      const handler = vi.fn();
      adapter.onData(handler);
      await adapter.init(container);

      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).toHaveBeenNthCalledWith(1, '\x1bb');
      expect(handler).toHaveBeenNthCalledWith(2, '\x1bf');
    });

    it('should emit line navigation for Home and End keys', async () => {
      const handler = vi.fn();
      adapter.onData(handler);
      await adapter.init(container);

      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Home',
        bubbles: true,
        cancelable: true,
      }));
      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }));

      expect(handler).toHaveBeenNthCalledWith(1, '\x1b[H');
      expect(handler).toHaveBeenNthCalledWith(2, '\x1b[F');
    });
  });

  describe('theme', () => {
    it('should set theme', async () => {
      await adapter.init(container);
      adapter.setTheme(lightTheme);
      expect(adapter.getTheme()?.name).toBe('light');
    });

    it('should toggle theme', async () => {
      await adapter.init(container, { theme: darkTheme });
      expect(adapter.getTheme()?.name).toBe('dark');
      adapter.setTheme(lightTheme);
      expect(adapter.getTheme()?.name).toBe('light');
      adapter.setTheme(darkTheme);
      expect(adapter.getTheme()?.name).toBe('dark');
    });
  });

  describe('dimensions', () => {
    it('should return default columns', () => {
      expect(adapter.cols).toBe(80);
    });

    it('should return default rows', () => {
      expect(adapter.rows).toBe(24);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', async () => {
      await adapter.init(container);
      expect(() => adapter.dispose()).not.toThrow();
    });

    it('should dispose even if not initialized', () => {
      expect(() => adapter.dispose()).not.toThrow();
    });
  });

  describe('fit', () => {
    it('should fit without error', async () => {
      await adapter.init(container);
      expect(() => adapter.fit()).not.toThrow();
    });

    it('should not throw if called before init', () => {
      expect(() => adapter.fit()).not.toThrow();
    });
  });

  describe('focus', () => {
    it('should focus without error', async () => {
      await adapter.init(container);
      expect(() => adapter.focus()).not.toThrow();
    });
  });
});
