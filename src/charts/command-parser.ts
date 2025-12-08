import type { ChartCommandOptions, ChartType } from './types';

/**
 * Valid chart types for validation
 */
const VALID_CHART_TYPES: ChartType[] = ['line', 'bar', 'scatter', 'histogram'];

/**
 * Parse result with potential error
 */
export interface ParseResult {
  success: boolean;
  options?: ChartCommandOptions;
  error?: string;
}

/**
 * Parse .chart command arguments
 *
 * Supported syntax:
 * - .chart                     - Show chart with auto-detection
 * - .chart hide                - Hide chart overlay
 * - .chart export              - Export chart as PNG
 * - .chart type=bar            - Force bar chart
 * - .chart x=date              - Set X axis column
 * - .chart y=revenue           - Set Y axis column
 * - .chart y=revenue,cost      - Set multiple Y columns
 * - .chart type=scatter x=age y=income
 */
export function parseChartCommand(input: string): ParseResult {
  // Remove leading .chart and trim
  const args = input.replace(/^\.chart\s*/, '').trim();

  // Empty args = show chart with auto-detection
  if (!args) {
    return {
      success: true,
      options: { action: 'show' },
    };
  }

  // Check for simple actions
  const lowerArgs = args.toLowerCase();
  if (lowerArgs === 'export' || lowerArgs === 'export png') {
    return {
      success: true,
      options: { action: 'export', exportFormat: 'png' },
    };
  }

  // Parse key=value pairs
  const options: ChartCommandOptions = { action: 'show' };
  const parts = tokenize(args);

  for (const part of parts) {
    const [key, value] = parseKeyValue(part);

    if (!key || !value) {
      return {
        success: false,
        error: `Invalid argument: '${part}'. Use format: key=value`,
      };
    }

    switch (key.toLowerCase()) {
      case 'type':
        const chartType = value.toLowerCase() as ChartType;
        if (!VALID_CHART_TYPES.includes(chartType)) {
          return {
            success: false,
            error: `Unknown chart type '${value}'. Use: ${VALID_CHART_TYPES.join(', ')}`,
          };
        }
        options.type = chartType;
        break;

      case 'x':
        options.x = value;
        break;

      case 'y':
        options.y = value.split(',').map((v) => v.trim());
        break;

      default:
        return {
          success: false,
          error: `Unknown option '${key}'. Valid options: type, x, y`,
        };
    }
  }

  return {
    success: true,
    options,
  };
}

/**
 * Tokenize command arguments, respecting quoted strings
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse a single key=value pair
 */
function parseKeyValue(input: string): [string | null, string | null] {
  const eqIndex = input.indexOf('=');
  if (eqIndex === -1) {
    return [null, null];
  }

  const key = input.slice(0, eqIndex).trim();
  const value = input.slice(eqIndex + 1).trim();

  if (!key || !value) {
    return [null, null];
  }

  return [key, value];
}

/**
 * Format help text for .chart command
 */
export function getChartHelpText(): string {
  return `Usage: .chart [options]

Show an interactive chart of the last query result.

Actions:
  .chart              Show chart with auto-detection
  .chart export       Export chart as PNG

Options:
  type=TYPE          Chart type: line, bar, scatter, histogram
  x=COLUMN           Column for X axis
  y=COLUMN[,...]     Column(s) for Y axis (comma-separated)

Examples:
  .chart                          Auto-detect chart type
  .chart type=bar                 Force bar chart
  .chart x=date y=revenue         Specify axes
  .chart type=line y=revenue,cost Multiple series

Press ESC to close the chart, Ctrl+S to export as PNG.`;
}
