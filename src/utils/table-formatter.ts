/**
 * Format query results as ASCII table
 */

/** Default maximum width for a single column in characters */
export const DEFAULT_MAX_COLUMN_WIDTH = 50;

export interface TableOptions {
  maxWidth?: number;
  maxColumnWidth?: number;
  nullValue?: string;
}

/**
 * Get display width of a string (handles unicode)
 */
function getDisplayWidth(str: string): number {
  // Simple implementation - counts characters
  // Could be enhanced for proper unicode width handling
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    // Check for wide characters (CJK, etc.)
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe1f) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad string to specified width
 */
function padEnd(str: string, width: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = width - displayWidth;
  if (padding <= 0) return str;
  return str + ' '.repeat(padding);
}

/**
 * Truncate string to max width
 */
function truncate(str: string, maxWidth: number): string {
  if (getDisplayWidth(str) <= maxWidth) return str;
  let result = '';
  let width = 0;
  for (const char of str) {
    const charWidth =
      char.charCodeAt(0) >= 0x1100 && char.charCodeAt(0) <= 0xffff ? 2 : 1;
    if (width + charWidth + 1 > maxWidth) break;
    result += char;
    width += charWidth;
  }
  return result + '\u2026'; // ellipsis
}

/**
 * Format a value for display
 */
function formatValue(value: unknown, nullValue: string): string {
  if (value === null || value === undefined) {
    return nullValue;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => formatValue(v, nullValue)).join(', ') + ']';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format query results as ASCII table
 */
export function formatTable(
  columns: string[],
  rows: unknown[][],
  options: TableOptions = {}
): string {
  const { maxColumnWidth = DEFAULT_MAX_COLUMN_WIDTH, nullValue = 'NULL' } = options;

  if (columns.length === 0) {
    return '';
  }

  // Format all values
  const formattedRows = rows.map((row) =>
    row.map((value) => {
      const formatted = formatValue(value, nullValue);
      return maxColumnWidth ? truncate(formatted, maxColumnWidth) : formatted;
    })
  );

  // Calculate column widths
  const widths = columns.map((col, i) => {
    const headerWidth = getDisplayWidth(col);
    const maxDataWidth = formattedRows.reduce((max, row) => {
      const cellWidth = getDisplayWidth(row[i] ?? '');
      return Math.max(max, cellWidth);
    }, 0);
    return Math.min(Math.max(headerWidth, maxDataWidth), maxColumnWidth);
  });

  // Build table
  const lines: string[] = [];

  // Top border
  lines.push('\u250c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u252c') + '\u2510');

  // Header row
  lines.push(
    '\u2502' +
      columns.map((col, i) => ' ' + padEnd(truncate(col, widths[i]), widths[i]) + ' ').join('\u2502') +
      '\u2502'
  );

  // Header separator
  lines.push('\u251c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u253c') + '\u2524');

  // Data rows
  for (const row of formattedRows) {
    lines.push(
      '\u2502' +
        row.map((cell, i) => ' ' + padEnd(cell, widths[i]) + ' ').join('\u2502') +
        '\u2502'
    );
  }

  // Bottom border
  lines.push('\u2514' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u2534') + '\u2518');

  return lines.join('\n');
}

/**
 * Format query results as CSV
 */
export function formatCSV(columns: string[], rows: unknown[][]): string {
  const escapeCSV = (value: unknown): string => {
    const str = formatValue(value, '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines: string[] = [];
  lines.push(columns.map(escapeCSV).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(','));
  }
  return lines.join('\n');
}

/**
 * Format query results as TSV (Tab-Separated Values)
 */
export function formatTSV(columns: string[], rows: unknown[][]): string {
  const escapeTSV = (value: unknown): string => {
    const str = formatValue(value, '');
    // Replace tabs and newlines with spaces to avoid breaking TSV format
    return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
  };

  const lines: string[] = [];
  lines.push(columns.map(escapeTSV).join('\t'));
  for (const row of rows) {
    lines.push(row.map(escapeTSV).join('\t'));
  }
  return lines.join('\n');
}

/**
 * Convert a value to a JSON-safe representation.
 * Handles BigInt and other non-serializable types.
 */
function toJSONSafe(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    // Convert BigInt to number if safe, otherwise to string
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(toJSONSafe);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = toJSONSafe(val);
    }
    return result;
  }
  return value;
}

/**
 * Format query results as JSON
 */
export function formatJSON(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = toJSONSafe(row[i]);
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
