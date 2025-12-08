import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, readFromClipboard, isClipboardAvailable } from './clipboard';

describe('clipboard', () => {
  // Mock clipboard API
  const mockClipboard = {
    writeText: vi.fn(),
    readText: vi.fn(),
  };

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Setup mock
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isClipboardAvailable', () => {
    it('should return true when clipboard API is available', () => {
      expect(isClipboardAvailable()).toBe(true);
    });

    it('should return false when clipboard API is not available', () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      expect(isClipboardAvailable()).toBe(false);
    });
  });

  describe('copyToClipboard', () => {
    it('should copy text to clipboard', async () => {
      mockClipboard.writeText.mockResolvedValueOnce(undefined);

      const result = await copyToClipboard('test text');

      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
    });

    it('should return false on error', async () => {
      mockClipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await copyToClipboard('test text');

      expect(result).toBe(false);
    });
  });

  describe('readFromClipboard', () => {
    it('should read text from clipboard', async () => {
      mockClipboard.readText.mockResolvedValueOnce('clipboard content');

      const result = await readFromClipboard();

      expect(result).toBe('clipboard content');
    });

    it('should return null on error', async () => {
      mockClipboard.readText.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await readFromClipboard();

      expect(result).toBe(null);
    });
  });
});
