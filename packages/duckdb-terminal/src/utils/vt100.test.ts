import { describe, it, expect } from 'vitest';
import {
  RESET,
  BOLD,
  DIM,
  FG_RED,
  FG_GREEN,
  FG_YELLOW,
  FG_BLUE,
  FG_CYAN,
  FG_BRIGHT_BLACK,
  colorize,
  bold,
  dim,
  stripAnsiCodes,
  visibleLength,
  cursorTo,
  cursorUp,
  cursorDown,
  cursorLeft,
  cursorRight,
  cursorColumn,
} from './vt100';

describe('VT100 constants', () => {
  it('should have correct reset code', () => {
    expect(RESET).toBe('\x1b[0m');
  });

  it('should have correct style codes', () => {
    expect(BOLD).toBe('\x1b[1m');
    expect(DIM).toBe('\x1b[2m');
  });

  it('should have correct color codes', () => {
    expect(FG_RED).toBe('\x1b[31m');
    expect(FG_GREEN).toBe('\x1b[32m');
    expect(FG_YELLOW).toBe('\x1b[33m');
    expect(FG_BLUE).toBe('\x1b[34m');
    expect(FG_CYAN).toBe('\x1b[36m');
    expect(FG_BRIGHT_BLACK).toBe('\x1b[90m');
  });
});

describe('colorize', () => {
  it('should wrap text with VT100 color codes', () => {
    const result = colorize('Hello', FG_RED);
    expect(result).toBe('\x1b[31mHello\x1b[0m');
  });

  it('should support named colors', () => {
    expect(colorize('Error', 'red')).toBe('\x1b[31mError\x1b[0m');
    expect(colorize('Success', 'green')).toBe('\x1b[32mSuccess\x1b[0m');
    expect(colorize('Warning', 'yellow')).toBe('\x1b[33mWarning\x1b[0m');
    expect(colorize('Info', 'blue')).toBe('\x1b[34mInfo\x1b[0m');
    expect(colorize('Cyan', 'cyan')).toBe('\x1b[36mCyan\x1b[0m');
  });

  it('should support bright named colors', () => {
    expect(colorize('Bright', 'brightRed')).toBe('\x1b[91mBright\x1b[0m');
    expect(colorize('Gray', 'brightBlack')).toBe('\x1b[90mGray\x1b[0m');
  });

  it('should pass through VT100 constants unchanged', () => {
    const result = colorize('Test', FG_CYAN);
    expect(result).toBe('\x1b[36mTest\x1b[0m');
  });

  it('should handle unknown color names by passing through', () => {
    // Unknown color names are passed through as-is
    const result = colorize('Test', 'unknownColor');
    expect(result).toBe('unknownColorTest\x1b[0m');
  });
});

describe('bold', () => {
  it('should wrap text with bold codes', () => {
    const result = bold('Bold text');
    expect(result).toBe('\x1b[1mBold text\x1b[0m');
  });
});

describe('dim', () => {
  it('should wrap text with dim codes', () => {
    const result = dim('Dim text');
    expect(result).toBe('\x1b[2mDim text\x1b[0m');
  });
});

describe('stripAnsiCodes', () => {
  it('should remove color codes', () => {
    const colored = colorize('Hello', FG_RED);
    expect(stripAnsiCodes(colored)).toBe('Hello');
  });

  it('should remove multiple codes', () => {
    const text = `${FG_RED}Red${RESET} ${FG_GREEN}Green${RESET}`;
    expect(stripAnsiCodes(text)).toBe('Red Green');
  });

  it('should remove bold and dim codes', () => {
    const text = bold('Bold') + ' ' + dim('Dim');
    expect(stripAnsiCodes(text)).toBe('Bold Dim');
  });

  it('should handle text without codes', () => {
    expect(stripAnsiCodes('Plain text')).toBe('Plain text');
  });

  it('should remove cursor movement codes', () => {
    const text = `\x1b[5AUp\x1b[3BDown`;
    expect(stripAnsiCodes(text)).toBe('UpDown');
  });
});

describe('visibleLength', () => {
  it('should return length of visible text only', () => {
    const colored = colorize('Hello', FG_RED);
    expect(visibleLength(colored)).toBe(5);
  });

  it('should handle text without codes', () => {
    expect(visibleLength('Plain text')).toBe(10);
  });

  it('should handle multiple colored sections', () => {
    const text = colorize('Red', FG_RED) + ' ' + colorize('Green', FG_GREEN);
    expect(visibleLength(text)).toBe(9); // 'Red Green'
  });
});

describe('cursor movement functions', () => {
  it('cursorTo should generate correct sequence', () => {
    expect(cursorTo(5, 10)).toBe('\x1b[5;10H');
  });

  it('cursorUp should generate correct sequence', () => {
    expect(cursorUp(3)).toBe('\x1b[3A');
  });

  it('cursorDown should generate correct sequence', () => {
    expect(cursorDown(2)).toBe('\x1b[2B');
  });

  it('cursorRight should generate correct sequence', () => {
    expect(cursorRight(4)).toBe('\x1b[4C');
  });

  it('cursorLeft should generate correct sequence', () => {
    expect(cursorLeft(1)).toBe('\x1b[1D');
  });

  it('cursorColumn should generate correct sequence', () => {
    expect(cursorColumn(15)).toBe('\x1b[15G');
  });
});
