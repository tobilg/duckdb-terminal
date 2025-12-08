import { describe, it, expect } from 'vitest';
import { parseChartCommand, getChartHelpText } from './command-parser';

describe('parseChartCommand', () => {
  describe('basic actions', () => {
    it('parses empty .chart command', () => {
      const result = parseChartCommand('.chart');

      expect(result.success).toBe(true);
      expect(result.options?.action).toBe('show');
    });

    it('parses .chart with trailing spaces', () => {
      const result = parseChartCommand('.chart   ');

      expect(result.success).toBe(true);
      expect(result.options?.action).toBe('show');
    });

    it('parses .chart export', () => {
      const result = parseChartCommand('.chart export');

      expect(result.success).toBe(true);
      expect(result.options?.action).toBe('export');
      expect(result.options?.exportFormat).toBe('png');
    });

    it('parses .chart export png', () => {
      const result = parseChartCommand('.chart export png');

      expect(result.success).toBe(true);
      expect(result.options?.action).toBe('export');
    });
  });

  describe('type option', () => {
    it('parses type=line', () => {
      const result = parseChartCommand('.chart type=line');

      expect(result.success).toBe(true);
      expect(result.options?.type).toBe('line');
    });

    it('parses type=bar', () => {
      const result = parseChartCommand('.chart type=bar');

      expect(result.success).toBe(true);
      expect(result.options?.type).toBe('bar');
    });

    it('parses type=scatter', () => {
      const result = parseChartCommand('.chart type=scatter');

      expect(result.success).toBe(true);
      expect(result.options?.type).toBe('scatter');
    });

    it('parses type=histogram', () => {
      const result = parseChartCommand('.chart type=histogram');

      expect(result.success).toBe(true);
      expect(result.options?.type).toBe('histogram');
    });

    it('rejects invalid chart type', () => {
      const result = parseChartCommand('.chart type=pie');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown chart type');
      expect(result.error).toContain('pie');
    });
  });

  describe('axis options', () => {
    it('parses x=column', () => {
      const result = parseChartCommand('.chart x=date');

      expect(result.success).toBe(true);
      expect(result.options?.x).toBe('date');
    });

    it('parses y=column', () => {
      const result = parseChartCommand('.chart y=value');

      expect(result.success).toBe(true);
      expect(result.options?.y).toEqual(['value']);
    });

    it('parses y=col1,col2,col3', () => {
      const result = parseChartCommand('.chart y=revenue,cost,profit');

      expect(result.success).toBe(true);
      expect(result.options?.y).toEqual(['revenue', 'cost', 'profit']);
    });

    it('parses combined x and y', () => {
      const result = parseChartCommand('.chart x=date y=value');

      expect(result.success).toBe(true);
      expect(result.options?.x).toBe('date');
      expect(result.options?.y).toEqual(['value']);
    });
  });

  describe('combined options', () => {
    it('parses type with axes', () => {
      const result = parseChartCommand('.chart type=bar x=category y=count');

      expect(result.success).toBe(true);
      expect(result.options?.type).toBe('bar');
      expect(result.options?.x).toBe('category');
      expect(result.options?.y).toEqual(['count']);
    });

    it('parses all options', () => {
      const result = parseChartCommand('.chart type=line x=date y=revenue,cost');

      expect(result.success).toBe(true);
      expect(result.options?.action).toBe('show');
      expect(result.options?.type).toBe('line');
      expect(result.options?.x).toBe('date');
      expect(result.options?.y).toEqual(['revenue', 'cost']);
    });
  });

  describe('error handling', () => {
    it('rejects invalid argument format', () => {
      const result = parseChartCommand('.chart invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid argument');
    });

    it('rejects unknown option', () => {
      const result = parseChartCommand('.chart foo=bar');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown option');
    });

    it('rejects empty value', () => {
      const result = parseChartCommand('.chart type=');

      expect(result.success).toBe(false);
    });
  });
});

describe('getChartHelpText', () => {
  it('returns help text', () => {
    const help = getChartHelpText();

    expect(help).toContain('Usage:');
    expect(help).toContain('.chart');
    expect(help).toContain('type=');
    expect(help).toContain('line');
    expect(help).toContain('bar');
    expect(help).toContain('scatter');
    expect(help).toContain('histogram');
    expect(help).toContain('ESC');
  });
});
