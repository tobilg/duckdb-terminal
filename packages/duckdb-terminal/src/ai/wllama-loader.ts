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

/** wllama's build for browsers without JSPI or Memory64, released with the same versions as wllama. */
const WLLAMA_COMPAT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@wllama/wllama-compat';

/** The worker script and WASM of wllama's compat build (wasm32 with Asyncify). */
export const getWllamaCompatUrls = (): { worker: string; wasm: string } => ({
  worker: `${WLLAMA_COMPAT_CDN_BASE}@${__WLLAMA_VERSION__}/wasm/wllama.js`,
  wasm: `${WLLAMA_COMPAT_CDN_BASE}@${__WLLAMA_VERSION__}/wasm/wllama.wasm`,
});

/** `(module (memory i64 1))`: a module with one Memory64 page. */
const MEMORY64_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]);

/**
 * Whether the browser can run wllama's default build, which needs JSPI and
 * Memory64. wllama checks Memory64 by creating a 64-bit memory, which Safari 27
 * allows although it cannot compile Memory64 modules; its worker then fails,
 * and the load never finishes (https://github.com/ngxson/wllama/issues/297).
 * Validating a Memory64 module answers reliably.
 */
export function canRunDefaultBuild(): boolean {
  try {
    return typeof (WebAssembly as { Suspending?: unknown }).Suspending === 'function'
      && WebAssembly.validate(MEMORY64_MODULE);
  } catch {
    return false;
  }
}

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
