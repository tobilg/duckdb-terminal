import { describe, expect, it } from 'vitest';
import { attachStatement, attachStatementIn, databaseAlias, isDatabaseFile, notAttachedNote, readerFor, urlsIn } from './file-urls';

describe('urlsIn', () => {
  it('finds the URLs of a message without trailing punctuation', () => {
    expect(urlsIn('Count https://example.com/a.parquet. Then http://example.org/b.csv, please')).toEqual([
      'https://example.com/a.parquet', 'http://example.org/b.csv',
    ]);
    expect(urlsIn('How many orders are there?')).toEqual([]);
  });
});

describe('readerFor', () => {
  it('picks the reader by extension, ignoring case, query, and fragment', () => {
    expect(readerFor('https://example.com/Data.PARQUET?raw=1')).toBe('read_parquet');
    expect(readerFor('events.ndjson')).toBe('read_json');
    expect(readerFor('trips.csv.gz')).toBe('read_csv');
    expect(readerFor('https://example.com/iam.duckdb')).toBeNull();
  });
});

describe('database files', () => {
  it('recognizes DuckDB database files', () => {
    expect(isDatabaseFile('https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb')).toBe(true);
    expect(isDatabaseFile('shop.db')).toBe(true);
    expect(isDatabaseFile('https://example.com/data.csv')).toBe(false);
  });

  it('derives the alias DuckDB would use, as a valid identifier', () => {
    expect(databaseAlias('https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb')).toBe('iam');
    expect(databaseAlias('My Shop-2024.db')).toBe('my_shop_2024');
    expect(databaseAlias('2024.duckdb')).toBe('db_2024');
    expect(databaseAlias('memory.duckdb')).toBe('memory_db');
  });

  it('attaches read-only under the alias', () => {
    expect(attachStatement('https://example.com/iam.duckdb')).toBe("ATTACH 'https://example.com/iam.duckdb' AS iam (READ_ONLY);");
    expect(attachStatement("it's.duckdb", 'its')).toBe("ATTACH 'it''s.duckdb' AS its (READ_ONLY);");
  });
});

describe('notAttachedNote and attachStatementIn', () => {
  it('finds the ATTACH statement of a database the schema block lists as not attached', () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const schema = `--- Database schema ---\n${notAttachedNote(url, 'inventory_db')}\nCREATE TABLE inventory (a INTEGER);`;
    expect(attachStatementIn(schema, url)).toBe(`ATTACH '${url}' AS inventory_db (READ_ONLY);`);
    expect(attachStatementIn(schema, 'https://example.com/other.duckdb')).toBeNull();
    expect(attachStatementIn(`-- ${url} is attached as inventory; query its tables as inventory.table_name.`, url)).toBeNull();
  });
});
