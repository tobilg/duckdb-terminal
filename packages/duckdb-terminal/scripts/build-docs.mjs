#!/usr/bin/env node
// Builds src/ai/docs/duckdb-docs.json, the documentation the `.ai` assistant
// searches, from DuckDB's single-file Markdown export.
//
//   pnpm run build:docs                       # download the current export
//   pnpm run build:docs -- --input docs.md    # use a local copy
//
// Regenerate whenever the DuckDB-Wasm engine moves to a new DuckDB release.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { extractChunks, serializeChunks } from './docs/extract.mjs';

const SOURCE = 'https://blobs.duckdb.org/docs/duckdb-docs.md';
const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../src/ai/docs/duckdb-docs.json');

const inputIndex = process.argv.indexOf('--input');
let markdown;
let lastModified;
if (inputIndex !== -1) {
  markdown = readFileSync(process.argv[inputIndex + 1], 'utf8');
} else {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Could not download ${SOURCE}: HTTP ${response.status}`);
  markdown = await response.text();
  lastModified = response.headers.get('last-modified') ?? undefined;
}

const extracted = extractChunks(markdown);
const json = serializeChunks(extracted, { source: SOURCE, ...(lastModified ? { lastModified } : {}) });
writeFileSync(output, json);

const sizes = extracted.chunks.map((chunk) => chunk.text.length).sort((a, b) => a - b);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(
  `Wrote ${output}\n` +
  `  DuckDB ${extracted.docsVersion} docs: ${extracted.chunks.length} chunks ` +
  `(median ${sizes[Math.floor(sizes.length / 2)]} chars, max ${sizes.at(-1)})\n` +
  `  ${kb(Buffer.byteLength(json))} (${kb(gzipSync(json).length)} gzipped) from ${kb(Buffer.byteLength(markdown))} of Markdown`
);
