/**
 * In-browser SQL assistant backed by wllama (llama.cpp on WebAssembly/WebGPU).
 *
 * Manages the model cache (list, install), loads the selected model on demand,
 * and runs a tool-calling loop in which the model may query the database
 * through the terminal. The conversation is remembered across prompts until
 * the model changes or {@link AIAssistant.resetConversation} is called.
 *
 * @module ai/assistant
 */

import type {
  ChatCompletionChunk,
  ChatCompletionChunkDelta,
  ChatCompletionMessage,
  Model,
  ModelManager,
  Wllama,
  WllamaConfig,
} from '@wllama/wllama/esm/index.js';
import { searchDocs } from './docs';
import { formatDocsResults, type DocsChunk } from './docs-search';
import {
  ANSWER_REQUEST, REPEAT_ANSWER_REQUEST, attachAnswer, attachReminder, attachedAliasHint, dataWordsIn, dataWordsResult,
  errorDocsKeyword, isAttachOnly, isDocsQuestion, normalizeSql, urlHint, verificationIssue, verificationRequest, withoutDataWords,
  type AttachedDatabase,
  type PendingDatabase,
} from './guardrails';
import { attachStatementIn, isDatabaseFile, urlsIn } from './file-urls';
import { AI_MODELS, findModel, getModelUrl, type AIModel } from './models';
import {
  MAX_OUTPUT_TOKENS,
  PROMPTS,
  formatDocsContext,
  formatSchemaContext,
  stripSchemaContext,
} from './prompt';
import { ResponseRenderer, type GenerationStats } from './response-renderer';
import { DEFAULT_TUNING, type AssistantTuning } from './tuning';
import {
  canRunDefaultBuild,
  getWllamaCompatUrls,
  getWllamaWasmUrl,
  loadWllama,
  type WllamaModuleType,
} from './wllama-loader';

/** localStorage key of the selected model. */
export const SELECTED_MODEL_STORAGE_KEY = 'duckdb-terminal-ai-model';

/** Earlier prompts kept in the conversation, besides the current one. */
const MAX_REMEMBERED_PROMPTS = 5;

/** Thinking tokens allowed per model turn before the model must answer. */
const REASONING_BUDGET_TOKENS = 512;

/** What the schema context sent with a prompt includes besides the DDL. */
export interface SchemaContextOptions {
  /** Sample rows per table (0 for none). */
  sampleRows: number;
  /** Distinct values of short text columns. */
  distinctValues: boolean;
  /**
   * http(s) URLs of files named in the question, then in the earlier questions
   * the conversation remembers, newest first; described like loaded files.
   */
  urls: string[];
}

/** The outcome of a statement the model requested. */
export interface QueryOutcome {
  /** Whether the statement ran successfully. */
  ok: boolean;
  /** The text the model receives as the tool result. */
  result: string;
  /** DuckDB's error message, when the statement failed. */
  error?: string;
  /** Databases a successful ATTACH added, with their tables. */
  attached?: AttachedDatabase[];
}

/** What the assistant needs from the terminal. */
export interface AssistantHost {
  /** Writes raw terminal output. */
  write(text: string): void;
  /** Returns the schema as DDL, with sample data as requested, or an empty string. */
  getSchema(options: SchemaContextOptions): Promise<string>;
  /** Runs a statement the model requested and shows it and its result to the user. */
  runQuery(sql: string, signal: AbortSignal): Promise<QueryOutcome>;
}

/** Install state of a catalog model. */
export interface ModelStatus {
  model: AIModel;
  installed: boolean;
}

/** A catalog model stored in this browser's model cache. */
export interface StoredModel {
  model: AIModel;
  /** Bytes it takes up in the cache. */
  bytes: number;
  /** False for an interrupted download. */
  complete: boolean;
}

export interface InstallOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface AssistantOptions {
  /** Imports wllama; defaults to loading it from jsDelivr. */
  loadWllama?: () => Promise<WllamaModuleType>;
  /** URL of wllama's WASM binary. */
  wasmUrl?: string;
  /** Persists the selected model; defaults to localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /**
   * Reports whether models run on the GPU; defaults to whether the browser has
   * WebGPU and is not Firefox (see {@link AIAssistant.cpuReason}).
   */
  hasWebGPU?: () => boolean;
  /** Reports whether the browser is Firefox; defaults to checking the user agent. */
  isFirefox?: () => boolean;
  /**
   * Reports whether models need wllama's compat build; defaults to whether the
   * browser cannot run the default build (no JSPI or Memory64, such as Safari 27).
   */
  needsCompatBuild?: () => boolean;
  /** URLs of the compat build's worker script and WASM. */
  compatUrls?: { worker: string; wasm: string };
  /** Searches the documentation; defaults to the bundled DuckDB docs. */
  searchDocs?: (query: string) => Promise<DocsChunk[]>;
  /** Overrides of DEFAULT_TUNING. */
  tuning?: Partial<AssistantTuning>;
}

/** An error whose message is meant for the terminal user as-is. */
export class AssistantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantError';
  }
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** wllama's timings for one model turn: how much of the prompt it read again, and how long that and generating took. */
export interface TurnTimings {
  /** Prompt tokens processed for this turn. */
  promptTokens: number;
  /** Prompt tokens reused from the previous turn's cache. */
  cachedTokens: number;
  promptMs: number;
  generatedTokens: number;
  generationMs: number;
}

/** What happened while answering one prompt. */
interface PromptState {
  /** A query ran successfully. */
  ranQuery: boolean;
  /** The model was already asked to run the SQL in its answer. */
  verificationRequested: boolean;
  /** The model was already asked to answer after ending without one. */
  answerRequested: boolean;
  /** The model repeated a statement in its last turn, and was not asked to answer after that yet. */
  repeatedQuery: boolean;
  /** The model was already asked to answer after repeating a statement. */
  repeatAnswerRequested: boolean;
  /** Tool results of the statements run so far, by normalized SQL. */
  executed: Map<string, string>;
  /** http(s) URLs in the user's message. */
  urls: string[];
  /** The user only asked to attach a database: answer once an ATTACH succeeds, without further queries. */
  attachOnly: boolean;
  /** The successful ATTACH statement and the databases it added. */
  attached: { statement: string; databases: AttachedDatabase[] } | null;
  /** Names from the user's data in the schema block, which docs searches leave out. */
  dataWords: Set<string>;
  /** The user's question, repeated to the model once it attached the database the question needs. */
  prompt: string;
  /** Databases the question names that the schema block lists as not attached. */
  pendingDatabases: PendingDatabase[];
  /** Attach reminders sent so far. */
  attachReminders: number;
  /** The model was already asked to attach the database instead of answering without it. */
  attachRequested: boolean;
  /** The model's ATTACH of the question's database failed: it can tell the user why. */
  attachFailed: boolean;
  /** The question was asked again after the model attached its database. */
  askedAgain: boolean;
}

/** What `runTurns` needs to know about the question. */
interface QuestionContext {
  /** The user's question, without the schema block. */
  prompt: string;
  /** Index of the question's message in the conversation. */
  questionIndex: number;
  /** http(s) URLs in the user's message. */
  urls: string[];
  /** The user only asked to attach a database. */
  attachOnly: boolean;
  /** Names from the user's data in the schema block. */
  dataWords: Set<string>;
  /** Databases the question names that are not attached yet. */
  pendingDatabases: PendingDatabase[];
}

/** Maximum length of the documentation sent with a question (about 550 tokens). */
const MAX_QUESTION_DOCS_CHARS = 2_000;

interface TurnResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  stats: GenerationStats;
}

/** wllama streams reasoning in a field its chunk type does not declare. */
type ReasoningDelta = ChatCompletionChunkDelta & {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

const QUIET_WLLAMA_CONFIG: WllamaConfig = {
  suppressNativeLog: true,
  logger: {
    debug: () => {},
    log: () => {},
    warn: (...args: unknown[]) => console.warn('[wllama]', ...args),
    error: (...args: unknown[]) => console.error('[wllama]', ...args),
  },
};

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Makes `engine` load wllama's compat build. `setCompat()` is not enough:
 * wllama uses the compat build only when its own check finds JSPI or Memory64
 * missing, and Safari 27 passes that check although it cannot run the default
 * build (https://github.com/ngxson/wllama/issues/297). So this replaces the
 * method that picks the build, as wllama 3.8 implements it.
 */
function useCompatBuild(engine: Wllama, urls: { worker: string; wasm: string }): void {
  (engine as unknown as { getWorkerResources(): object }).getWorkerResources = () => ({
    wasmPath: urls.wasm,
    jsPath: urls.worker,
    compat: true,
  });
}

/** A cached model whose files are all present (an interrupted download is invalid). */
function isValid(model: Model): boolean {
  return String(model.validate()) === 'valid';
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Rejects as soon as `signal` aborts, without waiting for `promise`. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

export class AIAssistant {
  private readonly importWllama: () => Promise<WllamaModuleType>;
  private readonly wasmUrl: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  private readonly webGPU: () => boolean;
  private readonly firefox: () => boolean;
  private readonly needsCompatBuild: () => boolean;
  private readonly compatUrls: { worker: string; wasm: string };
  private readonly docsSearch: (query: string) => Promise<DocsChunk[]>;
  private settings: AssistantTuning;
  private cacheClient: Wllama | null = null;
  private engine: Wllama | null = null;
  private engineModelId: string | null = null;
  private selectedId: string | null;
  /** Conversation without the system prompt. */
  private messages: ChatCompletionMessage[] = [];
  /** wllama's timings for each model turn of the latest prompt; tests/ai-eval records them. */
  private turnTimings: TurnTimings[] = [];
  private disposed = false;

  constructor(private readonly host: AssistantHost, options: AssistantOptions = {}) {
    this.importWllama = options.loadWllama ?? loadWllama;
    this.wasmUrl = options.wasmUrl ?? getWllamaWasmUrl();
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.firefox = options.isFirefox ?? (() => typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent));
    this.webGPU = options.hasWebGPU ?? (() => typeof navigator !== 'undefined' && 'gpu' in navigator && !this.firefox());
    this.needsCompatBuild = options.needsCompatBuild ?? (() => !canRunDefaultBuild());
    this.compatUrls = options.compatUrls ?? getWllamaCompatUrls();
    this.docsSearch = options.searchDocs ?? ((query) => searchDocs(query));
    this.settings = { ...DEFAULT_TUNING, ...options.tuning };
    let saved: string | null = null;
    try {
      saved = this.storage?.getItem(SELECTED_MODEL_STORAGE_KEY) ?? null;
    } catch {
      // Storage can be unavailable in private windows.
    }
    this.selectedId = findModel(saved)?.id ?? null;
  }

  /** The model `.ai` uses, if one was selected. */
  get selectedModel(): AIModel | undefined {
    return findModel(this.selectedId);
  }

  /** Whether models run on the GPU with WebGPU; otherwise they run on the CPU. */
  hasWebGPU(): boolean {
    return this.webGPU();
  }

  /**
   * Why models run on the CPU, or null when they use WebGPU. Firefox has WebGPU
   * but completes GPU work only on a 100 ms timer (Mozilla bug 1870699), which
   * makes generation far slower than its CPU (https://github.com/ngxson/wllama/issues/296).
   */
  cpuReason(): string | null {
    if (this.hasWebGPU()) return null;
    return this.firefox() ? "Firefox's WebGPU is too slow for these models" : 'WebGPU is not available in this browser';
  }

  /** The settings that shape answers. */
  get tuning(): Readonly<AssistantTuning> {
    return this.settings;
  }

  /** Changes settings that shape answers; used by tests/ai-eval to compare them. */
  setTuning(tuning: Partial<AssistantTuning>): void {
    this.settings = { ...this.settings, ...tuning };
  }

  /** Searches the documentation the model can consult. */
  searchDocs(query: string): Promise<DocsChunk[]> {
    return this.docsSearch(query);
  }

  /** Makes `model` the one `.ai` uses. Switching models starts a new conversation. */
  selectModel(model: AIModel): void {
    if (model.id !== this.selectedId) {
      this.selectedId = model.id;
      this.resetConversation();
    }
    try {
      this.storage?.setItem(SELECTED_MODEL_STORAGE_KEY, model.id);
    } catch {
      // The selection then lasts for this session only.
    }
  }

  /** Forgets earlier prompts and answers. */
  resetConversation(): void {
    this.messages = [];
  }

  /** Reports which catalog models are fully downloaded in this browser. */
  async getModelStatuses(): Promise<ModelStatus[]> {
    const manager = await this.getModelManager();
    const cached = await manager.getModels();
    return AI_MODELS.map((model) => ({
      model,
      installed: cached.some((entry) => entry.url === getModelUrl(model) && isValid(entry)),
    }));
  }

  /** The catalog models stored in this browser, including interrupted downloads. */
  async getStoredModels(): Promise<StoredModel[]> {
    const cached = await (await this.getModelManager()).getModels();
    return AI_MODELS.flatMap((model) => {
      const entry = cached.find((cachedModel) => cachedModel.url === getModelUrl(model));
      return entry ? [{ model, bytes: Math.max(0, entry.size), complete: isValid(entry) }] : [];
    });
  }

  /**
   * Removes the catalog models from the browser cache and returns the bytes
   * freed. Unloads the model first (some browsers cannot delete open files) and
   * forgets the selection, which starts a new conversation. Leaves other files
   * in wllama's cache alone: the page may use wllama for something else.
   */
  async removeStoredModels(): Promise<number> {
    const urls = new Set(AI_MODELS.map(getModelUrl));
    const stored = (await (await this.getModelManager()).getModels()).filter((model) => urls.has(model.url));
    await this.unloadEngine();
    let freed = 0;
    for (const model of stored) {
      const bytes = Math.max(0, model.size);
      await model.remove();
      freed += bytes;
    }
    this.selectedId = null;
    this.resetConversation();
    try {
      this.storage?.removeItem(SELECTED_MODEL_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private windows.
    }
    return freed;
  }

  /** Downloads `model` into the browser cache. */
  async install(model: AIModel, options: InstallOptions = {}): Promise<void> {
    const manager = await this.getModelManager();
    await manager.downloadModel(getModelUrl(model), {
      signal: options.signal,
      progressCallback: ({ loaded, total }) => options.onProgress?.(loaded, total || model.sizeBytes),
    });
  }

  /**
   * Sends `prompt` to the selected model and streams its reasoning, tool use,
   * and answer to the terminal. Rejects with the signal's reason when aborted.
   */
  async ask(prompt: string, signal: AbortSignal): Promise<void> {
    const model = this.selectedModel;
    if (!model) {
      throw new AssistantError('No model selected. Run .model to choose and install one.');
    }
    const renderer = new ResponseRenderer((text) => this.host.write(text));
    this.turnTimings = [];
    try {
      const engine = await this.loadEngine(model, renderer, signal);
      // Compact first: files of forgotten questions are not described again.
      this.compactConversation();
      const urls = urlsIn(prompt);
      const schemaText = await this.host.getSchema({
        sampleRows: this.settings.sampleRows,
        distinctValues: this.settings.distinctValues,
        urls: this.settings.describeUrls ? this.conversationUrls(urls) : [],
      });
      const dataWords = dataWordsIn(schemaText);
      const docs = this.settings.docsContext && isDocsQuestion(prompt)
        ? await this.questionDocs(prompt, dataWords, renderer, signal)
        : '';
      const turnStart = this.messages.length;
      const content = [prompt, formatSchemaContext(schemaText), formatDocsContext(docs)].filter(Boolean).join('\n\n');
      this.messages.push({ role: 'user', content });
      try {
        await this.runTurns(engine, model, renderer, signal, {
          prompt,
          questionIndex: turnStart,
          urls,
          attachOnly: this.settings.guardrails && isAttachOnly(prompt),
          dataWords,
          pendingDatabases: urls.filter(isDatabaseFile).flatMap((url) => {
            const statement = attachStatementIn(schemaText, url);
            return statement ? [{ url, statement }] : [];
          }),
        });
      } catch (error) {
        // Keep the conversation consistent: drop the unfinished exchange.
        this.messages.length = turnStart;
        if (signal.aborted || error instanceof AssistantError) throw error;
        // wllama's worker can crash (and then only returns garbage); never reuse it.
        await this.unloadEngine();
        const reason = error instanceof Error ? error.message : String(error);
        throw new AssistantError(`The model stopped with an error (${reason}). It is reloaded for your next prompt.`);
      }
    } finally {
      renderer.finish();
    }
  }

  /** Unloads the model and releases wllama's worker. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.cacheClient = null;
    await this.unloadEngine();
  }

  private async runTurns(
    engine: Wllama,
    model: AIModel,
    renderer: ResponseRenderer,
    signal: AbortSignal,
    { prompt, questionIndex, urls, attachOnly, dataWords, pendingDatabases }: QuestionContext
  ): Promise<void> {
    const state: PromptState = {
      ranQuery: false, verificationRequested: false, answerRequested: false, repeatedQuery: false, repeatAnswerRequested: false,
      executed: new Map(), urls, attachOnly, attached: null, dataWords, prompt,
      pendingDatabases, attachReminders: 0, attachRequested: false, attachFailed: false, askedAgain: false,
    };
    const maxSteps = this.settings.maxSteps;
    for (let iteration = 0; iteration < maxSteps; iteration++) {
      const turn = await this.generate(engine, model, renderer, signal);

      if (turn.toolCalls.length > 0 && turn.finishReason !== 'length') {
        const toolCalls = turn.toolCalls.map((call, index) => ({
          id: call.id || `call_${iteration}_${index}`,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments || '{}' },
        }));
        this.messages.push({ role: 'assistant', content: turn.content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const result = await this.runTool(call.function.name, call.function.arguments, renderer, signal, state);
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        if (state.attachOnly && state.attached) {
          // Small models keep querying after an ATTACH that was all the user asked for.
          const answer = attachAnswer(state.attached.statement, state.attached.databases);
          renderer.content(answer);
          this.messages.push({ role: 'assistant', content: answer });
          return;
        }
        if (state.attached && !state.askedAgain && this.settings.guardrails) {
          // Mid-conversation, after an ATTACH result, small models join and group the new tables wrongly;
          // with the tables in the schema block from the start, as for files on the web, they do well.
          state.askedAgain = true;
          renderer.notice('Attached the database; asking the model the question again with its tables.');
          this.messages.length = questionIndex;
          const schema = formatSchemaContext(await this.host.getSchema({
            sampleRows: this.settings.sampleRows,
            distinctValues: this.settings.distinctValues,
            urls: this.settings.describeUrls ? this.conversationUrls(urls) : [],
          }));
          this.messages.push({ role: 'user', content: schema ? `${prompt}\n\n${schema}` : prompt });
          state.executed.clear();
          continue;
        }
        // Not while the question's database is unattached: the answer would come from other tables.
        if (state.repeatedQuery && !state.repeatAnswerRequested && !this.awaitingAttach(state)) {
          // A repeated statement usually means the model meant to answer; ask now instead of
          // letting it end its next turn empty.
          state.repeatAnswerRequested = true;
          this.messages.push({ role: 'user', content: REPEAT_ANSWER_REQUEST });
        }
        state.repeatedQuery = false;
        continue;
      }

      if (!turn.content.trim() && this.settings.guardrails && !state.answerRequested) {
        // Small models sometimes stop after thinking without writing an answer.
        state.answerRequested = true;
        renderer.notice('The model ended without an answer; asking it to answer.');
        this.messages.push({ role: 'user', content: ANSWER_REQUEST });
        continue;
      }
      if (!turn.content.trim()) {
        throw new AssistantError(
          turn.finishReason === 'length'
            ? `The model reached the ${MAX_OUTPUT_TOKENS}-token limit before answering. Try a shorter prompt or a larger model.`
            : 'The model returned an empty response.'
        );
      }
      if (turn.finishReason === 'length') {
        renderer.notice(`Answer truncated at the ${MAX_OUTPUT_TOKENS}-token limit.`);
      }
      this.messages.push({ role: 'assistant', content: turn.content });
      if (this.awaitingAttach(state) && !state.attachRequested) {
        // It answered from the user's other tables; the question is about the database.
        state.attachRequested = true;
        renderer.notice('The model answered without the database from your question; asking it to attach the database.');
        this.messages.push({ role: 'user', content: attachReminder(state.pendingDatabases, 2) });
        continue;
      }
      const issue = this.settings.guardrails && !state.verificationRequested
        ? verificationIssue(turn.content, state.ranQuery)
        : null;
      if (issue) {
        state.verificationRequested = true;
        renderer.notice(issue === 'placeholders'
          ? 'The answer uses placeholders in its SQL; asking the model to run real SQL.'
          : 'The answer shows SQL that was not run; asking the model to run it.');
        this.messages.push({ role: 'user', content: verificationRequest(issue) });
        continue;
      }
      renderer.stats(turn.stats);
      return;
    }
    throw new AssistantError(
      `The model did not finish after ${maxSteps} steps. Try a more specific prompt.`
    );
  }

  /** Whether the question names a database the model has not attached yet, and attaching it has not failed. */
  private awaitingAttach(state: PromptState): boolean {
    return this.settings.guardrails && !state.attached && !state.attachFailed && state.pendingDatabases.length > 0;
  }

  private async generate(
    engine: Wllama,
    model: AIModel,
    renderer: ResponseRenderer,
    signal: AbortSignal
  ): Promise<TurnResult> {
    const { sampling } = model;
    // Until the first token, wllama cannot observe the abort signal: prompt
    // processing runs uninterruptibly in its worker. Stop the worker instead.
    let streaming = false;
    const stopPrefill = () => {
      if (!streaming) void this.unloadEngine();
    };
    renderer.status('Reading prompt…');
    const prompt = PROMPTS[this.settings.prompt];
    const stream = await abortable(
      engine.createChatCompletion({
        messages: [{ role: 'system', content: prompt.system(this.settings.maxSteps) }, ...this.messages],
        tools: prompt.tools,
        tool_choice: 'auto',
        temperature: this.settings.temperature ?? sampling.temperature,
        top_p: sampling.top_p,
        top_k: sampling.top_k,
        min_p: 0,
        // Read by llama.cpp; wllama's types call it penalty_present.
        ...({ presence_penalty: this.settings.presencePenalty } as object),
        chat_template_kwargs: { enable_thinking: this.settings.thinking },
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        abortSignal: signal,
        timings_per_token: true,
      }),
      signal,
      stopPrefill
    );

    const iterator = stream[Symbol.asyncIterator]();
    const toolCalls = new Map<number, ToolCall>();
    const stats: GenerationStats = {};
    let content = '';
    let finishReason: string | null = null;
    let timings: ChatCompletionChunk['timings'];

    for (;;) {
      const next = streaming
        ? await iterator.next()
        : await abortable(iterator.next(), signal, stopPrefill);
      if (next.done) break;
      const chunk = next.value;

      if (!streaming && chunk.prompt_progress?.total) {
        const { processed, total } = chunk.prompt_progress;
        renderer.status(`Reading prompt ${processed}/${total} tokens…`);
      }
      if (chunk.timings) timings = chunk.timings;
      if (chunk.timings?.predicted_n) {
        stats.tokens = chunk.timings.predicted_n;
        stats.tokensPerSecond = chunk.timings.predicted_per_second;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      streaming = true;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta as ReasoningDelta;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) renderer.reasoning(reasoning);
      if (delta.content) {
        content += delta.content;
        renderer.content(delta.content);
      }
      for (const call of delta.tool_calls ?? []) {
        const entry = toolCalls.get(call.index ?? 0) ?? { id: '', name: '', arguments: '' };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name += call.function.name;
        if (call.function?.arguments) entry.arguments += call.function.arguments;
        toolCalls.set(call.index ?? 0, entry);
      }
    }

    if (signal.aborted) throw abortError(signal);
    renderer.finish();
    if (timings) {
      this.turnTimings.push({
        promptTokens: timings.prompt_n,
        cachedTokens: timings.cache_n,
        promptMs: timings.prompt_ms,
        generatedTokens: timings.predicted_n,
        generationMs: timings.predicted_ms,
      });
    }
    return {
      content,
      toolCalls: [...toolCalls.values()].filter((call) => call.name),
      finishReason,
      stats,
    };
  }

  private async runTool(
    name: string,
    rawArguments: string,
    renderer: ResponseRenderer,
    signal: AbortSignal,
    state: PromptState
  ): Promise<string> {
    if (name !== 'query' && name !== 'search_docs') {
      return `Error: unknown tool "${name}". The tools are "query" and "search_docs".`;
    }
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArguments || '{}') as Record<string, unknown>;
    } catch {
      return 'Error: the tool arguments were not valid JSON.';
    }
    if (name === 'search_docs') {
      const keywords = String(args.keywords ?? args.query ?? '').trim();
      if (!keywords) return 'Error: the keywords argument is required.';
      return this.runDocsSearch(keywords, renderer, signal, state);
    }
    const sql = String(args.query ?? args.sql ?? '').trim();
    if (!sql) return 'Error: the query argument is required.';

    const attaching = /(?:^|;)\s*attach\b/i.test(sql);
    if (this.awaitingAttach(state) && !attaching) {
      // Until the question's database is attached, other queries only reach the user's other tables,
      // and small models then answer from those.
      state.attachReminders++;
      renderer.notice('Skipped a query: the database from your question is not attached yet; reminding the model to attach it.');
      return `Not run: ${attachReminder(state.pendingDatabases, state.attachReminders)}`;
    }
    const key = normalizeSql(sql);
    const previous = state.executed.get(key);
    if (this.settings.guardrails && previous !== undefined) {
      state.repeatedQuery = true;
      const repeated = `You already ran this exact statement for this question. Do not run it again. Its result was:\n${previous}`;
      renderer.notice('Skipped a repeated query; asking the model to answer from its earlier result.');
      return repeated;
    }
    const outcome = await this.host.runQuery(sql, signal);
    state.executed.set(key, outcome.result);
    if (outcome.ok) state.ranQuery = true;
    // A statement can attach a database and still fail in a later statement (ATTACH …; SELECT …);
    // the question is then asked again with the database's tables (see runTurns).
    if (outcome.attached?.length) state.attached = { statement: sql, databases: outcome.attached };
    if (attaching && !outcome.ok && !outcome.attached?.length && state.pendingDatabases.some(({ url }) => sql.includes(url))) {
      // The database itself cannot be attached (a network or server error): let the model tell the user.
      state.attachFailed = true;
    }
    if (outcome.ok || !outcome.error) return outcome.result;
    let result = outcome.result;
    const aliasHint = this.settings.guardrails && state.attached ? attachedAliasHint(outcome.error, state.attached.databases, sql) : null;
    if (aliasHint) {
      renderer.notice('Reminded the model how to query the tables of the attached database.');
      return `${aliasHint}\n\n${result}`;
    }
    // Once the model attached a database, its URL needs no hint; DuckDB's error stands for itself.
    const hint = this.settings.guardrails ? urlHint(outcome.error, sql, state.attached ? state.urls.filter((url) => !isDatabaseFile(url)) : state.urls) : null;
    if (hint) {
      renderer.notice(hint.database
        ? 'Reminded the model how to attach the database from your question.'
        : 'Reminded the model to use the full URL from your question.');
      // The way to attach comes first: after the error, small models follow DuckDB's "Did you mean" instead.
      result = hint.database ? `${hint.text.trim()}\n\n${result}` : result + hint.text;
    }
    if (this.settings.errorDocs) result += await this.errorDocs(outcome.error, sql, renderer, signal);
    return result;
  }

  /** Looks up the function or statement a failed query is about. */
  private async errorDocs(error: string, sql: string, renderer: ResponseRenderer, signal: AbortSignal): Promise<string> {
    const keyword = errorDocsKeyword(error, sql);
    if (!keyword) return '';
    try {
      const [chunk] = await abortable(this.docsSearch(keyword), signal);
      if (!chunk) return '';
      renderer.notice(`Looked up "${keyword}" in the DuckDB docs: ${chunk.path.split(' › ').slice(-2).join(' › ')}  ${chunk.url}`);
      renderer.notice('');
      return `\n\nThis documentation may help to fix the query:\n\n${formatDocsResults(keyword, [chunk], 2_000)}`;
    } catch (lookupError) {
      if (signal.aborted) throw lookupError;
      return '';
    }
  }

  /**
   * Shows which documentation sections the model reads, with their links.
   * Names from the user's data are left out of the search: the documentation
   * does not know them, and they push the results away from DuckDB's features.
   */
  private async runDocsSearch(keywords: string, renderer: ResponseRenderer, signal: AbortSignal, state: PromptState): Promise<string> {
    const { kept, dropped } = this.settings.guardrails
      ? await this.withoutDataWords(keywords, state.dataWords, signal)
      : { kept: keywords, dropped: [] };
    if (!kept) {
      renderer.notice(`Skipped a docs search for names from your data: ${dropped.join(', ')}`);
      renderer.notice('');
      return dataWordsResult(dropped);
    }
    const search = kept;
    const left = dropped.length > 0 ? dropped.join(', ') : '';
    const note = left ? ` (left out names from your data: ${left})` : '';
    renderer.notice(`Searching the DuckDB docs for "${search}"${note}`);
    try {
      const results = await abortable(this.docsSearch(search), signal);
      // The last two headings and the link fit on one line; the model gets the full trail.
      for (const chunk of results) {
        renderer.notice(`  ${chunk.path.split(' › ').slice(-2).join(' › ')}  ${chunk.url}`);
      }
      if (results.length === 0) renderer.notice('  No matching sections.');
      renderer.notice('');
      const leftOut = left ? `Left out ${left}: names from the user's data, listed in the schema block.\n\n` : '';
      return leftOut + formatDocsResults(search, results);
    } catch (error) {
      if (signal.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      renderer.notice(`  The documentation is unavailable: ${reason}`);
      renderer.notice('');
      return `Error: the DuckDB documentation could not be searched (${reason}). Continue without it.`;
    }
  }

  /**
   * `keywords` without names from the user's data, keeping those that the
   * documentation has a heading for, such as a column called date or json.
   */
  private async withoutDataWords(
    keywords: string,
    dataWords: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<{ kept: string; dropped: string[] }> {
    const split = withoutDataWords(keywords, dataWords);
    if (split.dropped.length === 0) return split;
    const keep = new Set<string>();
    for (const word of split.dropped) {
      try {
        const sections = await abortable(this.docsSearch(word), signal);
        const heading = new RegExp(`(^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`, 'i');
        if (sections.some((section) => heading.test(section.path))) keep.add(word);
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    if (keep.size === 0) return split;
    // Keep the keywords' order: rebuild from the tokens that are not left out.
    const dropped = split.dropped.filter((word) => !keep.has(word));
    const kept = keywords.split(/[\s,;]+/).filter((token) => token && !dropped.includes(token.replace(/^[^\w.]+|[^\w.]+$/g, ''))).join(' ');
    return { kept, dropped };
  }

  /**
   * The documentation for a question about how to do something in DuckDB,
   * searched with the question's own words minus names from the user's data.
   */
  private async questionDocs(
    prompt: string,
    dataWords: ReadonlySet<string>,
    renderer: ResponseRenderer,
    signal: AbortSignal
  ): Promise<string> {
    try {
      const { kept } = await this.withoutDataWords(prompt, dataWords, signal);
      const results = await abortable(this.docsSearch(kept || prompt), signal);
      if (results.length === 0) return '';
      for (const chunk of results) {
        renderer.notice(`Looked up the DuckDB docs for your question: ${chunk.path.split(' › ').slice(-2).join(' › ')}  ${chunk.url}`);
      }
      renderer.notice('');
      return formatDocsResults(kept || prompt, results, MAX_QUESTION_DOCS_CHARS);
    } catch (error) {
      if (signal.aborted) throw error;
      return '';
    }
  }

  private async loadEngine(model: AIModel, renderer: ResponseRenderer, signal: AbortSignal): Promise<Wllama> {
    if (this.engine && this.engineModelId === model.id) return this.engine;
    await this.unloadEngine();

    const manager = await this.getModelManager();
    const cached = (await manager.getModels()).find((entry) => entry.url === getModelUrl(model));
    if (!cached || !isValid(cached)) {
      throw new AssistantError(`${model.label} is not installed in this browser. Run .model to install it.`);
    }

    const { Wllama: WllamaClass } = await this.importWllama();
    const gpu = this.hasWebGPU();
    renderer.status(`Loading ${model.label} on the ${gpu ? 'GPU (WebGPU)' : 'CPU'}…`);
    const engine = new WllamaClass({ default: this.wasmUrl }, QUIET_WLLAMA_CONFIG);
    if (this.needsCompatBuild()) useCompatBuild(engine, this.compatUrls);
    try {
      await abortable(
        engine.loadModel(cached, {
          n_ctx: model.contextSize,
          n_gpu_layers: gpu ? 99_999 : 0,
          cache_type_k: 'q8_0',
          cache_type_v: 'q8_0',
          reasoning: true,
          reasoning_budget_tokens: REASONING_BUDGET_TOKENS,
          reasoning_format: 'deepseek',
        }),
        signal
      );
    } catch (error) {
      void engine.exit().catch(() => {});
      throw error;
    }
    if (this.disposed) {
      void engine.exit().catch(() => {});
      throw new AssistantError('The terminal was closed.');
    }
    renderer.clearStatus();
    this.engine = engine;
    this.engineModelId = model.id;
    return engine;
  }

  private async unloadEngine(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    this.engineModelId = null;
    if (engine) await engine.exit().catch(() => {});
  }

  private async getModelManager(): Promise<ModelManager> {
    if (!this.cacheClient) {
      const { Wllama: WllamaClass } = await this.importWllama();
      try {
        this.cacheClient = new WllamaClass({ default: this.wasmUrl }, QUIET_WLLAMA_CONFIG);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new AssistantError(
          `This browser cannot cache models (${reason}). Model caching needs the Origin Private File System.`
        );
      }
    }
    return this.cacheClient.modelManager;
  }

  /**
   * The URLs of the new question, then those of the earlier questions in the
   * conversation, newest first, so follow-up questions that do not repeat a
   * URL still get the file's columns (old schema blocks are dropped).
   */
  private conversationUrls(promptUrls: readonly string[]): string[] {
    const earlier = this.messages
      .filter((message) => message.role === 'user' && typeof message.content === 'string')
      .reverse()
      .flatMap((message) => urlsIn(message.content as string));
    return [...new Set([...promptUrls, ...earlier])];
  }

  /** Drops old schema excerpts and keeps only the most recent prompts. */
  private compactConversation(): void {
    for (const message of this.messages) {
      if (message.role === 'user' && typeof message.content === 'string') {
        message.content = stripSchemaContext(message.content);
      }
    }
    const promptStarts = this.messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
    if (promptStarts.length > MAX_REMEMBERED_PROMPTS) {
      this.messages = this.messages.slice(promptStarts[promptStarts.length - MAX_REMEMBERED_PROMPTS]);
    }
  }
}
