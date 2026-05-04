/**
 * Format query results as ASCII table
 */

/** Default maximum width for a single column in characters */
export const DEFAULT_MAX_COLUMN_WIDTH = 50;
const DEFAULT_MIN_COLUMN_WIDTH = 3;

export interface TableOptions {
  maxWidth?: number;
  maxColumnWidth?: number;
  nullValue?: string;
  columnTypes?: string[];
  showTypes?: boolean;
  alignByType?: boolean;
}

type CellAlignment = 'left' | 'right' | 'center';

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
 * Pad string at the start to specified width
 */
function padStart(str: string, width: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = width - displayWidth;
  if (padding <= 0) return str;
  return ' '.repeat(padding) + str;
}

/**
 * Pad string on both sides to specified width
 */
function padCenter(str: string, width: number): string {
  const displayWidth = getDisplayWidth(str);
  const padding = width - displayWidth;
  if (padding <= 0) return str;
  const left = Math.ceil(padding / 2);
  const right = Math.floor(padding / 2);
  return ' '.repeat(left) + str + ' '.repeat(right);
}

/**
 * Truncate string to max width
 */
function truncate(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
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

function alignCell(str: string, width: number, alignment: CellAlignment): string {
  const truncated = truncate(str, width);
  switch (alignment) {
    case 'right':
      return padStart(truncated, width);
    case 'center':
      return padCenter(truncated, width);
    case 'left':
    default:
      return padEnd(truncated, width);
  }
}

/**
 * Convert BigInt to Number if within safe integer range, otherwise to string.
 * JavaScript's Number.MAX_SAFE_INTEGER is 2^53 - 1 (9007199254740991).
 */
function bigIntToSafe(value: bigint): number | string {
  if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
    return Number(value);
  }
  return value.toString();
}

/**
 * Format an interval object (from DuckDB INTERVAL type).
 */
function formatInterval(interval: { months?: number; days?: number; micros?: bigint }): string {
  const parts: string[] = [];
  if (interval.months) {
    const years = Math.floor(interval.months / 12);
    const months = interval.months % 12;
    if (years) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
    if (months) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  }
  if (interval.days) {
    parts.push(`${interval.days} day${interval.days !== 1 ? 's' : ''}`);
  }
  if (interval.micros) {
    const totalMicros = typeof interval.micros === 'bigint' ? Number(interval.micros) : interval.micros;
    const hours = Math.floor(totalMicros / 3600000000);
    const minutes = Math.floor((totalMicros % 3600000000) / 60000000);
    const seconds = (totalMicros % 60000000) / 1000000;
    if (hours || minutes || seconds) {
      parts.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(6).padStart(9, '0')}`);
    }
  }
  return parts.length ? parts.join(' ') : '00:00:00';
}

/**
 * Check if value is a DuckDB interval object.
 */
function isInterval(value: unknown): value is { months?: number; days?: number; micros?: bigint } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return 'months' in obj || 'days' in obj || 'micros' in obj;
}

/**
 * JSON replacer that handles special DuckDB types.
 * - BigInt: converts to Number when safe, string otherwise
 * - Date: converts to ISO string
 * - Map: converts to object
 * - Uint8Array (BLOB): converts to hex string
 */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return bigIntToSafe(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Uint8Array) {
    return '\\x' + Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return value;
}

/**
 * Format a value for display.
 * Handles special DuckDB types:
 * - BigInt: converts to Number when safe, string otherwise
 * - Date: converts to ISO string
 * - Map: converts to {key: value, ...} format
 * - Uint8Array (BLOB): converts to hex string
 * - Interval: formats as human-readable duration
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
    return String(bigIntToSafe(value));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(
      ([k, v]) => `${formatValue(k, nullValue)}: ${formatValue(v, nullValue)}`
    );
    return '{' + entries.join(', ') + '}';
  }
  if (value instanceof Uint8Array) {
    return '\\x' + Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => formatValue(v, nullValue)).join(', ') + ']';
  }
  if (isInterval(value)) {
    return formatInterval(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, jsonSafeReplacer);
  }
  return String(value);
}

function normalizeColumnType(type: string | undefined): string {
  const normalized = (type ?? '').trim();
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  switch (lower) {
    case 'utf8':
    case 'largeutf8':
      return 'varchar';
    case 'float64':
      return 'double';
    case 'float32':
      return 'float';
    case 'int8':
      return 'tinyint';
    case 'int16':
      return 'smallint';
    case 'int32':
      return 'integer';
    case 'int64':
      return 'bigint';
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64':
      return lower;
    case 'bool':
      return 'boolean';
    default:
      return lower;
  }
}

function isRightAlignedType(type: string | undefined): boolean {
  const normalized = normalizeColumnType(type);
  return /^(bool|boolean|tinyint|smallint|integer|int|bigint|hugeint|u?int\d*|float|double|real|decimal|numeric)/.test(normalized);
}

function getTableOverhead(columnCount: number): number {
  return columnCount * 3 + 1;
}

function allocateWidths(
  naturalWidths: number[],
  maxWidth: number | undefined,
  maxColumnWidth: number
): number[] {
  const cappedNaturalWidths = naturalWidths.map((width) =>
    Math.max(1, Math.min(width, maxColumnWidth))
  );

  if (!maxWidth || maxWidth <= 0 || !Number.isFinite(maxWidth)) {
    return cappedNaturalWidths;
  }

  const columnCount = cappedNaturalWidths.length;
  const contentBudget = Math.floor(maxWidth) - getTableOverhead(columnCount);
  if (contentBudget <= 0) {
    return cappedNaturalWidths.map(() => 1);
  }

  const naturalTotal = cappedNaturalWidths.reduce((sum, width) => sum + width, 0);
  if (naturalTotal <= contentBudget) {
    return cappedNaturalWidths;
  }

  const minColumnWidth = Math.min(DEFAULT_MIN_COLUMN_WIDTH, maxColumnWidth);
  const minimumWidths = cappedNaturalWidths.map((width) => Math.min(width, minColumnWidth));
  const minimumTotal = minimumWidths.reduce((sum, width) => sum + width, 0);

  if (minimumTotal > contentBudget) {
    return distributeContentBudget(cappedNaturalWidths, contentBudget);
  }

  const widths = [...minimumWidths];
  let remaining = contentBudget - minimumTotal;

  while (remaining > 0) {
    const candidates = widths
      .map((width, index) => ({ width, index, needed: cappedNaturalWidths[index] - width }))
      .filter((candidate) => candidate.needed > 0);

    if (candidates.length === 0) {
      break;
    }

    const share = Math.max(1, Math.floor(remaining / candidates.length));
    let distributed = 0;
    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }
      const add = Math.min(candidate.needed, share, remaining);
      widths[candidate.index] += add;
      remaining -= add;
      distributed += add;
    }

    if (distributed === 0) {
      break;
    }
  }

  return widths;
}

function distributeContentBudget(naturalWidths: number[], contentBudget: number): number[] {
  if (contentBudget < naturalWidths.length) {
    return naturalWidths.map(() => 1);
  }

  const widths = naturalWidths.map(() => 1);
  let remaining = contentBudget - naturalWidths.length;

  while (remaining > 0) {
    const candidates = widths
      .map((width, index) => ({ width, index, needed: naturalWidths[index] - width }))
      .filter((candidate) => candidate.needed > 0);

    if (candidates.length === 0) {
      break;
    }

    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }
      widths[candidate.index] += 1;
      remaining -= 1;
    }
  }

  return widths;
}

/**
 * Format query results as ASCII table
 */
export function formatTable(
  columns: string[],
  rows: unknown[][],
  options: TableOptions = {}
): string {
  const {
    maxColumnWidth = DEFAULT_MAX_COLUMN_WIDTH,
    maxWidth,
    nullValue = 'NULL',
    columnTypes,
    showTypes = false,
    alignByType = Boolean(columnTypes),
  } = options;

  if (columns.length === 0) {
    return '';
  }

  const columnWidthCap = maxColumnWidth > 0 ? maxColumnWidth : Number.MAX_SAFE_INTEGER;
  const typeLabels = showTypes ? columns.map((_, index) => normalizeColumnType(columnTypes?.[index])) : [];

  // Format all values
  const formattedRows = rows.map((row) =>
    columns.map((_, index) => formatValue(row[index], nullValue))
  );

  // Calculate column widths
  const naturalWidths = columns.map((col, i) => {
    const headerWidth = getDisplayWidth(col);
    const typeWidth = getDisplayWidth(typeLabels[i] ?? '');
    const maxDataWidth = formattedRows.reduce((max, row) => {
      const cellWidth = getDisplayWidth(row[i] ?? '');
      return Math.max(max, cellWidth);
    }, 0);
    return Math.max(headerWidth, typeWidth, maxDataWidth);
  });
  const widths = allocateWidths(naturalWidths, maxWidth, columnWidthCap);
  const dataAlignments: CellAlignment[] = columns.map((_, index) =>
    alignByType && isRightAlignedType(columnTypes?.[index]) ? 'right' : 'left'
  );

  // Build table
  const lines: string[] = [];

  // Top border
  lines.push('\u250c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u252c') + '\u2510');

  // Header row
  lines.push(
    '\u2502' +
      columns.map((col, i) => ' ' + alignCell(col, widths[i], 'center') + ' ').join('\u2502') +
      '\u2502'
  );

  if (showTypes) {
    lines.push(
      '\u2502' +
        typeLabels.map((type, i) => ' ' + alignCell(type, widths[i], 'center') + ' ').join('\u2502') +
        '\u2502'
    );
  }

  // Header separator
  lines.push('\u251c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u253c') + '\u2524');

  // Data rows
  for (const row of formattedRows) {
    lines.push(
      '\u2502' +
        columns.map((_, i) => ' ' + alignCell(row[i] ?? '', widths[i], dataAlignments[i]) + ' ').join('\u2502') +
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
  if (columns.length === 0) {
    return '';
  }

  const lines = [formatCSVHeader(columns)];
  lines.push(...formatCSVRows(rows));
  return lines.join('\n');
}

export function formatCSVHeader(columns: string[]): string {
  return columns.map(escapeCSVValue).join(',');
}

export function formatCSVRow(row: unknown[]): string {
  return row.map(escapeCSVValue).join(',');
}

export function formatCSVRows(rows: unknown[][]): string[] {
  return rows.map(formatCSVRow);
}

/**
 * Format query results as TSV (Tab-Separated Values)
 */
export function formatTSV(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) {
    return '';
  }

  const lines = [formatTSVHeader(columns)];
  lines.push(...formatTSVRows(rows));
  return lines.join('\n');
}

export function formatTSVHeader(columns: string[]): string {
  return columns.map(escapeTSVValue).join('\t');
}

export function formatTSVRow(row: unknown[]): string {
  return row.map(escapeTSVValue).join('\t');
}

export function formatTSVRows(rows: unknown[][]): string[] {
  return rows.map(formatTSVRow);
}

function escapeCSVValue(value: unknown): string {
  const str = formatValue(value, '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function escapeTSVValue(value: unknown): string {
  const str = formatValue(value, '');
  return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
}

/**
 * Format query results as JSON.
 * Uses jsonSafeReplacer to handle BigInt values that JSON.stringify
 * cannot serialize natively.
 */
export function formatJSON(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
  return JSON.stringify(objects, jsonSafeReplacer, 2);
}
