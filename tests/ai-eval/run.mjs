#!/usr/bin/env node
// Evaluates the `.ai` assistant with a real model in Chromium (WebGPU).
//
//   pnpm run eval:ai -- --model qwen3.5-0.8b --variants baseline,all --repeat 2
//
// Options:
//   --model <id>         model from src/ai/models.ts (default qwen3.5-0.8b)
//   --variants <a,b>     tuning variants below (default: all of them)
//   --tasks <a,b>        task ids from tasks.mjs (default: all)
//   --repeat <n>         runs per task and variant (default 2)
//   --timeout <seconds>  per run before Ctrl+C (default 180)
//   --max-steps <n>      model turns per question for every variant (default: the variant's)
//   --profile <dir>      browser profile; keeps the model cache (default .ai-eval/profile)
//
// Needs the browser-test fixture (pnpm run build && pnpm run build:browser-tests),
// network access for the first model download, and a GPU for usable speed.
// Results: .ai-eval/results/<model>-<time>.jsonl, one line per run, and a summary.
//
// The runner drives the terminal through internals (loadFile, database,
// getAssistant, setTuning, messages, turnTimings); keep it in sync when those change.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { OUTPUT_FILES, SETUP_SQL, TABLES, readDataFiles } from './dataset.mjs';
import { TASKS, WEB } from './tasks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4175;
const FIXTURE_URL = `http://127.0.0.1:${PORT}/nested/`;

// Mirrors BASELINE_TUNING in src/ai/tuning.ts; each variant adds one group of changes.
const BASELINE = {
  thinking: true, temperature: null, presencePenalty: 0, prompt: 'detailed',
  sampleRows: 0, distinctValues: false, describeUrls: false, guardrails: false, errorDocs: false, docsContext: false, maxSteps: 8,
};
const SAMPLING = { ...BASELINE, temperature: 0.6, presencePenalty: 1.5 };
const DATA = { ...SAMPLING, sampleRows: 3, distinctValues: true, describeUrls: true };
const GUARDED = { ...DATA, guardrails: true, errorDocs: true };
const ALL = { ...GUARDED, prompt: 'procedural' };
export const VARIANTS = {
  baseline: BASELINE,
  sampling: SAMPLING,
  data: DATA,
  guarded: GUARDED,
  all: ALL,
  'all-no-thinking': { ...ALL, thinking: false },
  guided: { ...ALL, prompt: 'guided' },
  'guided-no-thinking': { ...ALL, prompt: 'guided', thinking: false },
  'guided-12-steps': { ...ALL, prompt: 'guided', maxSteps: 12 },
  'guided-16-steps': { ...ALL, prompt: 'guided', maxSteps: 16 },
  // Mirrors DEFAULT_TUNING in src/ai/tuning.ts.
  default: { ...ALL, prompt: 'guided', maxSteps: 20 },
  'default-docs': { ...ALL, prompt: 'guided', maxSteps: 20, docsContext: true },
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const modelId = option('model', 'qwen3.5-0.8b');
const variantNames = option('variants', Object.keys(VARIANTS).join(',')).split(',');
const taskIds = option('tasks', TASKS.map((task) => task.id).join(',')).split(',');
const repeat = Number(option('repeat', '2'));
const timeoutMs = Number(option('timeout', '180')) * 1000;
const maxSteps = option('max-steps', null);
if (maxSteps !== null) for (const tuning of Object.values(VARIANTS)) tuning.maxSteps = Number(maxSteps);
const profile = resolve(root, option('profile', '.ai-eval/profile'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const output = resolve(root, '.ai-eval/results', `${modelId}-${stamp}.jsonl`);

for (const name of variantNames) if (!VARIANTS[name]) throw new Error(`Unknown variant: ${name}`);
const tasks = taskIds.map((id) => TASKS.find((task) => task.id === id) ?? (() => { throw new Error(`Unknown task: ${id}`); })());
if (!existsSync(resolve(root, '.browser-test-dist/index.html'))) {
  throw new Error('Build the fixture first: pnpm run build && pnpm run build:browser-tests');
}
mkdirSync(dirname(output), { recursive: true });

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

async function startPreview() {
  const child = spawn('pnpm', [
    '--filter', '@duckdb-terminal/website', 'exec', 'vite', 'preview',
    '--config', '../../tests/browser/vite.config.mts', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
  ], { cwd: root, detached: true, stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(FIXTURE_URL)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('The fixture preview did not start');
}

/**
 * Serves data/remote at https://data.example.com/ (WEB), as a web server that
 * lets browsers read files would: with CORS headers and range requests, which
 * DuckDB uses for Parquet files and attached databases. Gzipped files are
 * served unpacked, without the .gz.
 */
async function serveRemoteFiles(context) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'data/remote');
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = `/${relative(dir, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/')}`;
    const body = readFileSync(resolve(entry.parentPath, entry.name));
    if (path.endsWith('.gz')) files.set(path.slice(0, -3), gunzipSync(body));
    else files.set(path, body);
  }
  const cors = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  };
  await context.route((url) => url.origin === WEB, (route) => {
    const request = route.request();
    const body = files.get(new URL(request.url()).pathname);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!body) return route.fulfill({ status: 404, headers: cors, body: 'Not found' });
    if (request.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' } });
    }
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers().range ?? '');
    if (!range) return route.fulfill({ status: 200, headers: { ...cors, 'Accept-Ranges': 'bytes' }, body });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({
      status: 206,
      headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes' },
      body: body.subarray(start, end + 1),
    });
  });
}

/** Console errors (wllama logs worker crashes there), collected per run. */
const consoleErrors = [];

/**
 * Installed in the page: turns a QueryResult into display strings
 * (timestamps as ISO text, lists and structs as JSON).
 */
function installFormatter() {
  const format = (value, type) => {
    if (value === null || value === undefined) return 'NULL';
    const kind = String(type ?? '').toLowerCase();
    try {
      if (typeof value === 'number' && (kind.includes('timestamp') || kind.startsWith('date'))) {
        const ms = Math.abs(value) > 1e14 ? value / 1000 : value;
        return new Date(ms).toISOString().replace('T', ' ').replace(/(\.000)?Z$/, '');
      }
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString().replace('T', ' ').replace(/(\.000)?Z$/, '');
      const json = (v) => JSON.stringify(v, (_k, inner) => (typeof inner === 'bigint' ? inner.toString() : inner));
      // HUGEINT (sum of integers) is an Arrow big number, whose toJSON() quotes it.
      if (ArrayBuffer.isView(value) && typeof value[Symbol.toPrimitive] === 'function') return String(value);
      if (typeof value?.toJSON === 'function') {
        const plain = value.toJSON();
        return typeof plain === 'string' ? plain : json(plain);
      }
      if (typeof value === 'object') return json(value);
    } catch {
      // fall through
    }
    return String(value);
  };
  window.__evalRows = (result) => (result?.rows ?? []).map((row) => row.map((value, index) => format(value, result.columnTypes?.[index])));
}

/** Runs one task in the page and returns what happened. */
async function runTask(page, task, tuning, label) {
  consoleErrors.length = 0;
  const marker = `### eval ${label} ${Date.now()}`;
  const raw = await page.evaluate(async ({ prompts, tuning, timeoutMs, setupSql, tables, outputFiles, reference, verify, marker }) => {
    const { fixture } = window;
    const terminal = fixture.terminal;
    const database = terminal.database;
    const assistant = terminal.getAssistant();
    const detachAll = async () => {
      const attached = await database.executeQuery(
        'SELECT database_name FROM duckdb_databases() WHERE NOT internal AND database_name <> current_database()'
      );
      for (const [name] of attached.rows) await database.executeQuery(`DETACH "${name}"`);
    };
    // Restore the data and remove what earlier tasks created, without terminal output.
    await detachAll();
    const created = await database.executeQuery(
      'SELECT table_name FROM duckdb_tables() WHERE database_name = current_database() AND NOT internal'
    );
    for (const [name] of created.rows) {
      if (!tables.includes(name)) await database.executeQuery(`DROP TABLE IF EXISTS "${String(name).replace(/"/g, '""')}"`);
    }
    for (const sql of setupSql) await database.executeQuery(sql);
    for (const file of outputFiles) await database.dropFile(file).catch(() => {});
    let referenceResult = null;
    for (const sql of [reference].flat()) referenceResult = await database.executeQuery(sql);
    const expected = window.__evalRows(referenceResult);
    await detachAll();
    assistant.resetConversation();
    assistant.setTuning(tuning);
    terminal.writeln(marker);
    const eventStart = fixture.events.length;
    const started = performance.now();
    let timedOut = false;
    // Follow-up questions run in one conversation, each with the full time limit.
    for (const prompt of prompts) {
      const timer = setTimeout(() => { timedOut = true; terminal.handleInput('\x03'); }, timeoutMs);
      try {
        await terminal.runCommand(`.ai ${prompt}`);
      } finally {
        clearTimeout(timer);
      }
      if (timedOut) break;
    }
    const durationMs = performance.now() - started;
    let verified = null;
    if (verify) {
      try {
        verified = window.__evalRows(await database.executeQuery(verify));
      } catch {
        verified = null;
      }
    }

    const queries = fixture.events.slice(eventStart).map((event) => ({
      sql: event.sql,
      ok: Boolean(event.result) && !event.error,
      error: event.error ?? null,
      columns: event.result?.columns ?? [],
      rows: window.__evalRows(event.result),
    }));
    const messages = assistant.messages;
    const turnTimings = assistant.turnTimings;
    const last = messages.at(-1);
    const finalAnswer = last?.role === 'assistant' && typeof last.content === 'string' ? last.content : '';
    const text = await fixture.text();
    const transcript = text.slice(text.lastIndexOf(marker) + marker.length);
    // A compact trace of the conversation: who spoke, which tools were called.
    const trace = messages.map((message) => message.role === 'assistant' && message.tool_calls
      ? `assistant -> ${message.tool_calls.map((call) => `${call.function.name}(${call.function.arguments.slice(0, 160)})`).join(', ')}`
      : `${message.role}: ${String(message.content ?? '').slice(0, 160).replace(/\n/g, ' ')}`);
    return {
      answer: finalAnswer, durationMs, timedOut, queries, transcript, trace, expected, verified, turnTimings,
      steps: messages.filter((m) => m.role === 'assistant').length,
    };
  }, {
    prompts: task.prompts ?? [task.prompt], tuning, timeoutMs, setupSql: SETUP_SQL, tables: TABLES, outputFiles: OUTPUT_FILES,
    reference: task.reference, verify: task.verify ?? null, marker,
  });

  const failureLine = raw.transcript.split('\n').reverse()
    .find((line) => /did not finish|empty response|token limit|Error:|Stopped\.|not installed|unavailable/.test(line)) ?? '';
  const run = {
    outcome: raw.timedOut ? 'timeout' : raw.answer ? 'answered' : 'failed',
    answer: raw.answer,
    failure: raw.answer ? '' : failureLine.trim(),
    queries: raw.queries,
    docsSearches: (raw.transcript.match(/Searching the DuckDB docs/g) ?? []).length,
    errorLookups: (raw.transcript.match(/Looked up "/g) ?? []).length,
    questionDocs: /Looked up the DuckDB docs for your question/.test(raw.transcript),
    skippedSearches: (raw.transcript.match(/Skipped a docs search/g) ?? []).length,
    nudges: (raw.transcript.match(/asking the model to run/g) ?? []).length,
    durationMs: Math.round(raw.durationMs),
    steps: raw.steps,
    trace: raw.trace,
    turnTimings: raw.turnTimings ?? [],
    transcript: raw.transcript.slice(-4000),
    consoleErrors: consoleErrors.slice(0, 5),
  };
  // Changes are judged by what was created, even if the model did not answer afterwards.
  const verdict = run.outcome === 'answered' || task.verify
    ? task.check(run, raw.expected, raw.verified)
    : { pass: false, reason: run.outcome };
  return { ...run, pass: verdict.pass, reason: verdict.reason };
}

async function main() {
  // Runs take hours; an idle Mac would sleep and stall them.
  if (process.platform === 'darwin') {
    spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref();
  }
  const preview = await startPreview();
  // Stop the preview server on Ctrl+C too; it would keep the port busy.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      try { process.kill(-preview.pid); } catch { /* already gone */ }
      process.exit(130);
    });
  }
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
  try {
    // Serve DuckDB-Wasm and wllama from node_modules; models and extensions come from the network.
    const duckdbDist = resolve(root, 'packages/duckdb-terminal/node_modules/@duckdb/duckdb-wasm/dist');
    const wllamaEsm = resolve(root, 'packages/duckdb-terminal/node_modules/@wllama/wllama/esm');
    await context.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@duckdb\/duckdb-wasm@[^/]+\/dist\/[^/?]+/, (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({ path: resolve(duckdbDist, name), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await context.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@wllama\/wllama@[^/]+\/esm\//, (route) => {
      const file = new URL(route.request().url()).pathname.replace(/^.*\/esm\//, '');
      return route.fulfill({ path: resolve(wllamaEsm, file), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
    });

    await serveRemoteFiles(context);
    await context.addInitScript(installFormatter);
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', (error) => log('page error:', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
    });
    await page.goto(FIXTURE_URL);
    await page.waitForFunction(() => window.fixture?.ready || window.fixture?.failure, null, { timeout: 120_000 });
    const failure = await page.evaluate(() => window.fixture.failure);
    if (failure) throw new Error(`Terminal failed to start: ${failure}`);
    log(`WebGPU: ${await page.evaluate(() => 'gpu' in navigator)}`);

    log(`Preparing ${modelId}…`);
    await page.evaluate(async (id) => {
      const assistant = window.fixture.terminal.getAssistant();
      const status = (await assistant.getModelStatuses()).find((entry) => entry.model.id === id);
      if (!status) throw new Error(`Unknown model ${id}`);
      if (!status.installed) await assistant.install(status.model);
      assistant.selectModel(status.model);
    }, modelId);
    await page.evaluate(async (files) => {
      const terminal = window.fixture.terminal;
      for (const { name, text } of files) await terminal.loadFile(new File([text], name, { type: 'text/csv' }));
    }, readDataFiles());
    log(`Running ${tasks.length} tasks × ${variantNames.length} variants × ${repeat} → ${output}`);

    const results = [];
    // Variants alternate per task, so a slowdown or a crash affects them alike.
    for (let attempt = 1; attempt <= repeat; attempt++) {
      for (const task of tasks) {
        for (const variant of variantNames) {
          const label = `${variant}/${task.id}#${attempt}`;
          const run = await runTask(page, task, VARIANTS[variant], label);
          const record = { model: modelId, variant, maxSteps: VARIANTS[variant].maxSteps, task: task.id, attempt, ...run };
          results.push(record);
          appendFileSync(output, `${JSON.stringify(record)}\n`);
          log(`${run.pass ? 'PASS' : 'FAIL'} ${label} ${(run.durationMs / 1000).toFixed(0)}s, ${run.queries.length} queries` +
            `${run.docsSearches ? `, ${run.docsSearches} docs` : ''}${run.questionDocs ? ', docs sent' : ''}` +
            `${run.skippedSearches ? `, ${run.skippedSearches} searches skipped` : ''}${run.nudges ? ', nudged' : ''}` +
            `${run.pass ? '' : ` (${run.failure || run.reason})`}` +
            `${run.consoleErrors.length ? ` [console: ${run.consoleErrors[0].slice(0, 160)}]` : ''}`);
        }
      }
    }
    printSummary(results);
  } finally {
    await context.close();
    try { process.kill(-preview.pid); } catch { /* already gone */ }
  }
}

function printSummary(results) {
  const by = (key) => Object.groupBy(results, (record) => record[key]);
  const rate = (records) => `${records.filter((record) => record.pass).length}/${records.length}`;
  const seconds = (records) => (records.reduce((sum, record) => sum + record.durationMs, 0) / records.length / 1000).toFixed(0);
  console.log(`\n## ${modelId}\n\n| Variant | Passed | Avg time | Failed or timed out |\n|---|---|---|---|`);
  for (const [variant, records] of Object.entries(by('variant'))) {
    const broken = records.filter((record) => record.outcome !== 'answered').length;
    console.log(`| ${variant} | ${rate(records)} | ${seconds(records)}s | ${broken} |`);
  }
  const variants = Object.keys(by('variant'));
  console.log(`\n| Task | ${variants.join(' | ')} |\n|---|${variants.map(() => '---').join('|')}|`);
  for (const [task, records] of Object.entries(by('task'))) {
    console.log(`| ${task} | ${variants.map((variant) => rate(records.filter((record) => record.variant === variant))).join(' | ')} |`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
