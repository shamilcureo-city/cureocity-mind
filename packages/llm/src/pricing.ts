/**
 * Vertex Gemini pricing as of January 2026, per 1M tokens (USD).
 * Audio is billed at ~32 tokens/second.
 *
 * Source: cloud.google.com/vertex-ai/generative-ai/pricing
 * UPDATE THIS when Google moves pricing.
 */
const USD_PER_INR = 1 / 83;

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const FLASH_PRICING: ModelPricing = {
  inputUsdPerMillion: 0.075,
  outputUsdPerMillion: 0.3,
};

export const PRO_PRICING: ModelPricing = {
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 5.0,
};

export function computeCostInr(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): number {
  const usd =
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  const inr = usd / USD_PER_INR;
  return Math.round(inr * 10_000) / 10_000;
}

/**
 * Rough audio→token conversion (Gemini documents ~32 tok/s for audio).
 */
export function estimateAudioInputTokens(durationMs: number): number {
  return Math.ceil((durationMs / 1000) * 32);
}
