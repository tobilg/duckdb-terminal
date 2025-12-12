/**
 * URL encoding/decoding utilities for query sharing
 */

import type { ShareableURLResult } from './types';

/** URL sharing version identifier */
const URL_VERSION = 'v1';

/** Maximum URL length for sharing */
export const MAX_URL_LENGTH = 2000;

/**
 * Encode query for URL using URL-safe Base64 without padding (v1 format)
 *
 * @param query - The SQL query to encode
 * @returns URL-safe Base64 encoded string
 */
export const encodeQueryForURL = (query: string): string => {
  // Convert to Base64
  const base64 = btoa(unescape(encodeURIComponent(query)));

  // Make URL-safe: replace + with -, / with _, and remove padding =
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

/**
 * Decode query from URL-safe Base64 (v1 format)
 *
 * @param encodedQuery - URL-safe Base64 encoded query
 * @returns Decoded SQL query string
 */
export const decodeQueryFromURL = (encodedQuery: string): string => {
  // Add padding back if needed
  let base64 = encodedQuery;
  while (base64.length % 4) {
    base64 += '=';
  }

  // Convert back from URL-safe Base64
  base64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Decode
  return decodeURIComponent(escape(atob(base64)));
};

/**
 * Generate the base URL for sharing (without queries)
 *
 * @returns Base URL string
 */
export const getBaseShareURL = (): string => {
  const { protocol, hostname, port } = window.location;
  const portPart = port ? `:${port}` : '';
  return `${protocol}//${hostname}${portPart}/#$queries=${URL_VERSION}`;
};

/**
 * Calculate the encoded length of a query (including comma separator)
 *
 * @param query - The SQL query
 * @returns Length of encoded query plus comma separator
 */
export const getEncodedQueryLength = (query: string): number => {
  return encodeQueryForURL(query).length + 1; // +1 for comma separator
};

/**
 * Generate a shareable URL from selected queries
 *
 * @param queries - Array of SQL queries to include (in execution order)
 * @returns ShareableURLResult with URL and metadata
 */
export const generateShareableURL = (queries: string[]): ShareableURLResult => {
  if (queries.length === 0) {
    const baseUrl = getBaseShareURL();
    return {
      url: baseUrl,
      characterCount: baseUrl.length,
      queryCount: 0,
    };
  }

  const baseUrl = getBaseShareURL();
  const encodedQueries = queries.map(encodeQueryForURL);
  const url = `${baseUrl},${encodedQueries.join(',')}`;

  return {
    url,
    characterCount: url.length,
    queryCount: queries.length,
  };
};

/**
 * Calculate the total URL length for a set of queries
 *
 * @param queries - Array of SQL queries
 * @returns Total character count of the resulting URL
 */
export const calculateURLLength = (queries: string[]): number => {
  return generateShareableURL(queries).characterCount;
};

/**
 * Check if adding a query would exceed the URL length limit
 *
 * @param currentQueries - Currently selected queries
 * @param newQuery - Query to potentially add
 * @param maxLength - Maximum URL length (default: MAX_URL_LENGTH)
 * @returns True if adding the query would exceed the limit
 */
export const wouldExceedLimit = (
  currentQueries: string[],
  newQuery: string,
  maxLength: number = MAX_URL_LENGTH
): boolean => {
  const newQueries = [...currentQueries, newQuery];
  return calculateURLLength(newQueries) > maxLength;
};

/**
 * Parse the shareable URL from the current window location
 *
 * @returns Array of decoded SQL queries, or null if no valid sharing URL found
 */
export const parseShareableURL = (): string[] | null => {
  const hash = window.location.hash;

  // Check for sharing URL format: #$queries=v1,encoded1,encoded2,...
  if (!hash.startsWith('#$queries=')) {
    return null;
  }

  // Remove the #$queries= prefix
  const content = hash.slice('#$queries='.length);

  // Split by comma - first part is version, rest are encoded queries
  const parts = content.split(',');

  if (parts.length < 1) {
    return null;
  }

  const version = parts[0];

  // Currently only v1 is supported
  if (version !== URL_VERSION) {
    console.warn(`Unsupported sharing URL version: ${version}`);
    return null;
  }

  // Decode all queries (skip version)
  const encodedQueries = parts.slice(1);

  if (encodedQueries.length === 0) {
    return null;
  }

  try {
    return encodedQueries.map(decodeQueryFromURL);
  } catch (error) {
    console.error('Failed to decode shared queries:', error);
    return null;
  }
};

/**
 * Clear the sharing URL from the browser's address bar
 * Uses history.replaceState to avoid triggering a page reload
 */
export const clearShareableURL = (): void => {
  const { protocol, hostname, port, pathname } = window.location;
  const portPart = port ? `:${port}` : '';
  const cleanUrl = `${protocol}//${hostname}${portPart}${pathname}`;
  history.replaceState(null, '', cleanUrl);
};
