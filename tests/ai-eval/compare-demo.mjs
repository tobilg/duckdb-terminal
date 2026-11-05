#!/usr/bin/env node
// Runs the evaluation tasks against the duckdb-wasm-shell-wllama demo
// (https://thomas-0816.github.io/duckdb-wasm-shell-wllama/), with the same data
// and checks as run.mjs, to compare its assistant with ours.
//
//   node tests/ai-eval/compare-demo.mjs --model qwen3.5-0.8b --repeat 2
//
// Options: --model <demo model key>, --tasks <a,b>, --repeat <n> (default 2),
// --timeout <seconds> (default 300), --url <demo URL>.
//
// The demo has no schema context: like a user who imported the files and
// created the tables, its shell shows the import lines and CREATE TABLE
// statements, which the demo sends with each prompt. Reference results come
// from the DuckDB CLI on the same CSV files. The demo drives the shell through
// its own test hooks (window.__app, __chat, __shell); keep in sync if it changes.
//
// The demo's runQuery gives up on a statement after 120 s without interrupting
// it, so the shell stays busy until someone presses Ctrl+C. Within a task that
// is the demo's real behavior and is recorded (shellStuck); between tasks the
// runner presses Ctrl+C, reloads the page if that does not help, and aborts
// when setup fails, so one runaway query cannot spoil the rest of the run.
// Likewise, wllama can run out of memory after long tasks (std::bad_alloc) and
// then fails every request: the runner counts that as a crash, reloads the
// demo, and repeats the task once.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DATA_FILES, OUTPUT_FILES, SETUP_SQL, readDataFiles } from './dataset.mjs';
import { TASKS } from './tasks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const modelKey = option('model', 'qwen3.5-0.8b');
const taskIds = option('tasks', TASKS.map((task) => task.id).join(',')).split(',');
const repeat = Number(option('repeat', '2'));
const timeoutMs = Number(option('timeout', '300')) * 1000;
const demoUrl = option('url', 'https://thomas-0816.github.io/duckdb-wasm-shell-wllama/');
const profile = resolve(root, '.ai-eval/demo-profile');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const output = resolve(root, '.ai-eval/results', `demo-${modelKey}-${stamp}.jsonl`);
const tasks = taskIds.map((id) => TASKS.find((task) => task.id === id) ?? (() => { throw new Error(`Unknown task: ${id}`); })());
mkdirSync(dirname(output), { recursive: true });

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

// --- Reference results from the DuckDB CLI ---------------------------------

const referenceDb = resolve(root, '.ai-eval/demo-reference.duckdb');
const dataDir = resolve(here, 'data');

function duckdb(sql) {
  const run = spawnSync('duckdb', ['-init', '/dev/null', '-no-agent', '-json', referenceDb, '-c', sql], { cwd: dataDir, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`duckdb failed: ${run.stderr || run.stdout}`);
  return run.stdout;
}

function referenceRows(sql) {
  const text = duckdb(sql).trim();
  if (!text) return [];
  return JSON.parse(text).map((row) => Object.values(row).map((value) => {
    if (value === null) return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }));
}

rmSync(referenceDb, { force: true });
duckdb(SETUP_SQL.join(';\n'));
if (process.argv.includes('--references')) {
  for (const task of tasks) console.log(task.id, JSON.stringify(referenceRows(task.reference)).slice(0, 300));
  process.exit(0);
}

// --- Demo results ------------------------------------------------------------

/** Cells of a duckbox table (the demo's result format); [] for anything else. */
function duckboxRows(text) {
  const lines = String(text).split('\n');
  const separator = lines.findIndex((line) => line.startsWith('├'));
  if (separator === -1) return [];
  return lines.slice(separator + 1)
    .filter((line) => line.startsWith('│'))
    .map((line) => line.slice(1, -1).split('│').map((cell) => cell.trim()));
}

const SHELL_BUSY = 'DuckDB shell is busy.';
const QUERY_TIMED_OUT = 'Query timed out.';

/** Opens the demo with the model loaded and the data files registered. */
async function openDemo(page, { reload = false } = {}) {
  if (reload) await page.reload();
  else await page.goto(demoUrl);
  await page.waitForFunction(() => window.__app && window.__shell?.ready, null, { timeout: 120_000 });
  // The demo loads its default model on start; switch if another one is wanted.
  await page.waitForFunction(() => window.__chat && !window.__chat.loading, null, { timeout: 120_000 });
  if (await page.evaluate((key) => window.__chat.modelKey !== key || !window.__chat.modelLoaded, modelKey)) {
    await page.evaluate((key) => window.__app.loadModel(key), modelKey);
  }
  await page.waitForFunction(() => window.__chat.modelLoaded, null, { timeout: 1_800_000 });
  for (const { name, text } of readDataFiles()) {
    await page.evaluate(({ name, text }) => window.__shell.sendToWorkerAsync('register_file', {
      fileName: name, buffer: new TextEncoder().encode(text),
    }), { name, text });
  }
}

/** Interrupts a statement still running (Ctrl+C); true once the shell is at an empty prompt. */
function interruptShell(page) {
  return page.evaluate(async () => {
    const shell = window.__shell;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await shell.waitForPrompt(true, attempt === 0 ? 1_000 : 15_000)) return true;
      shell.handleData('\x03');
    }
    return shell.waitForPrompt(true, 15_000);
  });
}

/** Brings the shell back to an idle prompt, reloading the demo if Ctrl+C does not. */
async function resetShell(page) {
  if (await interruptShell(page)) return;
  log('Shell still busy after Ctrl+C; reloading the demo');
  await openDemo(page, { reload: true });
  if (!(await interruptShell(page))) throw new Error('The demo shell stays busy after a reload; aborting.');
}

/** Starts a task from fresh tables; throws when setup fails, since every result after it would be void. */
async function prepareTask(page) {
  await resetShell(page);
  const failures = await page.evaluate(async ({ setupSql, outputFiles, dataFiles }) => {
    const { __app: app, __chat: chat, __shell: shell } = window;
    chat.newChat();
    for (const file of outputFiles) await shell.sendToWorkerAsync('drop_file', { fileName: file }).catch(() => {});
    shell.clearScreen();
    // What the shell shows after importing the files and creating the tables.
    for (const file of dataFiles) shell.term.write(`Registered: ${file}\r\n`);
    shell.term.write(`Query it with: SELECT * FROM '${dataFiles[0]}' LIMIT 10;\r\n`);
    shell.flushPending?.();
    const failed = [];
    for (const sql of [...setupSql, 'SELECT count(*) FROM orders']) {
      const result = await app.runQuery(sql);
      if (!result.ok) failed.push(`${sql}: ${result.error}`);
    }
    return failed;
  }, { setupSql: SETUP_SQL, outputFiles: OUTPUT_FILES, dataFiles: DATA_FILES });
  if (failures.length) throw new Error(`Setup failed in the demo; aborting:\n${failures.join('\n')}`);
}

/**
 * The model failed before producing a single turn, e.g. wllama after running
 * out of memory. Reasoning past the demo's output limit also leaves no turn,
 * but that is the model's failure and is graded as such.
 */
function modelFailed(run) {
  return run.outcome === 'failed' && run.steps === 0 && !/token limit/i.test(run.failure);
}

async function runTask(page, task) {
  await prepareTask(page);
  const raw = await page.evaluate(async ({ prompt, timeoutMs }) => {
    const { __app: app, __chat: chat } = window;
    const started = performance.now();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; chat.stop(); }, timeoutMs);
    try {
      await app.ask(prompt);
    } finally {
      clearTimeout(timer);
    }
    const durationMs = performance.now() - started;

    const messages = chat.messages.slice(1);
    const calls = new Map();
    const queries = [];
    let docsSearches = 0;
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) calls.set(call.id, call);
      if (message.role !== 'tool') continue;
      const call = calls.get(message.tool_call_id);
      if (call?.function?.name === 'help') { docsSearches++; continue; }
      const content = String(message.content ?? '');
      const sql = content.startsWith('SQL: ') ? content.slice(5, content.indexOf('\n\n') === -1 ? undefined : content.indexOf('\n\n')) : '';
      queries.push({ sql, ok: !/\n\nError: /.test(content), text: content.slice(content.indexOf('\n\n') + 2) });
    }
    const last = messages.at(-1);
    const answer = last?.role === 'assistant' && !last.tool_calls?.length ? String(last.content ?? '') : '';
    const errors = [...document.querySelectorAll('.msg-error .msg-body')].map((node) => node.textContent.trim());
    return { answer, queries, docsSearches, durationMs, timedOut, errors, steps: messages.filter((message) => message.role === 'assistant').length };
  }, { prompt: task.prompt, timeoutMs });

  // A busy shell before any statement timed out means the runner, not the
  // model, broke the shell: stop instead of recording void results.
  const errorsOf = (query) => (query.ok ? '' : query.text);
  const firstTimeout = raw.queries.findIndex((query) => errorsOf(query).includes(QUERY_TIMED_OUT));
  const firstBusy = raw.queries.findIndex((query) => errorsOf(query).includes(SHELL_BUSY));
  if (firstBusy !== -1 && (firstTimeout === -1 || firstBusy < firstTimeout)) {
    throw new Error(`The shell was busy before any of the model's statements timed out (${task.id}); aborting.`);
  }

  let verified = null;
  if (task.verify) {
    await resetShell(page);
    const result = await page.evaluate((sql) => window.__app.runQuery(sql), task.verify);
    if (result.ok) verified = duckboxRows(result.markdown);
  }
  const run = {
    answer: raw.answer,
    outcome: raw.timedOut ? 'timeout' : raw.answer.trim() ? 'answered' : 'failed',
    failure: raw.timedOut ? 'Stopped.' : raw.answer.trim() ? '' : (raw.errors.at(-1) ?? 'no answer'),
    queries: raw.queries.map((query) => ({ sql: query.sql, ok: query.ok, rows: query.ok ? duckboxRows(query.text) : [], text: query.text })),
    docsSearches: raw.docsSearches,
    durationMs: Math.round(raw.durationMs),
    steps: raw.steps,
    // A statement ran past the demo's 120 s limit and blocked the shell for the rest of the task.
    shellStuck: firstTimeout !== -1,
  };
  const reference = referenceRows(task.reference);
  const verdict = run.outcome === 'answered' || task.verify
    ? task.check(run, reference, verified)
    : { pass: false, reason: run.outcome };
  return { ...run, pass: verdict.pass, reason: verdict.reason };
}

async function main() {
  if (process.platform === 'darwin') {
    spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref();
  }
  // A 14" laptop screen. The demo's results come from its terminal, and at the
  // default 1280×720 (89 columns) DuckDB hides middle columns such as status.
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', args: ['--enable-unsafe-webgpu'], viewport: { width: 1512, height: 982 },
  });
  const consoleErrors = [];
  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await openDemo(page);
    log(`Demo ready with ${modelKey}`);

    log(`Running ${tasks.length} tasks × ${repeat} → ${output}`);
    const results = [];
    let crashes = 0;
    for (let attempt = 1; attempt <= repeat; attempt++) {
      for (const task of tasks) {
        consoleErrors.length = 0;
        let run = await runTask(page, task);
        let crashed = false;
        if (modelFailed(run)) {
          crashed = true;
          crashes++;
          log(`Model failed before its first turn (${run.failure}; ${consoleErrors.slice(0, 2).join(', ')}); reloading the demo and repeating ${task.id}`);
          await openDemo(page, { reload: true });
          consoleErrors.length = 0;
          run = await runTask(page, task);
          if (modelFailed(run)) throw new Error(`The model still fails after a reload (${run.failure}); aborting.`);
        }
        const record = {
          model: modelKey, variant: 'demo', task: task.id, attempt, ...run, crashedBefore: crashed, consoleErrors: consoleErrors.slice(0, 5),
        };
        results.push(record);
        appendFileSync(output, `${JSON.stringify(record)}\n`);
        const succeeded = run.queries.filter((query) => query.ok).length;
        log(`${run.pass ? 'PASS' : 'FAIL'} demo/${task.id}#${attempt} ${(run.durationMs / 1000).toFixed(0)}s, ` +
          `${succeeded}/${run.queries.length} queries ok${run.docsSearches ? `, ${run.docsSearches} docs` : ''}` +
          `${run.shellStuck ? ', shell stuck' : ''}${run.pass ? '' : ` (${run.failure || run.reason})`}`);
      }
    }
    const passed = results.filter((record) => record.pass).length;
    console.log(`\n## demo, ${modelKey}: ${passed}/${results.length} passed, ` +
      `${(results.reduce((sum, record) => sum + record.durationMs, 0) / results.length / 1000).toFixed(0)}s on average, ` +
      `${crashes} model crash${crashes === 1 ? '' : 'es'} (page reloaded)\n`);
    for (const task of tasks) {
      const records = results.filter((record) => record.task === task.id);
      console.log(`| ${task.id} | ${records.filter((record) => record.pass).length}/${records.length} |`);
    }
  } finally {
    await context.close();
  }
}


main().catch((error) => {
  console.error(error);
  process.exit(1);
});
