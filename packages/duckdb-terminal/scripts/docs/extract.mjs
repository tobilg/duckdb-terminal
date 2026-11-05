// Turns DuckDB's single-file Markdown documentation into search chunks for the
// `.ai` assistant's docs tool. Pure functions; scripts/build-docs.mjs does the I/O.
//
// Every real heading in the export carries an anchor such as
// {#docs:2.0:sql:statements:pivot::syntax}, which gives the page path, the
// version, and the duckdb.org URL. Lines inside code fences are never headings.

/** Documentation areas (page path prefixes) left out of the chunks. */
export const DEFAULT_EXCLUDE = [
  'clients/', // client APIs for other languages, including the DuckDB CLI
  'connect',
  'core_extensions/spatial',
  'dev/',
  'guides/data_viewers',
  'guides/odbc',
  'guides/offline-copy',
  'guides/python',
  'guides/sql_editors',
  'internals',
  'quack',
];

/** Exceptions to DEFAULT_EXCLUDE. */
export const DEFAULT_KEEP = ['clients/wasm'];

/** Largest chunk, in characters. Smaller subtrees are merged into one chunk. */
export const MAX_CHUNK_CHARS = 3000;

const HEADING = /^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Code the browser terminal cannot run: shells (the DuckDB CLI) and other
 * programming languages. `console` blocks hold DuckDB error messages and stay.
 */
export const FOREIGN_CODE = new Set([
  'bash', 'batch', 'c', 'cpp', 'go', 'java', 'javascript', 'js', 'julia', 'matlab',
  'powershell', 'py', 'python', 'r', 'rust', 'sh', 'shell', 'swift', 'ts', 'typescript', 'zsh',
]);

/**
 * Parses the anchor of a heading.
 * `docs:2.0:sql:statements:pivot::syntax` → { version: '2.0', page: 'sql/statements/pivot', section: 'syntax' }
 */
export function parseAnchor(anchor) {
  const match = /^docs:([^:]+):([^:]+(?::[^:]+)*)(?:::(.*))?$/.exec(anchor || '');
  if (!match) return null;
  return { version: match[1], page: match[2].split(':').join('/'), section: match[3] || '' };
}

/** Whether a page belongs in the chunks. */
export function isIncluded(page, exclude = DEFAULT_EXCLUDE, keep = DEFAULT_KEEP) {
  if (keep.some((prefix) => page === prefix || page.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) return true;
  return !exclude.some((prefix) => page === prefix.replace(/\/$/, '') || page.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

/** Builds the heading tree, ignoring heading-like lines inside code fences. */
export function parseHeadingTree(markdown) {
  const root = { title: '', level: 0, anchor: '', lines: [], children: [], parent: null };
  let node = root;
  let fence = null;
  for (const line of markdown.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
    }
    const heading = !fence && !fenceMatch ? HEADING.exec(line) : null;
    if (heading) {
      const level = heading[1].length;
      while (node.level >= level) node = node.parent;
      const child = { title: heading[2].trim(), level, anchor: heading[3] || '', lines: [], children: [], parent: node };
      node.children.push(child);
      node = child;
    } else {
      node.lines.push(line);
    }
  }
  return root;
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * Removes markup the model does not need: HTML tags, link targets, images,
 * Liquid tags, and Kramdown attribute lists. Code fences are left untouched.
 */
export function cleanMarkdown(text) {
  // Split into prose and fenced code; prose is cleaned as a whole because
  // link text can span lines.
  const segments = [];
  let current = { code: false, lines: [] };
  let fence = null;
  for (const line of text.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (!fence && fenceMatch) {
      segments.push(current);
      current = { code: true, lines: [line] };
      fence = fenceMatch[1];
    } else if (fence && fenceMatch && fenceMatch[1] === fence) {
      current.lines.push(line);
      segments.push(current);
      current = { code: false, lines: [] };
      fence = null;
    } else {
      current.lines.push(line);
    }
  }
  segments.push(current);
  return pruneSegments(segments)
    .map(({ code, lines }) => (code ? lines.join('\n') : cleanProse(lines.join('\n'))))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The language of an opening code fence, in lower case ('' when it has none). */
function fenceLanguage(line) {
  return line.trim().replace(/^(```|~~~)/, '').trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Drops what cannot help in the browser: code in other languages, with the
 * paragraph introducing it when that ends in a colon ("Read a CSV from stdin:"),
 * and the output of a SQL example (a table or text block right after it),
 * which small models take for part of the example.
 */
function pruneSegments(segments) {
  const kept = [];
  let afterSql = false; // only blank lines since the end of a SQL block
  for (const segment of segments) {
    if (segment.code) {
      const language = fenceLanguage(segment.lines[0]);
      const output = afterSql && language === 'text';
      afterSql = false;
      if (FOREIGN_CODE.has(language)) {
        dropIntro(kept.at(-1));
        continue;
      }
      if (output) continue;
      kept.push(segment);
      afterSql = language === 'sql';
      continue;
    }
    const lines = afterSql ? withoutLeadingTable(segment.lines) : segment.lines;
    if (lines.some((line) => line.trim())) afterSql = false;
    kept.push({ code: false, lines });
  }
  return kept;
}

/** Removes the last paragraph of a prose segment if it ends in a colon. */
function dropIntro(segment) {
  if (!segment || segment.code) return;
  const { lines } = segment;
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  while (start > 0 && lines[start - 1].trim()) start--;
  if (end > start && lines[end - 1].trimEnd().endsWith(':')) lines.splice(start, end - start);
}

/** Prose lines without a table at their start (the result of the SQL block before them). */
function withoutLeadingTable(lines) {
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  if (!lines[index]?.trimStart().startsWith('|')) return lines;
  while (index < lines.length && lines[index].trimStart().startsWith('|')) index++;
  return ['', ...lines.slice(index)];
}

function cleanProse(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Link text may itself contain brackets, as in [`UNION [ALL]`](#docs:...).
    .replace(/\[((?:[^[\]]|\[[^[\]]*\])*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, '')
    .replace(/\{%[^%]*%\}/g, '')
    .replace(/\{:\s*[.#][^}]*\}/g, '') // Kramdown attribute lists such as {: .table}
    .replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/[ \t]+$/gm, '');
}

/** Renders a subtree as Markdown; descendant headings become `###` headings. */
function renderSubtree(node, includeOwnHeading) {
  const parts = [];
  if (includeOwnHeading) parts.push(`### ${node.title}`);
  const own = cleanMarkdown(node.lines.join('\n'));
  if (own) parts.push(own);
  for (const child of node.children) {
    if (child.anchor && !isPageIncluded(child)) continue;
    const rendered = renderSubtree(child, true);
    if (rendered) parts.push(rendered);
  }
  return parts.join('\n\n');
}

function isPageIncluded(node, exclude, keep) {
  const parsed = parseAnchor(node.anchor);
  return !parsed || isIncluded(parsed.page, exclude, keep);
}

/**
 * Splits text longer than `max` at blank lines (or line breaks), keeping code
 * fences balanced across parts.
 */
export function splitText(text, max = MAX_CHUNK_CHARS) {
  if (text.length <= max) return [text];
  const parts = [];
  let lines = [];
  let size = 0;
  let fence = null; // fence marker still open after `lines`
  let lastBreak = 0; // number of lines up to the last blank line outside a fence

  // Emits the first `count` lines. A fence still open there is closed and
  // reopened at the start of the next part.
  const emit = (count, openFence) => {
    const body = lines.slice(0, count).join('\n').trim();
    if (body) parts.push(openFence ? `${body}\n${openFence}` : body);
    const rest = lines.slice(count);
    lines = openFence ? [openFence, ...rest] : rest;
    size = lines.reduce((total, line) => total + line.length + 1, 0);
    lastBreak = 0;
  };

  for (const line of text.split('\n')) {
    // Prefer the last paragraph break; cut mid-paragraph only when there is none.
    while (size + line.length + 1 > max && lines.length > 0) {
      if (lastBreak > 0) {
        emit(lastBreak, null);
      } else {
        emit(lines.length, fence);
        break;
      }
    }
    lines.push(line);
    size += line.length + 1;
    const m = FENCE.exec(line);
    if (m) fence = fence ? (m[1] === fence ? null : fence) : m[1];
    if (!fence && line.trim() === '') lastBreak = lines.length;
  }
  if (lines.length) emit(lines.length, null);
  return parts;
}

/**
 * Extracts search chunks: one per subtree that fits into `maxChars`, otherwise
 * one per section, with oversized sections split into parts.
 *
 * @returns {{ docsVersion: string, chunks: Array<{ path: string, url: string, text: string }> }}
 */
export function extractChunks(markdown, { exclude = DEFAULT_EXCLUDE, keep = DEFAULT_KEEP, maxChars = MAX_CHUNK_CHARS } = {}) {
  const root = parseHeadingTree(markdown);
  const chunks = [];
  let docsVersion = '';

  const emit = (node, trail, text) => {
    const parsed = parseAnchor(node.anchor);
    const url = parsed.section ? `${parsed.page}#${parsed.section}` : parsed.page;
    const pieces = splitText(text, maxChars);
    pieces.forEach((piece, index) => {
      const suffix = pieces.length > 1 ? ` (part ${index + 1} of ${pieces.length})` : '';
      chunks.push({ path: trail.join(' › ') + suffix, url, text: piece });
    });
  };

  const visit = (node, trail) => {
    const parsed = parseAnchor(node.anchor);
    const path = [...trail, node.title];
    if (!parsed) {
      // Part headings ({#sql}, {#clients}) only group pages, which decide for
      // themselves; the unanchored summary and acknowledgments are skipped.
      if (node.anchor) for (const child of node.children) visit(child, path);
      return;
    }
    docsVersion ||= parsed.version;
    if (!isIncluded(parsed.page, exclude, keep)) return;
    const whole = renderSubtree(node, false);
    if (whole.length <= maxChars) {
      if (whole) emit(node, path, whole);
      return;
    }
    const own = cleanMarkdown(node.lines.join('\n'));
    if (own) emit(node, path, own);
    for (const child of node.children) visit(child, path);
  };

  for (const top of root.children) visit(top, []);
  return { docsVersion, chunks };
}

/** Serializes chunks with one chunk per line, so regenerated files diff well. */
export function serializeChunks({ docsVersion, chunks }, meta = {}) {
  const header = JSON.stringify({ format: 1, docsVersion, ...meta });
  const rows = chunks.map((chunk) => JSON.stringify([chunk.path, chunk.url, chunk.text]));
  return `${header.slice(0, -1)},"chunks":[\n${rows.join(',\n')}\n]}\n`;
}
