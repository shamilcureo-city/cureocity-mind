/**
 * Vertex Gemini 2.5 standard pay-as-you-go list prices, per 1M tokens (USD).
 * Verified 2026-09-12 against the Google pricing page below.
 * Audio is billed at ~32 tokens/second at its own (higher) input rate.
 *
 * Source: cloud.google.com/vertex-ai/generative-ai/pricing
 * UPDATE THIS when Google moves pricing, and reconcile against the actual
 * Vertex invoice. These are estimates, not subscription charges or invoices:
 * FX is an explicit fixed assumption, and tax, credits, infrastructure,
 * explicit-cache storage and other services are excluded.
 */
export const ESTIMATED_INR_PER_USD = 83;

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
  const inr = usd * ESTIMATED_INR_PER_USD;
  return Math.round(inr * 10_000) / 10_000;
}

/**
 * Rough audio→token conversion (Gemini documents ~32 tok/s for audio).
 */
export function estimateAudioInputTokens(durationMs: number): number {
  return Math.ceil((durationMs / 1000) * 32);
}

/** Structural subset of Vertex's GenerateContentResponseUsageMetadata. */
export interface VertexUsageForCost {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  cacheTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
}

interface UsagePricing extends ModelPricing {
  audioInputUsdPerMillion: number;
  cachedTextUsdPerMillion: number;
  cachedAudioUsdPerMillion: number;
}

/** Never guess the price of an arbitrary env model override. */
function pricingForModel(model: string, inputTokens: number): UsagePricing | null {
  const name = model.split('/').at(-1) ?? model;
  if (/^gemini-2\.5-flash-lite(?:-\d{3})?$/.test(name)) {
    return {
      inputUsdPerMillion: 0.1,
      audioInputUsdPerMillion: 0.3,
      outputUsdPerMillion: 0.4,
      cachedTextUsdPerMillion: 0.01,
      cachedAudioUsdPerMillion: 0.03,
    };
  }
  if (/^gemini-2\.5-flash(?:-\d{3})?$/.test(name)) {
    return {
      ...FLASH_PRICING,
      audioInputUsdPerMillion: inputTokens > 200_000 ? 0.3 : 1,
      cachedTextUsdPerMillion: 0.03,
      cachedAudioUsdPerMillion: 0.1,
    };
  }
  if (/^gemini-2\.5-pro(?:-\d{3})?$/.test(name)) {
    const long = inputTokens > 200_000;
    return {
      inputUsdPerMillion: long ? 2.5 : 1.25,
      audioInputUsdPerMillion: long ? 2.5 : 1.25,
      outputUsdPerMillion: long ? 15 : 10,
      cachedTextUsdPerMillion: long ? 0.25 : 0.125,
      cachedAudioUsdPerMillion: long ? 0.25 : 0.125,
    };
  }
  return null;
}

/**
 * Estimate one completed request from provider usage, even when its content
 * fails validation. Prompt tokens INCLUDE cached tokens. Candidate and thought
 * tokens are disjoint and both billed as output. Audio is not text: the system
 * prompt must retain the text rate on every audio window.
 *
 * Usage fields: https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse
 * Prefer provider modality counts. If absent, the audio-duration fallback is
 * approximate; unknown cache modality uses the least-discounted modality first.
 * An unrecognised model retains the caller's legacy estimate, explicitly marked
 * pricingKnown=false. Never silently claim that fallback is its verified price.
 */
export function estimateVertexUsageCostInr(options: {
  model: string;
  usage?: VertexUsageForCost;
  fallbackInputTokens: number;
  fallbackOutputTokens?: number;
  fallbackAudioInputTokens?: number;
  fallbackPricing: ModelPricing;
  /** Only known HTTP 4xx/5xx responses are unbilled; timeouts remain uncertain. */
  requestError?: unknown;
}): { inputTokens: number; outputTokens: number; costInr: number; pricingKnown: boolean } {
  const { usage } = options;
  if (!usage && isUnbilledHttpError(options.requestError)) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      costInr: 0,
      pricingKnown: pricingForModel(options.model, 0) !== null,
    };
  }
  const promptTokens = tokenCount(usage?.promptTokenCount, options.fallbackInputTokens);
  const toolTokens = tokenCount(usage?.toolUsePromptTokenCount);
  const inputTokens = promptTokens + toolTokens;
  const outputTokens =
    tokenCount(usage?.candidatesTokenCount, options.fallbackOutputTokens) +
    tokenCount(usage?.thoughtsTokenCount);
  const pricing = pricingForModel(options.model, inputTokens);
  if (!pricing) {
    return {
      inputTokens,
      outputTokens,
      costInr: computeCostInr(inputTokens, outputTokens, options.fallbackPricing),
      pricingKnown: false,
    };
  }

  const details = usage?.promptTokensDetails;
  const audioTokens = Math.min(
    promptTokens,
    details?.length
      ? modalityTokens(details, 'AUDIO')
      : tokenCount(options.fallbackAudioInputTokens),
  );
  const textTokens = promptTokens - audioTokens;
  const cachedTokens = Math.min(promptTokens, tokenCount(usage?.cachedContentTokenCount));
  const cachedAudio = usage?.cacheTokensDetails?.length
    ? Math.min(audioTokens, cachedTokens, modalityTokens(usage.cacheTokensDetails, 'AUDIO'))
    : pricing.audioInputUsdPerMillion - pricing.cachedAudioUsdPerMillion <
        pricing.inputUsdPerMillion - pricing.cachedTextUsdPerMillion
      ? Math.min(audioTokens, cachedTokens)
      : Math.min(audioTokens, Math.max(0, cachedTokens - textTokens));
  const cachedText = Math.min(textTokens, cachedTokens - cachedAudio);
  const usd =
    ((textTokens - cachedText + toolTokens) * pricing.inputUsdPerMillion +
      cachedText * pricing.cachedTextUsdPerMillion +
      (audioTokens - cachedAudio) * pricing.audioInputUsdPerMillion +
      cachedAudio * pricing.cachedAudioUsdPerMillion +
      outputTokens * pricing.outputUsdPerMillion) /
    1_000_000;
  return {
    inputTokens,
    outputTokens,
    costInr: Math.round(usd * ESTIMATED_INR_PER_USD * 10_000) / 10_000,
    pricingKnown: true,
  };
}

function tokenCount(value?: number, fallback = 0): number {
  if (value !== undefined && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  return Number.isFinite(fallback) && fallback >= 0 ? Math.ceil(fallback) : 0;
}

function isUnbilledHttpError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return [candidate.status, candidate.code].some(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599,
  );
}

function modalityTokens(
  details: NonNullable<VertexUsageForCost['promptTokensDetails']>,
  modality: string,
): number {
  return details.reduce(
    (sum, detail) =>
      sum + (detail.modality?.toUpperCase() === modality ? tokenCount(detail.tokenCount) : 0),
    0,
  );
}
