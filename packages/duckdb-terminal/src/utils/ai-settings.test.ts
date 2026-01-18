import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAISettings,
  saveAISettings,
  getDefaultEndpoint,
  getDefaultProvider,
  clearAISettings,
} from './ai-settings';

describe('ai-settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getDefaultEndpoint', () => {
    it('returns the default endpoint', () => {
      expect(getDefaultEndpoint()).toBe('http://localhost:4000');
    });
  });

  describe('getDefaultProvider', () => {
    it('returns the default provider', () => {
      expect(getDefaultProvider()).toBe('claude');
    });
  });

  describe('getAISettings', () => {
    it('returns default settings when nothing is saved', () => {
      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('claude');
    });

    it('returns saved endpoint', () => {
      localStorage.setItem(
        'duckdb-terminal-ai-settings',
        JSON.stringify({
          endpoint: 'http://custom:8000',
          provider: 'openai',
        })
      );

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://custom:8000');
      expect(settings.provider).toBe('openai');
    });

    it('returns saved provider', () => {
      localStorage.setItem(
        'duckdb-terminal-ai-settings',
        JSON.stringify({
          endpoint: 'http://localhost:4000',
          provider: 'openai',
        })
      );

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('openai');
    });

    it('returns default endpoint if saved endpoint is empty', () => {
      localStorage.setItem(
        'duckdb-terminal-ai-settings',
        JSON.stringify({
          endpoint: '',
          provider: 'anthropic',
        })
      );

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('anthropic');
    });

    it('returns default provider if saved provider is empty', () => {
      localStorage.setItem(
        'duckdb-terminal-ai-settings',
        JSON.stringify({
          endpoint: 'http://custom:8000',
          provider: '',
        })
      );

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://custom:8000');
      expect(settings.provider).toBe('claude');
    });

    it('handles invalid JSON gracefully', () => {
      localStorage.setItem('duckdb-terminal-ai-settings', 'invalid json');

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('claude');
    });
  });

  describe('saveAISettings', () => {
    it('saves endpoint', () => {
      saveAISettings({ endpoint: 'http://new:9000' });

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://new:9000');
      expect(settings.provider).toBe('claude');
    });

    it('saves provider', () => {
      saveAISettings({ provider: 'anthropic' });

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('anthropic');
    });

    it('merges with existing settings', () => {
      saveAISettings({ endpoint: 'http://test:1000' });
      saveAISettings({ provider: 'custom' });

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://test:1000');
      expect(settings.provider).toBe('custom');
    });
  });

  describe('clearAISettings', () => {
    it('removes all AI settings', () => {
      saveAISettings({ endpoint: 'http://test:1000', provider: 'openai' });
      clearAISettings();

      const settings = getAISettings();
      expect(settings.endpoint).toBe('http://localhost:4000');
      expect(settings.provider).toBe('claude');
    });
  });
});
