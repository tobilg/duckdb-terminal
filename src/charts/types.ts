import type uPlot from 'uplot';

/**
 * Version injected at build time from uPlot package.json
 */
declare const __UPLOT_VERSION__: string;

/**
 * Supported chart types
 */
export type ChartType = 'line' | 'bar' | 'scatter' | 'histogram';

/**
 * Column type categories for auto-detection
 */
export type ColumnType = 'numeric' | 'categorical' | 'temporal' | 'unknown';

/**
 * Loading states for the chart library
 */
export type LoaderState = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Information about a column in the query result
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** Detected column type */
  type: ColumnType;
  /** Original DuckDB type if available */
  duckdbType?: string;
  /** Number of unique values (for categorical detection) */
  uniqueCount?: number;
}

/**
 * Axis selection result from auto-detection or user override
 */
export interface AxisSelection {
  /** Column to use for X axis (null for row index) */
  xColumn: string | null;
  /** Columns to use for Y axes */
  yColumns: string[];
  /** Labels for categorical X axis */
  xLabels?: string[];
}

/**
 * Parsed .chart command options
 */
export interface ChartCommandOptions {
  /** Action: show chart or export */
  action: 'show' | 'export';
  /** Override chart type */
  type?: ChartType;
  /** Override X axis column */
  x?: string;
  /** Override Y axis columns */
  y?: string[];
  /** Export format (currently only 'png') */
  exportFormat?: 'png';
}

/**
 * Theme configuration for charts derived from terminal theme
 */
export interface ChartTheme {
  /** Chart background color */
  background: string;
  /** Text and axis color */
  foreground: string;
  /** Grid line color */
  gridColor: string;
  /** Axis line color */
  axisColor: string;
  /** Colors for data series (cycled) */
  seriesColors: string[];
  /** Tooltip background color */
  tooltipBg: string;
  /** Tooltip text color */
  tooltipFg: string;
}

/**
 * Dimensions and positioning for chart overlay
 */
export interface ChartDimensions {
  /** Width as percentage of container */
  widthPercent: number;
  /** Height as percentage of container */
  heightPercent: number;
  /** Padding from edges in pixels */
  padding: number;
  /** Minimum width in pixels */
  minWidth: number;
  /** Minimum height in pixels */
  minHeight: number;
}

/**
 * Options for rendering a chart
 */
export interface ChartRenderOptions {
  /** Chart type to render */
  type: ChartType;
  /** Chart theme */
  theme: ChartTheme;
  /** Chart dimensions */
  dimensions: ChartDimensions;
  /** Column info for axis labels */
  columns: ColumnInfo[];
  /** Axis selection */
  axes: AxisSelection;
}

/**
 * Data format expected by uPlot (columnar)
 * First array is X values, subsequent arrays are Y series
 */
export type UPlotData = uPlot.AlignedData;

/**
 * uPlot options type
 */
export type UPlotOptions = uPlot.Options;

/**
 * Reference to the uPlot constructor when loaded
 */
export type UPlotConstructor = typeof uPlot;

/**
 * Chart overlay visibility state
 */
export type OverlayState = 'hidden' | 'showing' | 'visible' | 'hiding';

/**
 * Event handlers for chart overlay
 */
export interface ChartOverlayEvents {
  /** Called when overlay is dismissed (ESC key or .chart hide) */
  onDismiss?: () => void;
  /** Called when export is triggered (Ctrl+S) */
  onExport?: () => void;
}

/**
 * Default chart dimensions
 */
export const DEFAULT_CHART_DIMENSIONS: ChartDimensions = {
  widthPercent: 80,
  heightPercent: 70,
  padding: 20,
  minWidth: 400,
  minHeight: 300,
};

/**
 * CDN URLs for uPlot
 */
export const UPLOT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/uplot';

export const getUPlotJsUrl = (): string =>
  `${UPLOT_CDN_BASE}@${__UPLOT_VERSION__}/dist/uPlot.iife.min.js`;

export const getUPlotCssUrl = (): string =>
  `${UPLOT_CDN_BASE}@${__UPLOT_VERSION__}/dist/uPlot.min.css`;
