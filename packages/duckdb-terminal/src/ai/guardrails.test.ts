import { describe, it, expect } from 'vitest';
import {
  attachAnswer, attachReminder, attachedAliasHint, dataWordsIn, dataWordsResult, errorDocsKeyword, isAttachOnly, isDocsQuestion, normalizeSql, sqlBlocks, urlHint,
  verificationIssue, verificationRequest, withoutDataWords,
} from './guardrails';

describe('sqlBlocks', () => {
  it('finds SQL in fenced code blocks and ignores other code', () => {
    const answer = 'Run this:\n```sql\nSELECT 1;\n```\nand\n```\nPIVOT t ON c;\n```\nnot\n```bash\nls -la\n```';
    expect(sqlBlocks(answer)).toEqual(['SELECT 1;\n', 'PIVOT t ON c;\n']);
  });
});

describe('verificationIssue', () => {
  it('flags placeholders even after a query ran', () => {
    expect(verificationIssue('```sql\nSELECT <column> FROM t;\n```', true)).toBe('placeholders');
  });

  it('flags SQL when no query ran, and accepts SQL that ran', () => {
    const answer = 'Use:\n```sql\nSELECT date_trunc(\'month\', ts) FROM t;\n```';
    expect(verificationIssue(answer, false)).toBe('unrun');
    expect(verificationIssue(answer, true)).toBeNull();
  });

  it('ignores answers without SQL and comparisons that are not placeholders', () => {
    expect(verificationIssue('There are 3 orders.', false)).toBeNull();
    expect(verificationIssue('```sql\nSELECT * FROM t WHERE a < b AND c > d;\n```', true)).toBeNull();
  });

  it('phrases a request for each issue', () => {
    expect(verificationRequest('placeholders')).toContain('placeholders');
    expect(verificationRequest('unrun')).toContain('did not run');
  });
});

describe('normalizeSql', () => {
  it('ignores case, whitespace, and a trailing semicolon', () => {
    expect(normalizeSql('SELECT  *\n FROM T ;')).toBe(normalizeSql('select * from t'));
  });
});

describe('errorDocsKeyword', () => {
  it('uses the suggested name for an unknown function', () => {
    expect(errorDocsKeyword(
      'Catalog Error: Scalar Function with name date_trnc does not exist!\nDid you mean "date_trunc"?',
      "SELECT date_trnc('month', ts) FROM t"
    )).toBe('date_trunc');
    expect(errorDocsKeyword('Catalog Error: Scalar Function with name frobnicate does not exist!', 'SELECT frobnicate(1)')).toBe('frobnicate');
  });

  it('uses the function name for wrong argument types', () => {
    expect(errorDocsKeyword(
      "Binder Error: No function matches the given name and argument types 'date_trunc(STRING_LITERAL, DECIMAL(10,2))'. You might need to add explicit type casts.",
      "SELECT date_trunc('month', amount) FROM orders"
    )).toBe('date_trunc');
  });

  it('looks up DuckDB-specific statements after a parser error', () => {
    expect(errorDocsKeyword('Parser Error: syntax error at or near ";"', 'PIVOT;')).toBe('PIVOT');
    expect(errorDocsKeyword('Parser Error: syntax error at or near "t"', 'SELECT * FORM t')).toBeNull();
  });

  it('leaves errors about tables and columns alone', () => {
    expect(errorDocsKeyword('Catalog Error: Table with name orderz does not exist!\nDid you mean "orders"?', 'SELECT * FROM orderz')).toBeNull();
    expect(errorDocsKeyword('Binder Error: Referenced column "b" not found in FROM clause!', 'SELECT b FROM t')).toBeNull();
  });
});

describe('urlHint', () => {
  const url = 'https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/parquet/aws_services.parquet';
  const missingFile = 'IO Error: No files found that match the pattern "aws_services.parquet"';

  it('points a query that shortened the URL to the full URL with the matching reader', () => {
    expect(urlHint(missingFile, 'SELECT count(*) FROM aws_services.parquet', [url])?.text).toContain(`FROM read_parquet('${url}')`);
    expect(urlHint('Catalog Error: Table with name aws_services does not exist!', 'SELECT count(*) FROM aws_services', [url])?.text)
      .toContain(`FROM read_parquet('${url}')`);
  });

  it('names the reader by extension and leaves other formats to the model', () => {
    expect(urlHint(missingFile, 'SELECT 1', ['https://example.com/data.csv?raw=1'])?.text).toContain("FROM read_csv('https://example.com/data.csv?raw=1')");
    expect(urlHint(missingFile, 'SELECT 1', ['https://example.com/events.ndjson'])?.text).toContain("FROM read_json('https://example.com/events.ndjson')");
    expect(urlHint(missingFile, 'SELECT 1', ['https://example.com/export'])?.text).toContain("the full URL 'https://example.com/export' with the reader for its format");
  });

  it('stays quiet when the query used the URL, the error is about something else, or the message has no URL', () => {
    expect(urlHint(missingFile, `SELECT count(*) FROM read_csv('${url}')`, [url])).toBeNull();
    expect(urlHint('Binder Error: Referenced column "x" not found', 'SELECT x FROM t', [url])).toBeNull();
    expect(urlHint(missingFile, 'SELECT count(*) FROM aws_services.parquet', [])).toBeNull();
  });
});

describe('urlHint for database files', () => {
  const db = 'https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb';
  const attach = `ATTACH '${db}' AS iam (READ_ONLY);`;

  it('tells a model that reads a database file like a data file to attach it', () => {
    const hint = urlHint(`Invalid Input Error: Error when sniffing file "${db}".`, `SELECT * FROM read_csv('${db}')`, [db]);
    expect(hint?.database).toBe(true);
    expect(hint?.text).toContain(
      `${db} is a DuckDB database, not a file or a table. Unless you already attached it, run this statement next, exactly as written: ${attach}`
    );
    expect(hint?.text).toContain('Its result lists the tables you can query.');
  });

  it('reminds of the database when a query misses a table without using it, such as the alias alone', () => {
    expect(urlHint('Catalog Error: Table with name iam does not exist!', 'SELECT * FROM iam', [db])?.text).toContain(attach);
    expect(urlHint('Catalog Error: Table with name iam does not exist!', 'SELECT * FROM iam', ['https://example.com/a.csv'])?.database).toBe(false);
  });

  it('tells a model that uses the database name as a table to attach it, whatever the error', () => {
    const parserError = 'Parser Error: syntax error at or near "("';
    expect(urlHint(parserError, 'SELECT * FROM iam (READ_ONLY)', [db])?.text).toContain(attach);
    expect(urlHint(parserError, 'SELECT * FROM iam.services WHERE (', [db])).toBeNull();
  });

  it('stays quiet for a failing ATTACH and for errors unrelated to the database', () => {
    expect(urlHint('IO Error: Cannot open file', `${attach}`, [db])).toBeNull();
    expect(urlHint('Binder Error: Referenced column "x" not found', 'SELECT x FROM iam.services', [db])).toBeNull();
  });
});

describe('isAttachOnly', () => {
  const url = 'https://raw.githubusercontent.com/tobilg/aws-iam-data/main/data/db/iam.duckdb';

  it('recognizes requests that only ask to attach a database', () => {
    expect(isAttachOnly(`attach the remote database ${url}`)).toBe(true);
    expect(isAttachOnly(`Please attach ${url} as aws_iam (read-only).`)).toBe(true);
    expect(isAttachOnly('attach shop.duckdb')).toBe(true);
  });

  it('sees requests that ask for more, or nothing about attaching', () => {
    expect(isAttachOnly(`attach ${url} and count the services`)).toBe(false);
    expect(isAttachOnly(`attach ${url} and show me its tables`)).toBe(false);
    expect(isAttachOnly(`which services are in ${url}?`)).toBe(false);
  });
});

describe('attachAnswer', () => {
  it('names the database and its tables, without repeating the statement', () => {
    const statement = "ATTACH 'https://example.com/iam.duckdb' AS iam (READ_ONLY)";
    expect(attachAnswer(statement, [{ name: 'iam', tables: ['actions', 'services'] }])).toBe(
      'Attached the database as iam (read-only). Its 2 tables: actions, services. Query them as iam.table_name.'
    );
    expect(attachAnswer("ATTACH 'x.duckdb' AS x;", [{ name: 'x', tables: [] }])).toMatch(/^Attached the database as x\. It has no tables\./);
  });

  it('shortens long table lists', () => {
    const tables = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(attachAnswer("ATTACH 'a.duckdb'", [{ name: 'a', tables }])).toContain('t11, and 3 more.');
  });
});

// A schema block as the terminal builds it: DDL, sample rows, listed values, loaded and web files.
const SCHEMA = [
  'CREATE TABLE customers (customer_id INTEGER, email VARCHAR, country VARCHAR, signup_ts TIMESTAMP);',
  'CREATE TABLE orders (order_id INTEGER, customer_id INTEGER, status VARCHAR, total DECIMAL(10,2));',
  '',
  '-- First rows of customers:',
  'customer_id,email,country,signup_ts',
  '1,carol.smith@example.com,DE,2024-01-02 10:00:00',
  '',
  '-- All values of short text columns in orders:',
  "status: 'completed', 'cancelled', 'on hold'",
  '',
  "-- Files you can query directly with SQL (they are not tables), for example SELECT * FROM read_csv('web_events.csv'):",
  "-- read_csv('web_events.csv') has the columns: event_id BIGINT, event_type VARCHAR, properties VARCHAR",
  '',
  '-- Files on the web named in this conversation; query them with their full URL:',
  "-- read_parquet('https://data.example.com/weather/readings.parquet') has the columns: station_id VARCHAR, temperature_c DOUBLE",
].join('\n');

describe('dataWordsIn', () => {
  const words = dataWordsIn(SCHEMA);

  it('collects tables, columns, sample and listed values, and file names', () => {
    for (const word of [
      'customers', 'orders', 'customer_id', 'email', 'signup_ts', 'total', 'carol', 'smith', 'completed', 'hold',
      'web_events', 'event_type', 'properties', 'readings', 'station_id', 'temperature_c',
    ]) {
      expect(words, word).toContain(word);
    }
  });

  it('leaves out SQL, types, comments, and the parts of URLs and file extensions', () => {
    for (const word of ['create', 'table', 'integer', 'varchar', 'decimal', 'timestamp', 'first', 'rows', 'read_csv', 'csv', 'parquet', 'https', 'weather', 'files']) {
      expect(words, word).not.toContain(word);
    }
  });
});

describe('withoutDataWords', () => {
  const words = dataWordsIn(SCHEMA);

  it('leaves out names from the data, in singular or plural, and file names', () => {
    expect(withoutDataWords('ORDER BY, customer_id, orders, Carol', words)).toEqual({ kept: 'ORDER BY', dropped: ['customer_id', 'orders', 'Carol'] });
    expect(withoutDataWords('web_events.csv PIVOT', words)).toEqual({ kept: 'PIVOT', dropped: ['web_events.csv'] });
    expect(withoutDataWords('statuses', words)).toEqual({ kept: '', dropped: ['statuses'] });
  });

  it('keeps everything else', () => {
    expect(withoutDataWords('date_trunc month', words)).toEqual({ kept: 'date_trunc month', dropped: [] });
  });

  it('phrases the result of a search made only of data names', () => {
    expect(dataWordsResult(['customer_id', 'status'])).toMatch(/^No search: "customer_id", "status" are names from the user's data/);
    expect(dataWordsResult(['status'])).toContain('"status" is a name');
  });
});

describe('isDocsQuestion', () => {
  it('recognizes questions about how to do something in DuckDB', () => {
    expect(isDocsQuestion("How do I split a comma-separated string into a list? Show it with 'a,b,c'.")).toBe(true);
    expect(isDocsQuestion('how to export a query result to parquet')).toBe(true);
    expect(isDocsQuestion('Is there a function for the median?')).toBe(true);
    expect(isDocsQuestion('Pivot the orders table: one column per status.')).toBe(true);
    expect(isDocsQuestion('Can you unnest the tags column?')).toBe(true);
  });

  it('leaves questions about the data and questions with URLs alone', () => {
    expect(isDocsQuestion('How many orders do we have in each status?')).toBe(false);
    expect(isDocsQuestion('Summarize the refunds by reason.')).toBe(false);
    expect(isDocsQuestion('Exclude cancelled orders and show the revenue per month.')).toBe(false);
    expect(isDocsQuestion('How do I count the rows of https://example.com/data.parquet?')).toBe(false);
  });
});

describe('attachReminder', () => {
  const pending = [{ url: 'https://example.com/inventory.duckdb', statement: "ATTACH 'https://example.com/inventory.duckdb' AS inventory (READ_ONLY);" }];

  it('names the statement, and the exact tool call from the second reminder on', () => {
    const first = attachReminder(pending, 1);
    expect(first).toMatch(/^https:\/\/example\.com\/inventory\.duckdb is the DuckDB database the question is about, and it is NOT attached yet/);
    expect(first).toContain("run this statement next, exactly as written: ATTACH 'https://example.com/inventory.duckdb' AS inventory (READ_ONLY);".replace('run', 'Run'));
    expect(first).not.toContain('Your next tool call');
    expect(attachReminder(pending, 2)).toContain(
      `Your next tool call must be: query({"query": "ATTACH 'https://example.com/inventory.duckdb' AS inventory (READ_ONLY);"})`
    );
  });

});

describe('attachedAliasHint', () => {
  const databases = [{ name: 'inventory', tables: ['stock', 'warehouses'] }];

  it('names the tables of an attached database used as a table', () => {
    expect(attachedAliasHint('Catalog Error: Table with name inventory does not exist!\nDid you mean "pg_index"?', databases)).toBe(
      'inventory is the attached database, not a table. Query its tables with inventory. in front: inventory.stock, inventory.warehouses'
    );
  });

  it('asks to write the database name once', () => {
    expect(attachedAliasHint(
      'Catalog Error: Table with name "inventory.stock" does not exist because schema "inventory" does not exist.',
      databases,
      'SELECT count(*) FROM inventory.inventory.stock'
    )).toBe('Write the database name once: inventory.stock, not inventory.inventory.stock.');
  });

  it('stays quiet for other missing tables', () => {
    expect(attachedAliasHint('Catalog Error: Table with name stock does not exist!', databases)).toBeNull();
    expect(attachedAliasHint('Binder Error: Referenced column "x" not found', databases)).toBeNull();
  });
});
