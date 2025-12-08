import type { QueryResult } from '../types';
import type { ColumnInfo, AxisSelection, UPlotData, ChartType } from './types';
import { analyzeColumns, detectChartType, selectAxes } from './type-detector';

/**
 * Result of data transformation
 */
export interface TransformResult {
  /** Data in uPlot columnar format */
  data: UPlotData;
  /** Detected or specified chart type */
  chartType: ChartType;
  /** Column information */
  columns: ColumnInfo[];
  /** Axis selection */
  axes: AxisSelection;
  /** Series names for legend */
  seriesNames: string[];
  /** Whether the X axis contains temporal (date/time) data */
  isXTemporal: boolean;
}

/**
 * Options for data transformation
 */
export interface TransformOptions {
  /** Override chart type */
  type?: ChartType;
  /** Override X axis column */
  x?: string;
  /** Override Y axis columns */
  y?: string[];
  /** DuckDB column types (if available) */
  duckdbTypes?: string[];
}

/**
 * Transform QueryResult into uPlot-compatible data format.
 * Analyzes columns, selects axes, detects chart type, and converts data to columnar format.
 * @param result - The query result to transform
 * @param options - Optional transformation options (type override, axis overrides, DuckDB types)
 * @returns Transformed data ready for uPlot rendering
 */
export function transformData(
  result: QueryResult,
  options: TransformOptions = {}
): TransformResult {
  const { columns, rows } = result;

  // Analyze columns
  const columnInfo = analyzeColumns(columns, rows, options.duckdbTypes);

  // Select axes
  const axes = selectAxes(columnInfo, {
    x: options.x,
    y: options.y,
  });

  // Detect chart type
  const chartType = options.type ?? detectChartType(columnInfo);

  // Transform data based on chart type
  let data: UPlotData;
  let seriesNames: string[];

  if (chartType === 'histogram') {
    const histResult = transformHistogram(rows, columnInfo, axes);
    data = histResult.data;
    seriesNames = histResult.seriesNames;
    axes.xLabels = histResult.labels;
  } else {
    const transformed = transformColumnar(rows, columnInfo, axes);
    data = transformed.data;
    seriesNames = transformed.seriesNames;
    if (transformed.xLabels) {
      axes.xLabels = transformed.xLabels;
    }
  }

  // Determine if X axis is temporal
  const xCol = axes.xColumn
    ? columnInfo.find((c) => c.name === axes.xColumn)
    : null;
  const isXTemporal = xCol?.type === 'temporal';

  return {
    data,
    chartType,
    columns: columnInfo,
    axes,
    seriesNames,
    isXTemporal,
  };
}

/**
 * Transform rows to uPlot columnar format.
 * Handles temporal, categorical, and numeric X axis types.
 * @param rows - The data rows from the query result
 * @param columns - Column information with detected types
 * @param axes - The selected X and Y axes
 * @returns Object with columnar data, series names, and optional category labels
 */
function transformColumnar(
  rows: unknown[][],
  columns: ColumnInfo[],
  axes: AxisSelection
): { data: UPlotData; seriesNames: string[]; xLabels?: string[] } {
  const columnIndex = new Map(columns.map((c, i) => [c.name, i]));

  // Build X values
  let xValues: (number | null)[];
  let xLabels: string[] | undefined;

  if (axes.xColumn) {
    const xIdx = columnIndex.get(axes.xColumn);
    const xCol = columns.find((c) => c.name === axes.xColumn);

    if (xIdx === undefined) {
      throw new Error(`X column '${axes.xColumn}' not found`);
    }

    if (xCol?.type === 'temporal') {
      // Convert to Unix timestamps (seconds)
      xValues = rows.map((row) => toTimestamp(row[xIdx]));
    } else if (xCol?.type === 'categorical') {
      // For categorical data, we need to aggregate values by category
      // Get unique categories preserving order of first occurrence
      const uniqueValues: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const val = String(row[xIdx]);
        if (!seen.has(val)) {
          seen.add(val);
          uniqueValues.push(val);
        }
      }
      xLabels = uniqueValues;

      // Aggregate Y values by category (sum)
      const aggregated = aggregateByCategorical(
        rows,
        xIdx,
        axes.yColumns,
        columnIndex,
        uniqueValues
      );

      // X values are just indices 0, 1, 2, ... for each category
      return {
        data: [aggregated.xValues, ...aggregated.yColumns] as UPlotData,
        seriesNames: axes.yColumns,
        xLabels,
      };
    } else {
      // Numeric X axis
      xValues = rows.map((row) => toNumber(row[xIdx]));
    }
  } else {
    // Use row index as X
    xValues = rows.map((_, i) => i);
  }

  // Build Y values for each series
  const yColumns: (number | null)[][] = axes.yColumns.map((colName) => {
    const yIdx = columnIndex.get(colName);
    if (yIdx === undefined) {
      throw new Error(`Y column '${colName}' not found`);
    }
    return rows.map((row) => toNumber(row[yIdx]));
  });

  return {
    data: [xValues, ...yColumns] as UPlotData,
    seriesNames: axes.yColumns,
    xLabels,
  };
}

/**
 * Aggregate Y values by categorical X values (summing duplicates).
 * Groups data by category and sums the Y values for each group.
 * @param rows - The data rows
 * @param xIdx - Index of the X (category) column
 * @param yColumnNames - Names of the Y columns to aggregate
 * @param columnIndex - Map of column names to indices
 * @param uniqueCategories - Unique category values in order of appearance
 * @returns Object with X indices and aggregated Y values for each category
 */
function aggregateByCategorical(
  rows: unknown[][],
  xIdx: number,
  yColumnNames: string[],
  columnIndex: Map<string, number>,
  uniqueCategories: string[]
): { xValues: (number | null)[]; yColumns: (number | null)[][] } {
  // Initialize aggregation maps for each Y column
  const yAggregations: Map<string, number>[] = yColumnNames.map(
    () => new Map()
  );

  // Initialize all categories with 0
  for (const category of uniqueCategories) {
    for (const aggMap of yAggregations) {
      aggMap.set(category, 0);
    }
  }

  // Sum values by category
  for (const row of rows) {
    const category = String(row[xIdx]);

    yColumnNames.forEach((colName, yIdx) => {
      const colIdx = columnIndex.get(colName);
      if (colIdx !== undefined) {
        const value = toNumber(row[colIdx]);
        if (value !== null) {
          const current = yAggregations[yIdx].get(category) ?? 0;
          yAggregations[yIdx].set(category, current + value);
        }
      }
    });
  }

  // Build result arrays
  const xValues: (number | null)[] = uniqueCategories.map((_, i) => i);
  const yColumns: (number | null)[][] = yAggregations.map((aggMap) =>
    uniqueCategories.map((cat) => aggMap.get(cat) ?? null)
  );

  return { xValues, yColumns };
}

/**
 * Transform data into histogram bins.
 * Uses Sturges' formula to determine optimal bin count.
 * @param rows - The data rows
 * @param columns - Column information
 * @param _axes - Axis selection (unused, uses first numeric column)
 * @returns Object with binned data, series names, and bin labels
 */
function transformHistogram(
  rows: unknown[][],
  columns: ColumnInfo[],
  _axes: AxisSelection
): { data: UPlotData; seriesNames: string[]; labels: string[] } {
  // Get the first numeric column for histogram
  const numericCol = columns.find((c) => c.type === 'numeric');
  if (!numericCol) {
    throw new Error('No numeric column found for histogram');
  }

  const colIdx = columns.findIndex((c) => c.name === numericCol.name);
  const values = rows
    .map((row) => toNumber(row[colIdx]))
    .filter((v): v is number => v !== null);

  if (values.length === 0) {
    return {
      data: [[], []] as UPlotData,
      seriesNames: ['Count'],
      labels: [],
    };
  }

  // Calculate bins using Sturges' formula
  const binCount = Math.ceil(Math.log2(values.length) + 1);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = (max - min) / binCount || 1;

  // Create bins
  const bins: number[] = new Array(binCount).fill(0);
  const binLabels: string[] = [];

  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binWidth;
    const binEnd = binStart + binWidth;
    binLabels.push(`${formatNumber(binStart)}-${formatNumber(binEnd)}`);
  }

  // Count values in each bin
  for (const value of values) {
    let binIdx = Math.floor((value - min) / binWidth);
    // Handle edge case where value equals max
    if (binIdx >= binCount) binIdx = binCount - 1;
    bins[binIdx]++;
  }

  // X values are bin centers
  const xValues = binLabels.map((_, i) => i);

  return {
    data: [xValues, bins] as UPlotData,
    seriesNames: ['Count'],
    labels: binLabels,
  };
}

/**
 * Convert value to Unix timestamp in seconds.
 * Handles Date objects, numeric timestamps, and ISO date strings.
 * @param value - The value to convert
 * @returns Unix timestamp in seconds, or null if conversion fails
 */
function toTimestamp(value: unknown): number | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return value.getTime() / 1000;
  }

  if (typeof value === 'number') {
    // Assume already a timestamp, convert ms to seconds if needed
    return value > 1e12 ? value / 1000 : value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) {
      return parsed / 1000;
    }
  }

  return null;
}

/**
 * Convert value to number.
 * Handles numbers, bigints, and numeric strings.
 * @param value - The value to convert
 * @returns The numeric value, or null if conversion fails
 */
function toNumber(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Format number for display in bin labels.
 * Shows integers without decimals, floats with 2 decimal places.
 * @param value - The number to format
 * @returns Formatted string representation
 */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2);
}

/**
 * Validate that result has data suitable for charting.
 * Checks for non-null result, non-empty rows, and at least one numeric column.
 * @param result - The query result to validate
 * @returns Object with valid flag and optional error message
 */
export function validateResultForChart(result: QueryResult): {
  valid: boolean;
  error?: string;
} {
  if (!result) {
    return { valid: false, error: 'No data to chart. Run a query first.' };
  }

  if (result.rows.length === 0) {
    return { valid: false, error: 'Query returned no rows.' };
  }

  const columnInfo = analyzeColumns(result.columns, result.rows);
  const numericCols = columnInfo.filter((c) => c.type === 'numeric');

  if (numericCols.length === 0) {
    return { valid: false, error: 'No numeric columns found for charting.' };
  }

  return { valid: true };
}
