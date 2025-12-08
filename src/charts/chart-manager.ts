import type { QueryResult, ThemeColors } from '../types';
import type { ChartCommandOptions, UPlotConstructor } from './types';
import { ChartLoader } from './loader';
import { ChartOverlay } from './chart-overlay';
import { ChartRenderer } from './chart-renderer';
import { transformData, validateResultForChart } from './data-transformer';
import { parseChartCommand, getChartHelpText } from './command-parser';
import { validateColumns } from './type-detector';
import { adaptTheme, getDefaultChartTheme } from './theme-adapter';
import { exportToPNG } from './export';

/**
 * Result of a chart command execution.
 */
export interface ChartCommandResult {
  /** Whether the command executed successfully */
  success: boolean;
  /** Success message (e.g., "Showing line chart with 2 series") */
  message?: string;
  /** Error message if command failed */
  error?: string;
}

/**
 * Manages chart lifecycle: loading, rendering, overlay, and export.
 * This is the main entry point for the .chart command integration.
 */
export class ChartManager {
  private container: HTMLElement;
  private overlay: ChartOverlay | null = null;
  private renderer: ChartRenderer | null = null;
  private uPlot: UPlotConstructor | null = null;
  private enabled: boolean;
  private themeMode: 'dark' | 'light';
  private themeColors: ThemeColors | null = null;

  /**
   * Creates a new ChartManager instance.
   * @param container - The HTML element that contains the terminal (overlay parent)
   * @param options - Configuration options
   * @param options.enabled - Whether charts feature is enabled (default: false)
   * @param options.themeMode - Initial theme mode ('dark' or 'light')
   * @param options.themeColors - Custom theme colors from terminal theme
   */
  constructor(
    container: HTMLElement,
    options: {
      enabled?: boolean;
      themeMode?: 'dark' | 'light';
      themeColors?: ThemeColors;
    } = {}
  ) {
    this.container = container;
    this.enabled = options.enabled ?? false;
    this.themeMode = options.themeMode ?? 'dark';
    this.themeColors = options.themeColors ?? null;
  }

  /**
   * Check if charts feature is enabled.
   * @returns True if charts are enabled in configuration
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update theme settings for chart rendering.
   * @param mode - Theme mode ('dark' or 'light')
   * @param colors - Optional custom theme colors
   */
  setTheme(mode: 'dark' | 'light', colors?: ThemeColors): void {
    this.themeMode = mode;
    if (colors) {
      this.themeColors = colors;
    }
  }

  /**
   * Execute a .chart command.
   * Parses the command and performs the appropriate action (show/export).
   * @param input - The full command string (e.g., ".chart type=bar")
   * @param lastResult - The last query result to visualize
   * @returns Result object with success status and message/error
   */
  async executeCommand(
    input: string,
    lastResult: QueryResult | null
  ): Promise<ChartCommandResult> {
    // Check if feature is enabled
    if (!this.enabled) {
      return {
        success: false,
        error: 'Charts feature is disabled. Enable with enableCharts: true in config.',
      };
    }

    // Parse command
    const parseResult = parseChartCommand(input);
    if (!parseResult.success || !parseResult.options) {
      return {
        success: false,
        error: parseResult.error ?? 'Failed to parse chart command',
      };
    }

    const options = parseResult.options;

    // Handle different actions
    switch (options.action) {
      case 'export':
        return this.exportChart();

      case 'show':
        return this.showChart(lastResult, options);

      default:
        return {
          success: false,
          error: `Unknown action: ${options.action}`,
        };
    }
  }

  /**
   * Show chart with the given data and options.
   * Handles overlay creation, uPlot loading, data transformation, and rendering.
   * @param result - The query result to visualize
   * @param options - Parsed chart command options
   * @returns Result object with success status and message/error
   */
  private async showChart(
    result: QueryResult | null,
    options: ChartCommandOptions
  ): Promise<ChartCommandResult> {
    // Validate result
    const validation = validateResultForChart(result!);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Validate user-specified columns if provided
    if (options.x || options.y) {
      const columnsToValidate: string[] = [];
      if (options.x) columnsToValidate.push(options.x);
      if (options.y) columnsToValidate.push(...options.y);

      const { columns } = transformData(result!);
      const columnValidation = validateColumns(columnsToValidate, columns);
      if (!columnValidation.valid) {
        return {
          success: false,
          error: `Column${columnValidation.missing.length > 1 ? 's' : ''} '${columnValidation.missing.join("', '")}' not found in result.`,
        };
      }
    }

    // Create overlay if needed
    if (!this.overlay) {
      this.overlay = new ChartOverlay(this.container, {
        onDismiss: () => this.handleDismiss(),
        onExport: () => this.handleExport(),
      });
    }

    // Show overlay
    await this.overlay.show();

    // Get chart container
    const chartContainer = this.overlay.getChartContainer();
    if (!chartContainer) {
      return {
        success: false,
        error: 'Failed to create chart container',
      };
    }

    // Show loading indicator if we need to load uPlot
    const needsLoad = !this.uPlot;
    if (needsLoad) {
      this.overlay.showLoading();
    }

    // Load uPlot if not already loaded
    try {
      if (!this.uPlot) {
        this.uPlot = await ChartLoader.load();
      }
    } catch (err) {
      this.overlay.hideLoading();
      await this.overlay.hide();
      return {
        success: false,
        error: 'Failed to load charts library. Check your network connection.',
      };
    }

    // Hide loading indicator
    if (needsLoad) {
      this.overlay.hideLoading();
    }

    // Transform data
    const transformed = transformData(result!, {
      type: options.type,
      x: options.x,
      y: options.y,
      duckdbTypes: result!.columnTypes,
    });

    // Get theme
    const chartTheme = this.themeColors
      ? adaptTheme(this.themeColors)
      : getDefaultChartTheme(this.themeMode);

    // Set chart container background and flexbox layout for legend below
    chartContainer.style.setProperty('--chart-bg', chartTheme.background);
    chartContainer.style.background = chartTheme.background;
    chartContainer.style.display = 'flex';
    chartContainer.style.flexDirection = 'column';

    // Get dimensions and account for container padding (20px on each side) and legend
    const dimensions = this.overlay.getChartDimensions();
    const containerPadding = 40; // 20px left + 20px right
    const legendHeight = 36;
    const chartWidth = dimensions.width - containerPadding;
    const chartHeight = dimensions.height - containerPadding - legendHeight;

    // Create renderer with new container (container changes each time overlay is shown)
    // Destroy old renderer first to clean up
    if (this.renderer) {
      this.renderer.destroy();
    }
    this.renderer = new ChartRenderer(this.uPlot, chartContainer);

    // Render chart
    this.renderer.render(transformed.data, {
      type: transformed.chartType,
      theme: chartTheme,
      width: chartWidth,
      height: chartHeight,
      seriesNames: transformed.seriesNames,
      axes: transformed.axes,
      xLabels: transformed.axes.xLabels,
      isXTemporal: transformed.isXTemporal,
    });

    return {
      success: true,
      message: `Showing ${transformed.chartType} chart with ${transformed.seriesNames.length} series`,
    };
  }

  /**
   * Export current chart as PNG.
   * Downloads the chart as a PNG file.
   * @returns Result object with success status and message/error
   */
  private exportChart(): ChartCommandResult {
    const chart = this.renderer?.getChart();
    if (!chart) {
      return {
        success: false,
        error: 'No chart to export. Show a chart first.',
      };
    }

    try {
      exportToPNG(chart);
      return {
        success: true,
        message: 'Chart exported as PNG',
      };
    } catch (err) {
      return {
        success: false,
        error: 'Failed to export chart',
      };
    }
  }

  /**
   * Handle overlay dismiss event (ESC key or click outside).
   * Called by the overlay when user dismisses the chart.
   */
  private handleDismiss(): void {
    // Cleanup is handled by the overlay itself
  }

  /**
   * Handle export shortcut (Ctrl+S) from overlay.
   * Triggers PNG export of the current chart.
   */
  private handleExport(): void {
    this.exportChart();
  }

  /**
   * Get help text for .chart command.
   * @returns Formatted help text string
   */
  getHelpText(): string {
    return getChartHelpText();
  }

  /**
   * Destroy the chart manager and clean up all resources.
   * Should be called when the terminal is destroyed.
   */
  destroy(): void {
    this.renderer?.destroy();
    this.overlay?.destroy();
    this.renderer = null;
    this.overlay = null;
  }
}
