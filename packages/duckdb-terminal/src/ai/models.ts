/**
 * Catalog of the local language models offered by the `.model` command.
 *
 * The models and their settings follow the duckdb-wasm-shell-wllama demo. Each
 * one is a single GGUF file on the Hugging Face Hub (all Apache-2.0 licensed),
 * downloaded once and cached in the browser.
 *
 * @module ai/models
 */

/** Sampling settings recommended for a model. */
export interface AIModelSampling {
  temperature: number;
  top_p: number;
  top_k?: number;
}

/** A local model that can be installed with `.model`. */
export interface AIModel {
  /** Stable identifier, persisted as the user's selection. */
  id: string;
  /** Display name. */
  label: string;
  /** Hugging Face repository. */
  repo: string;
  /** GGUF file within the repository. */
  file: string;
  /** Exact download size in bytes. */
  sizeBytes: number;
  /** Context window used when the model is loaded. */
  contextSize: number;
  /** Recommended sampling settings. */
  sampling: AIModelSampling;
}

const QWEN_SAMPLING: AIModelSampling = { temperature: 0.7, top_p: 0.95, top_k: 20 };

/** The models offered by `.model`, smallest first. The first one is the suggested default. */
export const AI_MODELS: readonly AIModel[] = [
  {
    id: 'qwen3.5-0.8b',
    label: 'Qwen3.5 0.8B (Q4_0)',
    repo: 'ggml-org/Qwen3.5-0.8B-GGUF',
    file: 'Qwen3.5-0.8B-Q4_0.gguf',
    sizeBytes: 563_036_064,
    contextSize: 16_384,
    sampling: QWEN_SAMPLING,
  },
  {
    id: 'minicpm5-1b',
    label: 'MiniCPM5 1B (Q4_K_M)',
    repo: 'openbmb/MiniCPM5-1B-GGUF',
    file: 'MiniCPM5-1B-Q4_K_M.gguf',
    sizeBytes: 688_065_920,
    contextSize: 16_384,
    sampling: { temperature: 0.9, top_p: 0.95 },
  },
  {
    id: 'qwen3.5-2b',
    label: 'Qwen3.5 2B (Q4_K_XL)',
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    file: 'Qwen3.5-2B-UD-Q4_K_XL.gguf',
    sizeBytes: 1_339_752_704,
    contextSize: 16_384,
    sampling: QWEN_SAMPLING,
  },
  {
    id: 'qwen3.5-4b',
    label: 'Qwen3.5 4B (Q4_K_XL)',
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    file: 'Qwen3.5-4B-UD-Q4_K_XL.gguf',
    sizeBytes: 2_912_109_728,
    contextSize: 16_384,
    sampling: QWEN_SAMPLING,
  },
];

/** Download URL of a model's GGUF file. Also identifies the model in wllama's cache. */
export function getModelUrl(model: AIModel): string {
  return `https://huggingface.co/${model.repo}/resolve/main/${model.file}`;
}

/** Formats a byte count as whole mebibytes, e.g. `537 MiB`. */
export function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/** Finds a catalog model by its identifier. */
export function findModel(id: string | null | undefined): AIModel | undefined {
  return AI_MODELS.find((model) => model.id === id);
}
