/// <reference types="vite/client" />

/** Application version from package.json, injected at build time by Vite */
declare const __APP_VERSION__: string;

/** Packaged Gespenst WASM files are emitted beside the ESM entry point. */
declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
