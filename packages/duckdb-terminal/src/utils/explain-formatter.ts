import type { QueryResult } from '../types';

const EXPLAIN_COLUMNS = ['explain_key', 'explain_value'] as const;
const EXPLAIN_KEYS = new Set([
  'logical_plan',
  'logical_opt',
  'physical_plan',
  'analyzed_plan',
]);

type ExplainResult = Pick<QueryResult, 'columns' | 'rows'>;

/**
 * Recognizes DuckDB's canonical two-column EXPLAIN result without parsing SQL.
 */
export function isExplainResult(result: ExplainResult): boolean {
  if (
    result.columns.length !== EXPLAIN_COLUMNS.length ||
    result.columns.some(
      (column, index) => column.toLowerCase() !== EXPLAIN_COLUMNS[index]
    ) ||
    result.rows.length === 0
  ) {
    return false;
  }

  return result.rows.every((row) =>
    row.length === EXPLAIN_COLUMNS.length &&
    typeof row[0] === 'string' &&
    typeof row[1] === 'string' &&
    EXPLAIN_KEYS.has(row[0].toLowerCase())
  );
}

/**
 * Yields DuckDB query plans without an outer table or width truncation.
 */
export function* formatExplainResultLines(
  result: ExplainResult
): IterableIterator<string> {
  const showPlanKeys = result.rows.length > 1;

  for (let rowIndex = 0; rowIndex < result.rows.length; rowIndex++) {
    const [key, value] = result.rows[rowIndex] as [string, string];
    if (rowIndex > 0) yield '';
    if (showPlanKeys) yield `${key}:`;
    yield* splitTextLines(value);
  }
}

/**
 * Splits lazily to avoid allocating another array for large plans.
 */
function* splitTextLines(text: string): IterableIterator<string> {
  let start = 0;

  while (true) {
    const newline = text.indexOf('\n', start);
    if (newline === -1) {
      yield text.slice(start);
      return;
    }

    const end = newline > start && text.charCodeAt(newline - 1) === 13
      ? newline - 1
      : newline;
    yield text.slice(start, end);
    start = newline + 1;

    if (start === text.length) {
      yield '';
      return;
    }
  }
}
