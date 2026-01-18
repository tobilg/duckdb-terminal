/**
 * AI Settings Persistence
 *
 * Handles persistence of AI proxy configuration using localStorage.
 * Follows the same pattern as themes/index.ts for consistency.
 */

const AI_SETTINGS_KEY = 'duckdb-terminal-ai-settings';
const DEFAULT_ENDPOINT = 'http://localhost:4000';
const DEFAULT_PROVIDER = 'claude';

/**
 * Configuration for the AI proxy
 */
export interface AISettings {
  /** The proxy endpoint URL */
  endpoint: string;
  /** The selected AI provider name */
  provider: string;
}

/**
 * Provider information from the proxy API
 */
export interface AIProvider {
  name: string;
  description: string;
}

/**
 * Get the default endpoint URL
 */
export function getDefaultEndpoint(): string {
  return DEFAULT_ENDPOINT;
}

/**
 * Get the default provider name
 */
export function getDefaultProvider(): string {
  return DEFAULT_PROVIDER;
}

/**
 * Get saved AI settings from localStorage
 */
export function getAISettings(): AISettings {
  try {
    const saved = localStorage.getItem(AI_SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        endpoint: parsed.endpoint || DEFAULT_ENDPOINT,
        provider: parsed.provider || DEFAULT_PROVIDER,
      };
    }
  } catch {
    // localStorage not available or invalid JSON
  }
  return { endpoint: DEFAULT_ENDPOINT, provider: DEFAULT_PROVIDER };
}

/**
 * Save AI settings to localStorage
 */
export function saveAISettings(settings: Partial<AISettings>): void {
  try {
    const current = getAISettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    // localStorage not available
  }
}

/**
 * Clear AI settings from localStorage
 */
export function clearAISettings(): void {
  try {
    localStorage.removeItem(AI_SETTINGS_KEY);
  } catch {
    // localStorage not available
  }
}
