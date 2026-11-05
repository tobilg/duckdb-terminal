import { describe, it, expect } from 'vitest';
import {
  cleanMarkdown,
  extractChunks,
  isIncluded,
  parseAnchor,
  parseHeadingTree,
  serializeChunks,
  splitText,
} from './extract.mjs';

describe('parseAnchor', () => {
  it('splits version, page path, and section', () => {
    expect(parseAnchor('docs:2.0:sql:statements:pivot::syntax')).toEqual({ version: '2.0', page: 'sql/statements/pivot', section: 'syntax' });
    expect(parseAnchor('docs:2.0:whats_new_in_the_docs')).toEqual({ version: '2.0', page: 'whats_new_in_the_docs', section: '' });
    expect(parseAnchor('sql')).toBeNull();
    expect(parseAnchor('')).toBeNull();
  });
});

describe('isIncluded', () => {
  it('drops other clients, contributor docs, and spatial, but keeps the WASM client', () => {
    expect(isIncluded('sql/statements/pivot')).toBe(true);
    expect(isIncluded('clients/wasm/overview')).toBe(true);
    expect(isIncluded('clients/python/overview')).toBe(false);
    expect(isIncluded('clients/cli/dot_commands')).toBe(false);
    expect(isIncluded('dev/building/overview')).toBe(false);
    expect(isIncluded('core_extensions/spatial/functions')).toBe(false);
    expect(isIncluded('core_extensions/httpfs/s3api')).toBe(true);
    expect(isIncluded('connect')).toBe(false);
    expect(isIncluded('connections_elsewhere')).toBe(true);
  });
});

describe('parseHeadingTree', () => {
  it('ignores heading-like comment lines inside code fences', () => {
    const tree = parseHeadingTree([
      '# Part {#sql}',
      '### Page {#docs:2.0:sql:page}',
      '```bash',
      '# On macOS.',
      'brew install duckdb',
      '```',
      '~~~',
      '## Not a heading either',
      '~~~',
      '#### Section {#docs:2.0:sql:page::section}',
    ].join('\n'));
    const page = tree.children[0].children[0];
    expect(page.title).toBe('Page');
    expect(page.lines.join('\n')).toContain('# On macOS.');
    expect(page.lines.join('\n')).toContain('## Not a heading either');
    expect(page.children.map((child) => child.title)).toEqual(['Section']);
  });
});

describe('cleanMarkdown', () => {
  it('removes links, HTML, images, Liquid and attribute lists, but not code', () => {
    const cleaned = cleanMarkdown([
      'See [`UNION [ALL]`](#docs:2.0:sql:query_syntax:setops::union) and [the',
      'manual](https://duckdb.org/docs/) <span class="pre">now</span> ![logo](x.png){% include x %}',
      '{: .table}',
      'Use &lt;b&gt; &amp; more   ',
      '```sql',
      "SELECT format('{:04d}', 33); -- <span> stays",
      '```',
    ].join('\n'));
    expect(cleaned).toBe([
      'See `UNION [ALL]` and the',
      'manual now',
      '',
      'Use <b> & more',
      '```sql',
      "SELECT format('{:04d}', 33); -- <span> stays",
      '```',
    ].join('\n'));
  });
});

describe('cleanMarkdown pruning', () => {
  it('drops code the browser cannot run, with the sentence introducing it', () => {
    const cleaned = cleanMarkdown([
      'Read a CSV file:',
      '',
      '```sql',
      "SELECT * FROM 'flights.csv';",
      '```',
      '',
      'Read a CSV from stdin, auto-infer options:',
      '',
      '```batch',
      'cat flights.csv | duckdb',
      '```',
      '',
      'In Python:',
      '```python',
      'duckdb.sql("SELECT 42")',
      '```',
      'A full error message looks like this:',
      '```console',
      'Conversion Error: CSV Error on Line: 5648',
      '```',
    ].join('\n'));
    expect(cleaned).toContain("SELECT * FROM 'flights.csv';");
    expect(cleaned).not.toMatch(/stdin|cat flights|Python|duckdb\.sql/);
    expect(cleaned).toContain('Conversion Error: CSV Error on Line: 5648');
  });

  it('drops the output shown right after a SQL example, but keeps other tables and text blocks', () => {
    const cleaned = cleanMarkdown([
      '```sql',
      "SELECT * FROM read_csv('flights.csv');",
      '```',
      '',
      '| FlightDate | UniqueCarrier |',
      '|------------|---------------|',
      '| 1988-01-01 | AA            |',
      '',
      'The path can be relative.',
      '',
      '```sql',
      "SELECT 'anatidae';",
      '```',
      '',
      '```text',
      'anatidae',
      '```',
      '',
      '| Parameter | Description |',
      '|-----------|-------------|',
      '| header    | first line  |',
      '',
      '```text',
      'Prompt = FROM read_csv(...)',
      '```',
    ].join('\n'));
    expect(cleaned).not.toMatch(/FlightDate|1988-01-01|\nanatidae/);
    expect(cleaned).toContain('The path can be relative.');
    expect(cleaned).toContain('| header    | first line  |');
    expect(cleaned).toContain('Prompt = FROM read_csv(...)');
  });
});

describe('splitText', () => {
  it('returns short text unchanged', () => {
    expect(splitText('short', 100)).toEqual(['short']);
  });

  it('splits at blank lines within the limit', () => {
    const text = ['a'.repeat(40), '', 'b'.repeat(40), '', 'c'.repeat(40)].join('\n');
    const parts = splitText(text, 90);
    expect(parts).toEqual([`${'a'.repeat(40)}\n\n${'b'.repeat(40)}`, 'c'.repeat(40)]);
  });

  it('closes and reopens a code fence cut in the middle', () => {
    const text = ['```sql', ...Array.from({ length: 20 }, (_, i) => `SELECT ${i};`), '```'].join('\n');
    const parts = splitText(text, 80);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(84);
      expect((part.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
  });
});

describe('extractChunks', () => {
  const markdown = [
    '# Summary',
    'Front matter.',
    '# SQL {#sql}',
    '### PIVOT Statement {#docs:2.0:sql:statements:pivot}',
    'Turns rows into [columns](#docs:2.0:sql:x).',
    '#### Syntax {#docs:2.0:sql:statements:pivot::syntax}',
    '```sql',
    'PIVOT t ON c USING sum(v);',
    '```',
    '### Large Page {#docs:2.0:sql:large}',
    'Intro.',
    '#### Big Section {#docs:2.0:sql:large::big}',
    ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'x'.repeat(30)}\n`),
    '# Client APIs {#clients}',
    '### Python {#docs:2.0:clients:python:overview}',
    'Python text.',
    '### WASM {#docs:2.0:clients:wasm:overview}',
    'WASM text.',
  ].join('\n');
  const { docsVersion, chunks } = extractChunks(markdown, { maxChars: 400 });

  it('reads the docs version from the anchors', () => {
    expect(docsVersion).toBe('2.0');
  });

  it('merges small pages with their sections and keeps the heading trail and page path', () => {
    expect(chunks[0]).toEqual({
      path: 'SQL › PIVOT Statement',
      url: 'sql/statements/pivot',
      text: 'Turns rows into columns.\n\n### Syntax\n\n```sql\nPIVOT t ON c USING sum(v);\n```',
    });
  });

  it('keeps large pages as separate, split sections', () => {
    expect(chunks.find((chunk) => chunk.url === 'sql/large')?.text).toBe('Intro.');
    const parts = chunks.filter((chunk) => chunk.url === 'sql/large#big');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].path).toBe(`SQL › Large Page › Big Section (part 1 of ${parts.length})`);
    expect(parts.every((chunk) => chunk.text.length <= 400)).toBe(true);
  });

  it('skips front matter and excluded clients but keeps the WASM client', () => {
    expect(chunks.some((chunk) => chunk.text.includes('Front matter'))).toBe(false);
    expect(chunks.some((chunk) => chunk.url.startsWith('clients/python'))).toBe(false);
    expect(chunks.find((chunk) => chunk.url === 'clients/wasm/overview')?.path).toBe('Client APIs › WASM');
  });

  it('serializes one chunk per line as valid JSON', () => {
    const json = serializeChunks({ docsVersion, chunks }, { source: 'test' });
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ format: 1, docsVersion: '2.0', source: 'test' });
    expect(parsed.chunks).toHaveLength(chunks.length);
    expect(json.split('\n').length).toBe(chunks.length + 3);
  });
});
