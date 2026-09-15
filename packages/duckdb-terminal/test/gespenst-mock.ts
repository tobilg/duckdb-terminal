import { vi } from 'vitest';
import type { BrowserTerminal, BrowserTerminalEventMap } from '@gespenst/core';

export function createGespenstMock() {
  const listeners = new Map<string, Set<(value: never) => void>>();
  const terminal = {
    element: document.createElement('div'),
    geometry: { cols: 80, rows: 24, cellWidth: 9, cellHeight: 18, width: 720, height: 432 },
    write: vi.fn<BrowserTerminal['write']>(),
    writeAsync: vi.fn<BrowserTerminal['writeAsync']>().mockResolvedValue(undefined),
    fit: vi.fn<BrowserTerminal['fit']>(),
    focus: vi.fn<BrowserTerminal['focus']>(),
    dispose: vi.fn<BrowserTerminal['dispose']>(() => listeners.clear()),
    setTheme: vi.fn<BrowserTerminal['setTheme']>().mockResolvedValue(undefined),
    getSelection: vi.fn<BrowserTerminal['getSelection']>().mockResolvedValue(''),
    scrollLines: vi.fn<BrowserTerminal['scrollLines']>(),
    readViewport: vi.fn<BrowserTerminal['readViewport']>().mockResolvedValue({ viewportRows: [] } as never),
    on: vi.fn(<K extends keyof BrowserTerminalEventMap>(name: K, listener: (value: BrowserTerminalEventMap[K]) => void) => {
      const handlers = listeners.get(name) ?? new Set();
      listeners.set(name, handlers);
      handlers.add(listener as (value: never) => void);
      return { dispose: vi.fn(() => handlers.delete(listener as (value: never) => void)) };
    }),
    emit<K extends keyof BrowserTerminalEventMap>(name: K, value: BrowserTerminalEventMap[K]) {
      for (const listener of listeners.get(name) ?? []) listener(value as never);
    },
  };
  return terminal;
}
export type GespenstMock = ReturnType<typeof createGespenstMock>;
