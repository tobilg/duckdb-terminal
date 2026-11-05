import { describe, it, expect } from 'vitest';
import {
  DocsIndex,
  chunksFromBundle,
  formatDocsResults,
  MAX_DOCS_RESULT_CHARS,
  MAX_DOCS_SECTION_CHARS,
  queryTerms,
  tokenize,
  type DocsBundle,
  type DocsChunk,
} from './docs-search';
import bundledDocs from './docs/duckdb-docs.json?raw';

describe('tokenize', () => {
  it('matches whole words, stems them, and indexes snake_case parts', () => {
    expect(tokenize('Aggregate functions: read_csv_auto(…) types')).toEqual([
      'aggregat', 'funct', 'read_csv_auto', 'read', 'read_csv', 'csv', 'csv_auto', 'auto', 'type',
    ]);
  });

  it('maps the forms of a word to one term', () => {
    const same = (...words: string[]) => expect(new Set(tokenize(words.join(' '))).size, words.join(', ')).toBe(1);
    same('truncation', 'truncate', 'truncated', 'truncating');
    same('split', 'splits', 'splitting');
    same('partition', 'partitions', 'partitioning');
    same('database', 'databases');
    same('query', 'queries');
    same('setting', 'settings');
    same('sniff', 'sniffing');
  });

  it('keeps short words, words that only look like plurals, and identifiers', () => {
    expect(tokenize('class status analysis is string union case using')).toEqual(
      ['class', 'status', 'analysis', 'is', 'string', 'union', 'case', 'using']
    );
    expect(tokenize('date_trunc list_aggregates')).toEqual(['date_trunc', 'date', 'trunc', 'list_aggregate', 'list', 'aggregat']);
  });
});

describe('queryTerms', () => {
  it('weights snake_case parts below the whole name and drops filler words', () => {
    expect([...queryTerms('How do I use read_csv_auto?')]).toEqual([
      ['do', 1], ['use', 1], ['read_csv_auto', 1], ['read', 0.25], ['read_csv', 0.5], ['csv', 0.25], ['csv_auto', 0.5], ['auto', 0.25],
    ]);
  });

  it('keeps SQL keywords and falls back to all words for filler-only queries', () => {
    expect([...queryTerms('COPY TO with USING')].map(([term]) => term)).toEqual(['copy', 'to', 'with', 'using']);
    expect([...queryTerms('what is this')].map(([term]) => term)).toEqual(['is']);
    expect([...queryTerms('what the')].map(([term]) => term)).toEqual(['what', 'the']);
  });
});

describe('DocsIndex', () => {
  const chunks: DocsChunk[] = [
    { path: 'SQL › Statements › PIVOT Statement', url: 'https://duckdb.org/docs/2.0/sql/statements/pivot', text: 'Turns rows into columns.' },
    { path: 'SQL › Statements › PIVOT Statement › Syntax', url: 'https://duckdb.org/docs/2.0/sql/statements/pivot#syntax', text: 'PIVOT table ON column USING sum(value)' },
    { path: 'SQL › Statements › UNPIVOT Statement', url: 'https://duckdb.org/docs/2.0/sql/statements/unpivot', text: 'The opposite of PIVOT: columns into rows.' },
    { path: 'Guides › Snippets', url: 'https://duckdb.org/docs/2.0/guides/snippets', text: 'Unrelated text about sharing a database.' },
  ];
  const index = new DocsIndex(chunks);

  it('prefers a page\'s top section and adds its strong runner-up, then one chunk per other page', () => {
    const results = index.search('pivot');
    expect(results.map((chunk) => chunk.url)).toEqual([
      'https://duckdb.org/docs/2.0/sql/statements/pivot',
      'https://duckdb.org/docs/2.0/sql/statements/pivot#syntax',
      'https://duckdb.org/docs/2.0/sql/statements/unpivot',
    ]);
  });

  it('prefers a runner-up with SQL examples over a higher-scoring one without', () => {
    const page = 'https://duckdb.org/docs/2.0/data/csv/overview';
    const csv = new DocsIndex([
      { path: 'Data › CSV Import', url: page, text: 'CSV files: read CSV with DuckDB.' },
      { path: 'Data › CSV Import › CSV Loading', url: `${page}#csv-loading`, text: 'CSV loading is tricky; CSV files vary.' },
      { path: 'Data › CSV Import › Examples', url: `${page}#examples`, text: "Read a CSV file:\n\n```sql\nSELECT * FROM 'flights.csv';\n```\n\nThe reader detects the dialect of the file automatically." },
    ]);
    // Without the preference, the prose section would follow the top section.
    expect(csv.search('csv', 1).map((chunk) => chunk.url)).toEqual([page, `${page}#examples`]);
  });

  it('ranks a table of functions that have sections of their own below other matches', () => {
    const table = (names: string[]) =>
      `| Name | Description |\n|:--|:--|\n${names.map((name, i) => `| \`${name}\` | ${i === 0 ? 'Truncates' : 'Formats'} the value. |`).join('\n')}`;
    const docs = new DocsIndex([
      // A function overview, first so that it would win a tie.
      { path: 'Functions › Value Functions', url: 'https://duckdb.org/docs/2.0/functions', text: table(['trunc(v)', 'fmt(v)', 'pad(v)']) },
      { path: 'Functions › `trunc(v)`', url: 'https://duckdb.org/docs/2.0/functions#truncv', text: 'Rounds toward zero.' },
      { path: 'Functions › `fmt(v)`', url: 'https://duckdb.org/docs/2.0/functions#fmtv', text: 'Returns text.' },
      { path: 'Functions › `pad(v)`', url: 'https://duckdb.org/docs/2.0/functions#padv', text: 'Adds spaces.' },
      // The same table, but its rows have no sections: the table is the only place they are described.
      { path: 'Settings › Value Settings', url: 'https://duckdb.org/docs/2.0/settings', text: table(['trunc_v', 'fmt_v', 'pad_v']) },
    ]);
    expect(docs.search('truncates', 2).map((chunk) => chunk.url)).toEqual([
      'https://duckdb.org/docs/2.0/settings',
      'https://duckdb.org/docs/2.0/functions',
    ]);
  });

  it('returns nothing for unknown words and honors the page limit', () => {
    expect(index.search('zebra')).toEqual([]);
    const pages = new Set(index.search('pivot rows columns', 1).map((chunk) => chunk.url.split('#')[0]));
    expect(pages.size).toBe(1);
  });
});

describe('formatDocsResults', () => {
  const chunk = (n: number, text: string): DocsChunk => ({ path: `Page ${n}`, url: `https://duckdb.org/docs/2.0/p${n}`, text });

  it('lists each result with its heading trail and link', () => {
    expect(formatDocsResults('pivot', [chunk(1, 'one'), chunk(2, 'two')])).toBe(
      'DuckDB documentation for "pivot":\n\n## Page 1\nhttps://duckdb.org/docs/2.0/p1\n\none\n\n## Page 2\nhttps://duckdb.org/docs/2.0/p2\n\ntwo'
    );
  });

  it('shortens sections without SQL examples to the budget and closes a cut code fence', () => {
    const long = 'Parameters:\n\n```text\n' + 'option = value\n'.repeat(400) + '```';
    const output = formatDocsResults('q', [chunk(1, 'short'), chunk(2, long)], 1_000);
    expect(output.length).toBeLessThanOrEqual(1_000);
    expect(output.endsWith('```\n…')).toBe(true);
  });

  it('reduces sections to their SQL examples, each with its introduction', () => {
    const text = [
      'The following examples use the `flights.csv` file. They show the reader.',
      'Read a CSV file:',
      "```sql\nSELECT * FROM 'flights.csv';\n```",
      'The sniffer detects the header. It reads up to 20,480 rows.',
      'Alternatively, use a `CREATE TABLE ... AS SELECT` statement:',
      "```sql\nCREATE TABLE t AS FROM 'flights.csv';\n```",
      '### Override the Header Flag',
      'If a file contains only string columns, detection might fail.',
      "```sql\nSELECT * FROM read_csv('flights.csv', header = true);\n```",
      '```console\nConversion Error: line 5\n```',
    ].join('\n\n');
    expect(formatDocsResults('csv', [chunk(1, text)])).toBe([
      'DuckDB documentation for "csv":',
      '## Page 1\nhttps://duckdb.org/docs/2.0/p1',
      'The following examples use the `flights.csv` file.',
      "Read a CSV file:\n```sql\nSELECT * FROM 'flights.csv';\n```",
      "Alternatively, use a `CREATE TABLE ... AS SELECT` statement:\n```sql\nCREATE TABLE t AS FROM 'flights.csv';\n```",
      "Override the Header Flag\n```sql\nSELECT * FROM read_csv('flights.csv', header = true);\n```",
    ].join('\n\n'));
  });

  it('shows an example repeated in several sections once and skips sections with nothing new', () => {
    const example = (sql: string) => `Example:\n\n\`\`\`sql\n${sql}\n\`\`\``;
    const output = formatDocsResults('csv', [
      chunk(1, example("SELECT * FROM read_csv('a.csv');")),
      chunk(2, `${example("select *  from read_csv('a.csv')")}\n\n${example("SELECT * FROM 'b.csv';")}`),
      chunk(3, example("SELECT * FROM read_csv('a.csv');")),
    ]);
    expect(output.match(/read_csv\('a\.csv'\)/gi)).toHaveLength(1);
    expect(output).toContain("SELECT * FROM 'b.csv';");
    expect(output).not.toContain('## Page 3');
  });

  it('limits each of several sections, and leaves out examples that do not fit', () => {
    const examples = (n: number) => Array.from({ length: 30 }, (_, i) => `Example ${i}:\n\n\`\`\`sql\nSELECT ${n * 100 + i} AS value_with_a_long_name;\n\`\`\``).join('\n\n');
    const huge = '```sql\n' + 'SELECT 1;\n'.repeat(400) + '```';
    const output = formatDocsResults('q', [chunk(1, examples(1)), chunk(2, `${huge}\n\n${examples(2)}`)]);
    const [first, second] = output.split('\n\n## ').slice(1);
    expect(first.length).toBeLessThanOrEqual(MAX_DOCS_SECTION_CHARS);
    expect(second).toContain('SELECT 200 AS value_with_a_long_name;');
    expect(second).not.toContain('SELECT 1;');
    expect(output.length).toBeLessThanOrEqual(MAX_DOCS_RESULT_CHARS);
    expect(formatDocsResults('q', [chunk(1, examples(1))]).length).toBeGreaterThan(MAX_DOCS_SECTION_CHARS);
  });

  it('suggests better keywords when nothing matches', () => {
    expect(formatDocsResults('zebra', [])).toContain('No DuckDB documentation matches "zebra"');
  });
});

describe('bundled documentation', () => {
  const bundle = JSON.parse(bundledDocs) as DocsBundle;
  const index = new DocsIndex(chunksFromBundle(bundle));

  it('describes a DuckDB release and builds absolute duckdb.org links', () => {
    expect(bundle.format).toBe(1);
    expect(bundle.docsVersion).toMatch(/^\d+\.\d+$/);
    expect(index.chunks.length).toBeGreaterThan(1_000);
    expect(index.chunks.every((chunk) => chunk.url.startsWith(`https://duckdb.org/docs/${bundle.docsVersion}/`))).toBe(true);
    expect(index.chunks.every((chunk) => chunk.text.length <= 3_000)).toBe(true);
  });

  it('leaves out other client APIs and the spatial extension', () => {
    const pages = new Set(index.chunks.map((chunk) => chunk.url.split('#')[0]));
    expect([...pages].some((url) => /\/clients\/(python|java|c|cli)\//.test(url))).toBe(false);
    expect([...pages].some((url) => url.includes('/core_extensions/spatial/'))).toBe(false);
    expect([...pages].some((url) => url.includes('/clients/wasm/'))).toBe(true);
  });

  // Typical keywords a model searches for, with the pages that answer them.
  const evaluation: Array<[string, string[]]> = [
    ['PIVOT', ['sql/statements/pivot']],
    ['UNPIVOT', ['sql/statements/unpivot']],
    ['how to pivot a table', ['sql/statements/pivot']],
    ['read_csv_auto', ['data/csv/overview', 'data/csv/auto_detection']],
    ['read_parquet', ['data/parquet/overview', 'guides/file_formats/parquet_import', 'guides/file_formats/query_parquet']],
    ['date_trunc', ['sql/functions/date', 'sql/functions/timestamp']],
    ['string_agg', ['sql/functions/aggregates']],
    ['list_transform', ['sql/functions/lambda', 'sql/functions/list']],
    ['list_aggregate', ['sql/functions/list']],
    ['regexp_extract', ['sql/functions/regular_expressions']],
    ['window functions', ['sql/functions/window_functions', 'sql/query_syntax/window']],
    ['QUALIFY', ['sql/query_syntax/qualify']],
    ['ASOF JOIN', ['sql/query_syntax/from']],
    ['COPY TO parquet', ['sql/statements/copy', 'guides/file_formats/parquet_export']],
    ['struct', ['sql/data_types/struct']],
    ['UNNEST', ['sql/query_syntax/unnest']],
    ['CREATE MACRO', ['sql/statements/create_macro']],
    ['recursive CTE', ['sql/query_syntax/with']],
    ['SUMMARIZE', ['sql/statements/summarize', 'guides/meta/summarize']],
    ['DESCRIBE table', ['sql/statements/describe', 'guides/meta/describe']],
    ['USING SAMPLE', ['sql/query_syntax/sample', 'sql/samples']],
    ['strftime', ['sql/functions/dateformat']],
    ['strptime', ['sql/functions/dateformat', 'sql/functions/timestamp']],
    ['interval', ['sql/data_types/interval']],
    ['json_extract', ['data/json/json_functions']],
    ['GROUP BY ALL', ['sql/query_syntax/groupby']],
    ['EXCLUDE columns', ['sql/expressions/star']],
    ['S3 credentials', ['core_extensions/httpfs/s3api', 'core_extensions/httpfs/authentication', 'configuration/secrets_manager', 'guides/network_cloud_storage/s3_import']],
    ['CREATE TABLE AS', ['sql/statements/create_table']],
    ['INSERT ON CONFLICT', ['sql/statements/insert']],
    ['generate_series', ['sql/functions/list', 'sql/functions/utility']],
    ['MAP data type', ['sql/data_types/map']],
    ['ENUM', ['sql/data_types/enum']],
    ['approx_count_distinct', ['sql/functions/aggregates']],
    ['memory_limit', ['configuration/overview', 'guides/troubleshooting/oom_errors']],
    ['out of memory error', ['guides/troubleshooting/oom_errors']],
    ['EXPLAIN ANALYZE', ['guides/meta/explain_analyze', 'guides/meta/explain']],
    // The HTTPS guide shows ATTACH for remote databases, which the terminal can read.
    ['ATTACH database', ['sql/statements/attach', 'guides/network_cloud_storage/duckdb_over_https_or_s3']],
    ['TRY_CAST', ['sql/expressions/cast', 'sql/expressions/try']],
    ['CASE WHEN', ['sql/expressions/case']],
    ['split string', ['sql/functions/text']],
    ['list tables', ['guides/meta/list_tables', 'sql/meta/information_schema', 'sql/meta/duckdb_table_functions']],
  ];

  it.each(evaluation)('finds the right page for "%s" in the top 3', (query, expected) => {
    const pages = index.search(query, 3).map((chunk) => chunk.url.split('#')[0].replace(/^https:\/\/duckdb\.org\/docs\/[^/]+\//, ''));
    expect(pages.some((page) => expected.includes(page)), `got ${pages.join(', ')}`).toBe(true);
  });

  // Descriptions a model searches for when it does not know a function's name, with a name
  // the text it gets must contain. The right page is not enough: a long table of the page's
  // functions can be cut before the row that matched.
  const descriptive: Array<[string, string[]]> = [
    ['truncation timestamp month', ['date_trunc']],
    ['truncate date to month', ['date_trunc']],
    ['split string list', ['string_split']],
    ['split a string into a list', ['string_split']],
    ['splitting text by comma', ['string_split']],
    ['difference between two dates', ['date_diff', 'datediff', 'age(']],
    ['extract year from date', ['year(', 'date_part', 'extract']],
    ['concatenate strings', ['concat']],
    ['replace text', ['replace(']],
    ['parsing date from string', ['strptime']],
    ['ranking rows within groups', ['rank', 'row_number']],
    ['running total', ['OVER']],
    ['pivoting rows into columns', ['PIVOT']],
    ['unnesting lists', ['unnest']],
    ['aggregating values into a list', ['list(', 'array_agg']],
    ['counting distinct values', ['count(DISTINCT', 'approx_count_distinct']],
    ['filtering window results', ['QUALIFY']],
    ['reading remote parquet files', ['read_parquet']],
    ['attaching a database', ['ATTACH']],
    ['exporting a table to csv', ['COPY']],
    ['sampling rows', ['SAMPLE']],
    ['regular expression matching', ['regexp_matches', 'regexp_full_match']],
    ['padding strings', ['lpad']],
    ['string length', ['length(']],
    ['replacing null values', ['coalesce', 'ifnull']],
    ['deduplicating rows', ['DISTINCT']],
  ];

  it.each(descriptive)('shows the function for "%s"', (query, names) => {
    const output = formatDocsResults(query, index.search(query)).toLowerCase();
    expect(names.some((name) => output.includes(name.toLowerCase())), output.slice(0, 500)).toBe(true);
  });
});
