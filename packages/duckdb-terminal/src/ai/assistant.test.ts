import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createWllamaMock,
  contentChunk,
  docsCallChunk,
  finishChunk,
  never,
  reasoningChunk,
  toolCallChunk,
} from '../../test/wllama-mock';
import { AIAssistant, AssistantError, IOS_UNAVAILABLE_MESSAGE, SELECTED_MODEL_STORAGE_KEY, type AssistantHost } from './assistant';
import type { DocsChunk } from './docs-search';
import { REPEAT_ANSWER_REQUEST } from './guardrails';
import { AI_MODELS, getModelUrl } from './models';
import { GUIDED_SYSTEM_PROMPT, MAX_TOOL_ITERATIONS, SCHEMA_CONTEXT_OPEN, SYSTEM_PROMPT } from './prompt';
import { BASELINE_TUNING, DEFAULT_TUNING } from './tuning';

const [small, , medium] = AI_MODELS;

const PIVOT_DOCS: DocsChunk[] = [{
  path: 'SQL › Statements › PIVOT Statement',
  url: 'https://duckdb.org/docs/2.0/sql/statements/pivot',
  text: 'PIVOT table ON column USING sum(value);',
}];

const COMPAT_URLS = { worker: 'https://cdn.test/compat/wllama.js', wasm: 'https://cdn.test/compat/wllama.wasm' };

function setup(options: { gpu?: boolean; compat?: boolean; ios?: boolean; schema?: string } = {}) {
  const wllama = createWllamaMock();
  const writes: string[] = [];
  const store = new Map<string, string>();
  const host: AssistantHost & { runQuery: ReturnType<typeof vi.fn>; getSchema: ReturnType<typeof vi.fn> } = {
    write: (text) => writes.push(text),
    getSchema: vi.fn(async () => options.schema ?? ''),
    runQuery: vi.fn(async (sql: string) => ({ ok: true, result: `SQL: ${sql}\n\ncount\n3` })),
  };
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const searchDocs = vi.fn(async (_query: string): Promise<DocsChunk[]> => PIVOT_DOCS);
  const create = () => new AIAssistant(host, {
    loadWllama: async () => wllama.module,
    wasmUrl: 'https://cdn.test/wllama.wasm',
    storage,
    hasWebGPU: () => options.gpu ?? true,
    needsCompatBuild: () => options.compat ?? false,
    isIOS: () => options.ios ?? false,
    compatUrls: COMPAT_URLS,
    searchDocs,
  });
  const output = () => writes.join('').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  return { wllama, host, store, create, output, searchDocs };
}

/** Installs and selects a model, ready for `ask`. */
function ready(context: ReturnType<typeof setup>, model = small) {
  context.wllama.state.cachedUrls.add(getModelUrl(model));
  const assistant = context.create();
  assistant.selectModel(model);
  return assistant;
}

describe('AIAssistant model management', () => {
  it('reports installed models, ignoring interrupted downloads', async () => {
    const context = setup();
    context.wllama.state.cachedUrls.add(getModelUrl(small));
    context.wllama.state.cachedUrls.add(getModelUrl(medium));
    context.wllama.state.invalidUrls.add(getModelUrl(medium));

    const statuses = await context.create().getModelStatuses();

    expect(statuses.map(({ model, installed }) => [model.id, installed])).toEqual([
      ['qwen3.5-0.8b', true], ['minicpm5-1b', false], ['qwen3.5-2b', false], ['qwen3.5-4b', false],
    ]);
  });

  it('downloads a model with progress, using its size when the total is unknown', async () => {
    const context = setup();
    const progress: Array<[number, number]> = [];
    const controller = new AbortController();

    await context.create().install(small, { signal: controller.signal, onProgress: (...args) => progress.push(args) });

    expect(context.wllama.state.downloads).toEqual([getModelUrl(small)]);
    expect(progress).toEqual([[0, small.sizeBytes], [50, 100], [100, 100]]);
  });

  it('explains when the browser cannot cache models', async () => {
    const context = setup();
    context.wllama.state.constructorError = new Error('No supported storage backend found');
    await expect(context.create().getModelStatuses()).rejects.toThrow(/cannot cache models/);
  });

  describe('GPU or CPU by browser', () => {
    const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0';
    const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Safari/537.36';
    const browser = (navigator: object) => {
      vi.stubGlobal('navigator', navigator);
      const context = setup();
      return new AIAssistant(context.host, { loadWllama: async () => context.wllama.module, storage: null });
    };

    afterEach(() => vi.unstubAllGlobals());

    it('uses WebGPU where the browser has it', () => {
      const assistant = browser({ userAgent: CHROME, gpu: {} });
      expect(assistant.hasWebGPU()).toBe(true);
      expect(assistant.cpuReason()).toBeNull();
    });

    it('runs on the CPU in Firefox, whose WebGPU is too slow', () => {
      const assistant = browser({ userAgent: FIREFOX, gpu: {} });
      expect(assistant.hasWebGPU()).toBe(false);
      expect(assistant.cpuReason()).toBe("Firefox's WebGPU is too slow for these models");
    });

    it('recognizes iPhone and iPad, which cannot run the models', () => {
      const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
      const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
      expect(browser({ userAgent: IPHONE, gpu: {} }).unavailableReason()).toBe(IOS_UNAVAILABLE_MESSAGE);
      // iPadOS reports itself as a Mac with touch.
      expect(browser({ userAgent: MAC_UA, gpu: {}, maxTouchPoints: 5 }).unavailableReason()).toBe(IOS_UNAVAILABLE_MESSAGE);
      expect(browser({ userAgent: MAC_UA, gpu: {}, maxTouchPoints: 0 }).unavailableReason()).toBeNull();
      expect(browser({ userAgent: CHROME, gpu: {} }).unavailableReason()).toBeNull();
    });

    it('runs on the CPU without WebGPU', () => {
      const assistant = browser({ userAgent: CHROME });
      expect(assistant.hasWebGPU()).toBe(false);
      expect(assistant.cpuReason()).toBe('WebGPU is not available in this browser');
    });
  });

  it('lists the stored catalog models with their size, including interrupted downloads', async () => {
    const context = setup();
    context.wllama.state.cachedUrls.add(getModelUrl(small));
    context.wllama.state.cachedUrls.add(getModelUrl(medium));
    context.wllama.state.cachedUrls.add('https://example.com/other.gguf');
    context.wllama.state.invalidUrls.add(getModelUrl(medium));
    context.wllama.state.sizes.set(getModelUrl(medium), 250);

    expect(await context.create().getStoredModels()).toEqual([
      { model: small, bytes: 1000, complete: true },
      { model: medium, bytes: 250, complete: false },
    ]);
  });

  it('removes the catalog models, unloads the loaded one, and forgets the selection', async () => {
    const context = setup();
    const assistant = ready(context);
    context.wllama.state.cachedUrls.add(getModelUrl(medium));
    context.wllama.state.cachedUrls.add('https://example.com/other.gguf');
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);
    await assistant.ask('hi', new AbortController().signal);
    expect(context.store.get(SELECTED_MODEL_STORAGE_KEY)).toBe(small.id);

    expect(await assistant.removeStoredModels()).toBe(2000);

    expect(context.wllama.state.removed).toEqual([getModelUrl(small), getModelUrl(medium)]);
    expect([...context.wllama.state.cachedUrls]).toEqual(['https://example.com/other.gguf']);
    expect(context.wllama.state.exits).toBe(1);
    expect(assistant.selectedModel).toBeUndefined();
    expect(context.store.has(SELECTED_MODEL_STORAGE_KEY)).toBe(false);
    await expect(assistant.ask('hi', new AbortController().signal)).rejects.toThrow(/No model selected/);
  });

  it('persists the selected model and restores it', () => {
    const context = setup();
    expect(context.create().selectedModel).toBeUndefined();

    context.create().selectModel(medium);

    expect(context.store.get(SELECTED_MODEL_STORAGE_KEY)).toBe(medium.id);
    expect(context.create().selectedModel).toBe(medium);
  });

  it('ignores an unknown stored model id', () => {
    const context = setup();
    context.store.set(SELECTED_MODEL_STORAGE_KEY, 'retired-model');
    expect(context.create().selectedModel).toBeUndefined();
  });
});

describe('AIAssistant.ask', () => {
  let context: ReturnType<typeof setup>;
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    context = setup({ schema: 'CREATE TABLE t (id INTEGER);' });
  });

  it('requires a selected, installed model', async () => {
    await expect(context.create().ask('hi', signal())).rejects.toThrow('No model selected');

    const assistant = context.create();
    assistant.selectModel(small);
    await expect(assistant.ask('hi', signal())).rejects.toBeInstanceOf(AssistantError);
    expect(context.output()).not.toContain('Thinking');
  });

  it('loads the model on the GPU and streams reasoning and answer', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([
      reasoningChunk('The user greets me.'),
      contentChunk('Hello!'),
      finishChunk('stop', 7),
    ]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.loads).toEqual([{
      url: getModelUrl(small),
      params: expect.objectContaining({ n_ctx: 16_384, n_gpu_layers: 99_999, reasoning_format: 'deepseek' }),
    }]);
    const [request] = context.wllama.state.requests;
    expect(request[0]).toEqual({ role: 'system', content: GUIDED_SYSTEM_PROMPT });
    expect(request[1]).toMatchObject({ role: 'user' });
    expect(request[1].content).toContain('hi\n\n' + SCHEMA_CONTEXT_OPEN);
    expect(request[1].content).toContain('CREATE TABLE t (id INTEGER);');
    expect(context.wllama.state.requestOptions[0]).toMatchObject({ stream: true, tool_choice: 'auto' });
    expect(context.output()).toContain('Thinking\r\nThe user greets me.\r\n\r\nHello!\r\n(7 tokens · 10.0 tok/s)');
  });

  it('loads the default build where the browser can run it', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.workerResources).toEqual([{ wasmPath: 'https://cdn.test/wllama.wasm', compat: false }]);
  });

  it('loads the compat build where the default build cannot run (Safari 27)', async () => {
    context = setup({ compat: true });
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.workerResources).toEqual([
      { wasmPath: COMPAT_URLS.wasm, jsPath: COMPAT_URLS.worker, compat: true },
    ]);
    expect(context.wllama.state.loads[0].params).toMatchObject({ n_gpu_layers: 99_999, n_threads: 1 });
    expect(context.output()).toContain('ok');
  });

  it('lets wllama choose its threads for the default build', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.loads[0].params).not.toHaveProperty('n_threads');
    expect(context.wllama.state.loads[0].params).not.toHaveProperty('n_batch');
  });

  it('refuses to load a model on iPhone and iPad, where it crashes the tab', async () => {
    context = setup({ ios: true });
    const assistant = ready(context);

    await expect(assistant.ask('hi', signal())).rejects.toThrow(/more memory than a browser tab gets on iPhone and iPad/);
    expect(context.wllama.state.loads).toEqual([]);
  });

  it('runs on the CPU without WebGPU', async () => {
    context = setup({ gpu: false });
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.loads[0].params).toMatchObject({ n_gpu_layers: 0 });
    expect(context.output()).toContain('on the CPU');
  });

  it('runs requested queries and returns their results to the model', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [reasoningChunk('I should count.'), toolCallChunk('SELECT count(*) FROM t'), finishChunk('tool_calls')],
      [contentChunk('There are 3 rows.'), finishChunk('stop')],
    );

    await assistant.ask('how many rows?', signal());

    expect(context.host.runQuery).toHaveBeenCalledWith('SELECT count(*) FROM t', expect.any(AbortSignal));
    const followUp = context.wllama.state.requests[1];
    expect(followUp.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query' } }],
    });
    expect(followUp.at(-1)).toEqual({
      role: 'tool', tool_call_id: 'call_1', content: 'SQL: SELECT count(*) FROM t\n\ncount\n3',
    });
    expect(context.output()).toContain('There are 3 rows.');
  });

  it('remembers the conversation but sends the schema only with the newest prompt', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [contentChunk('First answer'), finishChunk('stop')],
      [contentChunk('Second answer'), finishChunk('stop')],
    );

    await assistant.ask('first', signal());
    await assistant.ask('second', signal());

    const messages = context.wllama.state.requests[1];
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toBe('first');
    expect(messages[2].content).toBe('First answer');
    expect(messages[3].content).toContain(SCHEMA_CONTEXT_OPEN);
  });

  it('starts a new conversation when the model changes', async () => {
    const assistant = ready(context);
    context.wllama.state.cachedUrls.add(getModelUrl(medium));
    context.wllama.state.scripts.push(
      [contentChunk('one'), finishChunk('stop')],
      [contentChunk('two'), finishChunk('stop')],
    );

    await assistant.ask('first', signal());
    assistant.selectModel(medium);
    await assistant.ask('second', signal());

    expect(context.wllama.state.requests[1].map((message) => message.role)).toEqual(['system', 'user']);
    expect(context.wllama.state.loads.map(({ url }) => url)).toEqual([getModelUrl(small), getModelUrl(medium)]);
    expect(context.wllama.state.exits).toBe(1);
  });

  it('stops prompt processing by unloading the model, and forgets the aborted prompt', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([never()], [contentChunk('fresh'), finishChunk('stop')]);
    const controller = new AbortController();

    const pending = assistant.ask('slow', controller.signal);
    await vi.waitFor(() => expect(context.wllama.state.requests).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(context.wllama.state.exits).toBe(1);

    await assistant.ask('next', signal());
    expect(context.wllama.state.loads).toHaveLength(2);
    expect(context.wllama.state.requests[1].map((message) => message.role)).toEqual(['system', 'user']);
  });

  it('reports an empty answer as an error and keeps the conversation unchanged', async () => {
    const assistant = ready(context);
    assistant.setTuning({ guardrails: false });
    context.wllama.state.scripts.push(
      [reasoningChunk('Hmm'), finishChunk('length')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await expect(assistant.ask('hard', signal())).rejects.toThrow(/token limit before answering/);
    await assistant.ask('easy', signal());

    expect(context.wllama.state.requests[1].map((message) => message.content)).toEqual([
      GUIDED_SYSTEM_PROMPT, expect.stringContaining('easy'),
    ]);
  });

  it('answers malformed tool calls with an error result', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [toolCallChunk(''), finishChunk('tool_calls')],
      [contentChunk('Sorry.'), finishChunk('stop')],
    );

    await assistant.ask('rows?', signal());

    expect(context.host.runQuery).not.toHaveBeenCalled();
    expect(context.wllama.state.requests[1].at(-1)).toMatchObject({
      role: 'tool', content: 'Error: the query argument is required.',
    });
  });

  it('records how much of the prompt each turn read again', async () => {
    const assistant = ready(context);
    const timings = (prompt_n: number, cache_n: number) => ({
      timings: { prompt_n, cache_n, prompt_ms: prompt_n, predicted_n: 20, predicted_ms: 1000, predicted_per_second: 20 },
    });
    context.wllama.state.scripts.push(
      [toolCallChunk('SELECT 1'), { ...finishChunk('tool_calls'), ...timings(4000, 0) }],
      [contentChunk('One.'), { ...finishChunk('stop'), ...timings(60, 4000) }],
    );

    await assistant.ask('one?', signal());

    expect((assistant as unknown as { turnTimings: unknown[] }).turnTimings).toEqual([
      { promptTokens: 4000, cachedTokens: 0, promptMs: 4000, generatedTokens: 20, generationMs: 1000 },
      { promptTokens: 60, cachedTokens: 4000, promptMs: 60, generatedTokens: 20, generationMs: 1000 },
    ]);
  });

  it('gives up after too many tool calls', async () => {
    const assistant = ready(context);
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      context.wllama.state.scripts.push([toolCallChunk(`SELECT ${i}`), finishChunk('tool_calls')]);
    }
    await expect(assistant.ask('loop', signal())).rejects.toThrow(/did not finish after 20 steps/);
    expect(context.host.runQuery).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
  });

  it('takes its step limit from the tuning and tells the guided model about it', async () => {
    const assistant = ready(context);
    assistant.setTuning({ maxSteps: 3, prompt: 'guided' });
    for (let i = 0; i < 3; i++) {
      context.wllama.state.scripts.push([toolCallChunk(`SELECT ${i}`), finishChunk('tool_calls')]);
    }
    await expect(assistant.ask('loop', signal())).rejects.toThrow(/did not finish after 3 steps/);
    expect(context.host.runQuery).toHaveBeenCalledTimes(3);
    expect(context.wllama.state.requests[0][0].content).toContain('at most 2 times per question');
  });

  it('offers both tools to the model', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);
    await assistant.ask('hi', signal());
    const tools = context.wllama.state.requestOptions[0].tools as Array<{ function: { name: string } }>;
    expect(tools.map((tool) => tool.function.name)).toEqual(['query', 'search_docs']);
  });

  it('searches the docs, shows the sections with links, and returns them to the model', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [reasoningChunk('Check the PIVOT syntax.'), docsCallChunk('PIVOT'), finishChunk('tool_calls')],
      [contentChunk('Use PIVOT … ON … USING.'), finishChunk('stop')],
    );

    await assistant.ask('how do I pivot?', signal());

    expect(context.searchDocs).toHaveBeenCalledWith('PIVOT');
    expect(context.output()).toContain(
      'Searching the DuckDB docs for "PIVOT"\r\n  Statements › PIVOT Statement  https://duckdb.org/docs/2.0/sql/statements/pivot\r\n'
    );
    expect(context.wllama.state.requests[1].at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_docs',
      content: expect.stringContaining('## SQL › Statements › PIVOT Statement\nhttps://duckdb.org/docs/2.0/sql/statements/pivot\n\nPIVOT table ON column USING sum(value);'),
    });
    expect(context.host.runQuery).not.toHaveBeenCalled();
  });

  it('tells the model when the docs cannot be loaded', async () => {
    const assistant = ready(context);
    context.searchDocs.mockRejectedValueOnce(new Error('HTTP 404'));
    context.wllama.state.scripts.push(
      [docsCallChunk('PIVOT'), finishChunk('tool_calls')],
      [contentChunk('From memory: PIVOT …'), finishChunk('stop')],
    );

    await assistant.ask('pivot?', signal());

    expect(context.output()).toContain('The documentation is unavailable: HTTP 404');
    expect(context.wllama.state.requests[1].at(-1)).toMatchObject({
      role: 'tool', content: expect.stringContaining('could not be searched (HTTP 404)'),
    });
  });

  it('asks for keywords when a docs search has none', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [docsCallChunk(''), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );
    await assistant.ask('docs?', signal());
    expect(context.searchDocs).not.toHaveBeenCalled();
    expect(context.wllama.state.requests[1].at(-1)).toMatchObject({ content: 'Error: the keywords argument is required.' });
  });

  it('unloads the model when disposed', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);
    await assistant.ask('hi', signal());

    await assistant.dispose();

    expect(context.wllama.state.exits).toBe(1);
  });
});

describe('AIAssistant tuning', () => {
  let context: ReturnType<typeof setup>;
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    context = setup({ schema: 'CREATE TABLE orders (id INTEGER, status VARCHAR);' });
  });

  it('uses the tuned defaults: guided prompt, 20 steps, thinking, temperature 0.6, presence penalty 1.5', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(assistant.tuning).toEqual(DEFAULT_TUNING);
    expect(context.wllama.state.requests[0][0].content).toBe(GUIDED_SYSTEM_PROMPT);
    expect(GUIDED_SYSTEM_PROMPT).toContain('at most 19 times per question');
    expect(context.wllama.state.requestOptions[0]).toMatchObject({
      temperature: 0.6,
      presence_penalty: 1.5,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(context.host.getSchema).toHaveBeenCalledWith({ sampleRows: 3, distinctValues: true, urls: [] });
  });

  it('reproduces the untuned baseline', async () => {
    const assistant = ready(context);
    assistant.setTuning(BASELINE_TUNING);
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.requests[0][0].content).toBe(SYSTEM_PROMPT);
    expect(context.wllama.state.requestOptions[0]).toMatchObject({ temperature: small.sampling.temperature, presence_penalty: 0 });
    expect(context.host.getSchema).toHaveBeenCalledWith({ sampleRows: 0, distinctValues: false, urls: [] });
  });

  it('sends the guided prompt with its own tool descriptions', async () => {
    const assistant = ready(context);
    assistant.setTuning({ prompt: 'guided' });
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.requests[0][0].content).toBe(GUIDED_SYSTEM_PROMPT);
    const tools = context.wllama.state.requestOptions[0].tools as Array<{ function: { name: string; description: string } }>;
    expect(tools.map((tool) => tool.function.name)).toEqual(['query', 'search_docs']);
    expect(tools[0].function.description).not.toContain('duckdb_columns');
  });

  it('turns thinking off per request', async () => {
    const assistant = ready(context);
    assistant.setTuning({ thinking: false });
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask('hi', signal());

    expect(context.wllama.state.requestOptions[0]).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
    expect(context.wllama.state.loads).toHaveLength(1);
  });

  it('asks once to run SQL that an answer shows but never ran', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [contentChunk('Use:\n```sql\nSELECT count(*) FROM orders;\n```'), finishChunk('stop')],
      [toolCallChunk('SELECT count(*) FROM orders'), finishChunk('tool_calls')],
      [contentChunk('There are 3 orders.'), finishChunk('stop')],
    );

    await assistant.ask('how many orders?', signal());

    expect(context.output()).toContain('The answer shows SQL that was not run; asking the model to run it.');
    const roles = context.wllama.state.requests[1].map((message) => message.role);
    expect(roles.slice(-2)).toEqual(['assistant', 'user']);
    expect(context.wllama.state.requests[1].at(-1)?.content).toContain('did not run');
    expect(context.host.runQuery).toHaveBeenCalledOnce();
    expect(context.wllama.state.requests).toHaveLength(3);
  });

  it('asks to replace placeholders, but only once per prompt', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [contentChunk('```sql\nPIVOT <table> ON <column>;\n```'), finishChunk('stop')],
      [contentChunk('```sql\nPIVOT <table> ON <column>;\n```'), finishChunk('stop')],
    );

    await assistant.ask('pivot it', signal());

    expect(context.wllama.state.requests[1].at(-1)?.content).toContain('placeholders');
    expect(context.wllama.state.requests).toHaveLength(2);
  });

  it('asks once for an answer when the model stops without one', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [reasoningChunk('I have the numbers.'), finishChunk('stop')],
      [contentChunk('There are 3 orders.'), finishChunk('stop')],
    );

    await assistant.ask('how many?', signal());

    expect(context.output()).toContain('The model ended without an answer; asking it to answer.');
    expect(context.wllama.state.requests[1].at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('You did not write an answer') });
    expect(context.output()).toContain('There are 3 orders.');
  });

  it('gives up when the model still does not answer after being asked', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [reasoningChunk('Hmm.'), finishChunk('stop')],
      [reasoningChunk('Hmm again.'), finishChunk('stop')],
    );
    await expect(assistant.ask('how many?', signal())).rejects.toThrow('The model returned an empty response.');
  });

  it('leaves answers alone without guardrails', async () => {
    const assistant = ready(context);
    assistant.setTuning({ guardrails: false });
    context.wllama.state.scripts.push([contentChunk('```sql\nSELECT 1;\n```'), finishChunk('stop')]);

    await assistant.ask('sql?', signal());

    expect(context.wllama.state.requests).toHaveLength(1);
  });

  it('answers a repeated query with its earlier result instead of running it again', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [toolCallChunk('SELECT count(*) FROM orders'), finishChunk('tool_calls')],
      [toolCallChunk('select count(*)  from orders;'), finishChunk('tool_calls')],
      [contentChunk('3 orders.'), finishChunk('stop')],
    );

    await assistant.ask('count', signal());

    expect(context.host.runQuery).toHaveBeenCalledOnce();
    expect(context.wllama.state.requests[2].at(-2)?.content).toContain('You already ran this exact statement');
    // The model meant to answer: it is asked to right away, not after an empty turn.
    expect(context.wllama.state.requests[2].at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Answer my question now') });
    expect(context.wllama.state.requests).toHaveLength(3);
    expect(context.output()).toContain('Skipped a repeated query; asking the model to answer from its earlier result.');
    expect(context.output()).toContain('3 orders.');
  });

  it('still asks once more when the model ends without an answer after repeating a statement', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push(
      [toolCallChunk('SELECT count(*) FROM orders'), finishChunk('tool_calls')],
      [toolCallChunk('SELECT count(*) FROM orders'), finishChunk('tool_calls')],
      [reasoningChunk('I will answer.'), finishChunk('stop')],
      [contentChunk('3 orders.'), finishChunk('stop')],
    );

    await assistant.ask('count', signal());

    expect(context.output()).toContain('The model ended without an answer; asking it to answer.');
    expect(context.output()).toContain('3 orders.');
  });

  it('asks the terminal to describe the files at URLs in the question, unless tuned off', async () => {
    const assistant = ready(context);
    const url = 'https://example.com/data/trips.csv';
    context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')], [contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask(`trips per city in ${url}?`, signal());
    assistant.setTuning({ describeUrls: false });
    await assistant.ask(`trips per city in ${url}?`, signal());

    expect(context.host.getSchema).toHaveBeenNthCalledWith(1, expect.objectContaining({ urls: [url] }));
    expect(context.host.getSchema).toHaveBeenNthCalledWith(2, expect.objectContaining({ urls: [] }));
  });

  it('keeps describing files from earlier questions in follow-ups, newest first, until the conversation is reset', async () => {
    const assistant = ready(context);
    const trips = 'https://example.com/data/trips.csv';
    const stations = 'https://example.com/data/stations.parquet';
    for (let i = 0; i < 4; i++) context.wllama.state.scripts.push([contentChunk('ok'), finishChunk('stop')]);

    await assistant.ask(`trips per city in ${trips}?`, signal());
    await assistant.ask(`and the stations in ${stations}?`, signal());
    await assistant.ask('now only Berlin', signal());
    assistant.resetConversation();
    await assistant.ask('now only Berlin', signal());

    const urls = context.host.getSchema.mock.calls.map(([options]) => options.urls);
    expect(urls).toEqual([[trips], [stations, trips], [stations, trips], []]);
  });

  it('reminds the model of the URL in the question when a query misses the file', async () => {
    const assistant = ready(context);
    const url = 'https://example.com/data/sales.parquet';
    context.host.runQuery.mockResolvedValueOnce({
      ok: false,
      result: "SQL: SELECT count(*) FROM 'sales.parquet'\n\nError: IO Error: No files found that match the pattern \"sales.parquet\"",
      error: 'IO Error: No files found that match the pattern "sales.parquet"',
    });
    context.wllama.state.scripts.push(
      [toolCallChunk("SELECT count(*) FROM 'sales.parquet'"), finishChunk('tool_calls')],
      [contentChunk('Done.'), finishChunk('stop')],
    );

    await assistant.ask(`count the rows of ${url}`, signal());

    expect(context.wllama.state.requests[1].at(-1)?.content).toContain(`FROM read_parquet('${url}')`);
    expect(context.output()).toContain('Reminded the model to use the full URL from your question.');
  });

  it('tells the model how to attach a database from the question when it queries the database as a table', async () => {
    const assistant = ready(context);
    const url = 'https://example.com/data/iam.duckdb';
    context.host.runQuery.mockResolvedValueOnce({
      ok: false,
      result: 'SQL: SELECT * FROM iam\n\nError: Catalog Error: Table with name iam does not exist!',
      error: 'Catalog Error: Table with name iam does not exist!',
    });
    context.wllama.state.scripts.push(
      [toolCallChunk('SELECT * FROM iam'), finishChunk('tool_calls')],
      [contentChunk('Done.'), finishChunk('stop')],
    );

    await assistant.ask(`attach the remote database ${url}`, signal());

    // The way to attach comes before DuckDB's error.
    expect(context.wllama.state.requests[1].at(-1)?.content).toMatch(
      new RegExp(`^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is a DuckDB database[^]*run this statement next, exactly as written: ATTACH[^]*\n\nSQL: SELECT \\* FROM iam\n\nError: Catalog Error`)
    );
    expect(context.output()).toContain('Reminded the model how to attach the database from your question.');
  });

  it('asks the question again with the attached database\'s tables after the model attached it', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const attach = `ATTACH '${url}' AS inventory (READ_ONLY);`;
    const context2 = setup();
    context2.host.getSchema
      .mockResolvedValueOnce(`-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ${attach}`)
      .mockResolvedValueOnce(`CREATE TABLE inventory.stock (quantity INTEGER);\n\n-- ${url} is attached as inventory; query its tables as inventory.table_name.`);
    const assistant = ready(context2);
    context2.host.runQuery.mockResolvedValueOnce({ ok: true, result: 'SQL: ATTACH …', attached: [{ name: 'inventory', tables: ['stock'] }] });
    context2.wllama.state.scripts.push(
      [toolCallChunk(attach), finishChunk('tool_calls')],
      [contentChunk('9192 units.'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    // The exchange before the ATTACH is replaced by the question with the new schema block.
    const messages = context2.wllama.state.requests[1];
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toBe(
      `How many units are in stock in ${url}?\n\n--- Database schema ---\nCREATE TABLE inventory.stock (quantity INTEGER);\n\n` +
      `-- ${url} is attached as inventory; query its tables as inventory.table_name.\n--- End of database schema ---`
    );
    expect(context2.output()).toContain('Attached the database; asking the model the question again with its tables.');
    expect(assistant.messages.at(-1)).toMatchObject({ role: 'assistant', content: '9192 units.' });
  });

  it('runs only ATTACH statements until the question\'s database is attached', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const attach = `ATTACH '${url}' AS inventory (READ_ONLY);`;
    const context2 = setup({ schema: `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ${attach}` + '\nCREATE TABLE products (quantity INTEGER);' });
    const assistant = ready(context2);
    context2.host.runQuery
      .mockResolvedValueOnce({ ok: true, result: 'SQL: ATTACH …', attached: [{ name: 'inventory', tables: ['stock'] }] })
      .mockResolvedValueOnce({ ok: true, result: 'SQL: SELECT sum(quantity) FROM inventory.stock\n\nsum\n9192' });
    context2.wllama.state.scripts.push(
      [toolCallChunk('SELECT sum(quantity) FROM products'), finishChunk('tool_calls')],
      [toolCallChunk('SELECT sum(quantity) FROM products'), finishChunk('tool_calls')],
      [toolCallChunk(attach), finishChunk('tool_calls')],
      [toolCallChunk('SELECT sum(quantity) FROM inventory.stock'), finishChunk('tool_calls')],
      [contentChunk('9192 units.'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    // The queries of the other tables do not run; the reminder shows the exact call from the second time on.
    expect(context2.host.runQuery.mock.calls.map(([sql]) => sql)).toEqual([attach, 'SELECT sum(quantity) FROM inventory.stock']);
    const first = String(context2.wllama.state.requests[1].at(-1)?.content);
    expect(first).toMatch(/^Not run: https:\/\/example\.com\/data\/inventory\.duckdb is the DuckDB database the question is about/);
    expect(first).not.toContain('Your next tool call');
    expect(context2.wllama.state.requests[2].at(-1)?.content).toContain(`Your next tool call must be: query({"query": "${attach}"})`);
    // Once attached, queries run again.
    expect(context2.wllama.state.requests[4].at(-1)?.content).toBe('SQL: SELECT sum(quantity) FROM inventory.stock\n\nsum\n9192');
    expect(context2.output()).toContain('Skipped a query: the database from your question is not attached yet; reminding the model to attach it.');
  });

  it('runs other queries again once attaching the question\'s database failed', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const attach = `ATTACH '${url}' AS inventory (READ_ONLY);`;
    const context2 = setup({
      schema: `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ${attach}`,
    });
    const assistant = ready(context2);
    context2.host.runQuery
      .mockResolvedValueOnce({ ok: false, result: 'SQL: ATTACH …\n\nError: IO Error: HTTP 403', error: 'IO Error: HTTP 403' })
      .mockResolvedValueOnce({ ok: true, result: 'SQL: SELECT 1\n\n1' });
    context2.wllama.state.scripts.push(
      [toolCallChunk(attach), finishChunk('tool_calls')],
      [toolCallChunk('SELECT 1'), finishChunk('tool_calls')],
      [contentChunk('The server does not allow reading the database.'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    expect(context2.host.runQuery).toHaveBeenCalledTimes(2);
    // No request to attach after the answer: attaching failed.
    expect(context2.wllama.state.requests).toHaveLength(3);
  });

  it('takes an ATTACH in a failed statement as attached and names the tables for the database used as a table', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const attach = `ATTACH '${url}' AS inventory (READ_ONLY);`;
    const context2 = setup({ schema: `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ${attach}` });
    const assistant = ready(context2);
    const error = 'Catalog Error: Table with name inventory does not exist!\nDid you mean "pg_index"?';
    context2.host.runQuery
      .mockResolvedValueOnce({
        ok: false, result: `SQL: ATTACH …; SELECT count(*) FROM inventory\n\nError: ${error}`, error,
        attached: [{ name: 'inventory', tables: ['stock'] }],
      })
      .mockResolvedValueOnce({ ok: false, result: `SQL: SELECT count(*) FROM inventory\n\nError: ${error}`, error });
    context2.wllama.state.scripts.push(
      [toolCallChunk(`ATTACH '${url}' AS inventory; SELECT count(*) FROM inventory`), finishChunk('tool_calls')],
      [toolCallChunk('SELECT count(*) FROM inventory'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    // Attached: the question is asked again, the query runs, and its error names the tables.
    expect(context2.output()).toContain('Attached the database; asking the model the question again with its tables.');
    expect(context2.host.runQuery).toHaveBeenCalledTimes(2);
    expect(String(context2.wllama.state.requests[2].at(-1)?.content)).toMatch(
      /^inventory is the attached database, not a table\. Query its tables with inventory\. in front: inventory\.stock\n\nSQL: SELECT/
    );
    expect(context2.wllama.state.requests).toHaveLength(3);
  });

  it('gives no attach hint for a missing table once the question\'s database is attached', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const attach = `ATTACH '${url}' AS inventory (READ_ONLY);`;
    const context2 = setup({
      schema: `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ${attach}`,
    });
    const assistant = ready(context2);
    const error = 'Catalog Error: Table with name stocks does not exist!\nDid you mean "inventory.stock"?';
    context2.host.runQuery
      .mockResolvedValueOnce({ ok: true, result: 'SQL: ATTACH …', attached: [{ name: 'inventory', tables: ['stock'] }] })
      .mockResolvedValueOnce({ ok: false, result: `SQL: SELECT * FROM inventory.stocks\n\nError: ${error}`, error });
    context2.wllama.state.scripts.push(
      [toolCallChunk(attach), finishChunk('tool_calls')],
      [toolCallChunk('SELECT * FROM inventory.stocks'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    expect(context2.wllama.state.requests[2].at(-1)?.content).toBe(`SQL: SELECT * FROM inventory.stocks\n\nError: ${error}`);
    expect(context2.output()).not.toContain('Reminded the model how to attach the database from your question.');
  });

  it('asks once to attach the question\'s database when the model answers without it', async () => {
    const url = 'https://example.com/data/inventory.duckdb';
    const context2 = setup({
      schema: `-- ${url} is a DuckDB database that is NOT attached yet: none of the tables below are in it. ` +
        `Before you can query its tables, run: ATTACH '${url}' AS inventory (READ_ONLY);`,
    });
    const assistant = ready(context2);
    context2.wllama.state.scripts.push(
      [contentChunk('About 12 units.'), finishChunk('stop')],
      [contentChunk('Still about 12 units.'), finishChunk('stop')],
    );

    await assistant.ask(`How many units are in stock in ${url}?`, signal());

    expect(context2.wllama.state.requests).toHaveLength(2);
    expect(context2.wllama.state.requests[1].at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Your next tool call must be') });
    expect(context2.output()).toContain('The model answered without the database from your question; asking it to attach the database.');
  });

  it('answers an attach-only request once the ATTACH succeeds, without further model turns', async () => {
    const assistant = ready(context);
    const url = 'https://example.com/data/iam.duckdb';
    const attach = `ATTACH '${url}' AS iam (READ_ONLY)`;
    context.host.runQuery.mockResolvedValueOnce({
      ok: true, result: `SQL: ${attach}\n\nSuccess`, attached: [{ name: 'iam', tables: ['actions', 'services'] }],
    });
    context.wllama.state.scripts.push(
      [toolCallChunk(attach), finishChunk('tool_calls')],
      [toolCallChunk('SELECT * FROM iam.actions'), finishChunk('tool_calls')],
    );

    await assistant.ask(`attach the remote database ${url}`, signal());

    expect(context.wllama.state.requests).toHaveLength(1);
    expect(context.host.runQuery).toHaveBeenCalledTimes(1);
    expect(context.output()).toContain('Attached the database as iam (read-only). Its 2 tables: actions, services.');
    expect(assistant.messages.at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining('Attached the database as iam') });
  });

  it('keeps going after an ATTACH when the request asks for more', async () => {
    const assistant = ready(context);
    const url = 'https://example.com/data/iam.duckdb';
    context.host.runQuery.mockResolvedValueOnce({
      ok: true, result: 'SQL: ATTACH\n\nSuccess', attached: [{ name: 'iam', tables: ['services'] }],
    });
    context.wllama.state.scripts.push(
      [toolCallChunk(`ATTACH '${url}' AS iam (READ_ONLY)`), finishChunk('tool_calls')],
      [contentChunk('There are 3 services.'), finishChunk('stop')],
    );

    await assistant.ask(`attach ${url} and count the services`, signal());

    expect(context.wllama.state.requests).toHaveLength(2);
    expect(context.output()).toContain('There are 3 services.');
  });

  it('attaches the documentation of a misspelled function to the query error', async () => {
    const assistant = ready(context);
    context.host.runQuery.mockResolvedValueOnce({
      ok: false,
      result: 'SQL: SELECT date_trnc(…)\n\nError: Catalog Error: Scalar Function with name date_trnc does not exist!',
      error: 'Catalog Error: Scalar Function with name date_trnc does not exist!\nDid you mean "date_trunc"?',
    });
    context.searchDocs.mockResolvedValueOnce([{
      path: 'SQL › Functions › Date Functions › `date_trunc(part, date)`',
      url: 'https://duckdb.org/docs/2.0/sql/functions/date#date_truncpart-date',
      text: 'Truncate to specified precision.',
    }]);
    context.wllama.state.scripts.push(
      [toolCallChunk("SELECT date_trnc('month', ordered_at) FROM orders"), finishChunk('tool_calls')],
      [contentChunk('Fixed.'), finishChunk('stop')],
    );

    await assistant.ask('month?', signal());

    expect(context.searchDocs).toHaveBeenCalledWith('date_trunc');
    expect(context.wllama.state.requests[1].at(-1)?.content).toContain('This documentation may help to fix the query');
    expect(context.wllama.state.requests[1].at(-1)?.content).toContain('Truncate to specified precision.');
    expect(context.output()).toContain('Looked up "date_trunc" in the DuckDB docs');
  });

  it('leaves names from the user\'s data out of a docs search', async () => {
    const context2 = setup({ schema: 'CREATE TABLE orders (customer_id INTEGER, status VARCHAR);' });
    const assistant = ready(context2);
    context2.wllama.state.scripts.push(
      [docsCallChunk('ORDER BY customer_id orders'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await assistant.ask('latest order per customer?', signal());

    expect(context2.searchDocs).toHaveBeenLastCalledWith('ORDER BY');
    expect(context2.output()).toContain('Searching the DuckDB docs for "ORDER BY" (left out names from your data: customer_id, orders)');
    expect(context2.wllama.state.requests[1].at(-1)?.content).toMatch(/^Left out customer_id, orders: names from the user's data/);
  });

  it('skips a docs search made only of names from the user\'s data', async () => {
    const context2 = setup({ schema: 'CREATE TABLE orders (customer_id INTEGER, status VARCHAR);' });
    const assistant = ready(context2);
    context2.wllama.state.scripts.push(
      [docsCallChunk('customer_id status'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await assistant.ask('orders per status?', signal());

    expect(context2.searchDocs).not.toHaveBeenCalledWith('customer_id status');
    expect(context2.output()).toContain('Skipped a docs search for names from your data: customer_id, status');
    expect(context2.wllama.state.requests[1].at(-1)?.content).toMatch(/^No search: "customer_id", "status" are names/);
  });

  it('keeps a data name the documentation has a heading for, and filters nothing without guardrails', async () => {
    const context2 = setup({ schema: 'CREATE TABLE events (date DATE, kind VARCHAR);' });
    context2.searchDocs.mockImplementation(async (query: string) => query === 'date'
      ? [{ path: 'SQL › Functions › Date Functions', url: 'https://duckdb.org/docs/2.0/sql/functions/date', text: '' }]
      : PIVOT_DOCS);
    const assistant = ready(context2);
    context2.wllama.state.scripts.push(
      [docsCallChunk('date kind'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
      [docsCallChunk('date kind'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );

    await assistant.ask('dates?', signal());
    expect(context2.searchDocs).toHaveBeenLastCalledWith('date');

    assistant.setTuning({ guardrails: false });
    context2.searchDocs.mockClear();
    await assistant.ask('dates again?', signal());
    expect(context2.searchDocs.mock.calls).toEqual([['date kind']]);
  });

  it('sends the documentation for a how-to question when docsContext is on', async () => {
    const context2 = setup({ schema: 'CREATE TABLE orders (status VARCHAR);' });
    const assistant = ready(context2);
    assistant.setTuning({ docsContext: true });
    context2.wllama.state.scripts.push(
      [contentChunk('Use PIVOT.'), finishChunk('stop')],
      [contentChunk('5'), finishChunk('stop')],
    );

    await assistant.ask('How do I pivot the orders table?', signal());

    // Searched with the question minus names from the data; sent after the schema block.
    expect(context2.searchDocs).toHaveBeenCalledWith('How do I pivot the table?');
    const first = String(context2.wllama.state.requests[0].find((message) => message.role === 'user')?.content);
    expect(first).toMatch(/^How do I pivot the orders table\?\n\n--- Database schema ---[\s\S]*--- DuckDB documentation for this question ---\nDuckDB documentation for "How do I pivot the table\?"/);
    expect(first).toContain('PIVOT table ON column USING sum(value);');
    expect(context2.output()).toContain('Looked up the DuckDB docs for your question: Statements › PIVOT Statement  https://duckdb.org/docs/2.0/sql/statements/pivot');

    // A data question gets no documentation, and the earlier documentation is dropped.
    context2.searchDocs.mockClear();
    await assistant.ask('How many orders are there?', signal());
    expect(context2.searchDocs).not.toHaveBeenCalled();
    const messages = context2.wllama.state.requests[1].filter((message) => message.role === 'user').map((message) => String(message.content));
    expect(messages[0]).toBe('How do I pivot the orders table?');
    expect(messages[1]).not.toContain('DuckDB documentation for this question');
  });

  it('sends no documentation with questions when docsContext is off', async () => {
    const assistant = ready(context);
    context.wllama.state.scripts.push([contentChunk('Use PIVOT.'), finishChunk('stop')]);
    await assistant.ask('How do I pivot a table?', signal());
    expect(context.searchDocs).not.toHaveBeenCalled();
  });

  it('does not look up documentation for failed queries when errorDocs is off', async () => {
    const assistant = ready(context);
    assistant.setTuning({ errorDocs: false });
    context.host.runQuery.mockResolvedValueOnce({ ok: false, result: 'Error', error: 'Catalog Error: Scalar Function with name x does not exist!' });
    context.wllama.state.scripts.push(
      [toolCallChunk('SELECT x()'), finishChunk('tool_calls')],
      [contentChunk('ok'), finishChunk('stop')],
    );
    await assistant.ask('x', signal());
    expect(context.searchDocs).not.toHaveBeenCalled();
  });
});

describe('AIAssistant recovery', () => {
  it('reloads the model after the engine fails instead of reusing a crashed worker', async () => {
    const context = setup();
    const assistant = ready(context);
    const crash = Promise.reject(new Error('Invalid magic number'));
    crash.catch(() => {});
    context.wllama.state.scripts.push([reasoningChunk('Thinking…'), crash], [contentChunk('ok'), finishChunk('stop')]);

    await expect(assistant.ask('first', new AbortController().signal))
      .rejects.toThrow('The model stopped with an error (Invalid magic number). It is reloaded for your next prompt.');
    expect(context.wllama.state.exits).toBe(1);

    await assistant.ask('second', new AbortController().signal);
    expect(context.wllama.state.loads).toHaveLength(2);
    expect(context.wllama.state.requests[1].map((message) => message.role)).toEqual(['system', 'user']);
  });
});
