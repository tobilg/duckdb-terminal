/**
 * Charts module for DuckDB Terminal
 *
 * Provides interactive charting capabilities using uPlot,
 * loaded on-demand from CDN when the feature is enabled.
 *
 * @example
 * ```typescript
 * import { ChartLoader, ChartOverlay } from './charts';
 *
 * // Load uPlot when needed
 * const uPlot = await ChartLoader.load();
 *
 * // Create overlay for displaying charts
 * const overlay = new ChartOverlay(containerElement);
 * await overlay.show();
 * ```
 */

// Types
export type {
  ChartType,
  ColumnType,
  LoaderState,
  ColumnInfo,
  AxisSelection,
  ChartCommandOptions,
  ChartTheme,
  ChartDimensions,
  ChartRenderOptions,
  UPlotData,
  UPlotOptions,
  UPlotConstructor,
  OverlayState,
  ChartOverlayEvents,
} from './types';

export {
  DEFAULT_CHART_DIMENSIONS,
  UPLOT_CDN_BASE,
  getUPlotJsUrl,
  getUPlotCssUrl,
} from './types';

// CDN Loader
export { ChartLoader } from './loader';

// Overlay
export { ChartOverlay } from './chart-overlay';

// Type Detection
export {
  detectColumnType,
  analyzeColumns,
  detectChartType,
  selectAxes,
  validateColumns,
} from './type-detector';

// Data Transformation
export type { TransformResult, TransformOptions } from './data-transformer';
export { transformData, validateResultForChart } from './data-transformer';

// Theme Adapter
export {
  adaptTheme,
  getDefaultChartTheme,
  DEFAULT_DARK_CHART_THEME,
  DEFAULT_LIGHT_CHART_THEME,
} from './theme-adapter';

// Chart Renderer
export type { RenderOptions } from './chart-renderer';
export { ChartRenderer } from './chart-renderer';

// Command Parser
export type { ParseResult } from './command-parser';
export { parseChartCommand, getChartHelpText } from './command-parser';

// Export Utilities
export {
  exportToPNG,
  exportToDataURL,
  exportToBlob,
  copyToClipboard,
} from './export';

// Chart Manager (main integration point)
export type { ChartCommandResult } from './chart-manager';
export { ChartManager } from './chart-manager';
