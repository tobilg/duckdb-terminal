import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRunDefaultBuild, getWllamaCompatUrls, getWllamaWasmUrl } from './wllama-loader';

describe('wllama builds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs the default build where JSPI and Memory64 modules work', () => {
    expect(canRunDefaultBuild()).toBe(true);
  });

  it('needs the compat build where Memory64 modules do not compile, even if 64-bit memories can be created', () => {
    // Safari 27 accepts `new WebAssembly.Memory({ address: 'i64' })` but cannot compile Memory64 modules.
    const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    expect(canRunDefaultBuild()).toBe(false);
    expect(validate).toHaveBeenCalledWith(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]));
  });

  it('needs the compat build without JSPI', () => {
    vi.stubGlobal('WebAssembly', { ...WebAssembly, validate: WebAssembly.validate, Suspending: undefined });
    expect(canRunDefaultBuild()).toBe(false);
  });

  it('loads the compat build from the same wllama version', () => {
    const version = /@wllama\/wllama@([^/]+)\//.exec(getWllamaWasmUrl())![1];
    expect(getWllamaCompatUrls()).toEqual({
      worker: `https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@${version}/wasm/wllama.js`,
      wasm: `https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@${version}/wasm/wllama.wasm`,
    });
  });
});
