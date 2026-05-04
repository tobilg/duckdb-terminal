import { describe, it, expect } from 'vitest';
import {
  formatTable,
  formatCSV,
  formatCSVHeader,
  formatCSVRow,
  formatTSV,
  formatTSVHeader,
  formatTSVRow,
  formatJSON,
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
