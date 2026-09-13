import { describe, expect, it } from 'vitest';
import {
  estimateVertexUsageCostInr,
  FLASH_AUDIO_PRICING,
  FLASH_PRICING,
  PRO_PRICING,
} from './pricing';

describe('Vertex usage cost estimates', () => {
  it('does not invent charges for explicit HTTP errors, while retaining uncertain timeout estimates', () => {
    const options = {
      model: 'gemini-2.5-flash',
      fallbackInputTokens: 1000,
      fallbackPricing: FLASH_PRICING,
    };
    expect(estimateVertexUsageCostInr({ ...options, requestError: { status: 429 } }).costInr).toBe(
      0,
    );
    expect(estimateVertexUsageCostInr({ ...options, requestError: { code: 503 } }).costInr).toBe(0);
    expect(
      estimateVertexUsageCostInr({ ...options, requestError: new Error('timeout') }).costInr,
    ).toBeGreaterThan(0);
    // A successful provider response whose content was rejected is still billable.
    expect(
      estimateVertexUsageCostInr({
        ...options,
        usage: { promptTokenCount: 1000 },
        requestError: new Error('invalid model content'),
      }).costInr,
    ).toBeGreaterThan(0);
  });
  it('prices audio and repeated text instructions separately', () => {
    const result = estimateVertexUsageCostInr({
      model: 'gemini-2.5-flash',
      fallbackInputTokens: 0,
      fallbackPricing: FLASH_AUDIO_PRICING,
      usage: {
        promptTokenCount: 2920,
        candidatesTokenCount: 500,
        promptTokensDetails: [
          { modality: 'TEXT', tokenCount: 1000 },
          { modality: 'AUDIO', tokenCount: 1920 },
        ],
      },
    });
    // 60s audio + 1k text + 500 output; illustrative, NOT a session invoice.
    expect(result).toEqual({
      inputTokens: 2920,
      outputTokens: 500,
      costInr: 0.288,
      pricingKnown: true,
    });
  });

  it('counts thinking tokens as output without double-counting candidates', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-pro',
        fallbackInputTokens: 0,
        fallbackPricing: PRO_PRICING,
        usage: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 800 },
      }),
    ).toEqual({ inputTokens: 1000, outputTokens: 1000, costInr: 0.9338, pricingKnown: true });
  });

  it('subtracts cached tokens from full-price input and applies modality-specific cache rates', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-flash',
        fallbackInputTokens: 0,
        fallbackPricing: FLASH_AUDIO_PRICING,
        usage: {
          promptTokenCount: 3000,
          cachedContentTokenCount: 1500,
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 1000 },
            { modality: 'AUDIO', tokenCount: 2000 },
          ],
          cacheTokensDetails: [
            { modality: 'TEXT', tokenCount: 500 },
            { modality: 'AUDIO', tokenCount: 1000 },
          ],
        },
      }).costInr,
    ).toBe(0.105);
  });

  it('conservatively allocates an unspecified mixed-input cache to text first', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-flash',
        fallbackInputTokens: 0,
        fallbackPricing: FLASH_AUDIO_PRICING,
        usage: {
          promptTokenCount: 3000,
          cachedContentTokenCount: 1500,
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 1000 },
            { modality: 'AUDIO', tokenCount: 2000 },
          ],
        },
      }).costInr,
    ).toBe(0.1311);
  });

  it('uses audio duration only when provider modality details are unavailable', () => {
    const options = {
      model: 'gemini-2.5-flash',
      fallbackInputTokens: 2000,
      fallbackOutputTokens: 0,
      fallbackAudioInputTokens: 1000,
      fallbackPricing: FLASH_AUDIO_PRICING,
    };
    expect(estimateVertexUsageCostInr(options).costInr).toBe(0.1079);
    expect(
      estimateVertexUsageCostInr({
        ...options,
        usage: {
          promptTokenCount: 2000,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 2000 }],
        },
      }).costInr,
    ).toBe(0.0498);
  });

  it('honours actual model routing instead of incorrectly using a caller Flash rate for Pro', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-pro',
        fallbackInputTokens: 1000,
        fallbackOutputTokens: 1000,
        fallbackPricing: FLASH_PRICING,
      }).costInr,
    ).toBe(0.9338);
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-flash-lite',
        fallbackInputTokens: 1000,
        fallbackOutputTokens: 1000,
        fallbackPricing: PRO_PRICING,
      }).costInr,
    ).toBe(0.0415);
  });

  it('applies long-context Pro prices to the entire request above 200k input tokens', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-pro',
        fallbackInputTokens: 200001,
        fallbackOutputTokens: 1000,
        fallbackPricing: PRO_PRICING,
      }).costInr,
    ).toBe(42.7452);
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-pro',
        fallbackInputTokens: 200000,
        fallbackOutputTokens: 1000,
        fallbackPricing: PRO_PRICING,
      }).costInr,
    ).toBe(21.58);
  });

  it('keeps the published long-context Flash audio and cache rates separate', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'gemini-2.5-flash',
        fallbackInputTokens: 0,
        fallbackPricing: FLASH_AUDIO_PRICING,
        usage: {
          promptTokenCount: 300000,
          cachedContentTokenCount: 100000,
          promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 300000 }],
          cacheTokensDetails: [{ modality: 'AUDIO', tokenCount: 100000 }],
        },
      }).costInr,
    ).toBe(5.81);
  });

  it('explicitly identifies unknown model prices while preserving the supplied fallback estimate', () => {
    expect(
      estimateVertexUsageCostInr({
        model: 'custom-model',
        fallbackInputTokens: 1000,
        fallbackOutputTokens: 1000,
        fallbackPricing: FLASH_PRICING,
      }),
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 1000,
      costInr: 0.2324,
      pricingKnown: false,
    });
  });

  it('includes tool-result input and clamps inconsistent provider counts without negative spend', () => {
    const result = estimateVertexUsageCostInr({
      model: 'gemini-2.5-flash',
      fallbackInputTokens: 0,
      fallbackPricing: FLASH_PRICING,
      usage: {
        promptTokenCount: 100,
        toolUsePromptTokenCount: 50,
        cachedContentTokenCount: 999,
        candidatesTokenCount: -5,
        thoughtsTokenCount: Number.NaN,
        promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 999 }],
      },
    });
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(0);
    expect(result.costInr).toBeGreaterThanOrEqual(0);
  });
});
