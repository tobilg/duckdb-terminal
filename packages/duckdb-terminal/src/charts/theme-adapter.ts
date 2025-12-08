import type { ThemeColors } from '../types';
import type { ChartTheme } from './types';

/**
 * Convert terminal theme colors to chart theme.
 * Maps terminal colors (background, foreground, ANSI colors) to chart styling.
 * @param colors - Terminal theme colors
 * @returns Chart theme configuration
 */
export function adaptTheme(colors: ThemeColors): ChartTheme {
  return {
    background: colors.background,
    foreground: colors.foreground,
    gridColor: dimColor(colors.foreground, 0.2),
    axisColor: dimColor(colors.foreground, 0.6),
    seriesColors: getSeriesColors(colors),
    tooltipBg: addAlpha(colors.background, 0.95),
    tooltipFg: colors.foreground,
  };
}

/**
 * Get series colors from theme, prioritizing distinct colors.
 * Order: blue, green, red, yellow, magenta, cyan (then bright variants).
 * @param colors - Terminal theme colors
 * @returns Array of colors for chart series
 */
function getSeriesColors(colors: ThemeColors): string[] {
  return [
    colors.blue,
    colors.green,
    colors.red,
    colors.yellow,
    colors.magenta,
    colors.cyan,
    colors.brightBlue,
    colors.brightGreen,
    colors.brightRed,
    colors.brightYellow,
    colors.brightMagenta,
    colors.brightCyan,
  ];
}

/**
 * Dim a color by mixing it with transparency.
 * @param color - The color string (hex or rgb)
 * @param opacity - Opacity value between 0 and 1
 * @returns RGBA color string
 */
function dimColor(color: string, opacity: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

/**
 * Add alpha channel to a color.
 * @param color - The color string (hex or rgb)
 * @param alpha - Alpha value between 0 and 1
 * @returns RGBA color string
 */
function addAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Parse hex or rgb color to RGB values.
 * Supports 3-digit hex, 6-digit hex, and rgb/rgba formats.
 * @param color - The color string to parse
 * @returns Object with r, g, b values, or null if parsing fails
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  // Handle rgb/rgba colors
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  return null;
}

/**
 * Default dark theme for charts (used when terminal theme is unavailable)
 */
export const DEFAULT_DARK_CHART_THEME: ChartTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  gridColor: 'rgba(212, 212, 212, 0.2)',
  axisColor: 'rgba(212, 212, 212, 0.6)',
  seriesColors: [
    '#2472c8', // blue
    '#0dbc79', // green
    '#cd3131', // red
    '#e5e510', // yellow
    '#bc3fbc', // magenta
    '#11a8cd', // cyan
    '#3b8eea', // bright blue
    '#23d18b', // bright green
    '#f14c4c', // bright red
    '#f5f543', // bright yellow
    '#d670d6', // bright magenta
    '#29b8db', // bright cyan
  ],
  tooltipBg: 'rgba(30, 30, 30, 0.95)',
  tooltipFg: '#d4d4d4',
};

/**
 * Default light theme for charts
 */
export const DEFAULT_LIGHT_CHART_THEME: ChartTheme = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  gridColor: 'rgba(30, 30, 30, 0.15)',
  axisColor: 'rgba(30, 30, 30, 0.6)',
  seriesColors: [
    '#0066cc', // blue
    '#008844', // green
    '#cc0000', // red
    '#cc9900', // yellow/gold
    '#9933cc', // magenta
    '#0099aa', // cyan
    '#3399ff', // bright blue
    '#33cc66', // bright green
    '#ff3333', // bright red
    '#ffcc00', // bright yellow
    '#cc66ff', // bright magenta
    '#33cccc', // bright cyan
  ],
  tooltipBg: 'rgba(255, 255, 255, 0.95)',
  tooltipFg: '#1e1e1e',
};

/**
 * Get default chart theme based on mode.
 * Used when terminal theme colors are not available.
 * @param mode - 'dark' or 'light' mode
 * @returns The default chart theme for the specified mode
 */
export function getDefaultChartTheme(mode: 'dark' | 'light'): ChartTheme {
  return mode === 'dark' ? DEFAULT_DARK_CHART_THEME : DEFAULT_LIGHT_CHART_THEME;
}
