import { describe, it, expect, beforeEach } from 'vitest';
import { InputBuffer, MAX_BUFFER_SIZE } from './input-buffer';

describe('InputBuffer', () => {
  let buffer: InputBuffer;

  beforeEach(() => {
    buffer = new InputBuffer();
  });

  describe('basic operations', () => {
    it('should start empty', () => {
      expect(buffer.getContent()).toBe('');
      expect(buffer.getCursorPos()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should insert characters', () => {
      buffer.insert('h');
      buffer.insert('i');
      expect(buffer.getContent()).toBe('hi');
      expect(buffer.getCursorPos()).toBe(2);
    });

    it('should handle backspace', () => {
      buffer.insert('abc');
      buffer.backspace();
      expect(buffer.getContent()).toBe('ab');
      expect(buffer.getCursorPos()).toBe(2);
    });

    it('should handle backspace at start', () => {
      buffer.backspace();
      expect(buffer.getContent()).toBe('');
      expect(buffer.getCursorPos()).toBe(0);
    });

    it('should clear buffer', () => {
      buffer.insert('test');
      buffer.clear();
      expect(buffer.getContent()).toBe('');
      expect(buffer.getCursorPos()).toBe(0);
    });
  });

  describe('cursor movement', () => {
    beforeEach(() => {
      buffer.insert('hello');
    });

    it('should move cursor left', () => {
      buffer.moveLeft();
      expect(buffer.getCursorPos()).toBe(4);
    });

    it('should not move cursor left past start', () => {
      buffer.moveToStart();
      buffer.moveLeft();
      expect(buffer.getCursorPos()).toBe(0);
    });

    it('should move cursor right', () => {
      buffer.moveLeft();
      buffer.moveLeft();
      buffer.moveRight();
      expect(buffer.getCursorPos()).toBe(4);
    });

    it('should not move cursor right past end', () => {
      buffer.moveRight();
      expect(buffer.getCursorPos()).toBe(5);
    });

    it('should move to start', () => {
      buffer.moveToStart();
      expect(buffer.getCursorPos()).toBe(0);
    });

    it('should move to end', () => {
      buffer.moveToStart();
      buffer.moveToEnd();
      expect(buffer.getCursorPos()).toBe(5);
    });
  });

  describe('insert in middle', () => {
    it('should insert at cursor position', () => {
      buffer.insert('hllo');
      buffer.moveToStart();
      buffer.moveRight();
      buffer.insert('e');
      expect(buffer.getContent()).toBe('hello');
    });
  });

  describe('delete', () => {
    it('should delete character at cursor', () => {
      buffer.insert('hello');
      buffer.moveToStart();
      buffer.delete();
      expect(buffer.getContent()).toBe('ello');
    });

    it('should not delete at end', () => {
      buffer.insert('hello');
      buffer.delete();
      expect(buffer.getContent()).toBe('hello');
    });
  });

  describe('setContent', () => {
    it('should set content and move cursor to end', () => {
      buffer.setContent('new content');
      expect(buffer.getContent()).toBe('new content');
      expect(buffer.getCursorPos()).toBe(11);
    });
  });

  describe('word operations', () => {
    it('should get word before cursor', () => {
      buffer.insert('SELECT * FROM users');
      expect(buffer.getWordBeforeCursor()).toBe('users');
    });

    it('should get partial word', () => {
      buffer.insert('SELECT us');
      expect(buffer.getWordBeforeCursor()).toBe('us');
    });

    it('should return empty for space before cursor', () => {
      buffer.insert('SELECT ');
      expect(buffer.getWordBeforeCursor()).toBe('');
    });

    it('should replace word before cursor', () => {
      buffer.insert('SELECT us');
      buffer.replaceWordBeforeCursor('users');
      expect(buffer.getContent()).toBe('SELECT users');
    });
  });

  describe('isBlank', () => {
    it('should return true for empty buffer', () => {
      expect(buffer.isBlank()).toBe(true);
    });

    it('should return true for whitespace only', () => {
      buffer.insert('   ');
      expect(buffer.isBlank()).toBe(true);
    });

    it('should return false for content', () => {
      buffer.insert('test');
      expect(buffer.isBlank()).toBe(false);
    });
  });

  describe('buffer size limits', () => {
    it('should export MAX_BUFFER_SIZE constant', () => {
      expect(MAX_BUFFER_SIZE).toBe(64 * 1024);
    });

    it('should have default max size', () => {
      expect(buffer.getMaxSize()).toBe(MAX_BUFFER_SIZE);
    });

    it('should allow setting custom max size', () => {
      buffer.setMaxSize(100);
      expect(buffer.getMaxSize()).toBe(100);
    });

    it('should truncate insert when buffer is full', () => {
      buffer.setMaxSize(10);
      buffer.insert('12345');
      buffer.insert('67890');
      expect(buffer.getContent()).toBe('1234567890');
      // Further inserts should be ignored
      buffer.insert('X');
      expect(buffer.getContent()).toBe('1234567890');
    });

    it('should partially insert when near limit', () => {
      buffer.setMaxSize(10);
      buffer.insert('12345678');
      buffer.insert('ABCD'); // Only 2 chars should fit
      expect(buffer.getContent()).toBe('12345678AB');
    });

    it('should truncate setContent when over limit', () => {
      buffer.setMaxSize(5);
      buffer.setContent('1234567890');
      expect(buffer.getContent()).toBe('12345');
      expect(buffer.getCursorPos()).toBe(5);
    });

    it('should return empty string when buffer full on insert', () => {
      buffer.setMaxSize(3);
      buffer.insert('abc');
      const result = buffer.insert('d');
      expect(result).toBe('');
      expect(buffer.getContent()).toBe('abc');
    });
  });

  describe('multi-line support', () => {
    beforeEach(() => {
      // Set up a terminal width of 20 and prompt length of 3 (e.g., "🦆 ")
      buffer.setTerminalWidth(20);
      buffer.setPromptLength(3);
    });

    it('should track terminal width', () => {
      expect(buffer.getTerminalWidth()).toBe(20);
    });

    it('should track prompt length', () => {
      expect(buffer.getPromptLength()).toBe(3);
    });

    it('should calculate position on first line', () => {
      buffer.insert('hello');
      // Position should be at row 0, col 3 (prompt) + 5 (content) = col 8
      const pos = buffer.getCursorPosition();
      expect(pos.row).toBe(0);
      expect(pos.col).toBe(8); // 3 (prompt) + 5 (chars)
    });

    it('should calculate position when text wraps to second line', () => {
      // Terminal width 20, prompt 3, so first line has 17 chars available
      // Insert 20 chars to wrap to second line
      buffer.insert('12345678901234567890'); // 20 chars
      const pos = buffer.getCursorPosition();
      // First line: 17 chars, remaining 3 chars on second line
      expect(pos.row).toBe(1);
      expect(pos.col).toBe(3); // 20 - 17 = 3 chars on second row
    });

    it('should calculate position for multiple wrapped lines', () => {
      // Insert 60 chars with terminal width 20 and prompt 3
      // First line: 17 chars, then 20 chars per line
      // 60 chars = 17 + 20 + 20 + 3 = row 3, col 3
      buffer.insert('a'.repeat(60));
      const pos = buffer.getCursorPosition();
      expect(pos.row).toBe(3);
      expect(pos.col).toBe(3); // (60 - 17) % 20 = 43 % 20 = 3
    });

    it('should get row count correctly', () => {
      buffer.insert('12345678901234567'); // 17 chars, exactly first line
      expect(buffer.getRowCount()).toBe(1);

      buffer.insert('8'); // 18 chars, wraps to second line
      expect(buffer.getRowCount()).toBe(2);
    });

    it('should calculate end position correctly', () => {
      buffer.insert('1234567890123456789012345'); // 25 chars
      // 17 on first line, 8 on second line
      const endPos = buffer.getEndPosition();
      expect(endPos.row).toBe(1);
      expect(endPos.col).toBe(8); // 25 - 17 = 8
    });

    it('should handle position at exactly line boundary', () => {
      // First line has 17 chars available
      buffer.insert('12345678901234567'); // exactly 17 chars
      const pos = buffer.getCursorPosition();
      expect(pos.row).toBe(0);
      expect(pos.col).toBe(20); // 3 + 17 = 20 (at end of first line)
    });

    it('should get position at specific offset', () => {
      buffer.insert('hello world test'); // 16 chars
      // Position at offset 5 (after "hello")
      const pos = buffer.getPositionAt(5);
      expect(pos.row).toBe(0);
      expect(pos.col).toBe(8); // 3 (prompt) + 5 = 8
    });

    it('should handle cursor movement across line boundaries', () => {
      // Fill first line and a bit of second line
      buffer.insert('1234567890123456789012'); // 22 chars (17 + 5)

      // Move cursor left to wrap to previous line
      buffer.moveLeft();
      buffer.moveLeft();
      buffer.moveLeft();
      buffer.moveLeft();
      buffer.moveLeft();
      buffer.moveLeft(); // Now at position 16, still on first line

      const pos = buffer.getCursorPosition();
      expect(pos.row).toBe(0);
      expect(pos.col).toBe(19); // 3 + 16 = 19
    });
  });
});
