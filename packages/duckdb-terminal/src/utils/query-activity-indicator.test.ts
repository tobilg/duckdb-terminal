import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryActivityIndicator } from './query-activity-indicator';
import * as vt100 from './vt100';

describe('QueryActivityIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should avoid output for queries that finish before the delay', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const indicator = new QueryActivityIndicator(write, { delayMs: 250 });

    indicator.start();
    vi.advanceTimersByTime(249);
    indicator.stop();
    vi.runAllTimers();

    expect(write).not.toHaveBeenCalled();
  });

  it('should update elapsed time once per interval and clear its line on stop', () => {
    vi.useFakeTimers();
    let now = 0;
    const write = vi.fn();
    const indicator = new QueryActivityIndicator(write, {
      delayMs: 250,
      updateIntervalMs: 1_000,
      now: () => now,
    });

    indicator.start();
    now = 250;
    vi.advanceTimersByTime(250);
    expect(write.mock.calls[0][0]).toContain('Running… 0s');

    now = 1_250;
    vi.advanceTimersByTime(1_000);
    expect(write.mock.calls[1][0]).toContain('Running… 1s');

    indicator.stop();
    expect(write.mock.calls.at(-1)?.[0]).toBe(`\r${vt100.CLEAR_LINE}`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should stay within one row on narrow terminals', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const indicator = new QueryActivityIndicator(write, { delayMs: 0, now: () => 0, columns: () => 20 });

    indicator.start();
    vi.advanceTimersByTime(0);
    indicator.stop();

    expect(write.mock.calls[0][0]).toBe(`\r${vt100.CLEAR_LINE}${vt100.dim('Running… 0s')}`);
  });
});
