/**
 * Command handlers for DuckDB Terminal
 *
 * This module contains all the logic for handling dot commands like
 * .help, .tables, .schema, .mode, etc.
 *
 * @module commands
 */

import type { Database } from './database';
import type { QueryResult } from './types';
import type { FileInfo } from './utils/file-handler';
import type { LinkProvider } from './utils/link-provider';
import { formatTable, formatCSV, formatTSV, formatJSON } from './utils/table-formatter';
import { copyToClipboard } from './utils/clipboard';
import { formatFileSize, pickFiles } from './utils/file-handler';
import * as vt100 from './utils/vt100';

/**
 * Handler function for a command
 */
export type CommandHandler = (args: string[]) => Promise<void> | void;

/**
 * Definition of a dot command
 */
export interface Command {
  /** Command name including the dot prefix */
  name: string;
  /** Short description of what the command does */
  description: string;
  /** Usage example */
  usage?: string;
  /** The function that handles the command */
  handler: CommandHandler;
}

/**
 * Interface for the terminal context needed by command handlers
 */
export interface CommandContext {
  /** Write text to terminal (no newline) */
  write: (text: string) => void;
  /** Write text to terminal with newline */
  writeln: (text: string) => void;
  /** Clear the terminal */
  clear: () => void;
  /** Get the database instance */
  getDatabase: () => Database;
  /** Get loaded files map */
  getLoadedFiles: () => Map<string, FileInfo>;
  /** Get last query result */
  getLastQueryResult: () => QueryResult | null;
  /** Get current output mode */
  getOutputMode: () => 'table' | 'csv' | 'tsv' | 'json';
  /** Set output mode */
  setOutputMode: (mode: 'table' | 'csv' | 'tsv' | 'json') => void;
  /** Get timer status */
  getShowTimer: () => boolean;
  /** Set timer status */
  setShowTimer: (enabled: boolean) => void;
  /** Get syntax highlighting status */
  getSyntaxHighlighting: () => boolean;
  /** Set syntax highlighting status */
  setSyntaxHighlighting: (enabled: boolean) => void;
  /** Get link provider */
  getLinkProvider: () => LinkProvider;
  /** Get page size */
  getPageSize: () => number;
  /** Set page size */
  setPageSize: (size: number) => void;
  /** Get current prompt */
  getPrompt: () => string;
  /** Get current continuation prompt */
  getContinuationPrompt: () => string;
  /** Set prompts */
  setPrompts: (primary: string, continuation?: string) => void;
  /** Get highlighted SQL */
  getHighlightedSQL: (sql: string) => string;
  /** Set theme */
  setTheme: (theme: 'dark' | 'light') => void;
  /** Get current theme name */
  getThemeName: () => string;
  /** Load a file */
  loadFile: (file: File) => Promise<void>;
  /** Remove a loaded file */
  removeFile: (filename: string) => Promise<void>;
  /** Reset the terminal state */
  resetState: () => Promise<void>;
}

/**
 * Creates all command definitions for the terminal
 */
export function createCommands(ctx: CommandContext): Map<string, Command> {
  const commands = new Map<string, Command>();

  commands.set('.help', {
    name: '.help',
    description: 'Show available commands',
    handler: () => cmdHelp(commands, ctx),
  });

  commands.set('.clear', {
    name: '.clear',
    description: 'Clear the terminal',
    handler: () => ctx.clear(),
  });

  commands.set('.tables', {
    name: '.tables',
    description: 'List all tables',
    handler: () => cmdTables(ctx),
  });

  commands.set('.schema', {
    name: '.schema',
    description: 'Show table schema',
    usage: '.schema <table_name>',
    handler: (args) => cmdSchema(args, ctx),
  });

  commands.set('.timer', {
    name: '.timer',
    description: 'Toggle query timing',
    usage: '.timer on|off',
    handler: (args) => cmdTimer(args, ctx),
  });

  commands.set('.mode', {
    name: '.mode',
    description: 'Set output mode',
    usage: '.mode table|csv|tsv|json',
    handler: (args) => cmdMode(args, ctx),
  });

  commands.set('.theme', {
    name: '.theme',
    description: 'Set color theme (clears screen)',
    usage: '.theme dark|light',
    handler: (args) => cmdTheme(args, ctx),
  });

  commands.set('.examples', {
    name: '.examples',
    description: 'Show example queries',
    handler: () => cmdExamples(ctx),
  });

  commands.set('.files', {
    name: '.files',
    description: 'Manage loaded files',
    usage: '.files [list|add|remove <name|index>]',
    handler: (args) => cmdFiles(args, ctx),
  });

  commands.set('.open', {
    name: '.open',
    description: 'Open a file picker to load files',
    handler: () => cmdOpen(ctx),
  });

  commands.set('.copy', {
    name: '.copy',
    description: 'Copy last result to clipboard',
    handler: () => cmdCopy(ctx),
  });

  commands.set('.highlight', {
    name: '.highlight',
    description: 'Toggle syntax highlighting',
    usage: '.highlight on|off',
    handler: (args) => cmdHighlight(args, ctx),
  });

  commands.set('.links', {
    name: '.links',
    description: 'Toggle clickable URL detection',
    usage: '.links on|off',
    handler: (args) => cmdLinks(args, ctx),
  });

  commands.set('.pagesize', {
    name: '.pagesize',
    description: 'Enable pagination for large results (default: off)',
    usage: '.pagesize <number> (0 = disabled)',
    handler: (args) => cmdPageSize(args, ctx),
  });

  commands.set('.reset', {
    name: '.reset',
    description: 'Reset database and all settings to defaults',
    handler: () => cmdReset(ctx),
  });

  commands.set('.prompt', {
    name: '.prompt',
    description: 'Get or set the command prompt',
    usage: '.prompt [primary [continuation]]',
    handler: (args) => cmdPrompt(args, ctx),
  });

  return commands;
}

// ==================== Command Handlers ====================

function cmdHelp(commands: Map<string, Command>, ctx: CommandContext): void {
  ctx.writeln(vt100.bold('Available commands:'));
  ctx.writeln('');
  for (const cmd of commands.values()) {
    const usage = cmd.usage ? `  ${vt100.dim(cmd.usage)}` : '';
    ctx.writeln(`  ${vt100.colorize(cmd.name, vt100.FG_CYAN)}  ${cmd.description}${usage}`);
  }
  ctx.writeln('');
  ctx.writeln('SQL statements must end with a semicolon (;)');
}

async function cmdTables(ctx: CommandContext): Promise<void> {
  const tables = await ctx.getDatabase().getTables();
  if (tables.length === 0) {
    ctx.writeln(vt100.dim('No tables found'));
    return;
  }
  for (const table of tables) {
    ctx.writeln(table);
  }
}

async function cmdSchema(args: string[], ctx: CommandContext): Promise<void> {
  if (args.length === 0) {
    ctx.writeln('Usage: .schema <table_name>');
    return;
  }
  const schema = await ctx.getDatabase().getTableSchema(args[0]);
  if (schema.length === 0) {
    ctx.writeln(vt100.dim(`Table not found: ${args[0]}`));
    return;
  }
  for (const col of schema) {
    ctx.writeln(`  ${col.name} ${vt100.dim(col.type)}`);
  }
}

function cmdTimer(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    ctx.writeln(`Timer is ${ctx.getShowTimer() ? 'on' : 'off'}`);
    return;
  }
  const value = args[0].toLowerCase();
  if (value === 'on') {
    ctx.setShowTimer(true);
    ctx.writeln('Timer is now on');
  } else if (value === 'off') {
    ctx.setShowTimer(false);
    ctx.writeln('Timer is now off');
  } else {
    ctx.writeln('Usage: .timer on|off');
  }
}

function cmdMode(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    ctx.writeln(`Output mode: ${ctx.getOutputMode()}`);
    return;
  }
  const mode = args[0].toLowerCase();
  if (mode === 'table' || mode === 'csv' || mode === 'tsv' || mode === 'json') {
    ctx.setOutputMode(mode);
    ctx.writeln(`Output mode set to ${mode}`);
  } else {
    ctx.writeln('Usage: .mode table|csv|tsv|json');
  }
}

function cmdTheme(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    ctx.writeln(`Theme: ${ctx.getThemeName()}`);
    return;
  }
  const theme = args[0].toLowerCase();
  if (theme === 'dark' || theme === 'light') {
    ctx.setTheme(theme);
  } else {
    ctx.writeln('Usage: .theme dark|light');
  }
}

function cmdExamples(ctx: CommandContext): void {
  ctx.writeln(vt100.bold('Example queries:'));
  ctx.writeln('');
  ctx.writeln(vt100.colorize('  -- Create a table', vt100.FG_BRIGHT_BLACK));
  ctx.writeln('  ' + ctx.getHighlightedSQL('CREATE TABLE users (id INTEGER, name VARCHAR);'));
  ctx.writeln('');
  ctx.writeln(vt100.colorize('  -- Insert data', vt100.FG_BRIGHT_BLACK));
  ctx.writeln('  ' + ctx.getHighlightedSQL("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');"));
  ctx.writeln('');
  ctx.writeln(vt100.colorize('  -- Query data', vt100.FG_BRIGHT_BLACK));
  ctx.writeln('  ' + ctx.getHighlightedSQL("SELECT * FROM users WHERE name LIKE 'A%';"));
  ctx.writeln('');
  ctx.writeln(vt100.colorize('  -- Use built-in functions', vt100.FG_BRIGHT_BLACK));
  ctx.writeln('  ' + ctx.getHighlightedSQL('SELECT range(10), current_timestamp;'));
}

async function cmdFiles(args: string[], ctx: CommandContext): Promise<void> {
  const subcommand = args[0]?.toLowerCase() ?? 'list';
  const loadedFiles = ctx.getLoadedFiles();

  if (subcommand === 'list') {
    if (loadedFiles.size === 0) {
      ctx.writeln(vt100.dim('No files loaded'));
      ctx.writeln(vt100.dim('Use .open or drag-and-drop to add files'));
      return;
    }
    ctx.writeln(vt100.bold('Loaded files:'));
    let index = 1;
    for (const [name, info] of loadedFiles) {
      ctx.writeln(`  ${vt100.dim(`${index}.`)} ${name} ${vt100.dim(`(${formatFileSize(info.size)})`)}`);
      index++;
    }
  } else if (subcommand === 'add') {
    await cmdOpen(ctx);
  } else if (subcommand === 'remove' || subcommand === 'rm') {
    const target = args.slice(1).join(' ');
    if (!target) {
      ctx.writeln('Usage: .files remove <filename|index>');
      return;
    }

    // Try to parse as index first
    const index = parseInt(target, 10);
    let filenameToRemove: string | null = null;

    if (!isNaN(index) && index >= 1) {
      // Get filename by index
      const filesArray = Array.from(loadedFiles.keys());
      if (index <= filesArray.length) {
        filenameToRemove = filesArray[index - 1];
      } else {
        ctx.writeln(vt100.colorize(`Invalid index: ${index}. Use .files list to see available files.`, 'red'));
        return;
      }
    } else {
      // Treat as filename
      if (loadedFiles.has(target)) {
        filenameToRemove = target;
      } else {
        ctx.writeln(vt100.colorize(`File not found: ${target}`, 'red'));
        return;
      }
    }

    if (filenameToRemove) {
      try {
        await ctx.removeFile(filenameToRemove);
        ctx.writeln(vt100.colorize(`Removed: ${filenameToRemove}`, 'green'));
      } catch (error) {
        ctx.writeln(vt100.colorize(`Error removing file: ${error}`, 'red'));
      }
    }
  } else {
    ctx.writeln('Usage: .files [list|add|remove <name|index>]');
  }
}

async function cmdOpen(ctx: CommandContext): Promise<void> {
  ctx.writeln(vt100.dim('Opening file picker...'));
  const files = await pickFiles({
    multiple: true,
    accept: '.csv,.parquet,.json,.db,.duckdb',
  });

  if (files.length === 0) {
    ctx.writeln(vt100.dim('No files selected'));
    return;
  }

  for (const file of files) {
    await ctx.loadFile(file);
  }
}

function cmdHighlight(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    ctx.writeln(`Syntax highlighting is ${ctx.getSyntaxHighlighting() ? 'on' : 'off'}`);
    return;
  }
  const value = args[0].toLowerCase();
  if (value === 'on') {
    ctx.setSyntaxHighlighting(true);
    ctx.writeln('Syntax highlighting is now on');
  } else if (value === 'off') {
    ctx.setSyntaxHighlighting(false);
    ctx.writeln('Syntax highlighting is now off');
  } else {
    ctx.writeln('Usage: .highlight on|off');
  }
}

function cmdLinks(args: string[], ctx: CommandContext): void {
  const linkProvider = ctx.getLinkProvider();
  if (args.length === 0) {
    ctx.writeln(`URL link detection is ${linkProvider.isEnabled() ? 'on' : 'off'}`);
    return;
  }
  const value = args[0].toLowerCase();
  if (value === 'on') {
    linkProvider.setEnabled(true);
    ctx.writeln('URL link detection is now on');
  } else if (value === 'off') {
    linkProvider.setEnabled(false);
    ctx.writeln('URL link detection is now off');
  } else {
    ctx.writeln('Usage: .links on|off');
  }
}

function cmdPageSize(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    const pageSize = ctx.getPageSize();
    if (pageSize === 0) {
      ctx.writeln('Pagination is disabled (showing all rows)');
    } else {
      ctx.writeln(`Page size: ${pageSize} rows`);
    }
    return;
  }
  const size = parseInt(args[0], 10);
  if (isNaN(size) || size < 0) {
    ctx.writeln('Usage: .pagesize <number> (0 = no pagination)');
    return;
  }
  ctx.setPageSize(size);
  if (size === 0) {
    ctx.writeln('Pagination disabled (will show all rows)');
  } else {
    ctx.writeln(`Page size set to ${size} rows`);
  }
}

async function cmdReset(ctx: CommandContext): Promise<void> {
  await ctx.resetState();
}

function cmdPrompt(args: string[], ctx: CommandContext): void {
  if (args.length === 0) {
    // Show current prompts
    ctx.writeln(`Primary prompt: "${ctx.getPrompt()}"`);
    ctx.writeln(`Continuation prompt: "${ctx.getContinuationPrompt()}"`);
    return;
  }

  // Set primary prompt (first arg)
  const newPrompt = args[0];

  // Optionally set continuation prompt (second arg)
  if (args.length >= 2) {
    ctx.setPrompts(newPrompt, args[1]);
    ctx.writeln(`Prompts set to "${newPrompt}" and "${args[1]}"`);
  } else {
    ctx.setPrompts(newPrompt);
    ctx.writeln(`Primary prompt set to "${newPrompt}"`);
  }
}

async function cmdCopy(ctx: CommandContext): Promise<void> {
  const lastResult = ctx.getLastQueryResult();
  if (!lastResult) {
    ctx.writeln(vt100.dim('No query result to copy'));
    return;
  }

  const mode = ctx.getOutputMode();
  let content: string;

  switch (mode) {
    case 'csv':
      content = formatCSV(lastResult.columns, lastResult.rows);
      break;
    case 'tsv':
      content = formatTSV(lastResult.columns, lastResult.rows);
      break;
    case 'json':
      content = formatJSON(lastResult.columns, lastResult.rows);
      break;
    default:
      content = formatTable(lastResult.columns, lastResult.rows);
  }

  const success = await copyToClipboard(content);
  if (success) {
    ctx.writeln(vt100.colorize(`Copied ${lastResult.rowCount} rows to clipboard (${mode} format)`, vt100.FG_GREEN));
  } else {
    ctx.writeln(vt100.colorize('Failed to copy to clipboard', vt100.FG_RED));
  }
}
