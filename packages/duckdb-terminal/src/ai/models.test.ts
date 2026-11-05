import { describe, it, expect } from 'vitest';
import { AI_MODELS, findModel, formatMiB, getModelUrl } from './models';

describe('AI model catalog', () => {
  it('offers the four demo models, smallest first, with unique ids', () => {
    expect(AI_MODELS.map((model) => model.id)).toEqual([
      'qwen3.5-0.8b', 'minicpm5-1b', 'qwen3.5-2b', 'qwen3.5-4b',
    ]);
    const sizes = AI_MODELS.map((model) => model.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it('builds Hugging Face download URLs', () => {
    expect(getModelUrl(AI_MODELS[0])).toBe(
      'https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf'
    );
  });

  it('formats sizes as whole mebibytes', () => {
    expect(AI_MODELS.map((model) => formatMiB(model.sizeBytes))).toEqual([
      '537 MiB', '656 MiB', '1278 MiB', '2777 MiB',
    ]);
    expect(formatMiB(0)).toBe('0 MiB');
  });

  it('finds models by id', () => {
    expect(findModel('qwen3.5-2b')?.label).toBe('Qwen3.5 2B (Q4_K_XL)');
    expect(findModel('unknown')).toBeUndefined();
    expect(findModel(null)).toBeUndefined();
  });
});
