import { describe, it, expect } from 'vitest';
import {
  detectColumnType,
  analyzeColumns,
  detectChartType,
  selectAxes,
  validateColumns,
} from './type-detector';
import type { ColumnInfo } from './types';

describe('detectColumnType', () => {
  it('detects numeric types from DuckDB type strings', () => {
    expect(detectColumnType('INTEGER', [])).toBe('numeric');
    expect(detectColumnType('BIGINT', [])).toBe('numeric');
    expect(detectColumnType('DOUBLE', [])).toBe('numeric');
    expect(detectColumnType('DECIMAL(10,2)', [])).toBe('numeric');
    expect(detectColumnType('FLOAT', [])).toBe('numeric');
  });

  it('detects temporal types from DuckDB type strings', () => {
    expect(detectColumnType('DATE', [])).toBe('temporal');
    expect(detectColumnType('TIMESTAMP', [])).toBe('temporal');
    expect(detectColumnType('TIMESTAMPTZ', [])).toBe('temporal');
    expect(detectColumnType('TIME', [])).toBe('temporal');
    expect(detectColumnType('INTERVAL', [])).toBe('temporal');
  });

  it('detects categorical types from DuckDB type strings', () => {
    expect(detectColumnType('VARCHAR', [])).toBe('categorical');
    expect(detectColumnType('TEXT', [])).toBe('categorical');
    expect(detectColumnType('BOOLEAN', [])).toBe('categorical');
    expect(detectColumnType('UUID', [])).toBe('categorical');
  });

  it('falls back to value sampling when no DuckDB type', () => {
    expect(detectColumnType(undefined, [1, 2, 3, 4, 5])).toBe('numeric');
    expect(detectColumnType(undefined, [1.5, 2.5, 3.5])).toBe('numeric');
    expect(detectColumnType(undefined, ['a', 'b', 'c'])).toBe('categorical');
    expect(detectColumnType(undefined, [true, false, true])).toBe('categorical');
  });

  it('detects temporal from date strings', () => {
    expect(detectColumnType(undefined, ['2024-01-01', '2024-01-02'])).toBe('temporal');
    expect(detectColumnType(undefined, ['2024-01-01T10:00:00'])).toBe('temporal');
  });

  it('returns unknown for empty values', () => {
    expect(detectColumnType(undefined, [])).toBe('unknown');
    expect(detectColumnType(undefined, [null, null])).toBe('unknown');
  });

  it('handles bigint values', () => {
    expect(detectColumnType(undefined, [BigInt(1), BigInt(2)])).toBe('numeric');
  });
});

describe('analyzeColumns', () => {
  it('analyzes columns from query result', () => {
    const columns = ['id', 'name', 'amount'];
    const rows = [
      [1, 'Alice', 100.5],
      [2, 'Bob', 200.0],
    ];
    const types = ['INTEGER', 'VARCHAR', 'DOUBLE'];

    const result = analyzeColumns(columns, rows, types);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: 'id',
      type: 'numeric',
      duckdbType: 'INTEGER',
      uniqueCount: 2,
    });
    expect(result[1]).toEqual({
      name: 'name',
      type: 'categorical',
      duckdbType: 'VARCHAR',
      uniqueCount: 2,
    });
    expect(result[2]).toEqual({
      name: 'amount',
      type: 'numeric',
      duckdbType: 'DOUBLE',
      uniqueCount: 2,
    });
  });

  it('counts unique values correctly', () => {
    const columns = ['category'];
    const rows = [['A'], ['B'], ['A'], ['C'], ['B']];

    const result = analyzeColumns(columns, rows);

    expect(result[0].uniqueCount).toBe(3);
  });

  it('handles null values in unique count', () => {
    const columns = ['value'];
    const rows = [[1], [null], [1], [null], [2]];

    const result = analyzeColumns(columns, rows);

    expect(result[0].uniqueCount).toBe(2); // nulls excluded
  });
});

describe('detectChartType', () => {
  it('returns histogram for single numeric column', () => {
    const columns: ColumnInfo[] = [
      { name: 'value', type: 'numeric' },
    ];

    expect(detectChartType(columns)).toBe('histogram');
  });

  it('returns line for temporal + numeric', () => {
    const columns: ColumnInfo[] = [
      { name: 'date', type: 'temporal' },
      { name: 'value', type: 'numeric' },
    ];

    expect(detectChartType(columns)).toBe('line');
  });

  it('returns bar for categorical + numeric', () => {
    const columns: ColumnInfo[] = [
      { name: 'category', type: 'categorical', uniqueCount: 5 },
      { name: 'value', type: 'numeric' },
    ];

    expect(detectChartType(columns)).toBe('bar');
  });

  it('returns scatter for two numeric columns', () => {
    const columns: ColumnInfo[] = [
      { name: 'x', type: 'numeric' },
      { name: 'y', type: 'numeric' },
    ];

    expect(detectChartType(columns)).toBe('scatter');
  });

  it('returns line for multiple numeric columns', () => {
    const columns: ColumnInfo[] = [
      { name: 'a', type: 'numeric' },
      { name: 'b', type: 'numeric' },
      { name: 'c', type: 'numeric' },
    ];

    expect(detectChartType(columns)).toBe('line');
  });

  it('ignores categorical with too many unique values', () => {
    const columns: ColumnInfo[] = [
      { name: 'id', type: 'categorical', uniqueCount: 100 },
      { name: 'value', type: 'numeric' },
    ];

    // Should not be detected as bar chart since too many categories
    expect(detectChartType(columns)).toBe('line');
  });
});

describe('selectAxes', () => {
  it('applies user overrides', () => {
    const columns: ColumnInfo[] = [
      { name: 'a', type: 'numeric' },
      { name: 'b', type: 'numeric' },
      { name: 'c', type: 'numeric' },
    ];

    const result = selectAxes(columns, { x: 'a', y: ['b'] });

    expect(result.xColumn).toBe('a');
    expect(result.yColumns).toEqual(['b']);
  });

  it('auto-selects temporal column for X axis', () => {
    const columns: ColumnInfo[] = [
      { name: 'value', type: 'numeric' },
      { name: 'date', type: 'temporal' },
    ];

    const result = selectAxes(columns);

    expect(result.xColumn).toBe('date');
    expect(result.yColumns).toEqual(['value']);
  });

  it('auto-selects categorical column for X axis', () => {
    const columns: ColumnInfo[] = [
      { name: 'value', type: 'numeric' },
      { name: 'category', type: 'categorical', uniqueCount: 5 },
    ];

    const result = selectAxes(columns);

    expect(result.xColumn).toBe('category');
    expect(result.yColumns).toEqual(['value']);
    expect(result.xLabels).toEqual([]);
  });

  it('uses row index when no suitable X column', () => {
    const columns: ColumnInfo[] = [
      { name: 'a', type: 'numeric' },
      { name: 'b', type: 'numeric' },
    ];

    const result = selectAxes(columns);

    expect(result.xColumn).toBeNull();
    expect(result.yColumns).toEqual(['a', 'b']);
  });

  it('selects all numeric columns for Y axis', () => {
    const columns: ColumnInfo[] = [
      { name: 'date', type: 'temporal' },
      { name: 'revenue', type: 'numeric' },
      { name: 'cost', type: 'numeric' },
      { name: 'profit', type: 'numeric' },
    ];

    const result = selectAxes(columns);

    expect(result.xColumn).toBe('date');
    expect(result.yColumns).toEqual(['revenue', 'cost', 'profit']);
  });
});

describe('validateColumns', () => {
  const columns: ColumnInfo[] = [
    { name: 'id', type: 'numeric' },
    { name: 'name', type: 'categorical' },
    { name: 'value', type: 'numeric' },
  ];

  it('validates existing columns', () => {
    const result = validateColumns(['id', 'value'], columns);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports missing columns', () => {
    const result = validateColumns(['id', 'foo', 'bar'], columns);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['foo', 'bar']);
  });

  it('handles empty column list', () => {
    const result = validateColumns([], columns);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
