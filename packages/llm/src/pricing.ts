/**
 * Vertex Gemini 2.5 pricing, per 1M tokens (USD) — trued up in Sprint 74 to
 * the published list prices (the previous constants were a model-generation
 * old and billed audio at the text rate, understating Pass-1 cost ~13×).
 * Audio is billed at ~32 tokens/second at its own (higher) input rate.
 *
 * Source: cloud.google.com/vertex-ai/generative-ai/pricing
 * UPDATE THIS when Google moves pricing, and reconcile against the actual
 * Vertex invoice — logged costs (GeminiCallLog.costInr) are only as honest
 * as this table.
 */
const USD_PER_INR = 1 / 83;

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/** Gemini 2.5 Flash — TEXT input (transcripts, prompts). */
export const FLASH_PRICING: ModelPricing = {
  inputUsdPerMillion: 0.3,
  outputUsdPerMillion: 2.5,
};

/**
 * Gemini 2.5 Flash — AUDIO input (Pass 1 / live transcription). Same output
 * rate as text; the input rate is what differs.
 */
export const FLASH_AUDIO_PRICING: ModelPricing = {
  inputUsdPerMillion: 1.0,
  outputUsdPerMillion: 2.5,
};

/** Gemini 2.5 Pro (≤200k-token prompts). Output includes thinking tokens. */
export const PRO_PRICING: ModelPricing = {
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 10.0,
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
