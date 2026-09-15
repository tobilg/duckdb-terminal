/**
 * DuckDB Terminal - Demo Application Entry Point
 */

import { createTerminal, darkTheme, lightTheme, parseShareableURL, clearShareableURL } from 'duckdb-terminal';
import 'duckdb-terminal/style.css';
import type { Theme, ThemeColors } from 'duckdb-terminal';

// Custom theme: Tokyo Night
const tokyoNightColors: ThemeColors = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selection: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

const tokyoNightTheme: Theme = {
  name: 'tokyo-night',
  colors: tokyoNightColors,
};

// Custom theme: Dracula
const draculaColors: ThemeColors = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  selection: '#44475a',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

const draculaTheme: Theme = {
  name: 'dracula',
  colors: draculaColors,
};

// Custom theme: Solarized Dark
const solarizedDarkColors: ThemeColors = {
  background: '#002b36',
  foreground: '#839496',
  cursor: '#839496',
  selection: '#073642',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#002b36',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
};

const solarizedDarkTheme: Theme = {
  name: 'solarized-dark',
  colors: solarizedDarkColors,
};

// Theme registry
const themes: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  'tokyo-night': tokyoNightTheme,
  dracula: draculaTheme,
  'solarized-dark': solarizedDarkTheme,
};

// Get saved theme from localStorage
function getSavedThemeName(): string {
  try {
    const saved = localStorage.getItem('duckdb-terminal-theme');
    if (saved && themes[saved]) {
      return saved;
    }
  } catch {
    // localStorage not available
  }
  return 'dark';
}

// Save theme to localStorage
function saveThemeName(name: string): void {
  try {
    localStorage.setItem('duckdb-terminal-theme', name);
  } catch {
    // localStorage not available
  }
}

// Calculate responsive font size based on viewport width
function getResponsiveFontSize(): number {
  const width = window.innerWidth;
  if (width <= 480) return 12;
  if (width <= 768) return 13;
  return 14;
}

type Terminal = Awaited<ReturnType<typeof createTerminal>>;
const themeClasses = Object.keys(themes);

function applyPageTheme(name: string): void {
  document.body.classList.remove(...themeClasses);
  document.body.classList.add(name);
}

function reportActionError(terminal: Terminal, error: unknown): void {
  terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`);
  terminal.refreshPrompt();
}

function setupActions(terminal: Terminal): void {
  const bind = (id: string, action: () => void | Promise<unknown>) => {
    document.getElementById(id)?.addEventListener('click', (event) => {
      event.stopPropagation();
      // Start the action synchronously; file pickers need the original click activation.
      try {
        const result = action();
        if (result) void result.catch((error: unknown) => reportActionError(terminal, error));
      } catch (error) {
        reportActionError(terminal, error);
      }
    });
  };
  bind('action-keyboard', () => terminal.focus());
  bind('action-copy', async () => { await terminal.copyLastResult(); terminal.focus(); });
  bind('action-clear', () => terminal.runCommand('.clear'));
  bind('action-help', () => terminal.runCommand('.help'));
  bind('action-files', () => terminal.runCommand('.open'));
  bind('action-share', () => terminal.openSharingModal());
  bind('sidebar-share', () => terminal.openSharingModal());
  terminal.on('stateChange', ({ state }) => {
    for (const id of ['action-help', 'action-files', 'action-clear']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = state !== 'idle';
    }
  });
}

async function main() {
  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('Terminal container not found');
    return;
  }

  // Get saved theme
  const savedThemeName = getSavedThemeName();
  const savedTheme = themes[savedThemeName] || darkTheme;

  // Apply theme class to body
  applyPageTheme(savedThemeName);

  // Set dropdown to saved value
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.value = savedThemeName;
  }

  container.setAttribute('aria-busy', 'true');
  try {
    // Create and start the terminal with responsive font size
    const terminal = await createTerminal({
      container,
      theme: savedTheme,
      welcomeMessage: true,
      fontSize: getResponsiveFontSize(),
      enableCharts: true,
    });

    terminal.on('themeChange', ({ theme }) => {
      const name = themes[theme.name] ? theme.name : terminal.getTheme();
      saveThemeName(name);
      applyPageTheme(name);
      if (themeSelect) themeSelect.value = name;
    });
    themeSelect?.addEventListener('change', () => {
      const theme = themes[themeSelect.value];
      if (theme) void terminal.setTheme(theme).catch((error: unknown) => reportActionError(terminal, error));
    });
    setupActions(terminal);
    container.setAttribute('aria-busy', 'false');
    let restoreFocus = false;
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) restoreFocus = container.contains(document.activeElement);
      else void terminal.destroy().catch((error: unknown) => console.error('Terminal cleanup failed', error));
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && restoreFocus) terminal.focus();
    });

    // Check for shared queries in URL
    const sharedQueries = parseShareableURL();
    if (sharedQueries && sharedQueries.length > 0) {
      // Clear the URL to prevent re-execution on refresh
      clearShareableURL();

      // Execute shared queries sequentially
      // Clear the prompt line first (move to start of line and clear it)
      terminal.write('\r\x1b[K');
      terminal.writeln('Executing shared queries...');
      terminal.writeln('');

      for (const query of sharedQueries) {
        // Print the query being executed with syntax highlighting
        const highlightedQuery = await terminal.highlightSQL(query);
        terminal.writeln(`🦆 ${highlightedQuery}`);
        terminal.writeln('');

        // Execute the query
        await terminal.executeSQL(query);
        terminal.writeln('');
      }

      // Show the prompt after all queries are executed
      terminal.refreshPrompt();
    }
  } catch (error) {
    container.setAttribute('aria-busy', 'false');
    console.error('Failed to initialize terminal:', error);
    // Use textContent to prevent XSS from error messages
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'padding: 20px; color: #f14c4c;';

    const heading = document.createElement('h2');
    heading.textContent = 'Failed to initialize DuckDB Terminal';
    errorDiv.appendChild(heading);

    const errorMessage = document.createElement('p');
    errorMessage.textContent = error instanceof Error ? error.message : 'Unknown error';
    errorDiv.appendChild(errorMessage);

    const helpText = document.createElement('p');
    helpText.textContent = 'Please check the console for more details.';
    errorDiv.appendChild(helpText);

    container.innerHTML = '';
    container.appendChild(errorDiv);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
