import type { LoaderState, UPlotConstructor } from './types';
import { getUPlotJsUrl, getUPlotCssUrl } from './types';

/**
 * Singleton loader for uPlot library from CDN.
 * Loads JavaScript and CSS on-demand when charts feature is first used.
 */
class ChartLoaderClass {
  private state: LoaderState = 'idle';
  private uplot: UPlotConstructor | null = null;
  private loadPromise: Promise<UPlotConstructor> | null = null;
  private error: Error | null = null;

  /** Timeout for CDN load in milliseconds */
  private readonly LOAD_TIMEOUT = 10000;

  /**
   * Get current loading state
   */
  getState(): LoaderState {
    return this.state;
  }

  /**
   * Check if uPlot is already loaded
   */
  isLoaded(): boolean {
    return this.state === 'loaded' && this.uplot !== null;
  }

  /**
   * Get the loaded uPlot constructor, or null if not loaded
   */
  getUPlot(): UPlotConstructor | null {
    return this.uplot;
  }

  /**
   * Get the loading error if any
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * Load uPlot library from CDN.
   * Returns cached instance if already loaded.
   * Prevents duplicate load attempts.
   */
  async load(): Promise<UPlotConstructor> {
    // Already loaded - return cached instance
    if (this.state === 'loaded' && this.uplot) {
      return this.uplot;
    }

    // Already loading - return existing promise
    if (this.state === 'loading' && this.loadPromise) {
      return this.loadPromise;
    }

    // Previous error - throw it again
    if (this.state === 'error' && this.error) {
      throw this.error;
    }

    // Start fresh load
    this.state = 'loading';
    this.loadPromise = this.doLoad();

    try {
      this.uplot = await this.loadPromise;
      this.state = 'loaded';
      return this.uplot;
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err : new Error(String(err));
      throw this.error;
    }
  }

  /**
   * Reset loader state (mainly for testing)
   */
  reset(): void {
    this.state = 'idle';
    this.uplot = null;
    this.loadPromise = null;
    this.error = null;
  }

  /**
   * Perform the actual loading of JS and CSS
   */
  private async doLoad(): Promise<UPlotConstructor> {
    // Load CSS and JS in parallel
    await Promise.all([this.loadCSS(), this.loadJS()]);

    // Access the global uPlot from IIFE build
    const uplot = (window as unknown as { uPlot: UPlotConstructor }).uPlot;

    if (!uplot) {
      throw new Error('uPlot not found on window after loading');
    }

    return uplot;
  }

  /**
   * Load uPlot JavaScript from CDN
   */
  private loadJS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if ((window as unknown as { uPlot?: unknown }).uPlot) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = getUPlotJsUrl();
      script.async = true;

      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading uPlot JavaScript'));
      }, this.LOAD_TIMEOUT);

      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };

      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load uPlot JavaScript from CDN'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Load uPlot CSS from CDN
   */
  private loadCSS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      const existingLink = document.querySelector(
        `link[href*="uPlot.min.css"]`
      );
      if (existingLink) {
        resolve();
        return;
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = getUPlotCssUrl();

      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading uPlot CSS'));
      }, this.LOAD_TIMEOUT);

      link.onload = () => {
        clearTimeout(timeout);
        resolve();
      };

      link.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load uPlot CSS from CDN'));
      };

      document.head.appendChild(link);
    });
  }
}

/**
 * Singleton instance of the chart loader
 */
export const ChartLoader = new ChartLoaderClass();
