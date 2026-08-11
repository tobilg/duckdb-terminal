import { describe, expect, it, vi } from 'vitest';
import { TerminalOutputWriter } from './terminal-output-writer';

describe('TerminalOutputWriter', () => {
  it('writes ordered CRLF chunks and awaits each sink write', async () => {
    const chunks: string[] = [];
    let inFlight = false;
    const sink = {
      writeAsync: vi.fn().mockImplementation(async (text: string) => {
        expect(inFlight).toBe(false);
        inFlight = true;
        await Promise.resolve();
        chunks.push(text);
        inFlight = false;
      }),
    };
    const writer = new TerminalOutputWriter(sink, { maxChunkChars: 8 });

    await writer.writeLines(['one', 'two', 'three']);

    expect(chunks.join('')).toBe('one\r\ntwo\r\nthree\r\n');
    expect(chunks.every((chunk) => chunk.length <= 8)).toBe(true);
  });

  it('processes output before splitting oversized chunks', async () => {
    const chunks: string[] = [];
    const writer = new TerminalOutputWriter(
      { writeAsync: async (text) => { chunks.push(text); } },
      { maxChunkChars: 4, process: (text) => `[${text}]` }
    );

    await writer.writeLines(['abcdef']);

    expect(chunks.join('')).toBe('[abcdef\r\n]');
    expect(chunks.every((chunk) => chunk.length <= 4)).toBe(true);
  });

  it('does not split UTF-16 surrogate pairs between chunks', async () => {
    const chunks: string[] = [];
    const writer = new TerminalOutputWriter(
      { writeAsync: async (text) => { chunks.push(text); } },
      { maxChunkChars: 2 }
    );

    await writer.writeLines(['a😀b']);

    expect(chunks.join('')).toBe('a😀b\r\n');
    expect(chunks).not.toContain(expect.stringMatching(/[\uD800-\uDBFF]$/));
    expect(chunks).not.toContain(expect.stringMatching(/^[\uDC00-\uDFFF]/));
  });

  it('rejects unsafe chunk sizes', () => {
    expect(() => new TerminalOutputWriter(
      { writeAsync: async () => undefined },
      { maxChunkChars: 1 }
    )).toThrow(RangeError);
  });
});
