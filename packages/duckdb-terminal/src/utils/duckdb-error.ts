/**
 * DuckDB-Wasm reports some errors, such as parser errors, as a JSON object
 * (`{"exception_type":"Parser","exception_message":"…","error_subtype":"…"}`)
 * instead of DuckDB's usual text. These helpers turn them into that text,
 * `Parser Error: syntax error at or near "…"`, for users and the AI model.
 *
 * @module utils/duckdb-error
 */

/** DuckDB's text form of an error message; other messages are returned unchanged. */
export function readableErrorMessage(message: string): string {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end < start || !message.includes('"exception_')) return message;

  let parsed: { exception_type?: unknown; exception_message?: unknown };
  try {
    parsed = JSON.parse(message.slice(start, end + 1));
  } catch {
    return message;
  }
  const type = typeof parsed.exception_type === 'string' ? parsed.exception_type.trim() : '';
  const text = typeof parsed.exception_message === 'string' ? parsed.exception_message : '';
  if (!type && !text) return message;

  const label = !type || /error$/i.test(type) ? type : `${type} Error`;
  const readable = label && text ? `${label}: ${text}` : label || text;
  return message.slice(0, start) + readable + message.slice(end + 1);
}

/** `error` with DuckDB's text form of its message; `error` itself when its message is already text. */
export function readableError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const message = readableErrorMessage(error.message);
  if (message === error.message) return error;
  return Object.assign(new Error(message), { cause: error });
}
