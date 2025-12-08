import { describe, it, expect } from 'vitest';
import { transformData, validateResultForChart } from './data-transformer';
import type { QueryResult } from '../types';

describe('transformData', () => {
  it('transforms numeric data for line chart', () => {
    const result: QueryResult = {
      columns: ['x', 'y'],
      rows: [
        [1, 10],
        [2, 20],
        [3, 30],
      ],
      rowCount: 3,
      duration: 1,
    };

    const transformed = transformData(result, { type: 'line' });

    expect(transformed.chartType).toBe('line');
    // Both columns are numeric, so X is row index and both become Y series
    expect(transformed.data).toHaveLength(3); // X (indices) + 2 Y series
    expect(transformed.data[0]).toEqual([0, 1, 2]); // Row indices as X
    expect(transformed.seriesNames).toContain('x');
    expect(transformed.seriesNames).toContain('y');
  });

  it('transforms temporal X axis to timestamps', () => {
    const result: QueryResult = {
      columns: ['date', 'value'],
      rows: [
        ['2024-01-01', 100],
        ['2024-01-02', 200],
      ],
      rowCount: 2,
      duration: 1,
    };

    const transformed = transformData(result, { duckdbTypes: ['DATE', 'INTEGER'] });

    expect(transformed.axes.xColumn).toBe('date');
    // Timestamps should be in seconds
    expect(transformed.data[0][0]).toBeGreaterThan(1700000000);
  });

  it('transforms categorical X axis to indices', () => {
    const result: QueryResult = {
      columns: ['category', 'value'],
      rows: [
        ['A', 10],
        ['B', 20],
        ['C', 30],
      ],
      rowCount: 3,
      duration: 1,
    };

    const transformed = transformData(result, { duckdbTypes: ['VARCHAR', 'INTEGER'] });

    expect(transformed.axes.xColumn).toBe('category');
    expect(transformed.data[0]).toEqual([0, 1, 2]); // Category indices
    expect(transformed.axes.xLabels).toEqual(['A', 'B', 'C']);
  });

  it('aggregates duplicate categorical values by summing', () => {
    const result: QueryResult = {
      columns: ['category', 'value'],
      rows: [
        ['A', 10],
        ['B', 20],
        ['A', 5], // Duplicate 'A' - should be summed
        ['B', 15], // Duplicate 'B' - should be summed
        ['C', 30],
      ],
      rowCount: 5,
      duration: 1,
    };

    const transformed = transformData(result, { duckdbTypes: ['VARCHAR', 'INTEGER'] });

    expect(transformed.axes.xColumn).toBe('category');
    expect(transformed.data[0]).toEqual([0, 1, 2]); // Only 3 unique categories
    expect(transformed.axes.xLabels).toEqual(['A', 'B', 'C']); // Preserves order of first occurrence
    expect(transformed.data[1]).toEqual([15, 35, 30]); // A: 10+5=15, B: 20+15=35, C: 30
  });

  it('handles null values', () => {
    const result: QueryResult = {
      columns: ['x', 'y'],
      rows: [
        [1, 10],
        [2, null],
        [3, 30],
      ],
      rowCount: 3,
      duration: 1,
    };

    const transformed = transformData(result);

    // With two numeric columns, both become Y series (indices 1 and 2)
    // The 'y' column with null is at index 2
    expect(transformed.data[2]).toContain(null);
  });

  it('auto-detects histogram for single numeric column', () => {
    const result: QueryResult = {
      columns: ['value'],
      rows: [[1], [2], [2], [3], [3], [3], [4], [4], [5]],
      rowCount: 9,
      duration: 1,
    };

    const transformed = transformData(result, { duckdbTypes: ['INTEGER'] });

    expect(transformed.chartType).toBe('histogram');
    expect(transformed.seriesNames).toEqual(['Count']);
    // Histogram creates bins
    expect(transformed.axes.xLabels).toBeDefined();
  });

  it('respects type override', () => {
    const result: QueryResult = {
      columns: ['date', 'value'],
      rows: [
        ['2024-01-01', 100],
        ['2024-01-02', 200],
      ],
      rowCount: 2,
      duration: 1,
    };

    const transformed = transformData(result, { type: 'bar' });

    expect(transformed.chartType).toBe('bar');
  });

  it('respects x/y column overrides', () => {
    const result: QueryResult = {
      columns: ['a', 'b', 'c'],
      rows: [
        [1, 10, 100],
        [2, 20, 200],
      ],
      rowCount: 2,
      duration: 1,
    };

    const transformed = transformData(result, { x: 'a', y: ['c'] });

    expect(transformed.axes.xColumn).toBe('a');
    expect(transformed.axes.yColumns).toEqual(['c']);
  });

  it('handles multiple Y columns', () => {
    const result: QueryResult = {
      columns: ['date', 'revenue', 'cost'],
      rows: [
        ['2024-01-01', 100, 50],
        ['2024-01-02', 200, 75],
      ],
      rowCount: 2,
      duration: 1,
    };

    const transformed = transformData(result, { duckdbTypes: ['DATE', 'INTEGER', 'INTEGER'] });

    expect(transformed.seriesNames).toEqual(['revenue', 'cost']);
    expect(transformed.data).toHaveLength(3); // X + 2 Y series
  });
});

describe('validateResultForChart', () => {
  it('validates result with numeric columns', () => {
    const result: QueryResult = {
      columns: ['id', 'value'],
      rows: [[1, 100]],
      rowCount: 1,
      duration: 1,
    };

    expect(validateResultForChart(result)).toEqual({ valid: true });
  });

  it('rejects null result', () => {
    expect(validateResultForChart(null as unknown as QueryResult)).toEqual({
      valid: false,
      error: 'No data to chart. Run a query first.',
    });
  });

  it('rejects empty result', () => {
    const result: QueryResult = {
      columns: ['id'],
      rows: [],
      rowCount: 0,
      duration: 1,
    };

    expect(validateResultForChart(result)).toEqual({
      valid: false,
      error: 'Query returned no rows.',
    });
  });

  it('rejects result with no numeric columns', () => {
    const result: QueryResult = {
      columns: ['name', 'category'],
      rows: [['Alice', 'A']],
      rowCount: 1,
      duration: 1,
    };

    expect(validateResultForChart(result)).toEqual({
      valid: false,
      error: 'No numeric columns found for charting.',
    });
  });
});
