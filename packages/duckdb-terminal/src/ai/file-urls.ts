/**
 * Recognizes the files a question names: http(s) URLs in the text, DuckDB's
 * reader for a data file, and DuckDB database files, which are attached
 * instead of read.
 *
 * @module ai/file-urls
 */

const URL = /https?:\/\/[^\s'"`<>()]+/gi;
const DATABASE_FILE = /\.(?:duckdb|ddb|db)$/;
/** Names DuckDB uses for its own catalogs. */
const RESERVED_ALIASES = new Set(['memory', 'system', 'temp', 'main']);

/** The http(s) URLs in a user's message, without trailing punctuation. */
export function urlsIn(text: string): string[] {
  return [...new Set([...text.matchAll(URL)].map(([url]) => url.replace(/[.,;:!?]+$/, '')))];
}

/** The path of a file name or URL, in lower case and without query or fragment. */
function pathOf(nameOrUrl: string): string {
  return nameOrUrl.split(/[?#]/)[0].toLowerCase();
}

/** DuckDB's reader for a data file name or URL, by its extension, or null. */
export function readerFor(nameOrUrl: string): string | null {
  const path = pathOf(nameOrUrl);
  if (path.endsWith('.parquet')) return 'read_parquet';
  if (/\.(?:csv|tsv|txt)(?:\.gz)?$/.test(path)) return 'read_csv';
  if (/\.(?:json|jsonl|ndjson)(?:\.gz)?$/.test(path)) return 'read_json';
  return null;
}

/** Whether a file name or URL is a DuckDB database file (.duckdb, .ddb, .db). */
export function isDatabaseFile(nameOrUrl: string): boolean {
  return DATABASE_FILE.test(pathOf(nameOrUrl));
}

/** The alias DuckDB would give a database file: its name without the extension, as an identifier. */
export function databaseAlias(nameOrUrl: string): string {
  const file = pathOf(nameOrUrl).split('/').pop() ?? '';
  let alias = file.replace(DATABASE_FILE, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!alias) alias = 'remote_db';
  if (/^\d/.test(alias)) alias = `db_${alias}`;
  return RESERVED_ALIASES.has(alias) ? `${alias}_db` : alias;
}

/** The statement that attaches a database file read-only under its alias. */
export function attachStatement(nameOrUrl: string, alias = databaseAlias(nameOrUrl)): string {
  return `ATTACH '${nameOrUrl.replace(/'/g, "''")}' AS ${alias} (READ_ONLY);`;
}

const NOT_ATTACHED = 'is a DuckDB database that is NOT attached yet';

/**
 * The schema block's line for a database file that is not attached: it comes
 * before the tables, which belong to other data, so the model does not
 * answer from them. The assistant finds the statement again with `attachStatementIn`.
 */
export function notAttachedNote(nameOrUrl: string, alias: string): string {
  return `-- ${nameOrUrl} ${NOT_ATTACHED}: none of the tables below are in it. ` +
    `Before you can query its tables, run: ${attachStatement(nameOrUrl, alias)}`;
}

/** The ATTACH statement a schema block gives for a database file that is not attached, or null. */
export function attachStatementIn(schema: string, nameOrUrl: string): string | null {
  const start = schema.indexOf(`-- ${nameOrUrl} ${NOT_ATTACHED}:`);
  if (start === -1) return null;
  const line = schema.slice(start, schema.indexOf('\n', start) === -1 ? undefined : schema.indexOf('\n', start));
  return /run: (ATTACH .*;)$/.exec(line)?.[1] ?? null;
}
