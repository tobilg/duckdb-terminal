/**
 * Settings that shape the assistant's answers. `tests/ai-eval` compares them
 * on a fixed task set with real models; DEFAULT_TUNING holds the winners.
 *
 * @module ai/tuning
 */

import { MAX_TOOL_ITERATIONS, type PromptStyle } from './prompt';

export interface AssistantTuning {
  /** Let the model reason before answering (rendered dimmed under "Thinking"). */
  thinking: boolean;
  /** Sampling temperature; null uses the model's catalog value. */
  temperature: number | null;
  /** Penalty for repeating tokens; Qwen recommends 1.5 against repetition loops. */
  presencePenalty: number;
  /**
   * System prompt and tool descriptions: the original list of rules, a short
   * numbered procedure with an example, or the guided prompt with error
   * recovery and DuckDB tips (see `PROMPTS` in prompt.ts).
   */
  prompt: PromptStyle;
  /** Sample rows per table sent with the schema (0 sends only the schema). */
  sampleRows: number;
  /** Send the distinct values of short text columns with the schema. */
  distinctValues: boolean;
  /**
   * Send the columns and first rows of files at URLs in the question and in
   * earlier questions of the conversation with the schema, as for loaded
   * files: small models do not look them up reliably.
   */
  describeUrls: boolean;
  /**
   * Ask the model once to run SQL that its answer shows but never ran, or that
   * contains placeholders; answer repeated identical queries without rerunning them;
   * point a query that misses a file at the URLs of the user's message; leave
   * names from the user's data (tables, columns, values) out of docs searches.
   */
  guardrails: boolean;
  /** Attach the documentation for the function a failing query names. */
  errorDocs: boolean;
  /**
   * Send the documentation that matches a question about how to do something
   * in DuckDB ("How do I split a string?", "pivot …") with the question:
   * small models rarely search it themselves.
   */
  docsContext: boolean;
  /** Model turns per prompt, tool calls included; the answer takes the last one. */
  maxSteps: number;
}

/** The behavior before any tuning; kept as the evaluation baseline. */
export const BASELINE_TUNING: Readonly<AssistantTuning> = {
  thinking: true,
  temperature: null,
  presencePenalty: 0,
  prompt: 'detailed',
  sampleRows: 0,
  distinctValues: false,
  describeUrls: false,
  guardrails: false,
  errorDocs: false,
  docsContext: false,
  // The original step limit.
  maxSteps: 8,
};

/**
 * The defaults, chosen with tests/ai-eval for the suggested model, Qwen3.5
 * 0.8B, which needs thinking to call tools at all.
 */
export const DEFAULT_TUNING: Readonly<AssistantTuning> = {
  thinking: true,
  temperature: 0.6,
  presencePenalty: 1.5,
  prompt: 'guided',
  sampleRows: 3,
  distinctValues: true,
  describeUrls: true,
  guardrails: true,
  errorDocs: true,
  docsContext: false,
  maxSteps: MAX_TOOL_ITERATIONS,
};
