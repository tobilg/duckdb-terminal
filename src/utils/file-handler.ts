/**
 * File handling utilities for DuckDB Terminal
 */

/** Maximum allowed file size (100MB) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Error thrown when a file exceeds the maximum size limit */
export class FileSizeError extends Error {
  constructor(
    public readonly filename: string,
    public readonly size: number,
    public readonly maxSize: number = MAX_FILE_SIZE
  ) {
    super(
      `File "${filename}" (${formatFileSize(size)}) exceeds maximum size of ${formatFileSize(maxSize)}`
    );
    this.name = 'FileSizeError';
  }
}

/**
 * Validates that a file does not exceed the maximum size limit.
 *
 * @param file - The file to validate
 * @param maxSize - Optional maximum size in bytes (defaults to MAX_FILE_SIZE)
 * @throws FileSizeError if the file exceeds the maximum size
 */
export function validateFileSize(file: File, maxSize: number = MAX_FILE_SIZE): void {
  if (file.size > maxSize) {
    throw new FileSizeError(file.name, file.size, maxSize);
  }
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: Date;
}

/**
 * Open a file picker dialog
 */
export async function pickFiles(options?: {
  multiple?: boolean;
  accept?: string;
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options?.multiple ?? true;
    input.accept = options?.accept ?? '.csv,.parquet,.json,.db,.duckdb';

    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      resolve(files);
    };

    input.oncancel = () => {
      resolve([]);
    };

    input.click();
  });
}

/**
 * Read file as ArrayBuffer with size validation.
 *
 * @param file - The file to read
 * @param maxSize - Optional maximum size in bytes (defaults to MAX_FILE_SIZE)
 * @throws FileSizeError if the file exceeds the maximum size
 */
export async function readFileAsBuffer(
  file: File,
  maxSize: number = MAX_FILE_SIZE
): Promise<Uint8Array> {
  validateFileSize(file, maxSize);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read file as text
 */
export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file extension
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Check if file is supported
 */
export function isSupportedFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ['csv', 'parquet', 'json', 'db', 'duckdb'].includes(ext);
}

/**
 * Get file info
 */
export function getFileInfo(file: File): FileInfo {
  return {
    name: file.name,
    size: file.size,
    type: file.type || getFileExtension(file.name),
    lastModified: new Date(file.lastModified),
  };
}

/**
 * Download data as file
 */
export function downloadFile(
  content: string | Uint8Array,
  filename: string,
  mimeType: string = 'application/octet-stream'
): void {
  const blobParts: BlobPart[] =
    content instanceof Uint8Array ? [new Uint8Array(content)] : [content];
  const blob = new Blob(blobParts, { type: mimeType });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Setup drag and drop handler
 */
export function setupDragAndDrop(
  element: HTMLElement,
  onFiles: (files: File[]) => void
): () => void {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.add('drag-over');
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      onFiles(files);
    }
  };

  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('drop', handleDrop);

  // Return cleanup function
  return () => {
    element.removeEventListener('dragover', handleDragOver);
    element.removeEventListener('dragleave', handleDragLeave);
    element.removeEventListener('drop', handleDrop);
  };
}
