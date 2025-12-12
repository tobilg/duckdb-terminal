/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SharingModal } from './sharing-modal';

// Mock clipboard
vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

describe('SharingModal', () => {
  let container: HTMLDivElement;
  let modal: SharingModal;

  beforeEach(() => {
    // Mock scrollIntoView which is not available in jsdom
    Element.prototype.scrollIntoView = vi.fn();

    // Set up DOM container
    container = document.createElement('div');
    container.style.position = 'relative';
    document.body.appendChild(container);

    // Mock window.location
    delete (window as any).location;
    window.location = {
      protocol: 'https:',
      hostname: 'example.com',
      port: '',
      pathname: '/',
      hash: '',
    } as any;

    // Use fake timers to control async operations
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    modal?.destroy();
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  // Helper to advance timers and flush promises
  async function showModal(m: SharingModal, queries: string[]): Promise<void> {
    const showPromise = m.show(queries);
    // Advance past the TRANSITION_DURATION (200ms)
    await vi.advanceTimersByTimeAsync(250);
    await showPromise;
  }

  async function hideModal(m: SharingModal): Promise<void> {
    const hidePromise = m.hide();
    await vi.advanceTimersByTimeAsync(250);
    await hidePromise;
  }

  describe('constructor', () => {
    it('should create a modal instance', () => {
      modal = new SharingModal(container);
      expect(modal).toBeInstanceOf(SharingModal);
    });

    it('should initialize with hidden state', () => {
      modal = new SharingModal(container);
      expect(modal.getState()).toBe('hidden');
    });

    it('should accept custom configuration', () => {
      modal = new SharingModal(container, {}, {
        maxUrlLength: 1000,
        initialQueryCount: 10,
        loadMoreCount: 10,
      });
      expect(modal).toBeInstanceOf(SharingModal);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      modal = new SharingModal(container);
      expect(modal.getState()).toBe('hidden');
    });
  });

  describe('isVisible', () => {
    it('should return false when hidden', () => {
      modal = new SharingModal(container);
      expect(modal.isVisible()).toBe(false);
    });

    it('should return true when visible', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      expect(modal.isVisible()).toBe(true);
    });
  });

  describe('show', () => {
    it('should show the modal', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      expect(modal.getState()).toBe('visible');
    });

    it('should filter out dot commands', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['.help', 'SELECT 1;', '.tables', 'SELECT 2;']);
      // Should only have SQL queries, no dot commands
      expect(modal.getSelectedQueries()).toEqual([]);
    });

    it('should create overlay in container', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      const overlay = container.querySelector('.duckdb-sharing-overlay');
      expect(overlay).not.toBeNull();
    });

    it('should create modal container', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      const modalEl = container.querySelector('.duckdb-sharing-modal');
      expect(modalEl).not.toBeNull();
    });

    it('should not show again if already visible', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      const firstOverlay = container.querySelector('.duckdb-sharing-overlay');
      await showModal(modal, ['SELECT 2;']);
      const secondOverlay = container.querySelector('.duckdb-sharing-overlay');
      expect(firstOverlay).toBe(secondOverlay);
    });

    it('should display query items', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);
      const items = container.querySelectorAll('.duckdb-sharing-query-item');
      expect(items.length).toBe(3);
    });

    it('should show empty state when no queries', async () => {
      modal = new SharingModal(container);
      await showModal(modal, []);
      const emptyState = container.querySelector('.duckdb-sharing-query-list div');
      expect(emptyState?.textContent).toContain('No SQL queries');
    });

    it('should limit initial display to configured count', async () => {
      modal = new SharingModal(container, {}, { initialQueryCount: 2 });
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;', 'SELECT 4;', 'SELECT 5;']);
      const items = container.querySelectorAll('.duckdb-sharing-query-item');
      expect(items.length).toBe(2);
    });

    it('should show "load more" button when there are more queries', async () => {
      modal = new SharingModal(container, {}, { initialQueryCount: 2 });
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);
      const loadMoreBtn = container.querySelector('.duckdb-sharing-load-more');
      expect(loadMoreBtn).not.toBeNull();
      expect(loadMoreBtn?.textContent).toContain('1 more');
    });
  });

  describe('hide', () => {
    it('should hide the modal', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      await hideModal(modal);
      expect(modal.getState()).toBe('hidden');
    });

    it('should remove overlay from DOM', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      await hideModal(modal);
      const overlay = container.querySelector('.duckdb-sharing-overlay');
      expect(overlay).toBeNull();
    });

    it('should not hide if already hidden', async () => {
      modal = new SharingModal(container);
      await hideModal(modal);
      expect(modal.getState()).toBe('hidden');
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      modal.destroy();
      expect(modal.getState()).toBe('hidden');
      const overlay = container.querySelector('.duckdb-sharing-overlay');
      expect(overlay).toBeNull();
    });
  });

  describe('getSelectedQueries', () => {
    it('should return empty array when nothing selected', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);
      expect(modal.getSelectedQueries()).toEqual([]);
    });
  });

  describe('keyboard navigation', () => {
    it('should close on Escape key', async () => {
      const onDismiss = vi.fn();
      modal = new SharingModal(container, { onDismiss });
      await showModal(modal, ['SELECT 1;']);

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);

      // Wait for hide animation with fake timers
      await vi.advanceTimersByTimeAsync(250);

      expect(modal.getState()).toBe('hidden');
      expect(onDismiss).toHaveBeenCalled();
    });

    it('should toggle selection with Space key', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);

      // Focus should be on first item (index 0)
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      document.dispatchEvent(event);

      expect(modal.getSelectedQueries()).toEqual(['SELECT 1;']);
    });

    it('should copy and close on Enter with selections', async () => {
      const onCopy = vi.fn();
      modal = new SharingModal(container, { onCopy });
      await showModal(modal, ['SELECT 1;']);

      // Select a query first
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      document.dispatchEvent(spaceEvent);

      // Press Enter to copy
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(enterEvent);

      // Wait for clipboard and hide animation
      await vi.advanceTimersByTimeAsync(300);

      expect(onCopy).toHaveBeenCalled();
    });
  });

  describe('click interactions', () => {
    it('should close when clicking overlay backdrop', async () => {
      const onDismiss = vi.fn();
      modal = new SharingModal(container, { onDismiss });
      await showModal(modal, ['SELECT 1;']);

      const overlay = container.querySelector('.duckdb-sharing-overlay') as HTMLElement;
      overlay.click();

      // Wait for hide animation
      await vi.advanceTimersByTimeAsync(250);

      expect(modal.getState()).toBe('hidden');
      expect(onDismiss).toHaveBeenCalled();
    });

    it('should toggle selection when clicking query item', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;', 'SELECT 2;']);

      const items = container.querySelectorAll('.duckdb-sharing-query-item');
      (items[0] as HTMLElement).click();

      expect(modal.getSelectedQueries().length).toBe(1);
    });
  });

  describe('character limit', () => {
    it('should update character count in footer', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);

      const charCount = container.querySelector('.sharing-char-count');
      expect(charCount?.textContent).toContain('/ 2000 characters');
    });

    it('should disable copy button when nothing selected', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);

      const copyBtn = container.querySelector('.duckdb-sharing-copy-btn') as HTMLButtonElement;
      expect(copyBtn.disabled).toBe(true);
    });

    it('should enable copy button when queries selected', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;']);

      // Select a query
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      document.dispatchEvent(spaceEvent);

      const copyBtn = container.querySelector('.duckdb-sharing-copy-btn') as HTMLButtonElement;
      expect(copyBtn.disabled).toBe(false);
    });
  });

  describe('query ordering', () => {
    it('should maintain execution order (oldest first) for selected queries', async () => {
      modal = new SharingModal(container);
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);

      // Select queries in reverse display order
      const items = container.querySelectorAll('.duckdb-sharing-query-item');
      // Display is: oldest at top (index 2), newest at bottom (index 0)
      // Click the top item (oldest query)
      (items[0] as HTMLElement).click();
      // Click the bottom item (newest query)
      (items[2] as HTMLElement).click();

      const selected = modal.getSelectedQueries();
      // Should be in execution order: oldest first
      expect(selected[0]).toBe('SELECT 1;');
      expect(selected[1]).toBe('SELECT 3;');
    });
  });

  describe('load more functionality', () => {
    it('should load more queries when button clicked', async () => {
      modal = new SharingModal(container, {}, { initialQueryCount: 2, loadMoreCount: 2 });
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;', 'SELECT 4;']);

      let items = container.querySelectorAll('.duckdb-sharing-query-item');
      expect(items.length).toBe(2);

      const loadMoreBtn = container.querySelector('.duckdb-sharing-load-more') as HTMLElement;
      loadMoreBtn.click();

      items = container.querySelectorAll('.duckdb-sharing-query-item');
      expect(items.length).toBe(4);
    });

    it('should hide load more button when all queries loaded', async () => {
      modal = new SharingModal(container, {}, { initialQueryCount: 2, loadMoreCount: 3 });
      await showModal(modal, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);

      const loadMoreBtn = container.querySelector('.duckdb-sharing-load-more') as HTMLElement;
      loadMoreBtn.click();

      const newLoadMoreBtn = container.querySelector('.duckdb-sharing-load-more');
      expect(newLoadMoreBtn).toBeNull();
    });
  });

  describe('events', () => {
    it('should call onDismiss when modal dismissed via close button', async () => {
      const onDismiss = vi.fn();
      modal = new SharingModal(container, { onDismiss });
      await showModal(modal, ['SELECT 1;']);

      // Find and click the close button
      const closeBtn = container.querySelector('.duckdb-sharing-modal button') as HTMLElement;
      closeBtn.click();

      // Wait for hide animation
      await vi.advanceTimersByTimeAsync(250);

      expect(onDismiss).toHaveBeenCalled();
    });

    it('should call onCopy when URL is copied', async () => {
      const onCopy = vi.fn();
      modal = new SharingModal(container, { onCopy });
      await showModal(modal, ['SELECT 1;']);

      // Select a query
      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      document.dispatchEvent(spaceEvent);

      // Click copy button
      const copyBtn = container.querySelector('.duckdb-sharing-copy-btn') as HTMLElement;
      copyBtn.click();

      // Wait for clipboard operation
      await vi.advanceTimersByTimeAsync(100);

      expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('#$queries=v1'));
    });
  });
});
