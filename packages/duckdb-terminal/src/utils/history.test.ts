import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryStore } from './history';

// Simple IndexedDB mock
const createMockIndexedDB = () => {
  const stores: Map<string, Map<number, { id: number; command: string }>> = new Map();
  let nextId = 1;

  const mockStore = {
    add: vi.fn((item: { command: string }) => {
      const request = {
        result: nextId,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        const store = stores.get('history') || new Map();
        store.set(nextId, { id: nextId, command: item.command });
        stores.set('history', store);
        nextId++;
        request.onsuccess?.();
      }, 0);
      return request;
    }),
    getAll: vi.fn(() => {
      const request = {
        result: [] as { id: number; command: string }[],
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        const store = stores.get('history') || new Map();
        request.result = Array.from(store.values());
        request.onsuccess?.();
      }, 0);
      return request;
    }),
    getAllKeys: vi.fn(() => {
      const request = {
        result: [] as number[],
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        const store = stores.get('history') || new Map();
        request.result = Array.from(store.keys());
        request.onsuccess?.();
      }, 0);
      return request;
    }),
    count: vi.fn(() => {
      const request = {
        result: 0,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        const store = stores.get('history') || new Map();
        request.result = store.size;
        request.onsuccess?.();
      }, 0);
      return request;
    }),
    delete: vi.fn((key: number) => {
      const request = {
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        const store = stores.get('history') || new Map();
        store.delete(key);
        request.onsuccess?.();
      }, 0);
      return request;
    }),
    clear: vi.fn(() => {
      const request = {
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      setTimeout(() => {
        stores.set('history', new Map());
        request.onsuccess?.();
      }, 0);
      return request;
    }),
  };

  const mockTransaction = {
    objectStore: vi.fn(() => mockStore),
  };

  const mockDB = {
    transaction: vi.fn(() => mockTransaction),
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    createObjectStore: vi.fn(),
  };

  const mockRequest = {
    result: mockDB,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as ((event: { target: { result: typeof mockDB } }) => void) | null,
  };

  return {
    open: vi.fn(() => {
      setTimeout(() => {
        mockRequest.onsuccess?.();
      }, 0);
      return mockRequest;
    }),
    stores,
    reset: () => {
      stores.clear();
      stores.set('history', new Map());
      nextId = 1;
    },
  };
};

describe('HistoryStore', () => {
  let history: HistoryStore;
  let mockIDB: ReturnType<typeof createMockIndexedDB>;

  beforeEach(() => {
    mockIDB = createMockIndexedDB();
    vi.stubGlobal('indexedDB', mockIDB);
    history = new HistoryStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      await history.init();
      expect(history.getAll()).toEqual([]);
    });

    it('should not reinitialize if already initialized', async () => {
      await history.init();
      await history.init(); // Second call should be no-op
      expect(history.getAll()).toEqual([]);
    });
  });

  describe('add', () => {
    it('should add command to history', async () => {
      await history.init();
      await history.add('SELECT 1');
      expect(history.getAll()).toContain('SELECT 1');
    });

    it('should not add empty commands', async () => {
      await history.init();
      await history.add('');
      await history.add('   ');
      expect(history.getAll()).toEqual([]);
    });

    it('should not add duplicate consecutive commands', async () => {
      await history.init();
      await history.add('SELECT 1');
      await history.add('SELECT 1');
      expect(history.getAll()).toEqual(['SELECT 1']);
    });

    it('should add different commands', async () => {
      await history.init();
      await history.add('SELECT 1');
      await history.add('SELECT 2');
      expect(history.getAll()).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('should trim whitespace', async () => {
      await history.init();
      await history.add('  SELECT 1  ');
      expect(history.getAll()).toEqual(['SELECT 1']);
    });
  });

  describe('previous/next navigation', () => {
    beforeEach(async () => {
      await history.init();
      await history.add('command1');
      await history.add('command2');
      await history.add('command3');
    });

    it('should navigate to previous command', () => {
      const prev = history.previous('');
      expect(prev).toBe('command3');
    });

    it('should navigate through history', () => {
      expect(history.previous('')).toBe('command3');
      expect(history.previous('')).toBe('command2');
      expect(history.previous('')).toBe('command1');
    });

    it('should return null at beginning of history', () => {
      history.previous('');
      history.previous('');
      history.previous('');
      expect(history.previous('')).toBeNull();
    });

    it('should navigate forward with next', () => {
      history.previous('');
      history.previous('');
      expect(history.next()).toBe('command3');
    });

    it('should restore current input when navigating past end', () => {
      history.previous('current');
      history.previous('');
      expect(history.next()).toBe('command3');
      expect(history.next()).toBe('current');
    });
  });

  describe('empty history', () => {
    it('should return null if no history', async () => {
      await history.init();
      expect(history.previous('')).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset cursor to end', async () => {
      await history.init();
      await history.add('command1');
      await history.add('command2');

      history.previous('');
      history.reset();

      // After reset, previous should return last command again
      expect(history.previous('')).toBe('command2');
    });
  });

  describe('getAll', () => {
    it('should return copy of history', async () => {
      await history.init();
      await history.add('command1');

      const all = history.getAll();
      all.push('modified');

      expect(history.getAll()).toEqual(['command1']);
    });
  });

  describe('clear', () => {
    it('should clear all history', async () => {
      await history.init();
      await history.add('command1');
      await history.add('command2');

      await history.clear();

      expect(history.getAll()).toEqual([]);
    });
  });
});
