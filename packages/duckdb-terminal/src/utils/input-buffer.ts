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
  private terminalWidth: number = 80;
  private promptLength: number = 0;

  /**
   * Set the prompt length for cursor calculations.
   * This is needed to correctly calculate line wrapping since the prompt
   * takes up space on the first line.
   *
   * @param length - The visible length of the prompt (excluding ANSI codes)
   */
  setPromptLength(length: number): void {
    this.promptLength = length;
  }

  /**
   * Set the terminal width for line wrapping calculations.
   *
   * @param width - The terminal width in columns
   */
  setTerminalWidth(width: number): void {
    this.terminalWidth = width;
  }

  /**
   * Get the current terminal width.
   *
   * @returns The terminal width in columns
   */
  getTerminalWidth(): number {
    return this.terminalWidth;
  }

  /**
   * Get the current prompt length.
   *
   * @returns The prompt length in characters
   */
  getPromptLength(): number {
    return this.promptLength;
  }

  /**
   * Calculate the row and column position for a given buffer offset.
   * Takes into account the prompt length on the first line.
   *
   * @param offset - The buffer offset (0-based)
   * @returns Object with row (0-based) and col (0-based) position
   */
  getPositionAt(offset: number): { row: number; col: number } {
    const width = this.terminalWidth;
    // First line has less space due to prompt
    const firstLineSpace = width - this.promptLength;

    if (offset <= firstLineSpace) {
      return { row: 0, col: this.promptLength + offset };
    }

    // Calculate position for wrapped lines
    const remainingOffset = offset - firstLineSpace;
    const additionalRows = Math.floor(remainingOffset / width);
    const col = remainingOffset % width;

    return { row: 1 + additionalRows, col };
  }

  /**
   * Get the current cursor position as row/col.
   *
   * @returns Object with row (0-based) and col (0-based) position
   */
  getCursorPosition(): { row: number; col: number } {
    return this.getPositionAt(this.cursorPos);
  }

  /**
   * Get the end position (after the last character).
   *
   * @returns Object with row (0-based) and col (0-based) position
   */
  getEndPosition(): { row: number; col: number } {
    return this.getPositionAt(this.buffer.length);
  }

  /**
   * Calculate the number of rows the current content spans.
   *
   * @returns The total number of rows (1-based)
   */
  getRowCount(): number {
    return this.getEndPosition().row + 1;
  }

  /**
   * Generate VT100 escape sequence to move from one position to another.
   *
   * @param from - The starting position
   * @param to - The target position
   * @returns VT100 escape sequence string
   */
  private moveCursor(
    from: { row: number; col: number },
    to: { row: number; col: number }
  ): string {
    let output = '';

    // Vertical movement
    const rowDiff = to.row - from.row;
    if (rowDiff > 0) {
      output += vt100.cursorDown(rowDiff);
    } else if (rowDiff < 0) {
      output += vt100.cursorUp(-rowDiff);
    }

    // Horizontal movement - use absolute column positioning for reliability
    if (to.col !== from.col || rowDiff !== 0) {
      output += vt100.cursorColumn(to.col + 1); // cursorColumn is 1-based
    }

    return output;
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

    // Get position before insertion for multi-line handling
    const oldEndPos = this.getEndPosition();

    this.buffer = before + char + after;
    this.cursorPos += char.length;

    // Get new positions after insertion
    const newCursorPos = this.getCursorPosition();
    const newEndPos = this.getEndPosition();

    // Return the string to write to terminal
    if (after.length === 0) {
      // At end of line, just write the character
      return char;
    } else {
      // In middle of line, need to rewrite rest of line with multi-line awareness
      // Clear from current position to old end, then rewrite
      let output = '';

      // Write the inserted char and the rest of the content
      output += char + after;

      // If content spans multiple rows, we need to clear any leftover from old content
      if (newEndPos.row > oldEndPos.row) {
        // Content grew to new line(s), no cleanup needed
      } else if (newEndPos.row === oldEndPos.row && newEndPos.col < oldEndPos.col) {
        // Same row but shorter - clear remaining chars
        output += ' '.repeat(oldEndPos.col - newEndPos.col);
      }

      // Move cursor back to where it should be
      output += this.moveCursor(newEndPos, newCursorPos);

      return output;
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

    // Get positions before deletion
    const oldCursorPos = this.getCursorPosition();
    const oldEndPos = this.getEndPosition();

    const before = this.buffer.substring(0, this.cursorPos - 1);
    const after = this.buffer.substring(this.cursorPos);
    this.buffer = before + after;
    this.cursorPos--;

    // Get new positions after deletion
    const newCursorPos = this.getCursorPosition();
    const newEndPos = this.getEndPosition();

    let output = '';

    // Move cursor to new position first
    output += this.moveCursor(oldCursorPos, newCursorPos);

    if (after.length === 0) {
      // At end of line - just clear the character
      output += ' ';
      output += this.moveCursor(
        { row: newCursorPos.row, col: newCursorPos.col + 1 },
        newCursorPos
      );
    } else {
      // In middle of line - rewrite rest and handle multi-line cleanup
      output += after;

      // Clear any leftover characters from the old end position
      if (oldEndPos.row > newEndPos.row) {
        // Content shrank by one or more rows - need to clear old rows
        // First clear rest of current row
        output += vt100.CLEAR_TO_END;
        // Move to each old row and clear it
        for (let row = newEndPos.row + 1; row <= oldEndPos.row; row++) {
          output += vt100.cursorDown(1);
          output += vt100.cursorColumn(1);
          output += vt100.CLEAR_TO_END;
        }
        // Move back to new end position
        output += this.moveCursor(
          { row: oldEndPos.row, col: 0 },
          newEndPos
        );
      } else {
        // Same row - just add a space to clear the last char
        output += ' ';
      }

      // Move cursor back to where it should be
      const posAfterWrite = oldEndPos.row > newEndPos.row
        ? newEndPos
        : { row: newEndPos.row, col: newEndPos.col + 1 };
      output += this.moveCursor(posAfterWrite, newCursorPos);
    }

    return output;
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

    // Get positions before deletion
    const cursorPos = this.getCursorPosition();
    const oldEndPos = this.getEndPosition();

    const before = this.buffer.substring(0, this.cursorPos);
    const after = this.buffer.substring(this.cursorPos + 1);
    this.buffer = before + after;

    // Get new end position after deletion
    const newEndPos = this.getEndPosition();

    let output = '';

    // Write rest of line
    output += after;

    // Clear any leftover characters from the old end position
    if (oldEndPos.row > newEndPos.row) {
      // Content shrank by one or more rows - need to clear old rows
      output += vt100.CLEAR_TO_END;
      for (let row = newEndPos.row + 1; row <= oldEndPos.row; row++) {
        output += vt100.cursorDown(1);
        output += vt100.cursorColumn(1);
        output += vt100.CLEAR_TO_END;
      }
      // Move back to new end position then to cursor
      output += this.moveCursor({ row: oldEndPos.row, col: 0 }, cursorPos);
    } else {
      // Same row - just add a space to clear the last char
      output += ' ';
      // Move cursor back to original position
      output += this.moveCursor(
        { row: newEndPos.row, col: newEndPos.col + 1 },
        cursorPos
      );
    }

    return output;
  }

  /**
   * Moves the cursor one position to the left.
   *
   * @returns VT100 escape sequence, or empty string if already at start
   */
  moveLeft(): string {
    if (this.cursorPos > 0) {
      const oldPos = this.getCursorPosition();
      this.cursorPos--;
      const newPos = this.getCursorPosition();
      return this.moveCursor(oldPos, newPos);
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
      const oldPos = this.getCursorPosition();
      this.cursorPos++;
      const newPos = this.getCursorPosition();
      return this.moveCursor(oldPos, newPos);
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
    const oldPos = this.getCursorPosition();
    this.cursorPos = 0;
    const newPos = this.getCursorPosition();
    return this.moveCursor(oldPos, newPos);
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
    const oldPos = this.getCursorPosition();
    this.cursorPos = this.buffer.length;
    const newPos = this.getCursorPosition();
    return this.moveCursor(oldPos, newPos);
  }

  /**
   * Clears from cursor position to end of line (Ctrl+K).
   *
   * @returns VT100 escape sequence to clear the terminal
   */
  clearToEnd(): string {
    const oldEndPos = this.getEndPosition();
    const cursorPos = this.getCursorPosition();

    this.buffer = this.buffer.substring(0, this.cursorPos);

    const newEndPos = this.getEndPosition();
    let output = vt100.CLEAR_TO_END;

    // If we're clearing multiple rows, need to clear them too
    if (oldEndPos.row > newEndPos.row) {
      for (let row = cursorPos.row + 1; row <= oldEndPos.row; row++) {
        output += vt100.cursorDown(1);
        output += vt100.cursorColumn(1);
        output += vt100.CLEAR_TO_END;
      }
      // Move back to cursor position
      output += this.moveCursor({ row: oldEndPos.row, col: 0 }, cursorPos);
    }

    return output;
  }

  /**
   * Clears the entire line and resets buffer (Ctrl+U).
   *
   * @returns VT100 escape sequences to clear the terminal line
   */
  clearLine(): string {
    const oldEndPos = this.getEndPosition();

    // Move to start first
    let output = this.moveToStart();

    // Clear the current line
    output += vt100.CLEAR_TO_END;

    // Clear any additional rows if content was multi-line
    if (oldEndPos.row > 0) {
      for (let row = 1; row <= oldEndPos.row; row++) {
        output += vt100.cursorDown(1);
        output += vt100.cursorColumn(1);
        output += vt100.CLEAR_TO_END;
      }
      // Move back to start (row 0, after prompt)
      output += this.moveCursor(
        { row: oldEndPos.row, col: 0 },
        { row: 0, col: this.promptLength }
      );
    }

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

    // Get old positions before modification
    const oldCursorPos = this.getCursorPosition();
    const oldEndPos = this.getEndPosition();

    // Calculate word start position
    const oldWordStartPos = this.getPositionAt(wordStart);

    this.buffer = before + completion + after;
    this.cursorPos = wordStart + completion.length;

    // Get new positions after modification
    const newCursorPos = this.getCursorPosition();
    const newEndPos = this.getEndPosition();

    let output = '';

    // Move back to word start
    output += this.moveCursor(oldCursorPos, oldWordStartPos);

    // Clear from word start to old end
    output += vt100.CLEAR_TO_END;
    if (oldEndPos.row > oldWordStartPos.row) {
      for (let row = oldWordStartPos.row + 1; row <= oldEndPos.row; row++) {
        output += vt100.cursorDown(1);
        output += vt100.cursorColumn(1);
        output += vt100.CLEAR_TO_END;
      }
      // Move back to word start position
      output += this.moveCursor({ row: oldEndPos.row, col: 0 }, oldWordStartPos);
    }

    // Write completion and rest of content
    output += completion + after;

    // Move cursor to final position
    output += this.moveCursor(newEndPos, newCursorPos);

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
