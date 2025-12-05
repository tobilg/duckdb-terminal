import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { darkTheme, lightTheme, getTheme, getSavedTheme, saveTheme } from './index';

describe('themes', () => {
  describe('darkTheme', () => {
    it('should have name "dark"', () => {
      expect(darkTheme.name).toBe('dark');
    });

    it('should have all required colors', () => {
      expect(darkTheme.colors).toBeDefined();
      expect(darkTheme.colors.background).toBeDefined();
      expect(darkTheme.colors.foreground).toBeDefined();
      expect(darkTheme.colors.cursor).toBeDefined();
      expect(darkTheme.colors.selection).toBeDefined();
      expect(darkTheme.colors.black).toBeDefined();
      expect(darkTheme.colors.red).toBeDefined();
      expect(darkTheme.colors.green).toBeDefined();
      expect(darkTheme.colors.yellow).toBeDefined();
      expect(darkTheme.colors.blue).toBeDefined();
      expect(darkTheme.colors.magenta).toBeDefined();
      expect(darkTheme.colors.cyan).toBeDefined();
      expect(darkTheme.colors.white).toBeDefined();
    });

    it('should have bright color variants', () => {
      expect(darkTheme.colors.brightBlack).toBeDefined();
      expect(darkTheme.colors.brightRed).toBeDefined();
      expect(darkTheme.colors.brightGreen).toBeDefined();
      expect(darkTheme.colors.brightYellow).toBeDefined();
      expect(darkTheme.colors.brightBlue).toBeDefined();
      expect(darkTheme.colors.brightMagenta).toBeDefined();
      expect(darkTheme.colors.brightCyan).toBeDefined();
      expect(darkTheme.colors.brightWhite).toBeDefined();
    });

    it('should have dark background', () => {
      // Dark theme should have a dark background (low luminosity)
      expect(darkTheme.colors.background).toMatch(/^#[0-4]/);
    });
  });

  describe('lightTheme', () => {
    it('should have name "light"', () => {
      expect(lightTheme.name).toBe('light');
    });

    it('should have all required colors', () => {
      expect(lightTheme.colors).toBeDefined();
      expect(lightTheme.colors.background).toBeDefined();
      expect(lightTheme.colors.foreground).toBeDefined();
      expect(lightTheme.colors.cursor).toBeDefined();
    });

    it('should have light background', () => {
      // Light theme should have a light background
      expect(lightTheme.colors.background).toMatch(/^#[f]/i);
    });

    it('should have dark foreground', () => {
      // Light theme should have dark foreground text
      expect(lightTheme.colors.foreground).toMatch(/^#[0-4]/);
    });
  });

  describe('getTheme', () => {
    it('should return dark theme for "dark"', () => {
      const theme = getTheme('dark');
      expect(theme).toBe(darkTheme);
    });

    it('should return light theme for "light"', () => {
      const theme = getTheme('light');
      expect(theme).toBe(lightTheme);
    });
  });

  describe('getSavedTheme', () => {
    let mockStorage: { [key: string]: string };

    beforeEach(() => {
      mockStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStorage[key];
        }),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return "dark" by default', () => {
      expect(getSavedTheme()).toBe('dark');
    });

    it('should return saved "light" theme', () => {
      mockStorage['duckdb-terminal-theme'] = 'light';
      expect(getSavedTheme()).toBe('light');
    });

    it('should return saved "dark" theme', () => {
      mockStorage['duckdb-terminal-theme'] = 'dark';
      expect(getSavedTheme()).toBe('dark');
    });

    it('should return "dark" for invalid saved value', () => {
      mockStorage['duckdb-terminal-theme'] = 'invalid';
      expect(getSavedTheme()).toBe('dark');
    });

    it('should handle localStorage errors gracefully', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => {
          throw new Error('localStorage not available');
        }),
      });
      expect(getSavedTheme()).toBe('dark');
    });
  });

  describe('saveTheme', () => {
    let mockStorage: { [key: string]: string };

    beforeEach(() => {
      mockStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should save "dark" theme', () => {
      saveTheme('dark');
      expect(mockStorage['duckdb-terminal-theme']).toBe('dark');
    });

    it('should save "light" theme', () => {
      saveTheme('light');
      expect(mockStorage['duckdb-terminal-theme']).toBe('light');
    });

    it('should handle localStorage errors gracefully', () => {
      vi.stubGlobal('localStorage', {
        setItem: vi.fn(() => {
          throw new Error('localStorage not available');
        }),
      });
      // Should not throw
      expect(() => saveTheme('dark')).not.toThrow();
    });
  });

  describe('theme color validity', () => {
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

    it('dark theme colors should be valid hex colors', () => {
      Object.values(darkTheme.colors).forEach((color) => {
        expect(color).toMatch(hexColorRegex);
      });
    });

    it('light theme colors should be valid hex colors', () => {
      Object.values(lightTheme.colors).forEach((color) => {
        expect(color).toMatch(hexColorRegex);
      });
    });
  });

  describe('theme contrast', () => {
    it('dark theme should have sufficient contrast', () => {
      // Background is dark, foreground should be light
      const bgDark = parseInt(darkTheme.colors.background.slice(1, 3), 16) < 128;
      const fgLight = parseInt(darkTheme.colors.foreground.slice(1, 3), 16) > 128;
      expect(bgDark).toBe(true);
      expect(fgLight).toBe(true);
    });

    it('light theme should have sufficient contrast', () => {
      // Background is light, foreground should be dark
      const bgLight = parseInt(lightTheme.colors.background.slice(1, 3), 16) > 128;
      const fgDark = parseInt(lightTheme.colors.foreground.slice(1, 3), 16) < 128;
      expect(bgLight).toBe(true);
      expect(fgDark).toBe(true);
    });
  });
});
