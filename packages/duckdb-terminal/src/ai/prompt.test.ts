import { describe, expect, it } from 'vitest';
import { sqlBlocks, verificationIssue } from './guardrails';
import {
  DOCS_CONTEXT_OPEN, GUIDED_QUERY_TOOL, GUIDED_SYSTEM_PROMPT, MAX_TOOL_ITERATIONS, PROMPTS, SCHEMA_CONTEXT_CLOSE, SCHEMA_CONTEXT_OPEN,
  formatDocsContext, formatSchemaContext, stripSchemaContext,
} from './prompt';

describe('prompts', () => {
  it.each(Object.entries(PROMPTS))('%s describes the schema block and both tools', (_style, prompt) => {
    expect(prompt.system(MAX_TOOL_ITERATIONS)).toContain(SCHEMA_CONTEXT_OPEN);
    expect(prompt.system(MAX_TOOL_ITERATIONS)).toMatch(/search_docs\(keywords/);
    expect(prompt.tools.map((tool) => tool.function.name)).toEqual(['query', 'search_docs']);
  });

  it('gives the guided prompt the real tool-call budget', () => {
    expect(GUIDED_SYSTEM_PROMPT).toContain(`at most ${MAX_TOOL_ITERATIONS - 1} times per question`);
    expect(GUIDED_SYSTEM_PROMPT).toContain(SCHEMA_CONTEXT_CLOSE);
    expect(PROMPTS.guided.system(12)).toContain('at most 11 times per question');
  });

  it('tells the guided model that it can read files at URLs', () => {
    expect(GUIDED_SYSTEM_PROMPT).toContain("read_parquet('https://example.com/data/sales.parquet')");
    expect(GUIDED_SYSTEM_PROMPT).toContain('Never shorten a URL to its file name');
    expect(GUIDED_SYSTEM_PROMPT).toContain('Without a block, the database has no tables');
    expect(GUIDED_QUERY_TOOL.function.description).toContain('http(s) URLs');
  });

  it('tells the guided model to attach database files instead of reading them', () => {
    expect(GUIDED_SYSTEM_PROMPT).toContain("ATTACH 'https://example.com/data/weather.duckdb' AS weather (READ_ONLY);");
    expect(GUIDED_SYSTEM_PROMPT).toContain('DETACH weather');
    // A negative example ("SELECT * FROM library fails") gets copied by small models.
    expect(GUIDED_SYSTEM_PROMPT).not.toMatch(/FROM weather\b(?!\.)/);
    expect(GUIDED_SYSTEM_PROMPT).toContain('or ATTACH for a .duckdb database');
  });

  it('shows the guided model how to see the columns of a file before using them', () => {
    expect(GUIDED_SYSTEM_PROMPT).toContain("SELECT * FROM read_csv('https://example.com/data/trips.csv') LIMIT 1;");
    expect(GUIDED_SYSTEM_PROMPT).toContain("SELECT name, duckdb_type FROM parquet_schema('https://example.com/data/trips.parquet');");
  });

  it('shows example answers that the guardrails accept', () => {
    const answers = GUIDED_SYSTEM_PROMPT.split('You answer:').slice(1)
      .map((rest) => rest.split('\n\nExample, ')[0]);
    expect(answers).toHaveLength(2);
    for (const answer of answers) {
      expect(sqlBlocks(answer)).toHaveLength(1);
      expect(verificationIssue(answer, true)).toBeNull();
    }
  });
});

describe('context blocks', () => {
  it('removes the schema block and the documentation from an earlier question', () => {
    const schema = formatSchemaContext('CREATE TABLE t (a INTEGER);');
    const docs = formatDocsContext('PIVOT t ON a;');
    expect(stripSchemaContext(`How do I pivot t?\n\n${schema}\n\n${docs}`)).toBe('How do I pivot t?');
    // Without tables there is no schema block, only the documentation.
    expect(stripSchemaContext(`How do I pivot?\n\n${docs}`)).toBe('How do I pivot?');
    expect(docs.startsWith(DOCS_CONTEXT_OPEN)).toBe(true);
    expect(formatDocsContext('  ')).toBe('');
  });
});
