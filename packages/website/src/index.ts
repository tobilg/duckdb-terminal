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
/** The small-screen layout of index.html: up to 768px wide, or phones in landscape. */
const SMALL_SCREEN = '(max-width: 768px), (orientation: landscape) and (max-height: 500px)';

function getResponsiveFontSize(): number {
  if (window.innerWidth <= 480) return 12;
  if (window.matchMedia(SMALL_SCREEN).matches) return 13;
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

/**
 * The menu at the end of the side or top bar on small screens, which holds the
 * documentation and package links. Returns a function that closes it.
 */
function setupLinksMenu(): () => void {
  const toggle = document.getElementById('actions-toggle');
  const menu = document.getElementById('actions-menu');
  if (!toggle || !menu) return () => {};
  const close = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    // Below the button and aligned to its right edge in the top bar, beside it in the
    // side bar, and inside the screen either way.
    const button = toggle.getBoundingClientRect();
    const bar = (toggle.closest('.sidebar') ?? toggle).getBoundingClientRect();
    const horizontal = bar.width > bar.height;
    const left = horizontal ? button.right - menu.offsetWidth : bar.right;
    const top = horizontal ? bar.bottom : button.top;
    menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(top, window.innerHeight - menu.offsetHeight - 4))}px`;
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  // Capture phase: the terminal handles its own pointer events.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !toggle.contains(target)) close();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      toggle.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) close();
  });
  window.addEventListener('resize', close);
  return close;
}

function setupActions(terminal: Terminal): void {
  const closeMenu = setupLinksMenu();
  const bind = (id: string, action: () => void | Promise<unknown>) => {
    document.getElementById(id)?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeMenu();
      // Start the action synchronously; file pickers and the on-screen keyboard need the original tap.
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
  bind('sidebar-share', () => terminal.openSharingModal());
  terminal.on('stateChange', ({ state }) => {
    for (const id of ['action-help', 'action-files', 'action-clear']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = state !== 'idle';
    }
  });
}

/**
 * Keeps the page inside the part of the screen the on-screen keyboard leaves
 * free. iOS Safari (and Chrome on Android without `interactive-widget`) lays
 * the keyboard over the page instead of shrinking it, so the terminal's last
 * rows, where the prompt is, ended up under the keyboard. The visual viewport
 * excludes the keyboard: sizing the page to it gives the terminal fewer rows,
 * and the terminal keeps the cursor row visible when it shrinks.
 */
function fitToVisualViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;
  const update = () => {
    // Times the scale: pinch-zooming also shrinks the visual viewport, but not the space for the page.
    root.style.setProperty('--app-height', `${Math.round(viewport.height * viewport.scale)}px`);
    // iOS may scroll the page to reveal the focused input; the page is sized to fit, so undo it.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}

async function main() {
  fitToVisualViewport();
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
