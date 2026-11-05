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
function jsonSafeReplacer(this: unknown, key: string, value: unknown): unknown {
  // JSON.stringify applies toJSON() first, which quotes Arrow's big numbers: use the original value.
  const original = (this as Record<string, unknown> | null)?.[key];
  if (isArrowBigNum(original)) {
    return bigIntToSafe(BigInt(original.toString()));
  }
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
 * Whether a value is one of Arrow's big numbers, which DuckDB-Wasm returns for
 * HUGEINT and UHUGEINT (such as the sum of an integer column). They are typed
 * arrays whose toJSON() returns the number in quotes; toString() returns its digits.
 */
function isArrowBigNum(value: unknown): value is ArrayBufferView & { toString(): string } {
  return ArrayBuffer.isView(value) && typeof (value as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive] === 'function';
}

/**
 * Format a value for display.
 * Handles special DuckDB types:
 * - HUGEINT/UHUGEINT (Arrow big numbers): their digits
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
  if (isArrowBigNum(value)) {
    return value.toString();
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

const ARROW_TEMPORAL_TYPE = /^(Timestamp|Date32|Date64|Time32|Time64)<([A-Z]+)(?:,\s*([^>]+))?>$/i;
const MICROS_PER_UNIT: Record<string, number> = { SECOND: 1e6, MILLISECOND: 1e3, MICROSECOND: 1, NANOSECOND: 1e-3 };
const TIMESTAMP_TYPE_NAMES: Record<string, string> = {
  SECOND: 'timestamp_s', MILLISECOND: 'timestamp_ms', MICROSECOND: 'timestamp', NANOSECOND: 'timestamp_ns',
};

/** ".123456" for the microseconds of a second, without trailing zeros; "" for none. */
function fractionOfSecond(micros: number): string {
  return micros > 0 ? '.' + String(micros).padStart(6, '0').replace(/0+$/, '') : '';
}

/** "YYYY-MM-DD HH:MM:SS[.ffffff]" for microseconds since the epoch (UTC), or null when out of range. */
function formatEpochMicros(totalMicros: number): string | null {
  const seconds = Math.floor(totalMicros / 1e6);
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  const separator = iso.indexOf('T');
  return `${iso.slice(0, separator)} ${iso.slice(separator + 1, separator + 9)}${fractionOfSecond(totalMicros - seconds * 1e6)}`;
}

/**
 * Arrow hands DuckDB's temporal values to JavaScript as numbers: TIMESTAMP and
 * DATE as epoch milliseconds (fractional below a millisecond), TIME as micro-
 * or nanoseconds since midnight. Given the column's Arrow type, this returns
 * the value as DuckDB prints it ("2024-12-31 19:10:55", "2024-12-31",
 * "19:10:55"); time zone aware timestamps are shown in UTC ("+00"). Other
 * values are returned unchanged.
 */
export function toDisplayValue(value: unknown, type: string | undefined): unknown {
  if (!type || (typeof value !== 'number' && typeof value !== 'bigint')) return value;
  const match = ARROW_TEMPORAL_TYPE.exec(type.trim());
  if (!match) return value;
  const [, kind, unit, timeZone] = match;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  switch (kind.toLowerCase()) {
    case 'timestamp': {
      const text = formatEpochMicros(Math.round(number * 1000));
      return text === null ? value : `${text}${timeZone ? '+00' : ''}`;
    }
    case 'date32':
    case 'date64': {
      const text = formatEpochMicros(Math.round(number * 1000));
      return text === null ? value : text.slice(0, text.indexOf(' '));
    }
    default: {
      const factor = MICROS_PER_UNIT[unit.toUpperCase()];
      if (factor === undefined) return value;
      const totalMicros = Math.round(number * factor);
      const seconds = Math.floor(totalMicros / 1e6);
      const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
      return clock + fractionOfSecond(totalMicros - seconds * 1e6);
    }
  }
}

function normalizeColumnType(type: string | undefined): string {
  const normalized = (type ?? '').trim();
  if (!normalized) {
    return '';
  }

  const temporal = ARROW_TEMPORAL_TYPE.exec(normalized);
  if (temporal) {
    const [, kind, unit, timeZone] = temporal;
    if (/^timestamp$/i.test(kind)) {
      return timeZone ? 'timestamptz' : TIMESTAMP_TYPE_NAMES[unit.toUpperCase()] ?? 'timestamp';
    }
    return /^date/i.test(kind) ? 'date' : 'time';
  }
  if (/^interval</i.test(normalized)) {
    return 'interval';
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
  return Array.from(formatTableLines(columns, rows, options)).join('\n');
}

/**
 * Yield an ASCII table one line at a time.
 */
export function* formatTableLines(
  columns: string[],
  rows: unknown[][],
  options: TableOptions = {}
): IterableIterator<string> {
  const {
    maxColumnWidth = DEFAULT_MAX_COLUMN_WIDTH,
    maxWidth,
    nullValue = 'NULL',
    columnTypes,
    showTypes = false,
    alignByType = Boolean(columnTypes),
  } = options;

  if (columns.length === 0) {
    return;
  }

  const columnWidthCap = maxColumnWidth > 0 ? maxColumnWidth : Number.MAX_SAFE_INTEGER;
  const typeLabels = showTypes ? columns.map((_, index) => normalizeColumnType(columnTypes?.[index])) : [];

  // Format all values
  const formattedRows = rows.map((row) =>
    columns.map((_, index) => formatValue(toDisplayValue(row[index], columnTypes?.[index]), nullValue))
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

  // Top border
  yield '\u250c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u252c') + '\u2510';

  // Header row
  yield (
    '\u2502' +
      columns.map((col, i) => ' ' + alignCell(col, widths[i], 'center') + ' ').join('\u2502') +
      '\u2502'
  );

  if (showTypes) {
    yield (
      '\u2502' +
        typeLabels.map((type, i) => ' ' + alignCell(type, widths[i], 'center') + ' ').join('\u2502') +
        '\u2502'
    );
  }

  // Header separator
  yield '\u251c' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u253c') + '\u2524';

  // Data rows
  for (const row of formattedRows) {
    yield (
      '\u2502' +
        columns.map((_, i) => ' ' + alignCell(row[i] ?? '', widths[i], dataAlignments[i]) + ' ').join('\u2502') +
        '\u2502'
    );
  }

  // Bottom border
  yield '\u2514' + widths.map((w) => '\u2500'.repeat(w + 2)).join('\u2534') + '\u2518';
}

/**
 * Format query results as CSV. Pass the result's `columnTypes` so dates and
 * times are written as text instead of Arrow's epoch numbers.
 */
export function formatCSV(columns: string[], rows: unknown[][], columnTypes?: string[]): string {
  return Array.from(formatCSVLines(columns, rows, columnTypes)).join('\n');
}

export function* formatCSVLines(
  columns: string[],
  rows: unknown[][],
  columnTypes?: string[]
): IterableIterator<string> {
  if (columns.length === 0) return;
  yield formatCSVHeader(columns);
  for (const row of rows) yield formatCSVRow(row, columnTypes);
}

export function formatCSVHeader(columns: string[]): string {
  return columns.map((column) => escapeCSVValue(column)).join(',');
}

export function formatCSVRow(row: unknown[], columnTypes?: string[]): string {
  return row.map((value, index) => escapeCSVValue(toDisplayValue(value, columnTypes?.[index]))).join(',');
}

export function formatCSVRows(rows: unknown[][], columnTypes?: string[]): string[] {
  return rows.map((row) => formatCSVRow(row, columnTypes));
}

/**
 * Format query results as TSV (Tab-Separated Values)
 */
export function formatTSV(columns: string[], rows: unknown[][], columnTypes?: string[]): string {
  return Array.from(formatTSVLines(columns, rows, columnTypes)).join('\n');
}

export function* formatTSVLines(
  columns: string[],
  rows: unknown[][],
  columnTypes?: string[]
): IterableIterator<string> {
  if (columns.length === 0) return;
  yield formatTSVHeader(columns);
  for (const row of rows) yield formatTSVRow(row, columnTypes);
}

export function formatTSVHeader(columns: string[]): string {
  return columns.map((column) => escapeTSVValue(column)).join('\t');
}

export function formatTSVRow(row: unknown[], columnTypes?: string[]): string {
  return row.map((value, index) => escapeTSVValue(toDisplayValue(value, columnTypes?.[index]))).join('\t');
}

export function formatTSVRows(rows: unknown[][], columnTypes?: string[]): string[] {
  return rows.map((row) => formatTSVRow(row, columnTypes));
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
export function formatJSON(columns: string[], rows: unknown[][], columnTypes?: string[]): string {
  return Array.from(formatJSONLines(columns, rows, columnTypes)).join('\n');
}

export function* formatJSONLines(
  columns: string[],
  rows: unknown[][],
  columnTypes?: string[]
): IterableIterator<string> {
  if (rows.length === 0) {
    yield '[]';
    return;
  }

  yield '[';
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const obj: Record<string, unknown> = {};
    columns.forEach((column, columnIndex) => {
      obj[column] = toDisplayValue(rows[rowIndex][columnIndex], columnTypes?.[columnIndex]) ?? null;
    });
    const objectLines = JSON.stringify(obj, jsonSafeReplacer, 2).split('\n');
    for (let lineIndex = 0; lineIndex < objectLines.length; lineIndex++) {
      const comma = rowIndex < rows.length - 1 && lineIndex === objectLines.length - 1 ? ',' : '';
      yield `  ${objectLines[lineIndex]}${comma}`;
    }
  }
  yield ']';
}
