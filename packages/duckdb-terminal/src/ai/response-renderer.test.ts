import { describe, it, expect } from 'vitest';
import { ResponseRenderer } from './response-renderer';
import { CLEAR_LINE, DIM } from '../utils/vt100';

function setup() {
  const writes: string[] = [];
  const renderer = new ResponseRenderer((text) => writes.push(text));
  const plain = () => writes.join('').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  return { renderer, writes, plain };
}

describe('ResponseRenderer', () => {
  it('shows reasoning dimmed under a label, then the answer after a blank line', () => {
    const { renderer, writes, plain } = setup();
    renderer.reasoning('\nCount the ');
    renderer.reasoning('rows.\n');
    renderer.content('\n\nThere are ');
    renderer.content('3 rows.');
    renderer.finish();

    expect(plain()).toBe('Thinking\r\nCount the rows.\r\n\r\nThere are 3 rows.\r\n');
    expect(writes.find((text) => text.includes('Count the'))).toContain(DIM);
    expect(writes.find((text) => text.includes('There are'))).not.toContain(DIM);
  });

  it('replaces the status line in place and clears it when output starts', () => {
    const { renderer, writes, plain } = setup();
    renderer.status('Loading model…');
    renderer.status('Reading prompt 10/20 tokens…');
    renderer.content('Hi');
    renderer.finish();

    expect(writes.filter((text) => text.startsWith(`\r${CLEAR_LINE}`))).toHaveLength(3);
    expect(plain().endsWith('\rHi\r\n')).toBe(true);
  });

  it('writes notices and statistics on their own lines', () => {
    const { renderer, plain } = setup();
    renderer.content('Done');
    renderer.stats({ tokens: 42, tokensPerSecond: 12.345 });
    renderer.stats({});
    expect(plain()).toBe('Done\r\n(42 tokens · 12.3 tok/s)\r\n');
  });

  it('keeps inner line breaks but drops blank lines at the end of a section', () => {
    const { renderer, plain } = setup();
    renderer.content('a\n\n');
    renderer.content('b\n');
    renderer.content('c \n\n\n');
    renderer.finish();
    expect(plain()).toBe('a\r\n\r\nb\r\nc\r\n');
  });

  it('starts a new line when a new section follows unterminated output', () => {
    const { renderer, plain } = setup();
    renderer.content('first');
    renderer.finish();
    renderer.reasoning('again');
    renderer.finish();
    expect(plain()).toBe('first\r\nThinking\r\nagain\r\n');
  });
});
