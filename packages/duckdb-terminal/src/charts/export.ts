import type uPlot from 'uplot';

/**
 * Export chart to PNG and trigger download.
 * Creates a temporary download link and clicks it to initiate download.
 * @param chart - The uPlot chart instance to export
 * @param filename - Optional custom filename (defaults to timestamped name)
 * @throws Error if chart canvas is not available
 */
export function exportToPNG(chart: uPlot, filename?: string): void {
  const canvas = chart.ctx?.canvas;
  if (!canvas) {
    throw new Error('Chart canvas not available');
  }

  // Generate filename with timestamp
  const defaultFilename = generateFilename();
  const finalFilename = filename ?? defaultFilename;

  // Convert canvas to data URL
  const dataUrl = canvas.toDataURL('image/png');

  // Create download link
  const link = document.createElement('a');
  link.download = finalFilename;
  link.href = dataUrl;

  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export chart to PNG as data URL (for programmatic use).
 * @param chart - The uPlot chart instance to export
 * @returns Base64-encoded PNG data URL
 * @throws Error if chart canvas is not available
 */
export function exportToDataURL(chart: uPlot): string {
  const canvas = chart.ctx?.canvas;
  if (!canvas) {
    throw new Error('Chart canvas not available');
  }

  return canvas.toDataURL('image/png');
}

/**
 * Export chart to PNG as Blob (for clipboard/upload).
 * @param chart - The uPlot chart instance to export
 * @returns Promise resolving to PNG Blob
 * @throws Error if chart canvas is not available or blob creation fails
 */
export function exportToBlob(chart: uPlot): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = chart.ctx?.canvas;
    if (!canvas) {
      reject(new Error('Chart canvas not available'));
      return;
    }

    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create blob from canvas'));
      }
    }, 'image/png');
  });
}

/**
 * Copy chart to clipboard (where supported).
 * Uses the Clipboard API to write the chart as a PNG image.
 * @param chart - The uPlot chart instance to copy
 * @throws Error if Clipboard API is not available
 */
export async function copyToClipboard(chart: uPlot): Promise<void> {
  if (!navigator.clipboard?.write) {
    throw new Error('Clipboard API not available');
  }

  const blob = await exportToBlob(chart);
  const item = new ClipboardItem({ 'image/png': blob });
  await navigator.clipboard.write([item]);
}

/**
 * Generate filename with timestamp.
 * Format: duckdb-chart-YYYY-MM-DD-HHmmss.png
 * @returns Generated filename string
 */
function generateFilename(): string {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `duckdb-chart-${year}-${month}-${day}-${hours}${minutes}${seconds}.png`;
}
