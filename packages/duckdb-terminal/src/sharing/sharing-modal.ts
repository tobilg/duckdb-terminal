/**
 * Sharing modal for selecting and sharing SQL queries from history
 */

import type {
  SharingModalState,
  ShareableQuery,
  SharingModalEvents,
  SharingModalConfig,
} from './types';
import {
  encodeQueryForURL,
  generateShareableURL,
  MAX_URL_LENGTH,
} from './url-encoding';
import { copyToClipboard } from '../utils/clipboard';

/** Default configuration values */
const DEFAULT_CONFIG: Required<SharingModalConfig> = {
  maxUrlLength: MAX_URL_LENGTH,
  initialQueryCount: 5,
  loadMoreCount: 5,
};

/**
 * Manages the sharing modal overlay for selecting queries to share.
 * Displays query history, allows selection, and generates shareable URLs.
 */
export class SharingModal {
  private container: HTMLElement;
  private overlay: HTMLDivElement | null = null;
  private modalContainer: HTMLDivElement | null = null;
  private queryListContainer: HTMLDivElement | null = null;
  private footerContainer: HTMLDivElement | null = null;
  private state: SharingModalState = 'hidden';
  private events: SharingModalEvents;
  private config: Required<SharingModalConfig>;

  // Query state
  private allQueries: string[] = [];
  private displayedQueries: ShareableQuery[] = [];
  private selectedIndices: Set<number> = new Set();
  private focusedIndex: number = -1;
  private displayedCount: number = 0;

  // Event handlers
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  /** Transition duration in milliseconds */
  private readonly TRANSITION_DURATION = 200;

  /**
   * Creates a new SharingModal instance.
   * @param container - The parent HTML element to attach the modal to
   * @param events - Event handlers for modal interactions
   * @param config - Configuration options
   */
  constructor(
    container: HTMLElement,
    events: SharingModalEvents = {},
    config: SharingModalConfig = {}
  ) {
    this.container = container;
    this.events = events;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current modal state.
   */
  getState(): SharingModalState {
    return this.state;
  }

  /**
   * Check if modal is currently visible or in the process of showing.
   */
  isVisible(): boolean {
    return this.state === 'visible' || this.state === 'showing';
  }

  /**
   * Show the modal with the given queries.
   * @param queries - Array of SQL queries from history (oldest first)
   */
  async show(queries: string[]): Promise<void> {
    if (this.state === 'visible' || this.state === 'showing') {
      return;
    }

    // Filter out dot commands and store in reverse order (newest first for display)
    this.allQueries = queries
      .filter((q) => !q.trim().startsWith('.'))
      .reverse();

    this.selectedIndices.clear();
    this.displayedCount = 0;
    this.focusedIndex = -1;
    this.state = 'showing';

    this.createOverlay();
    this.loadInitialQueries();
    this.setupKeyboardHandler();
    this.updateFooter();

    return new Promise((resolve) => {
      // Force reflow
      this.overlay?.offsetHeight;

      if (this.overlay) {
        this.overlay.style.opacity = '1';
      }

      setTimeout(() => {
        this.state = 'visible';
        // Focus the newest query item (at bottom of visual list, index 0 in displayedQueries)
        if (this.displayedQueries.length > 0) {
          this.focusedIndex = 0; // Index 0 = newest query (at bottom of visual list)
          this.updateFocusedItem();
        }
        resolve();
      }, this.TRANSITION_DURATION);
    });
  }

  /**
   * Hide the modal with fade-out animation.
   */
  async hide(): Promise<void> {
    if (this.state === 'hidden' || this.state === 'hiding') {
      return;
    }

    this.state = 'hiding';

    if (this.overlay) {
      this.overlay.style.opacity = '0';
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        this.destroyOverlay();
        this.state = 'hidden';
        resolve();
      }, this.TRANSITION_DURATION);
    });
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.destroyOverlay();
    this.state = 'hidden';
  }

  /**
   * Get the currently selected queries in execution order.
   */
  getSelectedQueries(): string[] {
    // Get selected queries in their original order (oldest to newest for execution)
    const selected: { index: number; query: string }[] = [];

    for (const displayIndex of this.selectedIndices) {
      const queryItem = this.displayedQueries[displayIndex];
      if (queryItem) {
        // Convert display index back to original index
        const originalIndex = this.allQueries.length - 1 - displayIndex;
        selected.push({ index: originalIndex, query: queryItem.query });
      }
    }

    // Sort by original index (ascending = oldest first)
    selected.sort((a, b) => a.index - b.index);
    return selected.map((s) => s.query);
  }

  /**
   * Calculate current URL length for selected queries.
   */
  private getCurrentURLLength(): number {
    const queries = this.getSelectedQueries();
    return generateShareableURL(queries).characterCount;
  }

  /**
   * Check if adding a query would exceed the limit.
   */
  private wouldExceedLimit(query: string): boolean {
    const currentQueries = this.getSelectedQueries();
    const newLength = generateShareableURL([...currentQueries, query]).characterCount;
    return newLength > this.config.maxUrlLength;
  }

  /**
   * Load initial batch of queries.
   */
  private loadInitialQueries(): void {
    this.displayedQueries = [];
    this.displayedCount = Math.min(this.config.initialQueryCount, this.allQueries.length);

    for (let i = 0; i < this.displayedCount; i++) {
      const query = this.allQueries[i];
      this.displayedQueries.push({
        query,
        order: this.allQueries.length - i, // Order shows position from oldest
        selected: false,
        encodedLength: encodeQueryForURL(query).length + 1,
      });
    }

    this.renderQueryList();
  }

  /**
   * Load more older queries.
   */
  private loadMoreQueries(): void {
    const startIndex = this.displayedCount;
    const endIndex = Math.min(startIndex + this.config.loadMoreCount, this.allQueries.length);

    for (let i = startIndex; i < endIndex; i++) {
      const query = this.allQueries[i];
      this.displayedQueries.push({
        query,
        order: this.allQueries.length - i,
        selected: false,
        encodedLength: encodeQueryForURL(query).length + 1,
      });
    }

    this.displayedCount = endIndex;
    this.renderQueryList();
  }

  /**
   * Check if there are more queries to load.
   */
  private hasMoreQueries(): boolean {
    return this.displayedCount < this.allQueries.length;
  }

  /**
   * Toggle selection of a query.
   */
  private toggleSelection(displayIndex: number): void {
    const queryItem = this.displayedQueries[displayIndex];
    if (!queryItem) return;

    if (this.selectedIndices.has(displayIndex)) {
      // Deselect
      this.selectedIndices.delete(displayIndex);
      queryItem.selected = false;
    } else {
      // Check if adding would exceed limit
      if (this.wouldExceedLimit(queryItem.query)) {
        this.showLimitWarning();
        return;
      }
      // Select
      this.selectedIndices.add(displayIndex);
      queryItem.selected = true;
    }

    this.updateQueryItemUI(displayIndex);
    this.updateFooter();
  }

  /**
   * Show warning when character limit is reached.
   */
  private showLimitWarning(): void {
    const warning = this.modalContainer?.querySelector('.sharing-limit-warning');
    if (warning) {
      warning.classList.add('visible');
      setTimeout(() => {
        warning.classList.remove('visible');
      }, 3000);
    }
  }

  /**
   * Create the overlay DOM structure.
   */
  private createOverlay(): void {
    if (this.overlay) return;

    // Create overlay backdrop
    this.overlay = document.createElement('div');
    this.overlay.className = 'duckdb-sharing-overlay';
    this.overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      transition: opacity ${this.TRANSITION_DURATION}ms ease-in-out;
    `;

    // Create modal container
    this.modalContainer = document.createElement('div');
    this.modalContainer.className = 'duckdb-sharing-modal';
    this.modalContainer.style.cssText = `
      width: min(600px, 90vw);
      max-height: min(500px, 80vh);
      background: var(--modal-bg, #1e1e1e);
      border-radius: 8px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      font-family: system-ui, -apple-system, sans-serif;
      color: var(--modal-text, #d4d4d4);
    `;

    // Create header
    const header = this.createHeader();
    this.modalContainer.appendChild(header);

    // Create query list container
    this.queryListContainer = document.createElement('div');
    this.queryListContainer.className = 'duckdb-sharing-query-list';
    this.queryListContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 0 16px;
      min-height: 200px;
    `;
    this.modalContainer.appendChild(this.queryListContainer);

    // Create footer
    this.footerContainer = this.createFooter();
    this.modalContainer.appendChild(this.footerContainer);

    // Create limit warning
    const warning = document.createElement('div');
    warning.className = 'sharing-limit-warning';
    warning.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(220, 53, 69, 0.95);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
      z-index: 10;
    `;
    warning.textContent = 'URL character limit reached (2000 chars)';
    this.modalContainer.appendChild(warning);

    // Add visible class styles
    const style = document.createElement('style');
    style.textContent = `
      .sharing-limit-warning.visible {
        opacity: 1 !important;
      }
      .duckdb-sharing-query-item:hover {
        background: rgba(255, 255, 255, 0.05) !important;
      }
      .duckdb-sharing-query-item.focused {
        outline: 2px solid #007acc;
        outline-offset: -2px;
      }
      .duckdb-sharing-query-item.selected {
        background: rgba(0, 122, 204, 0.2) !important;
      }
      .duckdb-sharing-copy-btn:hover:not(:disabled) {
        background: #0066b3 !important;
      }
      .duckdb-sharing-copy-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .duckdb-sharing-load-more:hover {
        background: rgba(255, 255, 255, 0.1) !important;
      }
    `;
    this.modalContainer.appendChild(style);

    this.overlay.appendChild(this.modalContainer);

    // Setup click handler
    this.setupClickHandler();

    // Ensure container has position
    const containerPosition = getComputedStyle(this.container).position;
    if (containerPosition === 'static') {
      this.container.style.position = 'relative';
    }

    this.container.appendChild(this.overlay);
  }

  /**
   * Create the modal header.
   */
  private createHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const title = document.createElement('h2');
    title.style.cssText = `
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--modal-title, #ffffff);
    `;
    title.textContent = 'Share Queries';

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: var(--modal-text, #d4d4d4);
      cursor: pointer;
      padding: 4px 8px;
      font-size: 20px;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.15s;
    `;
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close (ESC)';
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.events.onDismiss?.();
    });
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.opacity = '1';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.opacity = '0.7';
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    return header;
  }

  /**
   * Create the modal footer.
   */
  private createFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      gap: 12px;
    `;

    // Left section: character count and hints
    const leftSection = document.createElement('div');
    leftSection.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    // Character count
    const charCount = document.createElement('span');
    charCount.className = 'sharing-char-count';
    charCount.style.cssText = `
      font-size: 13px;
      color: var(--modal-text-dim, #858585);
    `;
    charCount.textContent = `0 / ${this.config.maxUrlLength} characters`;

    // Keyboard hints
    const hints = document.createElement('span');
    hints.style.cssText = `
      font-size: 11px;
      color: var(--modal-text-dim, #656565);
    `;
    hints.textContent = 'Space: select/deselect | Enter: copy shareable link';

    leftSection.appendChild(charCount);
    leftSection.appendChild(hints);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'duckdb-sharing-copy-btn';
    copyBtn.style.cssText = `
      background: #007acc;
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    `;
    copyBtn.textContent = 'Copy shareable link';
    copyBtn.disabled = true;
    copyBtn.addEventListener('click', () => this.copyAndClose());

    footer.appendChild(leftSection);
    footer.appendChild(copyBtn);

    return footer;
  }

  /**
   * Render the query list.
   */
  private renderQueryList(): void {
    if (!this.queryListContainer) return;

    this.queryListContainer.innerHTML = '';

    // Add "Load older queries" button at top if there are more
    if (this.hasMoreQueries()) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.className = 'duckdb-sharing-load-more';
      loadMoreBtn.style.cssText = `
        width: 100%;
        padding: 10px;
        margin: 8px 0;
        background: rgba(255, 255, 255, 0.05);
        border: 1px dashed rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        color: var(--modal-text-dim, #858585);
        cursor: pointer;
        font-size: 13px;
        transition: background 0.15s;
      `;
      loadMoreBtn.textContent = `Load older queries (${this.allQueries.length - this.displayedCount} more)`;
      loadMoreBtn.addEventListener('click', () => this.loadMoreQueries());
      this.queryListContainer.appendChild(loadMoreBtn);
    }

    // Empty state
    if (this.displayedQueries.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = `
        text-align: center;
        padding: 40px 20px;
        color: var(--modal-text-dim, #858585);
      `;
      emptyState.textContent = 'No SQL queries in history yet.';
      this.queryListContainer.appendChild(emptyState);
      return;
    }

    // Render queries (oldest at top, newest at bottom)
    // displayedQueries is in reverse order (newest first), so reverse for display
    const reversedForDisplay = [...this.displayedQueries].reverse();

    reversedForDisplay.forEach((_, reversedIndex) => {
      // Convert back to displayedQueries index
      const displayIndex = this.displayedQueries.length - 1 - reversedIndex;
      const queryItem = this.displayedQueries[displayIndex];
      const itemEl = this.createQueryItem(queryItem, displayIndex);
      this.queryListContainer!.appendChild(itemEl);
    });

    // Scroll to bottom to show newest queries
    this.queryListContainer.scrollTop = this.queryListContainer.scrollHeight;
  }

  /**
   * Create a query list item element.
   */
  private createQueryItem(queryItem: ShareableQuery, displayIndex: number): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'duckdb-sharing-query-item';
    item.dataset.index = String(displayIndex);
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px 12px;
      margin: 4px 0;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
      gap: 12px;
    `;

    if (queryItem.selected) {
      item.classList.add('selected');
    }

    // Order number
    const orderNum = document.createElement('span');
    orderNum.className = 'query-order';
    orderNum.style.cssText = `
      min-width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--modal-text-dim, #858585);
    `;
    orderNum.textContent = String(queryItem.order);

    // Checkbox
    const checkbox = document.createElement('div');
    checkbox.className = 'query-checkbox';
    checkbox.style.cssText = `
      width: 18px;
      height: 18px;
      border: 2px solid ${queryItem.selected ? '#007acc' : 'rgba(255, 255, 255, 0.3)'};
      border-radius: 3px;
      background: ${queryItem.selected ? '#007acc' : 'transparent'};
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    `;
    if (queryItem.selected) {
      checkbox.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }

    // Query text
    const queryText = document.createElement('div');
    queryText.className = 'query-text';
    queryText.style.cssText = `
      flex: 1;
      font-family: 'Fira Code', 'Cascadia Code', monospace;
      font-size: 13px;
      color: var(--modal-text, #d4d4d4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    queryText.textContent = queryItem.query;
    queryText.title = queryItem.query; // Show full query on hover

    item.appendChild(orderNum);
    item.appendChild(checkbox);
    item.appendChild(queryText);

    // Click handler
    item.addEventListener('click', () => {
      this.focusedIndex = displayIndex;
      this.updateFocusedItem();
      this.toggleSelection(displayIndex);
    });

    return item;
  }

  /**
   * Update a single query item's UI after selection change.
   */
  private updateQueryItemUI(displayIndex: number): void {
    const queryItem = this.displayedQueries[displayIndex];
    if (!queryItem || !this.queryListContainer) return;

    const itemEl = this.queryListContainer.querySelector(
      `[data-index="${displayIndex}"]`
    ) as HTMLDivElement;
    if (!itemEl) return;

    const checkbox = itemEl.querySelector('.query-checkbox') as HTMLDivElement;
    if (checkbox) {
      checkbox.style.borderColor = queryItem.selected ? '#007acc' : 'rgba(255, 255, 255, 0.3)';
      checkbox.style.background = queryItem.selected ? '#007acc' : 'transparent';
      checkbox.innerHTML = queryItem.selected
        ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`
        : '';
    }

    if (queryItem.selected) {
      itemEl.classList.add('selected');
    } else {
      itemEl.classList.remove('selected');
    }
  }

  /**
   * Update the footer with current character count.
   */
  private updateFooter(): void {
    if (!this.footerContainer) return;

    const charCount = this.footerContainer.querySelector('.sharing-char-count');
    const copyBtn = this.footerContainer.querySelector('.duckdb-sharing-copy-btn') as HTMLButtonElement;

    const currentLength = this.getCurrentURLLength();
    const selectedCount = this.selectedIndices.size;

    if (charCount) {
      charCount.textContent = `${currentLength} / ${this.config.maxUrlLength} characters`;

      // Change color when approaching limit
      if (currentLength > this.config.maxUrlLength * 0.9) {
        (charCount as HTMLElement).style.color = '#dc3545';
      } else if (currentLength > this.config.maxUrlLength * 0.7) {
        (charCount as HTMLElement).style.color = '#ffc107';
      } else {
        (charCount as HTMLElement).style.color = 'var(--modal-text-dim, #858585)';
      }
    }

    if (copyBtn) {
      copyBtn.disabled = selectedCount === 0;
      copyBtn.textContent = selectedCount > 0
        ? `Copy shareable link (${selectedCount} ${selectedCount === 1 ? 'query' : 'queries'})`
        : 'Copy shareable link';
    }
  }

  /**
   * Update focused item styling.
   */
  private updateFocusedItem(): void {
    if (!this.queryListContainer) return;

    // Remove focus from all items
    const items = this.queryListContainer.querySelectorAll('.duckdb-sharing-query-item');
    items.forEach((item) => item.classList.remove('focused'));

    // Add focus to current item
    if (this.focusedIndex >= 0) {
      const focusedItem = this.queryListContainer.querySelector(
        `[data-index="${this.focusedIndex}"]`
      );
      if (focusedItem) {
        focusedItem.classList.add('focused');
        focusedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /**
   * Copy shareable link and close modal.
   */
  private async copyAndClose(): Promise<void> {
    const queries = this.getSelectedQueries();
    if (queries.length === 0) return;

    const { url } = generateShareableURL(queries);

    const success = await copyToClipboard(url);
    if (success) {
      this.events.onCopy?.(url);
      await this.hide();
    }
  }

  /**
   * Remove overlay from DOM and clean up.
   */
  private destroyOverlay(): void {
    this.removeKeyboardHandler();
    this.removeClickHandler();

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.modalContainer = null;
    this.queryListContainer = null;
    this.footerContainer = null;
    this.displayedQueries = [];
    this.selectedIndices.clear();
  }

  /**
   * Set up keyboard event handler.
   */
  private setupKeyboardHandler(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        this.events.onDismiss?.();
        return;
      }

      if (e.key === 'Enter' && this.selectedIndices.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.copyAndClose();
        return;
      }

      if (e.key === ' ' && this.focusedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSelection(this.focusedIndex);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        this.moveFocusDown();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        this.moveFocusUp();
        return;
      }
    };

    // Use capture phase to intercept before terminal
    document.addEventListener('keydown', this.keyHandler, true);
  }

  /**
   * Move focus down (to newer queries).
   * In display order, newer queries are at the bottom (lower display indices).
   */
  private moveFocusDown(): void {
    if (this.displayedQueries.length === 0) return;

    // Lower display index = newer queries (at bottom of visible list)
    const newIndex = this.focusedIndex - 1;

    if (newIndex >= 0) {
      this.focusedIndex = newIndex;
      this.updateFocusedItem();
    }
  }

  /**
   * Move focus up (to older queries).
   * In display order, older queries are at the top (higher display indices).
   * Auto-loads more queries when reaching the top.
   */
  private moveFocusUp(): void {
    if (this.displayedQueries.length === 0) return;

    // Higher display index = older queries (at top of visible list)
    const newIndex = this.focusedIndex + 1;

    if (newIndex < this.displayedQueries.length) {
      this.focusedIndex = newIndex;
      this.updateFocusedItem();
    } else if (this.hasMoreQueries()) {
      // At the top of visible list, load more older queries
      this.loadMoreQueries();
      // After loading, focus the new top item
      this.focusedIndex = this.displayedQueries.length - 1;
      this.updateFocusedItem();
    }
  }

  /**
   * Remove keyboard event handler.
   */
  private removeKeyboardHandler(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  /**
   * Set up click handler to close when clicking outside the modal.
   */
  private setupClickHandler(): void {
    this.clickHandler = (e: MouseEvent) => {
      if (e.target === this.overlay) {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        this.events.onDismiss?.();
      }
    };

    this.overlay?.addEventListener('click', this.clickHandler);
  }

  /**
   * Remove click handler.
   */
  private removeClickHandler(): void {
    if (this.clickHandler && this.overlay) {
      this.overlay.removeEventListener('click', this.clickHandler);
    }
    this.clickHandler = null;
  }
}
