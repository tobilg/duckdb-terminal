import type { Theme, ThemeColors } from '@/types';

/**
 * Dark theme colors
 */
const darkColors: ThemeColors = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selection: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

/**
 * Light theme colors
 */
const lightColors: ThemeColors = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#1e1e1e',
  selection: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#008000',
  yellow: '#795e00',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

/**
 * Dark theme
 */
export const darkTheme: Theme = {
  name: 'dark',
  colors: darkColors,
};

/**
 * Light theme
 */
export const lightTheme: Theme = {
  name: 'light',
  colors: lightColors,
};

/**
 * Get theme by name
 */
export function getTheme(name: 'dark' | 'light'): Theme {
  return name === 'light' ? lightTheme : darkTheme;
}

/**
 * Get saved theme preference
 */
export function getSavedTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('duckdb-terminal-theme');
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // localStorage not available
  }
  return 'dark';
}

/**
 * Save theme preference
 */
export function saveTheme(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem('duckdb-terminal-theme', theme);
  } catch {
    // localStorage not available
  }
}
