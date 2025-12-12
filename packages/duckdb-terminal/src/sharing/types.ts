/**
 * Types for the sharing feature
 */

/** State of the sharing modal overlay */
export type SharingModalState = 'hidden' | 'showing' | 'visible' | 'hiding';

/** A query item in the sharing modal */
export interface ShareableQuery {
  /** The SQL query string */
  query: string;
  /** Order number for display (1-based) */
  order: number;
  /** Whether this query is selected for sharing */
  selected: boolean;
  /** Encoded length of this query (for character count tracking) */
  encodedLength: number;
}

/** Events emitted by the sharing modal */
export interface SharingModalEvents {
  /** Called when the modal is dismissed (ESC, backdrop click, or close button) */
  onDismiss?: () => void;
  /** Called when queries are successfully copied to clipboard */
  onCopy?: (url: string) => void;
}

/** Configuration for the sharing modal */
export interface SharingModalConfig {
  /** Maximum URL length (default: 2000) */
  maxUrlLength?: number;
  /** Number of queries to load initially (default: 5) */
  initialQueryCount?: number;
  /** Number of queries to load when "load older" is clicked (default: 5) */
  loadMoreCount?: number;
}

/** Result of generating a shareable URL */
export interface ShareableURLResult {
  /** The generated URL */
  url: string;
  /** Total character count */
  characterCount: number;
  /** Number of queries included */
  queryCount: number;
}
