import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatFileSize,
  getFileExtension,
  isSupportedFile,
  getFileInfo,
  readFileAsBuffer,
  readFileAsText,
  setupDragAndDrop,
  validateFileSize,
  FileSizeError,
  MAX_FILE_SIZE,
} from './file-handler';

describe('formatFileSize', () => {
  it('should format 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('should format kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(2621440)).toBe('2.5 MB');
  });

  it('should format gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
    expect(formatFileSize(1610612736)).toBe('1.5 GB');
  });
});

describe('getFileExtension', () => {
  it('should return extension for simple filename', () => {
    expect(getFileExtension('data.csv')).toBe('csv');
  });

  it('should return lowercase extension', () => {
    expect(getFileExtension('data.CSV')).toBe('csv');
    expect(getFileExtension('data.ParQuet')).toBe('parquet');
  });

  it('should handle multiple dots', () => {
    expect(getFileExtension('data.backup.json')).toBe('json');
  });

  it('should return empty string for no extension', () => {
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('README')).toBe('');
  });

  it('should handle hidden files with extension', () => {
    expect(getFileExtension('.env.local')).toBe('local');
  });
});

describe('isSupportedFile', () => {
  it('should return true for CSV files', () => {
    expect(isSupportedFile('data.csv')).toBe(true);
  });

  it('should return true for Parquet files', () => {
    expect(isSupportedFile('data.parquet')).toBe(true);
  });

  it('should return true for JSON files', () => {
    expect(isSupportedFile('data.json')).toBe(true);
  });

  it('should return true for DuckDB files', () => {
    expect(isSupportedFile('data.db')).toBe(true);
    expect(isSupportedFile('data.duckdb')).toBe(true);
  });

  it('should return false for unsupported files', () => {
    expect(isSupportedFile('data.txt')).toBe(false);
    expect(isSupportedFile('data.xlsx')).toBe(false);
    expect(isSupportedFile('data.sql')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isSupportedFile('data.CSV')).toBe(true);
    expect(isSupportedFile('data.PARQUET')).toBe(true);
  });
});

describe('getFileInfo', () => {
  it('should extract file info correctly', () => {
    const mockFile = new File(['test content'], 'test.csv', {
      type: 'text/csv',
      lastModified: 1700000000000,
    });

    const info = getFileInfo(mockFile);

    expect(info.name).toBe('test.csv');
    expect(info.size).toBe(12); // 'test content' length
    expect(info.type).toBe('text/csv');
    expect(info.lastModified).toEqual(new Date(1700000000000));
  });

  it('should use extension when type is empty', () => {
    const mockFile = new File(['test'], 'data.parquet', {
      type: '',
      lastModified: 1700000000000,
    });

    const info = getFileInfo(mockFile);
    expect(info.type).toBe('parquet');
  });
});

describe('validateFileSize', () => {
  it('should not throw for files under the limit', () => {
    const file = new File(['small content'], 'small.txt', { type: 'text/plain' });
    expect(() => validateFileSize(file)).not.toThrow();
  });

  it('should throw FileSizeError for files over the limit', () => {
    // Create a file that's larger than our custom limit
    const file = new File(['x'.repeat(1000)], 'large.txt', { type: 'text/plain' });
    expect(() => validateFileSize(file, 100)).toThrow(FileSizeError);
  });

  it('should include filename and size in error', () => {
    const file = new File(['x'.repeat(1000)], 'big-file.csv', { type: 'text/csv' });
    try {
      validateFileSize(file, 100);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FileSizeError);
      const fileSizeError = error as FileSizeError;
      expect(fileSizeError.filename).toBe('big-file.csv');
      expect(fileSizeError.size).toBe(1000);
      expect(fileSizeError.maxSize).toBe(100);
    }
  });

  it('should use custom max size when provided', () => {
    const file = new File(['x'.repeat(50)], 'medium.txt', { type: 'text/plain' });
    // Should pass with default limit
    expect(() => validateFileSize(file)).not.toThrow();
    // Should fail with smaller limit
    expect(() => validateFileSize(file, 10)).toThrow(FileSizeError);
  });
});

describe('MAX_FILE_SIZE', () => {
  it('should be 100MB', () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
  });
});

describe('readFileAsBuffer', () => {
  it('should read file content as Uint8Array', async () => {
    const content = 'Hello, World!';
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const result = await readFileAsBuffer(file);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(content.length);
  });

  it('should throw FileSizeError for files over the limit', async () => {
    const file = new File(['x'.repeat(1000)], 'large.txt', { type: 'text/plain' });
    await expect(readFileAsBuffer(file, 100)).rejects.toThrow(FileSizeError);
  });

  it('should accept files under custom limit', async () => {
    const content = 'small content';
    const file = new File([content], 'small.txt', { type: 'text/plain' });
    const result = await readFileAsBuffer(file, 1000);
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe('readFileAsText', () => {
  it('should read file content as text', async () => {
    const content = 'Hello, World!';
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const result = await readFileAsText(file);

    expect(result).toBe(content);
  });
});

describe('setupDragAndDrop', () => {
  let element: HTMLDivElement;
  let onFiles: (files: File[]) => void;

  // Helper to create a mock drag event (DragEvent not available in jsdom)
  const createDragEvent = (type: string): Event => {
    const event = new Event(type, {
      bubbles: true,
      cancelable: true,
    });
    // Add dataTransfer property
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [] },
      writable: true,
    });
    return event;
  };

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    onFiles = vi.fn();
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  it('should add drag-over class on dragover', () => {
    setupDragAndDrop(element, onFiles);

    const event = createDragEvent('dragover');
    element.dispatchEvent(event);

    expect(element.classList.contains('drag-over')).toBe(true);
  });

  it('should remove drag-over class on dragleave', () => {
    setupDragAndDrop(element, onFiles);

    element.classList.add('drag-over');
    const event = createDragEvent('dragleave');
    element.dispatchEvent(event);

    expect(element.classList.contains('drag-over')).toBe(false);
  });

  it('should return cleanup function', () => {
    const cleanup = setupDragAndDrop(element, onFiles);

    expect(typeof cleanup).toBe('function');

    // After cleanup, dragover shouldn't add the class
    cleanup();
    const event = createDragEvent('dragover');
    element.dispatchEvent(event);

    // Class should not be added after cleanup
    expect(element.classList.contains('drag-over')).toBe(false);
  });
});
