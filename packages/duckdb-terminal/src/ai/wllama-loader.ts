/**
 * Loads wllama (llama.cpp compiled to WebAssembly with WebGPU) from jsDelivr on
 * first use, so the library does not ship its 9.6 MB WASM file.
 *
 * The version is pinned at build time to the `@wllama/wllama` devDependency.
 *
 * @module ai/wllama-loader
 */

import type * as WllamaModule from '@wllama/wllama/esm/index.js';

/** Version injected at build time from the @wllama/wllama package.json. */
declare const __WLLAMA_VERSION__: string;

export type WllamaModuleType = typeof WllamaModule;

const WLLAMA_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@wllama/wllama';

/** URL of the self-contained wllama ES module. */
export const getWllamaModuleUrl = (): string =>
  `${WLLAMA_CDN_BASE}@${__WLLAMA_VERSION__}/esm/index.min.js`;

/** URL of the wllama WASM binary (fetched by wllama's worker when a model loads). */
export const getWllamaWasmUrl = (): string =>
  `${WLLAMA_CDN_BASE}@${__WLLAMA_VERSION__}/esm/wasm/wllama.wasm`;

let loading: Promise<WllamaModuleType> | null = null;

/** Imports the wllama module once; a failed import can be retried. */
export function loadWllama(): Promise<WllamaModuleType> {
  if (!loading) {
    const url = getWllamaModuleUrl();
    loading = (import(/* @vite-ignore */ url) as Promise<WllamaModuleType>).catch((error: unknown) => {
      loading = null;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load wllama from ${url}: ${reason}`);
    });
  }
  return loading;
}
