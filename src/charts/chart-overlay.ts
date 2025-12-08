import type {
  ChartDimensions,
  ChartOverlayEvents,
  OverlayState,
} from './types';
import { DEFAULT_CHART_DIMENSIONS } from './types';

/**
 * Manages the chart overlay DOM element that displays charts on top of the terminal.
 * Handles show/hide animations, keyboard events, and responsive resizing.
 */
export class ChartOverlay {
  private container: HTMLElement;
  private overlay: HTMLDivElement | null = null;
  private chartContainer: HTMLDivElement | null = null;
  private loadingIndicator: HTMLDivElement | null = null;
  private state: OverlayState = 'hidden';
  private resizeObserver: ResizeObserver | null = null;
  private events: ChartOverlayEvents;
  private dimensions: ChartDimensions;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  /** Transition duration in milliseconds */
  private readonly TRANSITION_DURATION = 200;

  /**
   * Creates a new ChartOverlay instance.
   * @param container - The parent HTML element to attach the overlay to
   * @param events - Event handlers for overlay interactions (dismiss, export)
   * @param dimensions - Configuration for overlay sizing and positioning
   */
  constructor(
    container: HTMLElement,
    events: ChartOverlayEvents = {},
    dimensions: ChartDimensions = DEFAULT_CHART_DIMENSIONS
  ) {
    this.container = container;
    this.events = events;
    this.dimensions = dimensions;
  }

  /**
   * Get current overlay state.
   * @returns The current state of the overlay (hidden, showing, visible, hiding)
   */
  getState(): OverlayState {
    return this.state;
  }

  /**
   * Check if overlay is currently visible or in the process of showing.
   * @returns True if the overlay is visible or transitioning to visible
   */
  isVisible(): boolean {
    return this.state === 'visible' || this.state === 'showing';
  }

  /**
   * Get the chart container element where uPlot should render.
   * @returns The chart container div element, or null if overlay is not shown
   */
  getChartContainer(): HTMLDivElement | null {
    return this.chartContainer;
  }

  /**
   * Get computed chart dimensions based on container size.
   * Respects minimum dimensions and percentage-based sizing.
   * @returns Object with width and height in pixels
   */
  getChartDimensions(): { width: number; height: number } {
    const containerRect = this.container.getBoundingClientRect();

    const width = Math.max(
      this.dimensions.minWidth,
      Math.floor(
        (containerRect.width * this.dimensions.widthPercent) / 100 -
          this.dimensions.padding * 2
      )
    );

    const height = Math.max(
      this.dimensions.minHeight,
      Math.floor(
        (containerRect.height * this.dimensions.heightPercent) / 100 -
          this.dimensions.padding * 2
      )
    );

    return { width, height };
  }

  /**
   * Show the overlay with fade-in animation.
   * Sets up keyboard handlers, click handlers, and resize observers.
   * @returns Promise that resolves when the transition completes
   */
  show(): Promise<void> {
    if (this.state === 'visible' || this.state === 'showing') {
      return Promise.resolve();
    }

    this.state = 'showing';
    this.createOverlay();
    this.setupKeyboardHandler();
    this.setupResizeObserver();

    return new Promise((resolve) => {
      // Force reflow to ensure transition works
      this.overlay?.offsetHeight;

      if (this.overlay) {
        this.overlay.style.opacity = '1';
      }

      setTimeout(() => {
        this.state = 'visible';
        resolve();
      }, this.TRANSITION_DURATION);
    });
  }

  /**
   * Hide the overlay with fade-out animation.
   * Cleans up all event handlers and removes DOM elements.
   * @returns Promise that resolves when the transition completes
   */
  hide(): Promise<void> {
    if (this.state === 'hidden' || this.state === 'hiding') {
      return Promise.resolve();
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
   * Toggle overlay visibility.
   * Shows the overlay if hidden, hides it if visible.
   * @returns Promise that resolves when the transition completes
   */
  toggle(): Promise<void> {
    return this.isVisible() ? this.hide() : this.show();
  }

  /**
   * Show loading indicator while chart library is being fetched.
   * Displays a spinner and "Loading chart library..." message.
   */
  showLoading(): void {
    if (!this.chartContainer || this.loadingIndicator) return;

    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'duckdb-chart-loading';
    this.loadingIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: rgba(255, 255, 255, 0.7);
      font-size: 14px;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    `;

    // Create spinner
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: rgba(255, 255, 255, 0.8);
      border-radius: 50%;
      animation: duckdb-chart-spin 0.8s linear infinite;
    `;

    // Add keyframes for spinner animation
    if (!document.getElementById('duckdb-chart-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'duckdb-chart-spinner-styles';
      style.textContent = `
        @keyframes duckdb-chart-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    const text = document.createElement('span');
    text.textContent = 'Loading chart library...';

    this.loadingIndicator.appendChild(spinner);
    this.loadingIndicator.appendChild(text);
    this.chartContainer.appendChild(this.loadingIndicator);
  }

  /**
   * Hide loading indicator after chart library has loaded.
   */
  hideLoading(): void {
    if (this.loadingIndicator && this.loadingIndicator.parentNode) {
      this.loadingIndicator.parentNode.removeChild(this.loadingIndicator);
    }
    this.loadingIndicator = null;
  }

  /**
   * Clean up all resources and remove overlay from DOM.
   * Should be called when the overlay is no longer needed.
   */
  destroy(): void {
    this.destroyOverlay();
    this.state = 'hidden';
  }

  /**
   * Create the overlay DOM structure
   */
  private createOverlay(): void {
    if (this.overlay) return;

    // Create overlay backdrop
    this.overlay = document.createElement('div');
    this.overlay.className = 'duckdb-chart-overlay';
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

    // Create chart container
    this.chartContainer = document.createElement('div');
    this.chartContainer.className = 'duckdb-chart-container';

    const { width, height } = this.getChartDimensions();

    this.chartContainer.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      background: var(--chart-bg, #1e1e1e);
      border-radius: 8px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      padding: ${this.dimensions.padding}px;
      box-sizing: border-box;
    `;

    // Create close hint
    const closeHint = document.createElement('div');
    closeHint.className = 'duckdb-chart-close-hint';
    closeHint.style.cssText = `
      position: absolute;
      top: 12px;
      right: 16px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 12px;
      font-family: system-ui, sans-serif;
    `;
    closeHint.textContent = 'ESC or click outside to close';

    this.overlay.appendChild(this.chartContainer);
    this.overlay.appendChild(closeHint);

    // Set up click handler to close when clicking outside the chart
    this.setupClickHandler();

    // Ensure container has position for absolute positioning
    const containerPosition = getComputedStyle(this.container).position;
    if (containerPosition === 'static') {
      this.container.style.position = 'relative';
    }

    this.container.appendChild(this.overlay);
  }

  /**
   * Remove overlay from DOM and clean up
   */
  private destroyOverlay(): void {
    this.removeKeyboardHandler();
    this.removeClickHandler();
    this.removeResizeObserver();

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.chartContainer = null;
  }

  /**
   * Set up keyboard event handler for ESC and Ctrl+S
   */
  private setupKeyboardHandler(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        this.events.onDismiss?.();
      } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.events.onExport?.();
      }
    };

    // Use capture phase to intercept before terminal
    document.addEventListener('keydown', this.keyHandler, true);
  }

  /**
   * Remove keyboard event handler
   */
  private removeKeyboardHandler(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  /**
   * Set up click handler to close overlay when clicking outside the chart
   */
  private setupClickHandler(): void {
    this.clickHandler = (e: MouseEvent) => {
      // Only close if clicking directly on the overlay backdrop, not the chart
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
   * Remove click handler
   */
  private removeClickHandler(): void {
    if (this.clickHandler && this.overlay) {
      this.overlay.removeEventListener('click', this.clickHandler);
    }
    this.clickHandler = null;
  }

  /**
   * Set up resize observer to update chart dimensions
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chartContainer && this.state === 'visible') {
        const { width, height } = this.getChartDimensions();
        this.chartContainer.style.width = `${width}px`;
        this.chartContainer.style.height = `${height}px`;
      }
    });

    this.resizeObserver.observe(this.container);
  }

  /**
   * Remove resize observer
   */
  private removeResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
