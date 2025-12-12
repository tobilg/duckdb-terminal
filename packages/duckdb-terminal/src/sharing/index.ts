/**
 * Sharing module for DuckDB Terminal
 *
 * Provides functionality to share SQL queries via URL.
 */

export { SharingModal } from './sharing-modal';
export {
  encodeQueryForURL,
  decodeQueryFromURL,
  generateShareableURL,
  parseShareableURL,
  clearShareableURL,
  calculateURLLength,
  wouldExceedLimit,
  getBaseShareURL,
  getEncodedQueryLength,
  MAX_URL_LENGTH,
} from './url-encoding';
export type {
  SharingModalState,
  ShareableQuery,
  SharingModalEvents,
  SharingModalConfig,
  ShareableURLResult,
} from './types';
