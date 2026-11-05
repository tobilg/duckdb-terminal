/**
 * Streams a model's reasoning and answer into the terminal.
 *
 * Reasoning is shown dimmed under a "Thinking" label; the answer follows in the
 * normal color. A transient status line (model loading, prompt processing) is
 * redrawn in place until the first token arrives.
 *
 * @module ai/response-renderer
 */

import * as vt100 from '../utils/vt100';

type Section = 'none' | 'reasoning' | 'content';

export interface GenerationStats {
  /** Generated tokens. */
  tokens?: number;
  /** Generation speed in tokens per second. */
  tokensPerSecond?: number;
}

export class ResponseRenderer {
  private section: Section = 'none';
  private statusVisible = false;
  private atLineStart = true;
  private trimLeadingNewlines = false;
  /** Trailing whitespace with a line break, written only if more text follows. */
  private pendingBreaks = '';

  constructor(
    private readonly write: (text: string) => void,
    /** Terminal width in columns; status lines stay within one row. */
    private readonly columns: () => number = () => Infinity
  ) {}

  /** Shows or replaces the in-place status line. */
  status(text: string): void {
    this.write(`\r${vt100.CLEAR_LINE}${vt100.dim(vt100.fitLine(text, this.columns()))}`);
    this.statusVisible = true;
  }

  /** Removes the status line, if shown. */
  clearStatus(): void {
    if (!this.statusVisible) return;
    this.write(`\r${vt100.CLEAR_LINE}`);
    this.statusVisible = false;
  }

  /** Appends streamed reasoning text. */
  reasoning(delta: string): void {
    if (this.section !== 'reasoning') {
      this.beginSection('reasoning');
      this.write(`${vt100.dim(vt100.ITALIC + 'Thinking')}\r\n`);
      this.atLineStart = true;
    }
    this.emit(delta, true);
  }

  /** Appends streamed answer text. */
  content(delta: string): void {
    if (this.section !== 'content') {
      const afterReasoning = this.section === 'reasoning';
      this.beginSection('content');
      if (afterReasoning) this.write('\r\n');
    }
    this.emit(delta, false);
  }

  /** Writes a dimmed notice on its own line. */
  notice(text: string): void {
    this.endLine();
    this.write(`${vt100.dim(text)}\r\n`);
    this.atLineStart = true;
  }

  /** Writes generation statistics, e.g. `(42 tokens · 12.5 tok/s)`. */
  stats({ tokens, tokensPerSecond }: GenerationStats): void {
    const parts: string[] = [];
    if (tokens) parts.push(`${tokens} tokens`);
    if (tokensPerSecond) parts.push(`${tokensPerSecond.toFixed(1)} tok/s`);
    if (parts.length) this.notice(`(${parts.join(' · ')})`);
  }

  /** Ends a model turn, leaving the cursor at the start of a fresh line. */
  finish(): void {
    this.endLine();
    this.section = 'none';
  }

  private beginSection(section: Section): void {
    this.clearStatus();
    this.endLine();
    this.section = section;
    this.trimLeadingNewlines = true;
  }

  /** Ends the current line; blank lines the model emitted at the end are dropped. */
  private endLine(): void {
    this.clearStatus();
    this.pendingBreaks = '';
    if (!this.atLineStart) {
      this.write('\r\n');
      this.atLineStart = true;
    }
  }

  private emit(delta: string, dimmed: boolean): void {
    let text = delta;
    if (this.trimLeadingNewlines) {
      text = text.replace(/^\s*\n/, '');
      if (!text) return;
      this.trimLeadingNewlines = false;
    }
    // Hold back trailing line breaks so every section ends with exactly one.
    text = this.pendingBreaks + text;
    const trailing = /\s+$/.exec(text);
    this.pendingBreaks = trailing && trailing[0].includes('\n') ? trailing[0] : '';
    if (this.pendingBreaks) text = text.slice(0, -this.pendingBreaks.length);
    if (!text) return;
    this.clearStatus();
    const normalized = text.replace(/\r?\n/g, '\r\n');
    this.write(dimmed ? vt100.dim(normalized) : normalized);
    this.atLineStart = false;
  }
}
