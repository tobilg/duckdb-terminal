import { describe, it, expect } from 'vitest';
import { parseArgs, parseCommand, hasUnterminatedQuotes } from './command-parser';

describe('parseArgs', () => {
  describe('basic parsing', () => {
    it('should parse simple space-separated arguments', () => {
      expect(parseArgs('.mode csv')).toEqual(['.mode', 'csv']);
      expect(parseArgs('.timer on')).toEqual(['.timer', 'on']);
      expect(parseArgs('.schema users')).toEqual(['.schema', 'users']);
    });

    it('should handle single argument', () => {
      expect(parseArgs('.help')).toEqual(['.help']);
      expect(parseArgs('.clear')).toEqual(['.clear']);
    });

    it('should handle multiple spaces between arguments', () => {
      expect(parseArgs('.mode   csv')).toEqual(['.mode', 'csv']);
      expect(parseArgs('.timer    on')).toEqual(['.timer', 'on']);
    });

    it('should handle leading and trailing spaces', () => {
      expect(parseArgs('  .mode csv  ')).toEqual(['.mode', 'csv']);
    });

    it('should handle empty string', () => {
      expect(parseArgs('')).toEqual([]);
    });

    it('should handle whitespace only', () => {
      expect(parseArgs('   ')).toEqual([]);
    });
  });

  describe('double-quoted strings', () => {
    it('should parse double-quoted strings', () => {
      expect(parseArgs('.prompt "SQL> "')).toEqual(['.prompt', 'SQL> ']);
    });

    it('should preserve spaces inside double quotes', () => {
      expect(parseArgs('.echo "hello world"')).toEqual(['.echo', 'hello world']);
    });

    it('should handle multiple quoted arguments', () => {
      expect(parseArgs('.prompt "SQL> " "... "')).toEqual(['.prompt', 'SQL> ', '... ']);
    });

    it('should handle empty quoted strings', () => {
      expect(parseArgs('.echo ""')).toEqual(['.echo', '']);
    });

    it('should handle adjacent quoted strings', () => {
      expect(parseArgs('"hello""world"')).toEqual(['helloworld']);
    });
  });

  describe('single-quoted strings', () => {
    it('should parse single-quoted strings', () => {
      expect(parseArgs(".prompt 'SQL> '")).toEqual(['.prompt', 'SQL> ']);
    });

    it('should preserve spaces inside single quotes', () => {
      expect(parseArgs(".echo 'hello world'")).toEqual(['.echo', 'hello world']);
    });

    it('should NOT process escape sequences in single quotes', () => {
      expect(parseArgs(".echo 'hello\\nworld'")).toEqual(['.echo', 'hello\\nworld']);
      expect(parseArgs(".echo 'hello\\tworld'")).toEqual(['.echo', 'hello\\tworld']);
    });
  });

  describe('escape sequences in double quotes', () => {
    it('should handle newline escape', () => {
      expect(parseArgs('.echo "hello\\nworld"')).toEqual(['.echo', 'hello\nworld']);
    });

    it('should handle tab escape', () => {
      expect(parseArgs('.echo "hello\\tworld"')).toEqual(['.echo', 'hello\tworld']);
    });

    it('should handle carriage return escape', () => {
      expect(parseArgs('.echo "hello\\rworld"')).toEqual(['.echo', 'hello\rworld']);
    });

    it('should handle backslash escape', () => {
      expect(parseArgs('.echo "hello\\\\world"')).toEqual(['.echo', 'hello\\world']);
    });

    it('should handle escaped double quote', () => {
      expect(parseArgs('.echo "hello\\"world"')).toEqual(['.echo', 'hello"world']);
    });

    it('should handle escaped single quote', () => {
      expect(parseArgs(".echo \"hello\\'world\"")).toEqual(['.echo', "hello'world"]);
    });

    it('should handle unknown escape sequences', () => {
      expect(parseArgs('.echo "hello\\xworld"')).toEqual(['.echo', 'hello\\xworld']);
    });
  });

  describe('escape sequences outside quotes', () => {
    it('should process escapes outside quotes', () => {
      expect(parseArgs('.echo hello\\nworld')).toEqual(['.echo', 'hello\nworld']);
    });

    it('should handle escaped space outside quotes', () => {
      // Escaped space should be treated as literal space within argument
      expect(parseArgs('.echo hello\\ world')).toEqual(['.echo', 'hello world']);
    });
  });

  describe('mixed quoting', () => {
    it('should handle mixed quote types', () => {
      expect(parseArgs('.cmd "double" \'single\'')).toEqual(['.cmd', 'double', 'single']);
    });

    it('should handle single quotes inside double quotes', () => {
      expect(parseArgs('.echo "it\'s working"')).toEqual(['.echo', "it's working"]);
    });

    it('should handle double quotes inside single quotes', () => {
      expect(parseArgs('.echo \'say "hello"\'')).toEqual(['.echo', 'say "hello"']);
    });
  });

  describe('edge cases', () => {
    it('should handle file paths', () => {
      expect(parseArgs('.load "/path/to/file.csv"')).toEqual(['.load', '/path/to/file.csv']);
    });

    it('should handle URLs', () => {
      expect(parseArgs('.fetch "https://example.com/data?q=test"')).toEqual([
        '.fetch',
        'https://example.com/data?q=test',
      ]);
    });

    it('should handle SQL-like arguments', () => {
      expect(parseArgs('.query "SELECT * FROM users WHERE name = \'John\'"')).toEqual([
        '.query',
        "SELECT * FROM users WHERE name = 'John'",
      ]);
    });
  });
});

describe('parseCommand', () => {
  it('should extract command name and arguments', () => {
    const result = parseCommand('.mode csv');
    expect(result.command).toBe('.mode');
    expect(result.args).toEqual(['csv']);
    expect(result.allArgs).toEqual(['.mode', 'csv']);
  });

  it('should lowercase the command name', () => {
    const result = parseCommand('.MODE CSV');
    expect(result.command).toBe('.mode');
    expect(result.args).toEqual(['CSV']); // Args preserve case
  });

  it('should handle command with no arguments', () => {
    const result = parseCommand('.help');
    expect(result.command).toBe('.help');
    expect(result.args).toEqual([]);
  });

  it('should handle empty input', () => {
    const result = parseCommand('');
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
  });

  it('should handle multiple arguments', () => {
    const result = parseCommand('.prompt "SQL> " "... "');
    expect(result.command).toBe('.prompt');
    expect(result.args).toEqual(['SQL> ', '... ']);
  });
});

describe('hasUnterminatedQuotes', () => {
  it('should return false for balanced quotes', () => {
    expect(hasUnterminatedQuotes('.echo "hello"')).toBe(false);
    expect(hasUnterminatedQuotes(".echo 'hello'")).toBe(false);
    expect(hasUnterminatedQuotes('.echo "hello" "world"')).toBe(false);
  });

  it('should return true for unterminated double quotes', () => {
    expect(hasUnterminatedQuotes('.echo "hello')).toBe(true);
    expect(hasUnterminatedQuotes('.prompt "SQL> ')).toBe(true);
  });

  it('should return true for unterminated single quotes', () => {
    expect(hasUnterminatedQuotes(".echo 'hello")).toBe(true);
    expect(hasUnterminatedQuotes(".prompt 'SQL> ")).toBe(true);
  });

  it('should return false for no quotes', () => {
    expect(hasUnterminatedQuotes('.help')).toBe(false);
    expect(hasUnterminatedQuotes('.mode csv')).toBe(false);
  });

  it('should handle escaped quotes correctly', () => {
    expect(hasUnterminatedQuotes('.echo "hello\\"world"')).toBe(false);
    // Single quotes don't process escapes, so \' is literal backslash + closing quote
    // The string .echo 'hello\' is properly terminated (content is "hello\")
    expect(hasUnterminatedQuotes(".echo 'hello\\'")).toBe(false);
    // This is actually unterminated - opening quote with no closing quote
    expect(hasUnterminatedQuotes(".echo 'hello")).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(hasUnterminatedQuotes('')).toBe(false);
  });
});
