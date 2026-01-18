/**
 * AI Client
 *
 * HTTP client for communicating with the text-to-sql proxy.
 */

import type { AIProvider } from './ai-settings';

/**
 * Response from the proxy's /providers endpoint
 */
interface ProvidersResponse {
  providers: AIProvider[];
}

/**
 * Request body for the /generate-sql endpoint
 */
interface GenerateSQLRequest {
  ddl: string;
  question: string;
  provider?: string;
}

/**
 * Response from the /generate-sql endpoint
 */
interface GenerateSQLResponse {
  sql: string;
}

/**
 * Error class for AI client errors
 */
export class AIClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'AIClientError';
  }
}

/**
 * Normalize endpoint URL by removing trailing slash
 */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

/**
 * Check if the proxy is available at the given endpoint
 */
export async function checkProxyAvailable(endpoint: string): Promise<boolean> {
  const url = `${normalizeEndpoint(endpoint)}/providers`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch available providers from the proxy
 */
export async function fetchProviders(endpoint: string): Promise<AIProvider[]> {
  const url = `${normalizeEndpoint(endpoint)}/providers`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new AIClientError(
        `Failed to fetch providers: ${response.statusText}`,
        response.status,
        url
      );
    }

    const data: ProvidersResponse = await response.json();
    return data.providers || [];
  } catch (error) {
    if (error instanceof AIClientError) {
      throw error;
    }
    throw new AIClientError(
      `Network error connecting to ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      url
    );
  }
}

/**
 * Generate SQL from natural language query
 */
export async function generateSQL(
  endpoint: string,
  ddl: string,
  question: string,
  provider?: string
): Promise<string> {
  const url = `${normalizeEndpoint(endpoint)}/generate-sql`;

  const body: GenerateSQLRequest = {
    ddl,
    question,
  };

  if (provider) {
    body.provider = provider;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new AIClientError(`Failed to generate SQL: ${errorText}`, response.status, url);
    }

    const data: GenerateSQLResponse = await response.json();
    return data.sql;
  } catch (error) {
    if (error instanceof AIClientError) {
      throw error;
    }
    throw new AIClientError(
      `Network error connecting to ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      url
    );
  }
}
