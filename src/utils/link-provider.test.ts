import { describe, it, expect } from 'vitest';
import {
  containsURL,
  extractURLs,
  wrapURLInLink,
  linkifyText,
  isValidURL,
  truncateURL,
  LinkProvider,
} from './link-provider';

describe('link-provider', () => {
  describe('containsURL', () => {
    it('should return true for text containing HTTP URL', () => {
      expect(containsURL('Check out https://example.com')).toBe(true);
    });

    it('should return true for text containing HTTPS URL', () => {
      expect(containsURL('Visit http://example.com for more')).toBe(true);
    });

    it('should return false for text without URLs', () => {
      expect(containsURL('No links here')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(containsURL('')).toBe(false);
    });

    it('should detect URL with path', () => {
      expect(containsURL('See https://example.com/path/to/page')).toBe(true);
    });

    it('should detect URL with query string', () => {
      expect(containsURL('https://example.com?foo=bar&baz=qux')).toBe(true);
    });
  });

  describe('extractURLs', () => {
    it('should extract single URL', () => {
      expect(extractURLs('Check https://example.com')).toEqual(['https://example.com']);
    });

    it('should extract multiple URLs', () => {
      const text = 'Visit https://foo.com and http://bar.com';
      expect(extractURLs(text)).toEqual(['https://foo.com', 'http://bar.com']);
    });

    it('should return empty array for no URLs', () => {
      expect(extractURLs('No links')).toEqual([]);
    });

    it('should extract URL with path and query', () => {
      expect(extractURLs('https://example.com/path?q=1')).toEqual(['https://example.com/path?q=1']);
    });
  });

  describe('wrapURLInLink', () => {
    it('should wrap URL in OSC 8 escape sequence', () => {
      const result = wrapURLInLink('https://example.com');
      expect(result).toBe('\x1b]8;;https://example.com\x07https://example.com\x1b]8;;\x07');
    });

    it('should support custom display text', () => {
      const result = wrapURLInLink('https://example.com', 'Example');
      expect(result).toBe('\x1b]8;;https://example.com\x07Example\x1b]8;;\x07');
    });
  });

  describe('linkifyText', () => {
    it('should make URLs clickable', () => {
      const result = linkifyText('Visit https://example.com today');
      expect(result).toContain('\x1b]8;;https://example.com\x07');
      expect(result).toContain('\x1b]8;;\x07');
    });

    it('should linkify multiple URLs', () => {
      const result = linkifyText('https://foo.com and https://bar.com');
      expect(result).toContain('\x1b]8;;https://foo.com\x07');
      expect(result).toContain('\x1b]8;;https://bar.com\x07');
    });

    it('should preserve non-URL text', () => {
      const result = linkifyText('Hello world');
      expect(result).toBe('Hello world');
    });

    it('should preserve surrounding text', () => {
      const result = linkifyText('Check https://x.com now');
      expect(result.startsWith('Check ')).toBe(true);
      expect(result.endsWith(' now')).toBe(true);
    });
  });

  describe('isValidURL', () => {
    it('should return true for valid HTTP URL', () => {
      expect(isValidURL('http://example.com')).toBe(true);
    });

    it('should return true for valid HTTPS URL', () => {
      expect(isValidURL('https://example.com')).toBe(true);
    });

    it('should return false for invalid URL', () => {
      expect(isValidURL('not a url')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidURL('')).toBe(false);
    });

    it('should return true for URL with path and query', () => {
      expect(isValidURL('https://example.com/path?q=1#hash')).toBe(true);
    });
  });

  describe('truncateURL', () => {
    it('should not truncate short URLs', () => {
      const url = 'https://x.com';
      expect(truncateURL(url, 60)).toBe(url);
    });

    it('should truncate long URLs', () => {
      const url = 'https://example.com/very/long/path/that/exceeds/the/maximum/length/allowed';
      const result = truncateURL(url, 40);
      // Result should be significantly shorter than original
      expect(result.length).toBeLessThan(url.length);
      expect(result).toContain('...');
    });

    it('should preserve host in truncated URL', () => {
      const url = 'https://example.com/very/long/path/here';
      const result = truncateURL(url, 30);
      expect(result).toContain('example.com');
    });
  });

  describe('LinkProvider', () => {
    it('should be enabled by default', () => {
      const provider = new LinkProvider();
      expect(provider.isEnabled()).toBe(true);
    });

    it('should be toggleable', () => {
      const provider = new LinkProvider();
      provider.setEnabled(false);
      expect(provider.isEnabled()).toBe(false);
      provider.setEnabled(true);
      expect(provider.isEnabled()).toBe(true);
    });

    it('should process text when enabled', () => {
      const provider = new LinkProvider();
      const result = provider.process('Visit https://example.com');
      expect(result).toContain('\x1b]8;;');
    });

    it('should not process text when disabled', () => {
      const provider = new LinkProvider();
      provider.setEnabled(false);
      const text = 'Visit https://example.com';
      expect(provider.process(text)).toBe(text);
    });

    it('should support truncated URL processing', () => {
      const provider = new LinkProvider();
      provider.setMaxURLLength(30);
      const url = 'https://example.com/very/long/path/that/is/even/longer';
      const result = provider.processWithTruncation(url);
      // Should contain the full URL in the link
      expect(result).toContain(`\x1b]8;;${url}\x07`);
      // Display text should be truncated (shorter than original)
      const displayMatch = result.match(/\x07(.+?)\x1b/);
      expect(displayMatch).toBeTruthy();
      if (displayMatch) {
        expect(displayMatch[1].length).toBeLessThan(url.length);
      }
    });
  });
});
