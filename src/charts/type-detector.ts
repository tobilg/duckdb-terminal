import type { ColumnInfo, ColumnType, ChartType, AxisSelection } from './types';

/**
 * DuckDB types mapped to column categories
 */
const NUMERIC_TYPES = new Set([
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'UTINYINT',
  'USMALLINT',
  'UINTEGER',
  'UBIGINT',
  'HUGEINT',
  'UHUGEINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'REAL',
  'INT',
  'INT1',
  'INT2',
  'INT4',
  'INT8',
  'INT16',
  'INT32',
  'INT64',
  'INT128',
  'UINT8',
  'UINT16',
  'UINT32',
  'UINT64',
  'UINT128',
  'FLOAT4',
  'FLOAT8',
  'NUMERIC',
]);

const TEMPORAL_TYPES = new Set([
  'DATE',
  'TIME',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'TIMESTAMP_S',
  'TIMESTAMP_MS',
  'TIMESTAMP_NS',
  'TIMESTAMP WITH TIME ZONE',
  'TIME WITH TIME ZONE',
  'TIMETZ',
  'INTERVAL',
]);

const CATEGORICAL_TYPES = new Set([
  'VARCHAR',
  'TEXT',
  'STRING',
  'CHAR',
  'BPCHAR',
  'ENUM',
  'BOOLEAN',
  'BOOL',
  'UUID',
]);

/**
 * Maximum unique values for a column to be considered categorical
 */
const MAX_CATEGORICAL_UNIQUE = 20;

/**
 * Detect column type from DuckDB type string or by sampling values.
 * First attempts to match the DuckDB type, then falls back to value sampling.
 * @param duckdbType - The DuckDB type string (e.g., "INTEGER", "VARCHAR", "TIMESTAMP")
 * @param values - Sample values from the column for type inference
 * @returns The detected column type category
 */
export function detectColumnType(
  duckdbType: string | undefined,
  values: unknown[]
): ColumnType {
  // Try to match DuckDB type first
  if (duckdbType) {
    // Normalize type: remove parameters in both () and <> formats
    // Arrow types use <> (e.g., "Date<DAY>", "Timestamp<MILLISECOND>")
    // DuckDB types use () (e.g., "DECIMAL(10,2)", "VARCHAR(255)")
    const normalizedType = duckdbType
      .toUpperCase()
      .split('(')[0]
      .split('<')[0]
      .trim();

    if (NUMERIC_TYPES.has(normalizedType)) {
      return 'numeric';
    }
    if (TEMPORAL_TYPES.has(normalizedType)) {
      return 'temporal';
    }
    if (CATEGORICAL_TYPES.has(normalizedType)) {
      return 'categorical';
    }
  }

  // Fallback to value sampling
  return detectTypeFromValues(values);
}

/**
 * Detect column type by sampling values.
 * Samples up to 100 values to determine if column is numeric, temporal, or categorical.
 * @param values - The column values to sample
 * @returns The inferred column type
 */
function detectTypeFromValues(values: unknown[]): ColumnType {
  const nonNullValues = values.filter((v) => v != null);

  if (nonNullValues.length === 0) {
    return 'unknown';
  }

  // Sample first few values
  const sample = nonNullValues.slice(0, 100);

  // Check if all are numbers
  if (sample.every((v) => typeof v === 'number' || typeof v === 'bigint')) {
    return 'numeric';
  }

  // Check if all are dates
  if (
    sample.every(
      (v) =>
        v instanceof Date ||
        (typeof v === 'string' && !isNaN(Date.parse(v)) && isDateLike(v))
    )
  ) {
    return 'temporal';
  }

  // Check if strings (categorical)
  if (sample.every((v) => typeof v === 'string' || typeof v === 'boolean')) {
    return 'categorical';
  }

  return 'unknown';
}

/**
 * Check if a string looks like a date/timestamp.
 * Tests against common date patterns (ISO, US, EU formats).
 * @param value - The string to check
 * @returns True if the string matches a common date pattern
 */
function isDateLike(value: string): boolean {
  // Common date patterns
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/, // ISO date
    /^\d{2}\/\d{2}\/\d{4}/, // US date
    /^\d{2}\.\d{2}\.\d{4}/, // EU date
    /^\d{4}\/\d{2}\/\d{2}/, // Alt ISO
  ];

  return datePatterns.some((pattern) => pattern.test(value));
}

/**
 * Analyze columns from query result and return column info.
 * Detects type for each column and counts unique values.
 * @param columns - Column names from the query result
 * @param rows - Data rows for value sampling
 * @param duckdbTypes - Optional DuckDB type strings for each column
 * @returns Array of ColumnInfo objects with detected types
 */
export function analyzeColumns(
  columns: string[],
  rows: unknown[][],
  duckdbTypes?: string[]
): ColumnInfo[] {
  return columns.map((name, index) => {
    const values = rows.map((row) => row[index]);
    const duckdbType = duckdbTypes?.[index];
    const type = detectColumnType(duckdbType, values);

    // Count unique values for categorical detection
    const uniqueValues = new Set(values.filter((v) => v != null));

    return {
      name,
      type,
      duckdbType,
      uniqueCount: uniqueValues.size,
    };
  });
}

/**
 * Auto-detect the best chart type based on column types.
 * Rules:
 * - Single numeric → histogram
 * - Temporal + numeric → line (time series)
 * - Categorical + numeric → bar
 * - Two numeric only → scatter
 * - Multiple numeric → line (default)
 * @param columns - Analyzed column information
 * @returns The recommended chart type
 */
export function detectChartType(columns: ColumnInfo[]): ChartType {
  const numericCols = columns.filter((c) => c.type === 'numeric');
  const temporalCols = columns.filter((c) => c.type === 'temporal');
  const categoricalCols = columns.filter(
    (c) => c.type === 'categorical' && (c.uniqueCount ?? 0) <= MAX_CATEGORICAL_UNIQUE
  );

  // Single numeric column → histogram
  if (columns.length === 1 && numericCols.length === 1) {
    return 'histogram';
  }

  // Temporal + numeric → line chart (time series)
  if (temporalCols.length >= 1 && numericCols.length >= 1) {
    return 'line';
  }

  // Categorical + numeric → bar chart
  if (categoricalCols.length >= 1 && numericCols.length >= 1) {
    return 'bar';
  }

  // Two numeric columns → scatter plot
  if (numericCols.length === 2 && columns.length === 2) {
    return 'scatter';
  }

  // Multiple numeric columns → line chart (default)
  if (numericCols.length >= 2) {
    return 'line';
  }

  // Default to line chart
  return 'line';
}

/**
 * Select X and Y axes based on column types and optional overrides.
 * Auto-selection priority for X: temporal > categorical > row index.
 * Y axes default to all numeric columns except X.
 * @param columns - Analyzed column information
 * @param overrides - Optional user-specified axis columns
 * @returns The selected axis configuration
 */
export function selectAxes(
  columns: ColumnInfo[],
  overrides?: { x?: string; y?: string[] }
): AxisSelection {
  // Apply user overrides if provided
  if (overrides?.x || overrides?.y) {
    const xColumn = overrides.x ?? null;
    const yColumns =
      overrides.y ??
      columns.filter((c) => c.type === 'numeric' && c.name !== xColumn).map((c) => c.name);

    // Get labels for categorical X axis
    let xLabels: string[] | undefined;
    if (xColumn) {
      const xCol = columns.find((c) => c.name === xColumn);
      if (xCol?.type === 'categorical') {
        xLabels = []; // Will be populated during data transformation
      }
    }

    return { xColumn, yColumns, xLabels };
  }

  // Auto-select X axis
  // Priority: temporal > categorical (if few unique values) > row index
  const temporalCols = columns.filter((c) => c.type === 'temporal');
  const categoricalCols = columns.filter(
    (c) => c.type === 'categorical' && (c.uniqueCount ?? 0) <= MAX_CATEGORICAL_UNIQUE
  );
  const numericCols = columns.filter((c) => c.type === 'numeric');

  let xColumn: string | null = null;
  let xLabels: string[] | undefined;

  if (temporalCols.length > 0) {
    xColumn = temporalCols[0].name;
  } else if (categoricalCols.length > 0) {
    xColumn = categoricalCols[0].name;
    xLabels = []; // Will be populated during data transformation
  }

  // Y axes: all numeric columns except X
  const yColumns = numericCols
    .filter((c) => c.name !== xColumn)
    .map((c) => c.name);

  return { xColumn, yColumns, xLabels };
}

/**
 * Validate that specified columns exist in the result.
 * @param columnNames - Column names to validate
 * @param availableColumns - Available columns from the query result
 * @returns Object with valid flag and array of missing column names
 */
export function validateColumns(
  columnNames: string[],
  availableColumns: ColumnInfo[]
): { valid: boolean; missing: string[] } {
  const available = new Set(availableColumns.map((c) => c.name));
  const missing = columnNames.filter((name) => !available.has(name));

  return {
    valid: missing.length === 0,
    missing,
  };
}
