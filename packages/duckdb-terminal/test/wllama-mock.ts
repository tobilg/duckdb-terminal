import { vi } from 'vitest';
import type { ChatCompletionChunk, ChatCompletionMessage, LoadModelParams } from '@wllama/wllama/esm/index.js';
import type { WllamaModuleType } from '../src/ai/wllama-loader';

/** A streamed chunk, or a pause until the given promise settles. */
export type ScriptStep = Partial<ChatCompletionChunk> | Promise<unknown>;

/**
 * A fake wllama module. Each `createChatCompletion` call replays the next
 * queued script; downloads add the model URL to an in-memory cache.
 */
export function createWllamaMock() {
  const state = {
    cachedUrls: new Set<string>(),
    invalidUrls: new Set<string>(),
    scripts: [] as ScriptStep[][],
    /** Messages of each chat request, copied when the request was made. */
    requests: [] as ChatCompletionMessage[][],
    /** Options of each chat request. */
    requestOptions: [] as Record<string, unknown>[],
    loads: [] as Array<{ url: string; params: LoadModelParams | undefined }>,
    downloads: [] as string[],
    /** Settles a pending download when resolved; leave null to finish immediately. */
    downloadGate: null as Promise<void> | null,
    exits: 0,
    constructorError: null as Error | null,
  };

  class FakeModel {
    constructor(readonly url: string) {}
    validate() {
      return state.invalidUrls.has(this.url) ? 'invalid' : 'valid';
    }
  }

  class Wllama {
    readonly modelManager = {
      getModels: vi.fn(async () => [...state.cachedUrls].map((url) => new FakeModel(url))),
      downloadModel: vi.fn(async (
        url: string,
        options?: { signal?: AbortSignal; progressCallback?: (progress: { loaded: number; total: number }) => void }
      ) => {
        state.downloads.push(url);
        options?.progressCallback?.({ loaded: 0, total: 0 });
        options?.progressCallback?.({ loaded: 50, total: 100 });
        if (state.downloadGate) {
          await new Promise<void>((resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            void state.downloadGate!.then(resolve);
          });
        }
        options?.progressCallback?.({ loaded: 100, total: 100 });
        state.cachedUrls.add(url);
        return new FakeModel(url);
      }),
    };

    constructor(readonly paths: Record<string, string>, readonly config: unknown) {
      if (state.constructorError) throw state.constructorError;
    }

    loadModel = vi.fn(async (model: FakeModel, params?: LoadModelParams) => {
      state.loads.push({ url: model.url, params });
    });

    createChatCompletion = vi.fn(async (options: { messages: ChatCompletionMessage[] }) => {
      state.requests.push(JSON.parse(JSON.stringify(options.messages)) as ChatCompletionMessage[]);
      state.requestOptions.push(options as unknown as Record<string, unknown>);
      const script = state.scripts.shift() ?? [];
      return (async function* () {
        for (const step of script) {
          if (step instanceof Promise) await step;
          else yield step as ChatCompletionChunk;
        }
      })();
    });

    exit = vi.fn(async () => {
      state.exits++;
    });
  }

  return { module: { Wllama } as unknown as WllamaModuleType, state };
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): Partial<ChatCompletionChunk> {
  return { choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }] } as Partial<ChatCompletionChunk>;
}

export const reasoningChunk = (text: string) => chunk({ reasoning_content: text });
export const contentChunk = (text: string) => chunk({ content: text });
export const toolCallChunk = (sql: string, id = 'call_1') => chunk({
  tool_calls: [{ index: 0, id, type: 'function', function: { name: 'query', arguments: JSON.stringify({ query: sql }) } }],
});
export const docsCallChunk = (keywords: string, id = 'call_docs') => chunk({
  tool_calls: [{ index: 0, id, type: 'function', function: { name: 'search_docs', arguments: JSON.stringify({ keywords }) } }],
});
export const finishChunk =(reason: 'stop' | 'length' | 'tool_calls', tokens?: number) => ({
  ...chunk({}, reason),
  ...(tokens ? { timings: { predicted_n: tokens, predicted_per_second: 10 } } : {}),
}) as Partial<ChatCompletionChunk>;

/** A promise that never settles, for simulating long prompt processing. */
export const never = () => new Promise<never>(() => {});
