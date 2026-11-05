/**
 * Loads the bundled DuckDB documentation on first use and searches it.
 *
 * The JSON file is emitted as a separate asset next to the library (like the
 * Gespenst WASM files), so it is fetched only when the model first searches.
 *
 * @module ai/docs
 */

import docsAssetUrl from './docs/duckdb-docs.json?url&no-inline';
import { DocsIndex, chunksFromBundle, type DocsBundle, type DocsChunk } from './docs-search';

let loading: Promise<DocsIndex> | null = null;

/** Fetches the documentation and builds its index once; a failed load can be retried. */
export function loadDocsIndex(fetchDocs: typeof fetch = fetch): Promise<DocsIndex> {
  if (!loading) {
    loading = (async () => {
      const response = await fetchDocs(docsAssetUrl);
      if (!response.ok) {
        throw new Error(`could not load the DuckDB documentation (HTTP ${response.status})`);
      }
      const bundle = (await response.json()) as DocsBundle;
      return new DocsIndex(chunksFromBundle(bundle));
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** Searches the bundled documentation. */
export async function searchDocs(query: string, limit = 3): Promise<DocsChunk[]> {
  return (await loadDocsIndex()).search(query, limit);
}
