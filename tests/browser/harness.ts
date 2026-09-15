import { DuckDBTerminal, type QueryResult } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';
import type { BrowserTerminal } from '@gespenst/core';

const terminal = new DuckDBTerminal({ container: '#terminal', welcomeMessage: false, maxDisplayRows: 20, enableCharts: true });
const events: Array<{ sql: string; result: QueryResult | null; error?: string }> = [];
const errors: string[] = [];
terminal.on('queryEnd', (event) => events.push(event));
terminal.on('error', ({ message }) => errors.push(message));
const internals = terminal as unknown as {
  terminalAdapter: { terminal: BrowserTerminal };
  inputBuffer: { getContent(): string; getCursorPos(): number };
  state: string;
};
export const fixture = {
  terminal, events, errors, ready: false, failure: '',
  get native() { return internals.terminalAdapter.terminal; },
  get input() { return internals.inputBuffer.getContent(); },
  get cursor() { return internals.inputBuffer.getCursorPos(); },
  get state() { return internals.state; },
  async text() {
    await fixture.native.writeAsync('');
    const buffer = await fixture.native.readBuffer({ start: 0, end: 10000 });
    return buffer.rows.map((row) => row.text).join('\n');
  },
};
declare global { interface Window { fixture: typeof fixture; workerStatus: Array<{ name: string; ready: boolean; error: string }> } }
window.fixture = fixture;
void terminal.start().then(() => { fixture.ready = true; }).catch((error) => { fixture.failure = String(error); });
