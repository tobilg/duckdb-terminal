export interface AsyncTerminalSink {
  writeAsync(text: string): Promise<void>;
}

export interface TerminalOutputWriterOptions {
  maxChunkChars?: number;
  process?: (text: string) => string;
}

const DEFAULT_MAX_CHUNK_CHARS = 32 * 1024;

/**
 * Writes result lines to the terminal in bounded, frame-yielding chunks.
 */
export class TerminalOutputWriter {
  private readonly maxChunkChars: number;
  private readonly process: (text: string) => string;

  constructor(
    private readonly sink: AsyncTerminalSink,
    options: TerminalOutputWriterOptions = {}
  ) {
    const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    if (!Number.isInteger(maxChunkChars) || maxChunkChars < 2) {
      throw new RangeError('maxChunkChars must be an integer of at least 2');
    }
    this.maxChunkChars = maxChunkChars;
    this.process = options.process ?? ((text) => text);
  }

  async writeLines(lines: Iterable<string>): Promise<void> {
    const pending: string[] = [];
    let pendingLength = 0;

    const flush = async () => {
      if (pendingLength === 0) return;
      const chunk = pending.join('');
      pending.length = 0;
      pendingLength = 0;
      await this.writeChunk(this.process(chunk));
    };

    for (const line of lines) {
      const text = line.replace(/\r?\n/g, '\r\n') + '\r\n';
      if (pendingLength > 0 && pendingLength + text.length > this.maxChunkChars) {
        await flush();
      }
      if (text.length > this.maxChunkChars) {
        await flush();
        await this.writeChunk(this.process(text));
      } else {
        pending.push(text);
        pendingLength += text.length;
      }
    }

    await flush();
  }

  private async writeChunk(chunk: string): Promise<void> {
    let offset = 0;
    while (offset < chunk.length) {
      let end = Math.min(offset + this.maxChunkChars, chunk.length);
      if (end < chunk.length) {
        const finalCodeUnit = chunk.charCodeAt(end - 1);
        if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end--;
      }
      await this.sink.writeAsync(chunk.slice(offset, end));
      offset = end;
    }
  }
}
