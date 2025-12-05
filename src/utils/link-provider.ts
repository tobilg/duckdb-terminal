/**
 * URL link detection and handling for terminal output.
 *
 * This module provides utilities for detecting URLs in text and wrapping them
 * in OSC 8 escape sequences to create clickable hyperlinks in supported terminals.
 *
 * OSC 8 (Operating System Command 8) is a standard escape sequence for hyperlinks:
 * `\x1b]8;;URL\x07LINK_TEXT\x1b]8;;\x07`
 *
 * @module utils/link-provider
 *
 * @example Basic usage
 * ```typescript
 * import { linkifyText, containsURL } from './link-provider';
 *
 * const text = 'Visit https://example.com for more info';
 * if (containsURL(text)) {
 *   const linkedText = linkifyText(text);
 *   // linkedText contains OSC 8 escape sequences
 * }
 * ```
 */

/** Regex pattern for matching HTTP/HTTPS URLs */
const URL_REGEX = /https?:\/\/[^\s<>"\])\[}{'|^`\\]+/gi;

/**
 * OSC 8 hyperlink escape sequence format:
 * \x1b]8;;URL\x07LINK_TEXT\x1b]8;;\x07
 */
const OSC8_START = '\x1b]8;;';
const OSC8_END = '\x07';
const OSC8_CLOSE = '\x1b]8;;\x07';

/**
 * Checks if text contains any URLs.
 *
 * @param text - The text to search for URLs
 * @returns True if text contains at least one URL
 */
export function containsURL(text: string): boolean {
  URL_REGEX.lastIndex = 0;
  return URL_REGEX.test(text);
}

/**
 * Extracts all URLs from text.
 *
 * @param text - The text to extract URLs from
 * @returns Array of URLs found in the text
 */
export function extractURLs(text: string): string[] {
  URL_REGEX.lastIndex = 0;
  return text.match(URL_REGEX) || [];
}

/**
 * Wraps a URL in OSC 8 hyperlink escape sequences.
 *
 * @param url - The URL to link to
 * @param displayText - Optional display text (defaults to URL itself)
 * @returns The URL wrapped in OSC 8 escape sequences
 */
export function wrapURLInLink(url: string, displayText?: string): string {
  const text = displayText ?? url;
  return `${OSC8_START}${url}${OSC8_END}${text}${OSC8_CLOSE}`;
}

/**
 * Processes text and makes all URLs clickable using OSC 8 escape sequences.
 *
 * @param text - The text to process
 * @returns The text with URLs wrapped in hyperlink escape sequences
 */
export function linkifyText(text: string): string {
  URL_REGEX.lastIndex = 0;
  return text.replace(URL_REGEX, (url) => wrapURLInLink(url));
}

/**
 * Validates if a string is a valid URL.
 *
 * @param str - The string to validate
 * @returns True if the string is a valid URL
 */
export function isValidURL(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncates a URL for display if it exceeds maximum length.
 *
 * Preserves the host and shows beginning/end of the path with ellipsis.
 *
 * @param url - The URL to truncate
 * @param maxLength - Maximum display length (default: 60)
 * @returns The truncated URL string
 */
export function truncateURL(url: string, maxLength: number = 60): string {
  if (url.length <= maxLength) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const path = parsed.pathname + parsed.search + parsed.hash;

    // Keep host and beginning/end of path
    const hostLen = host.length;
    const remaining = maxLength - hostLen - 8; // 8 for "https://..."

    if (remaining < 10) {
      return url.substring(0, maxLength - 3) + '...';
    }

    const pathStart = path.substring(0, Math.floor(remaining / 2));
    const pathEnd = path.substring(path.length - Math.floor(remaining / 2));

    return `${parsed.protocol}//${host}${pathStart}...${pathEnd}`;
  } catch {
    return url.substring(0, maxLength - 3) + '...';
  }
}

/**
 * A class for processing text output and adding clickable hyperlinks.
 *
 * The LinkProvider wraps the utility functions in a stateful class that
 * can be enabled/disabled and configured with a maximum URL display length.
 *
 * @example
 * ```typescript
 * const provider = new LinkProvider();
 *
 * // Process text with links
 * const output = provider.process('See https://example.com');
 *
 * // Disable link processing
 * provider.setEnabled(false);
 * ```
 */
export class LinkProvider {
  private enabled: boolean = true;
  private maxURLLength: number = 80;

  /**
   * Enable or disable URL linking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if URL linking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set maximum URL display length
   */
  setMaxURLLength(length: number): void {
    this.maxURLLength = length;
  }

  /**
   * Process text and add hyperlinks to URLs
   */
  process(text: string): string {
    if (!this.enabled) {
      return text;
    }

    return linkifyText(text);
  }

  /**
   * Process text with truncated URL display
   */
  processWithTruncation(text: string): string {
    if (!this.enabled) {
      return text;
    }

    URL_REGEX.lastIndex = 0;
    return text.replace(URL_REGEX, (url) => {
      const displayText = truncateURL(url, this.maxURLLength);
      return wrapURLInLink(url, displayText);
    });
  }
}
