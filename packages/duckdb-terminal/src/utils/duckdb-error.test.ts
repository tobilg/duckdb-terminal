import { describe, expect, it } from 'vitest';
import { readableError, readableErrorMessage } from './duckdb-error';

const PARSER_ERROR = JSON.stringify({
  exception_type: 'Parser',
  exception_message: 'syntax error at or near "descrbe"\n\nLINE 1: descrbe SELECT 1\n        ^^^^^^^',
  error_subtype: 'SYNTAX_ERROR',
});

describe('readableErrorMessage', () => {
  it('turns a JSON error into DuckDB text', () => {
    expect(readableErrorMessage(PARSER_ERROR)).toBe(
      'Parser Error: syntax error at or near "descrbe"\n\nLINE 1: descrbe SELECT 1\n        ^^^^^^^'
    );
    expect(readableErrorMessage('{"exception_type":"Invalid Input","exception_message":"bad value"}'))
      .toBe('Invalid Input Error: bad value');
  });

  it('keeps text around the JSON and copes with missing fields', () => {
    expect(readableErrorMessage(`Query failed: ${PARSER_ERROR}`)).toMatch(/^Query failed: Parser Error: syntax error/);
    expect(readableErrorMessage('{"exception_message":"something broke"}')).toBe('something broke');
    expect(readableErrorMessage('{"exception_type":"Interrupt"}')).toBe('Interrupt Error');
  });

  it('leaves text errors and other JSON alone', () => {
    const binder = 'Binder Error: Referenced column "x" not found in FROM clause!';
    expect(readableErrorMessage(binder)).toBe(binder);
    expect(readableErrorMessage('Invalid Input Error: {"a": 1}')).toBe('Invalid Input Error: {"a": 1}');
    expect(readableErrorMessage('{"exception_type": broken')).toBe('{"exception_type": broken');
  });
});

describe('readableError', () => {
  it('replaces a JSON error and keeps the original as its cause', () => {
    const original = new Error(PARSER_ERROR);
    const error = readableError(original) as Error & { cause?: unknown };
    expect(error.message).toMatch(/^Parser Error: syntax error at or near "descrbe"/);
    expect(error.cause).toBe(original);
  });

  it('returns text errors and non-errors unchanged', () => {
    const text = new Error('Catalog Error: Table with name t does not exist!');
    expect(readableError(text)).toBe(text);
    expect(readableError('plain')).toBe('plain');
  });
});
