/**
 * Checks on model output that small models need: SQL they show but never ran,
 * placeholders in SQL, repeated queries, URLs shortened to file names or
 * databases read like files, and which documentation could help with a
 * failed query.
 *
 * @module ai/guardrails
 */

import { attachStatement, databaseAlias, isDatabaseFile, readerFor } from './file-urls';

const SQL_BLOCK = /```[a-z]*[ \t]*\n([\s\S]*?)```/gi;
const SQL_STATEMENT = /^\s*(?:with|select|from|pivot|unpivot|create|insert|update|delete|copy|describe|summarize|show|explain|attach|set)\b/i;
const PLACEHOLDER = /<[a-z_][a-z0-9_ ]*>/i;
/** Errors of a query that names a file or table that is not there. */
const MISSING_SOURCE = /No files found that match the pattern|Table with name \S+ does not exist/i;

/** Statements whose syntax is DuckDB-specific enough for a docs lookup after a parser error. */
const DOCS_STATEMENTS = new Set(['pivot', 'unpivot', 'summarize', 'describe', 'copy', 'attach', 'export', 'import', 'install', 'load']);

export type VerificationIssue = 'placeholders' | 'unrun';

/** SQL statements in the fenced code blocks of an answer. */
export function sqlBlocks(answer: string): string[] {
  return [...answer.matchAll(SQL_BLOCK)].map((match) => match[1]).filter((code) => SQL_STATEMENT.test(code));
}

/** Whether an answer's SQL needs checking: it uses placeholders, or no query ran at all. */
export function verificationIssue(answer: string, ranQuery: boolean): VerificationIssue | null {
  const blocks = sqlBlocks(answer);
  if (blocks.some((block) => PLACEHOLDER.test(block))) return 'placeholders';
  if (blocks.length > 0 && !ranQuery) return 'unrun';
  return null;
}

/** The follow-up message that asks the model to run its SQL. */
export function verificationRequest(issue: VerificationIssue): string {
  return issue === 'placeholders'
    ? 'Your answer uses placeholders such as <column> in its SQL. Replace them with real table and column names from the schema, or with literal values, run the statement with the query tool, and answer again based on the result.'
    : "Your answer shows SQL that you did not run. Run it with the query tool, on the user's tables or on literal values, and answer again based on the result.";
}

/** Asks for an answer when a model turn ended with neither an answer nor a tool call. */
export const ANSWER_REQUEST =
  'You did not write an answer. Answer my question now, in a few sentences, based on the query results above. ' +
  'If you still need data, call the query tool.';

/**
 * Asks for the answer after the model repeated a statement it already has the
 * result of: small models do that when they meant to answer.
 */
export const REPEAT_ANSWER_REQUEST =
  'You already have the result of that statement. Answer my question now, in one to three sentences, ' +
  'based on the query results above. Call the query tool again only for a different statement.';

/** Normalizes SQL to recognize a repeated statement. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim().toLowerCase();
}

/**
 * The function or statement a DuckDB error is about, when its documentation
 * could help: unknown or mismatched functions, and syntax errors in
 * DuckDB-specific statements. Errors about tables and columns are left alone.
 */
export function errorDocsKeyword(error: string, sql: string): string | null {
  const unknownFunction = /Function with name "?([A-Za-z_]\w*)"? does not exist/i.exec(error);
  if (unknownFunction) {
    return /Did you mean "([A-Za-z_]\w*)"/i.exec(error)?.[1] ?? unknownFunction[1];
  }
  const wrongArguments = /No function matches the given name and argument types '([A-Za-z_]\w*)\(/i.exec(error);
  if (wrongArguments) return wrongArguments[1];
  if (/^Parser Error/i.test(error.trim())) {
    const statement = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase();
    if (statement && DOCS_STATEMENTS.has(statement)) return statement.toUpperCase();
  }
  return null;
}

/**
 * A reminder for a failed query that misses a file the user's message names:
 * small models shorten a URL to its file name, take that name for a table, or
 * read a database file with a file reader instead of attaching it.
 */
export function urlHint(error: string, sql: string, urls: readonly string[]): { text: string; database: boolean } | null {
  const missing = MISSING_SOURCE.test(error);
  const attaching = /^\s*attach\b/i.test(sql);
  const files: string[] = [];
  const databases: string[] = [];
  for (const url of urls) {
    if (isDatabaseFile(url)) {
      // Reading it like a data file fails for any reason, and so does using its name as a
      // table (FROM iam, without a table after the dot); a missing table may mean it is not attached.
      const asTable = new RegExp(`\\b(?:from|join)\\s+"?${databaseAlias(url)}"?(?!\\s*\\.)\\b`, 'i').test(sql);
      if (!attaching && (sql.includes(url) || asTable || (missing && !sql.includes(url)))) databases.push(url);
    } else if (missing && !sql.includes(url)) {
      files.push(url);
    }
  }
  const hints: string[] = [];
  if (files.length > 0) {
    const sources = files.map((url) => {
      const reader = readerFor(url);
      return reader ? `FROM ${reader}('${url}')` : `the full URL '${url}' with the reader for its format`;
    });
    hints.push(`The user's message names ${files.length === 1 ? 'a file' : 'files'} on the web. ` +
      `Read ${files.length === 1 ? 'it' : 'them'} with the full URL, exactly as the user wrote it: ${sources.join('; ')}`);
  }
  for (const url of databases) {
    hints.push(`${url} is a DuckDB database, not a file or a table. Unless you already attached it, ` +
      `run this statement next, exactly as written: ${attachStatement(url)} Its result lists the tables you can query.`);
  }
  return hints.length > 0 ? { text: `\n\n${hints.join('\n')}`, database: databases.length > 0 } : null;
}

const IDENTIFIER = /[a-z_][a-z0-9_]*/g;
/** `name TYPE` pairs in a column list, e.g. `order_id INTEGER, status VARCHAR`. */
const COLUMN = /(?:^|[(,]\s*)"?([A-Za-z_][\w]*)"?\s+[A-Z]/g;
/** A file a schema block names: `read_csv('web_events.csv')` or `read_parquet('https://…/x.parquet')`. */
const FILE_SOURCE = /\bread_\w+\('([^']+)'\)/g;

/**
 * Names from the user's data in a schema block: tables, columns, the words of
 * sample rows and listed values, and the names of files. Small models search
 * the documentation for them ("customer_id orders"), which it cannot answer.
 */
export function dataWordsIn(schema: string): Set<string> {
  const words = new Set<string>();
  const add = (text: string) => {
    for (const [word] of text.toLowerCase().matchAll(IDENTIFIER)) if (word.length >= 3) words.add(word);
  };
  let rows = false;
  for (const line of schema.split('\n')) {
    const table = /^CREATE TABLE (\S+) \((.*)\);$/.exec(line);
    if (table) {
      add(table[1].split('.').pop() ?? '');
      for (const [, column] of table[2].matchAll(COLUMN)) add(column);
    }
    for (const [, file] of line.matchAll(FILE_SOURCE)) {
      add((file.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[^.]+(?:\.gz)?$/, ''));
    }
    const columns = /has the columns: (.*)$/.exec(line);
    if (columns) for (const [, column] of columns[1].matchAll(COLUMN)) add(column);
    // Listed values: `status: 'completed', 'cancelled'`, after "All values of short text columns".
    const values = /^(\w+): ('.*')$/.exec(line);
    if (values) {
      add(values[1]);
      add(values[2]);
    }
    // Sample rows follow "-- First rows of …:" as CSV, up to the next comment or blank line.
    if (line.startsWith('-- First rows of ')) rows = true;
    else if (line.startsWith('--') || !line.trim()) rows = false;
    else if (rows) add(line);
  }
  return words;
}

/** Keywords without the names from the user's data, and the names left out. */
export function withoutDataWords(keywords: string, dataWords: ReadonlySet<string>): { kept: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const token of keywords.split(/[\s,;]+/).filter(Boolean)) {
    const word = token.toLowerCase().replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, '');
    const forms = [word, word.replace(/\.[a-z0-9]+(?:\.gz)?$/, ''), word.replace(/s$/, ''), word.replace(/es$/, '')];
    if (word && forms.some((form) => dataWords.has(form))) dropped.push(token.replace(/^[^\w.]+|[^\w.]+$/g, ''));
    else kept.push(token);
  }
  return { kept: kept.join(' '), dropped };
}

/** The tool result for a docs search whose keywords are all names from the user's data. */
export function dataWordsResult(dropped: readonly string[]): string {
  const list = dropped.map((word) => `"${word}"`).join(', ');
  return `No search: ${list} ${dropped.length === 1 ? 'is a name' : 'are names'} from the user's data (tables, columns, or values), ` +
    'which the DuckDB documentation does not describe; the schema block lists them. Search the documentation only for ' +
    'DuckDB functions, statements, or error messages, for example date_trunc or PIVOT.';
}

/** Asking how to do something: "How do I …", "how to …", "Is there a function …". */
const HOW_TO = /\bhow (?:do|can|could|would|should) (?:i|you|we|one)\b|\bhow to\b|\bis there an? (?:way|function|command)\b|\bwhat(?:'s| is) the (?:syntax|function|command)\b|\bwhich function\b/i;
/** DuckDB features that small models get wrong from memory, named the way users write them. */
const DUCKDB_FEATURES = /\b(?:un)?pivot\w*|\basof\b|\bqualify\b|\bunnest\w*|\bstruct\b|\bregexp_\w+|\blist_\w+|\bstring_split\b|\btime_bucket\b|\bwindow functions?\b|\bcreate macro\b/i;

/**
 * Whether a question is about how to do something in DuckDB, so the
 * documentation that matches it is sent along: small models rarely search it
 * themselves. Questions with URLs get their files described instead.
 */
export function isDocsQuestion(prompt: string): boolean {
  if (/https?:\/\//i.test(prompt)) return false;
  return HOW_TO.test(prompt) || DUCKDB_FEATURES.test(prompt);
}

/** A database the question names that is not attached yet, with the statement that attaches it. */
export interface PendingDatabase {
  url: string;
  statement: string;
}

/**
 * The reminder to attach the databases a question names, sent with every
 * query result until the model attaches them: small models otherwise answer
 * from the user's other tables. From the second reminder on, it shows the
 * exact tool call, which they copy more reliably than a statement.
 */
export function attachReminder(databases: readonly PendingDatabase[], count: number): string {
  return databases.map(({ url, statement }) => {
    const call = count > 1 ? ` Your next tool call must be: query({"query": "${statement}"})` : '';
    return `${url} is the DuckDB database the question is about, and it is NOT attached yet: its tables cannot be queried, ` +
      `and the other tables do not hold its data. Run this statement next, exactly as written: ${statement}${call}`;
  }).join('\n');
}

/**
 * A reminder for a query that used an attached database's name as a table
 * (FROM inventory): DuckDB only suggests similar table names, such as pg_index.
 */
export function attachedAliasHint(error: string, databases: readonly AttachedDatabase[], sql = ''): string | null {
  // inventory.inventory.stock: the database name written twice.
  for (const { name, tables } of databases) {
    // The model picks the alias; one such as "my(db" must not break the pattern.
    const alias = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doubled = new RegExp(`\\b${alias}\\s*\\.\\s*${alias}\\s*\\.\\s*(\\w+)`, 'i').exec(sql);
    if (doubled && /does not exist/i.test(error)) {
      const table = tables.find((candidate) => candidate.toLowerCase() === doubled[1].toLowerCase()) ?? doubled[1];
      return `Write the database name once: ${name}.${table}, not ${name}.${name}.${table}.`;
    }
  }
  const missing = /Table with name "?([\w]+)"? does not exist/i.exec(error)?.[1]?.toLowerCase();
  const database = databases.find(({ name }) => name.toLowerCase() === missing);
  if (!database) return null;
  const tables = database.tables.slice(0, 12).map((table) => `${database.name}.${table}`).join(', ');
  return `${database.name} is the attached database, not a table. Query its tables with ${database.name}. in front` +
    (tables ? `: ${tables}` : '.');
}

/** Words a request may contain besides database files and an alias and still ask only for an attach. */
const ATTACH_ONLY_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'attach', 'can', 'could', 'database', 'databases', 'db', 'duckdb', 'file',
  'for', 'from', 'here', 'in', 'it', 'me', 'mode', 'now', 'online', 'only', 'please', 'read', 'readonly',
  'remote', 'the', 'this', 'to', 'url', 'web', 'with', 'you',
]);

/**
 * Whether a request only asks to attach databases ("attach the remote
 * database <url>"), so nothing needs to be queried afterwards.
 * "Attach <url> and count the services" asks for more.
 */
export function isAttachOnly(prompt: string): boolean {
  const text = prompt
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+\.(?:duckdb|ddb|db)\b/gi, ' ')
    .toLowerCase();
  const words: string[] = text.match(/[a-z_][a-z0-9_]*/g) ?? [];
  if (!words.includes('attach')) return false;
  return words.every((word, index) => ATTACH_ONLY_WORDS.has(word) || words[index - 1] === 'as');
}

/** A database the model's ATTACH added, with its tables. */
export interface AttachedDatabase {
  name: string;
  tables: string[];
}

/** The answer to an attach-only request, written without another model turn; the user saw the statement already. */
export function attachAnswer(statement: string, databases: readonly AttachedDatabase[]): string {
  const readOnly = /\bread_only\b/i.test(statement) ? ' (read-only)' : '';
  const sentences = databases.map(({ name, tables }) => {
    if (tables.length === 0) return `Attached the database as ${name}${readOnly}. It has no tables.`;
    const list = tables.length > 12 ? `${tables.slice(0, 12).join(', ')}, and ${tables.length - 12} more` : tables.join(', ');
    return `Attached the database as ${name}${readOnly}. Its ${tables.length === 1 ? 'table' : `${tables.length} tables`}: ${list}. ` +
      `Query them as ${name}.table_name.`;
  });
  return sentences.join('\n');
}
