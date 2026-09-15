import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { darkTheme, lightTheme } from './themes';

vi.mock('@gespenst/core', async () => {
  const { createGespenstMock } = await import('../test/gespenst-mock');
  return { createTerminal: vi.fn(async () => createGespenstMock()) };
});
vi.mock('@gespenst/web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function() {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));

// Import after mocking
import { TerminalAdapter } from './terminal-adapter';
import { createTerminal } from '@gespenst/core';
import type { GespenstMock } from '../test/gespenst-mock';

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

    it('should use authoritative native geometry', async () => {
      await adapter.init(container);
      const native = await vi.mocked(createTerminal).mock.results.at(-1)!.value as unknown as GespenstMock;
      native.geometry.cols = 48;
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

    it('should await native parsing and rendering', async () => {
      await adapter.init(container);
      const native = await vi.mocked(createTerminal).mock.results.at(-1)!.value as unknown as GespenstMock;
      let release!: () => void;
      native.writeAsync.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const completed = vi.fn();
      const write = adapter.writeAsync('Hello').then(completed);
      expect(native.writeAsync).toHaveBeenCalledWith('Hello');
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();
      release();
      await write;
      expect(completed).toHaveBeenCalledOnce();
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
      await adapter.setTheme(lightTheme);
      expect(adapter.getTheme()?.name).toBe('light');
    });

    it('should toggle theme', async () => {
      await adapter.init(container, { theme: darkTheme });
      expect(adapter.getTheme()?.name).toBe('dark');
      await adapter.setTheme(lightTheme);
      expect(adapter.getTheme()?.name).toBe('light');
      await adapter.setTheme(darkTheme);
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

describe('Gespenst adapter boundaries', () => {
  let adapter: TerminalAdapter;
  let container: HTMLElement;
  const native = async () => await vi.mocked(createTerminal).mock.results.at(-1)!.value as unknown as GespenstMock;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TerminalAdapter();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => { adapter.dispose(); container.remove(); vi.unstubAllGlobals(); });

  it('configures both WASM assets, line limits, and selection colors', async () => {
    await adapter.init(container, { scrollbackLines: 0, theme: lightTheme });
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({
      worker: 'dedicated', renderer: 'auto', scrollbackLines: 0,
      wasm: expect.any(String), callbacksWasm: expect.any(String),
      theme: expect.objectContaining({ selectionBackground: lightTheme.colors.selection }),
    }));
  });

  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid scrollback %s', (scrollbackLines) => {
    expect(() => adapter.init(container, { scrollbackLines })).toThrow('scrollbackLines');
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('rejects the removed byte-based setting', () => {
    expect(() => adapter.init(container, { scrollback: 1024 } as never)).toThrow('Use scrollbackLines');
  });

  it('decodes split UTF-8 and separates paste from protocol replies', async () => {
    const input = vi.fn();
    const paste = vi.fn();
    adapter.onData(input);
    adapter.onPaste(paste);
    await adapter.init(container);
    const terminal = await native();
    const bytes = new TextEncoder().encode('🦆');
    terminal.emit('input', { data: bytes.slice(0, 2), source: 'text' });
    expect(input).not.toHaveBeenCalled();
    terminal.emit('input', { data: bytes.slice(2), source: 'text' });
    expect(input).toHaveBeenCalledExactlyOnceWith('🦆');
    terminal.emit('input', { data: new TextEncoder().encode('SELECT\n 1;'), source: 'paste' });
    expect(paste).toHaveBeenCalledExactlyOnceWith('SELECT\n 1;');
    for (const source of ['reply', 'mouse', 'focus'] as const) terminal.emit('input', { data: bytes, source });
    expect(input).toHaveBeenCalledTimes(1);
  });

  it('subscribes to native geometry and cleans up subscriptions', async () => {
    const resize = vi.fn();
    adapter.onResize(resize);
    await adapter.init(container);
    const terminal = await native();
    terminal.emit('resize', { ...terminal.geometry, cols: 40 } as never);
    expect(resize).toHaveBeenCalledWith(40, 24);
    adapter.dispose();
    terminal.emit('resize', { ...terminal.geometry, cols: 20 } as never);
    expect(resize).toHaveBeenCalledTimes(1);
    for (const result of terminal.on.mock.results) expect(result.value.dispose).toHaveBeenCalledOnce();
    adapter.dispose();
    expect(terminal.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the prior theme on failure and can apply the next theme', async () => {
    await adapter.init(container, { theme: darkTheme });
    const terminal = await native();
    terminal.setTheme.mockRejectedValueOnce(new Error('renderer failed'));
    await expect(adapter.setTheme(lightTheme)).rejects.toThrow('renderer failed');
    expect(adapter.getTheme()).toBe(darkTheme);
    await adapter.setTheme(lightTheme);
    expect(adapter.getTheme()).toBe(lightTheme);
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(terminal.write).not.toHaveBeenCalled();
  });

  it('disposes a terminal that finishes initializing after teardown', async () => {
    const { createGespenstMock } = await import('../test/gespenst-mock');
    const terminal = createGespenstMock();
    let finish!: (value: unknown) => void;
    vi.mocked(createTerminal).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as never; }));
    const initializing = adapter.init(container);
    adapter.dispose();
    finish(terminal);
    await expect(initializing).rejects.toThrow('disposed during initialization');
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(terminal.on).not.toHaveBeenCalled();
  });

  it('starts Safari clipboard writes before the worker selection resolves', async () => {
    await adapter.init(container);
    const terminal = await native();
    let resolveSelection!: (value: string) => void;
    terminal.getSelection.mockImplementationOnce(() => new Promise((resolve) => { resolveSelection = resolve; }));
    const write = vi.fn().mockResolvedValue(undefined);
    const item = vi.fn(function(this: { contents: unknown }, contents: unknown) { this.contents = contents; });
    vi.stubGlobal('ClipboardItem', item);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    container.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', metaKey: true, bubbles: true }));
    expect(write).toHaveBeenCalledOnce();
    const contents = item.mock.calls[0][0] as { 'text/plain': Promise<Blob> };
    resolveSelection('selected SQL');
    expect((await contents['text/plain']).size).toBe(12);
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});
