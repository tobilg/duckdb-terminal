import { describe, expect, it } from 'vitest';
import { formatExplainResultLines, isExplainResult } from './explain-formatter';

describe('isExplainResult', () => {
  it.each(['physical_plan', 'logical_plan', 'logical_opt', 'analyzed_plan'])(
    'should recognize the canonical %s result',
    (key) => {
      expect(isExplainResult({
        columns: ['explain_key', 'explain_value'],
        rows: [[key, 'plan']],
      })).toBe(true);
    }
  );

  it('should compare canonical column and key names case-insensitively', () => {
    expect(isExplainResult({
      columns: ['EXPLAIN_KEY', 'EXPLAIN_VALUE'],
      rows: [['PHYSICAL_PLAN', 'plan']],
    })).toBe(true);
  });

  it('should reject ordinary results that only reuse the column names', () => {
    expect(isExplainResult({
      columns: ['explain_key', 'explain_value'],
      rows: [['custom_label', 'not a DuckDB plan']],
    })).toBe(false);
  });

  it('should reject non-string plans and different result shapes', () => {
    expect(isExplainResult({
      columns: ['explain_key', 'explain_value'],
      rows: [['physical_plan', null]],
    })).toBe(false);
    expect(isExplainResult({
      columns: ['explain_value'],
      rows: [['plan']],
    })).toBe(false);
  });
});

describe('formatExplainResultLines', () => {
  it('should preserve LF and CRLF plan lines without an outer table', () => {
    const lines = Array.from(formatExplainResultLines({
      columns: ['explain_key', 'explain_value'],
      rows: [['physical_plan', 'ORDER_BY\r\n  count_star() DESC\nHASH_GROUP_BY']],
    }));

    expect(lines).toEqual([
      'ORDER_BY',
      '  count_star() DESC',
      'HASH_GROUP_BY',
    ]);
  });

  it('should label and separate multiple plan representations', () => {
    const lines = Array.from(formatExplainResultLines({
      columns: ['explain_key', 'explain_value'],
      rows: [
        ['logical_plan', 'LOGICAL'],
        ['logical_opt', 'OPTIMIZED'],
        ['physical_plan', 'PHYSICAL'],
      ],
    }));

    expect(lines).toEqual([
      'logical_plan:',
      'LOGICAL',
      '',
      'logical_opt:',
      'OPTIMIZED',
      '',
      'physical_plan:',
      'PHYSICAL',
    ]);
  });
});
