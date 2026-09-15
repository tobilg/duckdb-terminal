import { createTerminal, type BrowserTerminal, type Disposable, type TerminalTheme } from '@gespenst/core';
import { WebLinksAddon } from '@gespenst/web-links';
import '@gespenst/core/style.css';
import wasm from '@gespenst/core/ghostty-vt.wasm?url&no-inline';
import callbacksWasm from '@gespenst/core/ghostty-callbacks.wasm?url&no-inline';
import type { Theme } from './types';

/** Configuration for the Gespenst browser terminal adapter. */
export interface TerminalOptions {
  /** CSS monospace font stack. */
  fontFamily?: string;
  /** Font size in CSS pixels. @defaultValue 14 */
  fontSize?: number;
  /** Initial terminal colors. */
  theme?: Theme;
  /** Maximum retained scrollback lines; zero disables history. @defaultValue 10000 */
  scrollbackLines?: number;
  /** Enable HTTP(S) links in the viewport. @defaultValue true */
  linkDetection?: boolean;
}

/** Validates the line-based setting and rejects the removed byte-based option. */
export function validateScrollback(options: { scrollbackLines?: number }): number {
  if ('scrollback' in options) {
    throw new TypeError('scrollback (bytes) was removed. Use scrollbackLines (lines) instead.');
  }
  const lines = options.scrollbackLines ?? 10_000;
  if (!Number.isSafeInteger(lines) || lines < 0) {
    throw new RangeError('scrollbackLines must be a nonnegative safe integer');
  }
  return lines;
}

/**
 * Adapts Gespenst's byte-oriented input and asynchronous rendering to the SQL REPL.
 * Owns browser handlers and disposes the native terminal and its addons.
 */
export class TerminalAdapter {
  private terminal: BrowserTerminal | null = null;
  private initialization: Promise<void> | null = null;
  private disposed = false;
  private currentTheme: Theme | null = null;
  private themeQueue: Promise<void> = Promise.resolve();
  private dataHandler?: (data: string) => void;
  private pasteHandler?: (text: string) => void;
  private resizeHandler?: (cols: number, rows: number) => void;
  private errorHandler?: (error: Error) => void;
  private cleanups: Array<() => void> = [];
  private links: WebLinksAddon | null = null;
  private linksEnabled = true;
  private selection = '';
  private selectionRevision = 0;
  private readonly decoder = new TextDecoder();

  /** Creates the terminal, loads packaged WASM, and mounts it in the host. */
  init(container: HTMLElement, options: TerminalOptions = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Terminal adapter is disposed'));
    if (this.initialization) return this.initialization;
    const scrollbackLines = validateScrollback(options);
    this.currentTheme = options.theme ?? null;
    this.linksEnabled = options.linkDetection ?? true;
    this.initialization = this.initialize(container, options, scrollbackLines);
    return this.initialization;
  }

  private async initialize(container: HTMLElement, options: TerminalOptions, scrollbackLines: number): Promise<void> {
    try {
      const terminal = await createTerminal({
        container, worker: 'dedicated', renderer: 'auto', wasm, callbacksWasm,
        fontFamily: options.fontFamily ??
          '"Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
        fontSizePx: options.fontSize ?? 14,
        defaultCursorBlink: true,
        scrollbackLines,
        theme: options.theme ? this.toTheme(options.theme) : undefined,
        ariaLabel: 'DuckDB SQL terminal',
      });
      if (this.disposed) {
        terminal.dispose();
        throw new Error('Terminal adapter was disposed during initialization');
      }
      this.terminal = terminal;
      const subscribe = (subscription: Disposable) => {
        this.cleanups.push(() => subscription.dispose());
      };
      subscribe(terminal.on('input', ({ data, source }) => {
        if (this.disposed) return;
        if (source !== 'key' && source !== 'text' && source !== 'paste') return;
        const text = this.decoder.decode(data, { stream: true });
        if (!text) return;
        if (source === 'paste') this.pasteHandler?.(text);
        else this.dataHandler?.(text);
      }));
      subscribe(terminal.on('resize', ({ cols, rows }) => this.resizeHandler?.(cols, rows)));
      subscribe(terminal.on('error', (error) => this.reportError(error)));
      subscribe(terminal.on('selectionChange', () => {
        const revision = ++this.selectionRevision;
        void terminal.getSelection().then((selection) => {
          if (!this.disposed && revision === this.selectionRevision) this.selection = selection;
        }).catch((error: unknown) => this.reportError(error));
      }));
      this.setupKeyboard(container);
      this.setupLinkPointers(container);
      this.setupTouchScrolling(container);
      this.setLinkDetection(this.linksEnabled);
      terminal.fit();
      terminal.focus();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private reportError(error: unknown): void {
    if (!this.disposed) this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
  }

  private setupLinkPointers(container: HTMLElement): void {
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const handler = (event: PointerEvent) => {
      const link = (event.target as Element).closest('a.gespenst__link');
      if (!link) return;
      // Core captures pointers on its root, redirecting the eventual click away
      // from the addon link. Let the addon's target handler run, then stop bubbling.
      link.addEventListener(event.type, stop, { once: true });
    };
    container.addEventListener('pointerdown', handler, true);
    container.addEventListener('pointerup', handler, true);
    this.cleanups.push(() => {
      container.removeEventListener('pointerdown', handler, true);
      container.removeEventListener('pointerup', handler, true);
    });
  }

  private setupKeyboard(container: HTMLElement): void {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // Let the browser deliver native paste data, bypassing core's Ctrl+V encoding.
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.code === 'KeyV') {
        event.stopPropagation();
        return;
      }
      if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.code === 'KeyC') {
        event.preventDefault();
        event.stopPropagation();
        this.copySelection();
        return;
      }
      let sequence: string | undefined;
      if (event.key === 'Home' || (event.metaKey && event.key === 'ArrowLeft')) sequence = '\x1b[H';
      else if (event.key === 'End' || (event.metaKey && event.key === 'ArrowRight')) sequence = '\x1b[F';
      else if (!event.metaKey && (event.altKey || event.ctrlKey)) {
        if (event.key === 'ArrowLeft') sequence = '\x1bb';
        if (event.key === 'ArrowRight') sequence = '\x1bf';
      }
      if (sequence) {
        event.preventDefault();
        event.stopPropagation();
        this.dataHandler?.(sequence);
      }
    };
    container.addEventListener('keydown', handler, true);
    this.cleanups.push(() => container.removeEventListener('keydown', handler, true));
  }

  private copySelection(): void {
    const terminal = this.terminal;
    if (!terminal) return;
    // Begin the write in the key event; worker selection resolves asynchronously.
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const text = terminal.getSelection().then((selection) => new Blob([selection], { type: 'text/plain' }));
      void navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })])
        .catch((error: unknown) => this.reportError(error));
    } else if (this.selection) {
      const input = document.createElement('textarea');
      input.value = this.selection;
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      const focused = document.activeElement as HTMLElement | null;
      document.body.append(input);
      try {
        input.select();
        document.execCommand('copy');
      } finally {
        input.remove();
        focused?.focus();
      }
    }
  }

  private setupTouchScrolling(container: HTMLElement): void {
    let previousY: number | null = null;
    let distance = 0;
    let remainder = 0;
    const start = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || (event.target as Element).closest('a')) return;
      previousY = event.clientY;
      distance = 0;
      remainder = 0;
      container.setPointerCapture?.(event.pointerId);
      event.stopPropagation();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || previousY === null) return;
      const height = container.clientHeight / this.rows || 20;
      distance += Math.abs(previousY - event.clientY);
      remainder += (previousY - event.clientY) / height;
      previousY = event.clientY;
      const lines = Math.trunc(remainder);
      if (lines) {
        this.terminal?.scrollLines(lines);
        remainder -= lines;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const end = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || previousY === null) return;
      previousY = null;
      if (event.type === 'pointerup' && distance < 10) this.focus();
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId);
      event.stopPropagation();
    };
    const previousTouchAction = container.style.touchAction;
    container.style.touchAction = 'none';
    container.addEventListener('pointerdown', start, true);
    container.addEventListener('pointermove', move, true);
    container.addEventListener('pointerup', end, true);
    container.addEventListener('pointercancel', end, true);
    this.cleanups.push(() => {
      container.style.touchAction = previousTouchAction;
      container.removeEventListener('pointerdown', start, true);
      container.removeEventListener('pointermove', move, true);
      container.removeEventListener('pointerup', end, true);
      container.removeEventListener('pointercancel', end, true);
    });
  }

  private toTheme(theme: Theme): TerminalTheme {
    const { selection, ...colors } = theme.colors;
    return { ...colors, selectionBackground: selection };
  }

  /** Fits the grid to the host. */
  fit(): void { this.terminal?.fit(); }
  /** Queues output without awaiting a frame. */
  write(text: string): void { this.terminal?.write(text); }
  /** Resolves after output has been parsed and rendered. */
  writeAsync(text: string): Promise<void> { return this.terminal?.writeAsync(text) ?? Promise.resolve(); }
  /** Writes output with normalized terminal line endings. */
  writeln(text: string): void { this.write(text.replace(/\r?\n/g, '\r\n') + '\r\n'); }
  /** Clears the screen while retaining scrollback and terminal modes. */
  clear(): void { this.write('\x1b[2J\x1b[H'); }
  /** Focuses native input, including the mobile keyboard. */
  focus(): void { this.terminal?.focus(); }
  /** Registers keyboard and composed-text input. */
  onData(handler: (data: string) => void): void { this.dataHandler = handler; }
  /** Registers paste text separately from keys and control sequences. */
  onPaste(handler: (text: string) => void): void { this.pasteHandler = handler; }
  /** Registers grid resize notifications. */
  onResize(handler: (cols: number, rows: number) => void): void { this.resizeHandler = handler; }
  /** Registers asynchronous renderer and browser errors. */
  onError(handler: (error: Error) => void): void { this.errorHandler = handler; }
  /** Grid width, or 80 before initialization. */
  get cols(): number { return this.terminal?.geometry.cols ?? 80; }
  /** Grid height, or 24 before initialization. */
  get rows(): number { return this.terminal?.geometry.rows ?? 24; }

  /** Enables or disables visible HTTP(S) link overlays. */
  setLinkDetection(enabled: boolean): void {
    this.linksEnabled = enabled;
    if (!enabled) {
      this.links?.dispose();
      this.links = null;
    } else if (this.terminal && !this.links) {
      this.links = new WebLinksAddon({ requireModifier: true });
      // Adapter ownership avoids retaining disposed instances after repeated toggles.
      this.links.activate(this.terminal);
    }
  }

  /** Applies colors in order without clearing or recreating the terminal. */
  setTheme(theme: Theme): Promise<void> {
    const change = this.themeQueue.then(async () => {
      if (this.disposed) throw new Error('Terminal adapter is disposed');
      if (this.initialization) await this.initialization;
      await this.terminal?.setTheme(this.toTheme(theme));
      if (this.disposed) throw new Error('Terminal adapter is disposed');
      this.currentTheme = theme;
    });
    this.themeQueue = change.catch(() => {});
    return change;
  }
  /** Last successfully applied application theme. */
  getTheme(): Theme | null { return this.currentTheme; }

  /** Idempotently releases addons, handlers, workers, rendering, and terminal DOM. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.selectionRevision;
    this.links?.dispose();
    this.links = null;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.terminal?.dispose();
    this.terminal = null;
    this.decoder.decode();
    this.dataHandler = undefined;
    this.pasteHandler = undefined;
    this.resizeHandler = undefined;
    this.errorHandler = undefined;
  }
}
