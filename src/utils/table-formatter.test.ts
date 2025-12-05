import { describe, it, expect } from 'vitest';
import { formatTable, formatCSV, formatJSON } from './table-formatter';

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

  it('should handle BigInt values within safe integer range', () => {
    const columns = ['id', 'count'];
    const rows = [[BigInt(1), BigInt(1000)]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].id).toBe(1);
    expect(parsed[0].count).toBe(1000);
  });

  it('should handle BigInt values outside safe integer range', () => {
    const columns = ['big_number'];
    const largeNumber = BigInt('9007199254740993'); // Larger than MAX_SAFE_INTEGER
    const rows = [[largeNumber]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].big_number).toBe('9007199254740993');
  });

  it('should handle null and undefined values', () => {
    const columns = ['a', 'b'];
    const rows = [[null, undefined]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].a).toBeNull();
    expect(parsed[0].b).toBeNull();
  });

  it('should handle nested arrays with BigInt', () => {
    const columns = ['values'];
    const rows = [[[BigInt(1), BigInt(2), BigInt(3)]]];
    const result = formatJSON(columns, rows);
    const parsed = JSON.parse(result);

    expect(parsed[0].values).toEqual([1, 2, 3]);
  });
});
