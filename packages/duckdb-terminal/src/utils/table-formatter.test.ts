import { describe, it, expect } from 'vitest';
import {
  formatTable,
  formatTableLines,
  formatCSV,
  formatCSVHeader,
  formatCSVRow,
  formatTSV,
  formatTSVHeader,
  formatTSVRow,
  formatJSON,
  formatJSONLines,
  toDisplayValue,
} from './table-formatter';

describe('formatTable', () => {
  it('should format empty result', () => {
    const result = formatTable([], []);
    expect(result).toBe('');
  });

  it('should format single column single row', () => {
    const result = formatTable(['name'], [['Alice']]);
    expect(result).toContain('name');
    expect(result).toContain('Alice');
  });

  it('should format multiple columns and rows', () => {
    const columns = ['id', 'name', 'age'];
    const rows = [
      [1, 'Alice', 30],
      [2, 'Bob', 25],
    ];
    const result = formatTable(columns, rows);

    expect(result).toContain('id');
    expect(result).toContain('name');
    expect(result).toContain('age');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).toContain('30');
    expect(result).toContain('25');
  });

  it('should keep line iteration compatible with string formatting', () => {
    const columns = ['id', 'name'];
    const rows = [[1, 'Alice'], [2, 'Bob']];
    expect(Array.from(formatTableLines(columns, rows)).join('\n')).toBe(
      formatTable(columns, rows)
    );
  });

  it('should handle null values', () => {
    const result = formatTable(['value'], [[null]]);
    expect(result).toContain('NULL');
  });

  it('should handle long strings with truncation', () => {
    const longString = 'a'.repeat(100);
    const result = formatTable(['value'], [[longString]], { maxColumnWidth: 20 });
    expect(result).toContain('\u2026'); // ellipsis
    expect(result.length).toBeLessThan(longString.length * 2);
  });

  it('should constrain table width when maxWidth is provided', () => {
    const result = formatTable(
      ['code', 'description'],
      [['ATL', 'United States, Mexico, and Canada pricing region']],
      { maxWidth: 40, maxColumnWidth: 80 }
    );

    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(result).toContain('\u2026');
  });

  it('should render an optional column type row', () => {
    const result = formatTable(
      ['amount', 'name'],
      [[123, 'Alice']],
      { columnTypes: ['INTEGER', 'VARCHAR'], showTypes: true }
    );
    const lines = result.split('\n');

    expect(lines[1]).toContain('amount');
    expect(lines[2]).toContain('integer');
    expect(lines[2]).toContain('varchar');
    expect(lines[3]).toMatch(/^├/);
  });

  it('should right-align numeric values when column types are provided', () => {
    const result = formatTable(
      ['name', 'amount'],
      [
        ['A', 1],
        ['Long', 200],
      ],
      { columnTypes: ['VARCHAR', 'INTEGER'] }
    );
    const dataLine = result.split('\n').find((line) => line.includes('A'))!;
    const cells = dataLine.split('│');

    expect(cells[1]).toMatch(/^ A +$/);
    expect(cells[2]).toMatch(/^ +1 $/);
  });
});

describe('formatCSV', () => {
  it('should format empty result', () => {
    const result = formatCSV([], []);
    expect(result).toBe('');
  });

  it('should format basic data', () => {
    const columns = ['name', 'age'];
    const rows = [['Alice', 30]];
    const result = formatCSV(columns, rows);

    expect(result).toBe('name,age\nAlice,30');
  });

  it('should escape values with commas', () => {
    const result = formatCSV(['value'], [['hello, world']]);
    expect(result).toContain('"hello, world"');
  });

  it('should escape values with quotes', () => {
    const result = formatCSV(['value'], [['say "hello"']]);
    expect(result).toContain('"say ""hello"""');
  });

  it('should expose compatible header and row helpers', () => {
    const columns = ['name', 'note'];
    const rows = [['Alice', 'hello, "world"']];

    expect([formatCSVHeader(columns), formatCSVRow(rows[0])].join('\n')).toBe(formatCSV(columns, rows));
  });
});

describe('formatTSV', () => {
  it('should format empty result', () => {
    const result = formatTSV([], []);
    expect(result).toBe('');
  });

  it('should format basic data', () => {
    const columns = ['name', 'age'];
    const rows = [['Alice', 30]];
    const result = formatTSV(columns, rows);

    expect(result).toBe('name\tage\nAlice\t30');
  });

  it('should escape tabs and newlines', () => {
    const result = formatTSV(['value'], [['hello\tworld\nagain']]);
    expect(result).toBe('value\nhello world again');
  });

  it('should expose compatible header and row helpers', () => {
    const columns = ['name', 'note'];
    const rows = [['Alice', 'hello\tworld']];

    expect([formatTSVHeader(columns), formatTSVRow(rows[0])].join('\n')).toBe(formatTSV(columns, rows));
  });
});

describe('formatJSON', () => {
  it('should format empty result', () => {
    const result = formatJSON([], []);
    expect(result).toBe('[]');
  });

  it('should format basic data', () => {
    const columns = ['name', 'age'];
    const rows = [['Alice', 30]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ name: 'Alice', age: 30 });
  });

  it('should handle multiple rows', () => {
    const columns = ['id', 'name'];
    const rows = [
      [1, 'Alice'],
      [2, 'Bob'],
    ];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Alice');
    expect(parsed[1].name).toBe('Bob');
  });

  it('should keep JSON line iteration compatible with string formatting', () => {
    const columns = ['id', 'name'];
    const rows = [[1, 'Alice'], [2, 'Bob']];
    expect(Array.from(formatJSONLines(columns, rows)).join('\n')).toBe(
      formatJSON(columns, rows)
    );
  });

  it('should handle numeric values (DuckDB converts BigInt to Double)', () => {
    // DuckDB's castBigIntToDouble config converts BigInt to numbers at query time
    const columns = ['id', 'count'];
    const rows = [[1, 1000]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].id).toBe(1);
    expect(parsed[0].count).toBe(1000);
  });

  it('should handle floating point numbers', () => {
    const columns = ['value'];
    const rows = [[3.14159]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].value).toBe(3.14159);
  });

  it('should handle null and undefined values', () => {
    const columns = ['a', 'b'];
    const rows = [[null, undefined]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].a).toBeNull();
    expect(parsed[0].b).toBeNull();
  });

  it('should handle nested arrays with numbers', () => {
    const columns = ['values'];
    const rows = [[[1, 2, 3]]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].values).toEqual([1, 2, 3]);
  });
});

// Values and type names as DuckDB-WASM returns them through Arrow.
describe('toDisplayValue', () => {
  it.each([
    [1735672255000, 'Timestamp<MICROSECOND>', '2024-12-31 19:10:55'],
    [1735672255123.456, 'Timestamp<MICROSECOND>', '2024-12-31 19:10:55.123456'],
    [1735672255500, 'Timestamp<MILLISECOND>', '2024-12-31 19:10:55.5'],
    [-500, 'Timestamp<MICROSECOND>', '1969-12-31 23:59:59.5'],
    [1735672255000, 'Timestamp<MICROSECOND, UTC>', '2024-12-31 19:10:55+00'],
    [1735603200000, 'Date32<DAY>', '2024-12-31'],
    [-14256000000, 'Date32<DAY>', '1969-07-20'],
    [1735603200000, 'Date64<MILLISECOND>', '2024-12-31'],
    [69055000000n, 'Time64<MICROSECOND>', '19:10:55'],
    [69055123456n, 'Time64<MICROSECOND>', '19:10:55.123456'],
    [69055500, 'Time32<MILLISECOND>', '19:10:55.5'],
  ])('formats %s of type %s as %s', (value, type, expected) => {
    expect(toDisplayValue(value, type)).toBe(expected);
  });

  it('leaves other values unchanged', () => {
    expect(toDisplayValue(42, 'Int32')).toBe(42);
    expect(toDisplayValue(42n, 'Int64')).toBe(42n);
    expect(toDisplayValue('2024-12-31', 'Utf8')).toBe('2024-12-31');
    expect(toDisplayValue(null, 'Timestamp<MICROSECOND>')).toBeNull();
    expect(toDisplayValue(1735672255000, undefined)).toBe(1735672255000);
    expect(toDisplayValue(Number.POSITIVE_INFINITY, 'Timestamp<MICROSECOND>')).toBe(Number.POSITIVE_INFINITY);
    expect(toDisplayValue(1e20, 'Date32<DAY>')).toBe(1e20);
  });
});

describe('temporal columns', () => {
  const columns = ['ts', 'd', 'tz', 't'];
  const columnTypes = ['Timestamp<MICROSECOND>', 'Date32<DAY>', 'Timestamp<MICROSECOND, UTC>', 'Time64<MICROSECOND>'];
  const rows = [[1735672255000, 1735603200000, 1735672255000, 69055000000n]];

  it('shows dates and times and DuckDB type names in tables', () => {
    const table = formatTable(columns, rows, { columnTypes, showTypes: true });
    expect(table).toContain('2024-12-31 19:10:55');
    expect(table).toContain('2024-12-31 19:10:55+00');
    expect(table).toContain('19:10:55');
    expect(table).not.toContain('1735672255000');
    expect(table).toMatch(/│\s+timestamp\s+│\s+date\s+│\s+timestamptz\s+│\s+time\s+│/);
  });

  it('writes dates and times in CSV, TSV, and JSON', () => {
    expect(formatCSV(columns, rows, columnTypes)).toBe('ts,d,tz,t\n2024-12-31 19:10:55,2024-12-31,2024-12-31 19:10:55+00,19:10:55');
    expect(formatTSV(columns, rows, columnTypes).split('\n')[1]).toBe('2024-12-31 19:10:55\t2024-12-31\t2024-12-31 19:10:55+00\t19:10:55');
    expect(JSON.parse(formatJSON(columns, rows, columnTypes))).toEqual([
      { ts: '2024-12-31 19:10:55', d: '2024-12-31', tz: '2024-12-31 19:10:55+00', t: '19:10:55' },
    ]);
  });

  it('keeps the old output without column types', () => {
    expect(formatCSV(['ts'], [[1735672255000]])).toBe('ts\n1735672255000');
  });
});

describe('HUGEINT values (Arrow big numbers)', () => {
  /** Like Arrow's BigNum: a typed array whose toJSON() quotes the number. */
  const bigNum = (digits: string) => Object.assign(new Uint32Array(4), {
    toJSON: () => `"${digits}"`,
    toString: () => digits,
    [Symbol.toPrimitive]: (hint: string) => (hint === 'number' ? Number(digits) : digits),
  });

  it('shows the digits in tables, CSV, and TSV', () => {
    expect(formatCSV(['total'], [[bigNum('9192')]])).toBe('total\n9192');
    expect(formatTSV(['total'], [[bigNum('9192')]])).toBe('total\n9192');
    expect(formatTable(['total'], [[bigNum('9192')]])).toContain('│ 9192  │');
    expect(formatTable(['total'], [[bigNum('9192')]])).not.toContain('"');
  });

  it('writes numbers to JSON, and strings beyond the safe integer range', () => {
    expect(JSON.parse(formatJSON(['total'], [[bigNum('9192')]]))).toEqual([{ total: 9192 }]);
    expect(JSON.parse(formatJSON(['total'], [[bigNum('123456789012345678901234567890')]]))).toEqual([{ total: '123456789012345678901234567890' }]);
  });
});
