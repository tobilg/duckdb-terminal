import * as vt100 from './vt100';

const DEFAULT_DELAY_MS = 250;
const DEFAULT_UPDATE_INTERVAL_MS = 1_000;

export interface QueryActivityIndicatorOptions {
  delayMs?: number;
  updateIntervalMs?: number;
  now?: () => number;
}

/**
 * Renders a low-overhead, in-place elapsed-time indicator for long queries.
 */
export class QueryActivityIndicator {
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private visible = false;
  private readonly delayMs: number;
  private readonly updateIntervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly write: (text: string) => void,
    options: QueryActivityIndicatorOptions = {}
  ) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    this.stop();
    this.startedAt = this.now();
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      this.visible = true;
      this.render();
      this.updateTimer = setInterval(() => this.render(), this.updateIntervalMs);
    }, this.delayMs);
  }

  stop(): void {
    if (this.delayTimer !== null) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.visible) {
      this.write(`\r${vt100.CLEAR_LINE}`);
      this.visible = false;
    }
  }

  private render(): void {
    const elapsedSeconds = Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000));
    this.write(
      `\r${vt100.CLEAR_LINE}${vt100.dim(`Running… ${elapsedSeconds}s (Ctrl+C to cancel)`)}`
    );
  }
}
