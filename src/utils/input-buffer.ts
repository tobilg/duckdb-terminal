/**
 * Input buffer for line editing with cursor positioning.
 *
 * This module provides a text buffer with cursor management for terminal-style
 * line editing. It handles insertions, deletions, cursor movement, and generates
 * the appropriate VT100 escape sequences for terminal output.
 *
 * @module utils/input-buffer
 */

import * as vt100 from './vt100';

/** Maximum buffer size (64KB) to prevent memory exhaustion from large pastes */
export const MAX_BUFFER_SIZE = 64 * 1024;

/**
 * A text buffer with cursor management for terminal line editing.
 *
 * The InputBuffer maintains both the current text content and cursor position,
 * providing methods for common editing operations. Each editing method returns
 * the VT100 escape sequences needed to update the terminal display.
 *
 * Features:
 * - Character insertion at cursor position
 * - Backspace and delete key handling
 * - Cursor movement (left, right, home, end)
 * - Line clearing operations
 * - Word-based operations for auto-completion
 *
 * @example Basic usage
 * ```typescript
 * const buffer = new InputBuffer();
 *
 * // Type "hello"
 * terminal.write(buffer.insert('h'));
 * terminal.write(buffer.insert('e'));
 * terminal.write(buffer.insert('l'));
 * terminal.write(buffer.insert('l'));
 * terminal.write(buffer.insert('o'));
 *
 * console.log(buffer.getContent()); // 'hello'
 * console.log(buffer.getCursorPos()); // 5
 *
 * // Delete last character
 * terminal.write(buffer.backspace()); // Buffer is now 'hell'
 * ```
 *
 * @example Cursor movement
 * ```typescript
 * const buffer = new InputBuffer();
 * buffer.setContent('hello world');
 *
 * terminal.write(buffer.moveToStart()); // Cursor at position 0
 * terminal.write(buffer.moveRight());   // Cursor at position 1
 * terminal.write(buffer.moveToEnd());   // Cursor at position 11
 * ```
 *
 * @example Auto-completion
 * ```typescript
 * const buffer = new InputBuffer();
 * buffer.setContent('SELECT * FROM us');
 *
 * const word = buffer.getWordBeforeCursor(); // 'us'
 * terminal.write(buffer.replaceWordBeforeCursor('users'));
 * console.log(buffer.getContent()); // 'SELECT * FROM users'
 * ```
 */
export class InputBuffer {
  private buffer: string = '';
  private cursorPos: number = 0;
  private maxSize: number = MAX_BUFFER_SIZE;

  /**
   * Set the prompt length for cursor calculations (reserved for future use)
   */
  setPromptLength(_length: number): void {
    // Reserved for future multi-line prompt handling
  }

  /**
   * Sets the maximum buffer size.
   *
   * @param size - Maximum size in bytes (defaults to MAX_BUFFER_SIZE)
   */
  setMaxSize(size: number): void {
    this.maxSize = size;
  }

  /**
   * Returns the maximum buffer size.
   *
   * @returns The maximum size in bytes
   */
  getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Returns the current buffer content.
   *
   * @returns The full text content of the buffer
   */
  getContent(): string {
    return this.buffer;
  }

  /**
   * Returns the current cursor position within the buffer.
   *
   * @returns The zero-based cursor position
   */
  getCursorPos(): number {
    return this.cursorPos;
  }

  /**
   * Clears the buffer and resets cursor to position 0.
   */
  clear(): void {
    this.buffer = '';
    this.cursorPos = 0;
  }

  /**
   * Sets the buffer content and moves cursor to end.
   *
   * Used for history navigation when replacing the current line with a previous command.
   *
   * @param content - The new buffer content
   */
  setContent(content: string): void {
    // Truncate if content exceeds max size
    if (content.length > this.maxSize) {
      content = content.substring(0, this.maxSize);
    }
    this.buffer = content;
    this.cursorPos = content.length;
  }

  /**
   * Inserts text at the cursor position.
   *
   * @param char - The character(s) to insert
   * @returns VT100 escape sequences to update the terminal display
   */
  insert(char: string): string {
    // Check if insertion would exceed max buffer size
    if (this.buffer.length + char.length > this.maxSize) {
      // Truncate to fit within limit
      const availableSpace = this.maxSize - this.buffer.length;
      if (availableSpace <= 0) {
        return ''; // Buffer full, ignore input
      }
      char = char.substring(0, availableSpace);
    }

    const before = this.buffer.substring(0, this.cursorPos);
    const after = this.buffer.substring(this.cursorPos);
    this.buffer = before + char + after;
    this.cursorPos += char.length;

    // Return the string to write to terminal
    if (after.length === 0) {
      // At end of line, just write the character
      return char;
    } else {
      // In middle of line, need to rewrite rest of line
      return char + after + vt100.cursorLeft(after.length);
    }
  }

  /**
   * Deletes the character before the cursor (backspace operation).
   *
   * @returns VT100 escape sequences to update the terminal display, or empty string if at start
   */
  backspace(): string {
    if (this.cursorPos === 0) {
      return '';
    }

    const before = this.buffer.substring(0, this.cursorPos - 1);
    const after = this.buffer.substring(this.cursorPos);
    this.buffer = before + after;
    this.cursorPos--;

    // Move back, write rest of line, clear to end, move back again
    if (after.length === 0) {
      return '\b \b';
    } else {
      return (
        vt100.CURSOR_LEFT +
        after +
        ' ' +
        vt100.cursorLeft(after.length + 1)
      );
    }
  }

  /**
   * Deletes the character at the cursor position (delete key operation).
   *
   * @returns VT100 escape sequences to update the terminal display, or empty string if at end
   */
  delete(): string {
    if (this.cursorPos >= this.buffer.length) {
      return '';
    }

    const before = this.buffer.substring(0, this.cursorPos);
    const after = this.buffer.substring(this.cursorPos + 1);
    this.buffer = before + after;

    // Write rest of line, clear last character, move back
    return after + ' ' + vt100.cursorLeft(after.length + 1);
  }

  /**
   * Moves the cursor one position to the left.
   *
   * @returns VT100 escape sequence, or empty string if already at start
   */
  moveLeft(): string {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      return vt100.CURSOR_LEFT;
    }
    return '';
  }

  /**
   * Moves the cursor one position to the right.
   *
   * @returns VT100 escape sequence, or empty string if already at end
   */
  moveRight(): string {
    if (this.cursorPos < this.buffer.length) {
      this.cursorPos++;
      return vt100.CURSOR_RIGHT;
    }
    return '';
  }

  /**
   * Moves the cursor to the start of the line (Home key / Ctrl+A).
   *
   * @returns VT100 escape sequence, or empty string if already at start
   */
  moveToStart(): string {
    if (this.cursorPos === 0) {
      return '';
    }
    const moves = this.cursorPos;
    this.cursorPos = 0;
    return vt100.cursorLeft(moves);
  }

  /**
   * Moves the cursor to the end of the line (End key / Ctrl+E).
   *
   * @returns VT100 escape sequence, or empty string if already at end
   */
  moveToEnd(): string {
    if (this.cursorPos === this.buffer.length) {
      return '';
    }
    const moves = this.buffer.length - this.cursorPos;
    this.cursorPos = this.buffer.length;
    return vt100.cursorRight(moves);
  }

  /**
   * Clears from cursor position to end of line (Ctrl+K).
   *
   * @returns VT100 escape sequence to clear the terminal
   */
  clearToEnd(): string {
    this.buffer = this.buffer.substring(0, this.cursorPos);
    return vt100.CLEAR_TO_END;
  }

  /**
   * Clears the entire line and resets buffer (Ctrl+U).
   *
   * @returns VT100 escape sequences to clear the terminal line
   */
  clearLine(): string {
    const output = this.moveToStart() + vt100.CLEAR_TO_END;
    this.buffer = '';
    this.cursorPos = 0;
    return output;
  }

  /**
   * Returns the word immediately before the cursor for auto-completion.
   *
   * A word is defined as a sequence of word characters (`\w`) and dots.
   *
   * @returns The word before cursor, or empty string if none
   */
  getWordBeforeCursor(): string {
    const beforeCursor = this.buffer.substring(0, this.cursorPos);
    const match = beforeCursor.match(/[\w.]*$/);
    return match ? match[0] : '';
  }

  /**
   * Replaces the word before the cursor with a completion string.
   *
   * @param completion - The completion string to insert
   * @returns VT100 escape sequences to update the terminal display
   */
  replaceWordBeforeCursor(completion: string): string {
    const word = this.getWordBeforeCursor();
    const wordStart = this.cursorPos - word.length;
    const before = this.buffer.substring(0, wordStart);
    const after = this.buffer.substring(this.cursorPos);

    this.buffer = before + completion + after;
    this.cursorPos = wordStart + completion.length;

    // Move back to word start, clear to end, write new content
    let output = '';
    if (word.length > 0) {
      output += vt100.cursorLeft(word.length);
    }
    output += vt100.CLEAR_TO_END;
    output += completion + after;
    if (after.length > 0) {
      output += vt100.cursorLeft(after.length);
    }

    return output;
  }

  /**
   * Checks if the buffer is empty.
   *
   * @returns True if buffer has no content
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Checks if the buffer contains only whitespace.
   *
   * @returns True if buffer is empty or contains only whitespace
   */
  isBlank(): boolean {
    return this.buffer.trim().length === 0;
  }
}
